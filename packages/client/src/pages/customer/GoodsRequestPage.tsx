import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import { AddressSearchInput } from '../../components/journey/AddressSearchInput';
import { FairPriceHint } from '../../components/journey/FairPriceHint';
import { reverseGeocodeOnce, isGeocodingUnavailable } from '../../hooks/useGeocodeSearch';
import { LocationPickerMap, type PickTarget, type PickedLocation, type PickOnMapRequest } from '../../components/map/LocationPickerMap';
import { PickOnMapButton } from '../../components/journey/PickOnMapButton';
import { PlaceDescriptionInput } from '../../components/journey/PlaceDescriptionInput';
import type { LandmarkSuggestion } from '../../lib/landmark-search';
import { BottomSheet, type SheetState } from '../../components/map/BottomSheet';
import { useJourneyStore } from '../../stores/journey.store';
import { useUIStore } from '../../stores/ui.store';
import { geolocation } from '../../hooks/useGeolocation';
import {
  DeliverySpeed,
  JourneyType,
  VehicleType,
  getVehicleCompliance,
  getParcelAllowance,
  validateParcelLoad,
} from '@bimoto/shared';
import { apiFetch, apiErrorFromResponse, isConnectivityError } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';
import { useAuthStore } from '../../stores/auth.store';
import { enqueueJourneyCreate, newClientId } from '../../lib/outbox';
import { SavedOfflineNotice } from '../../components/journey/SavedOfflineNotice';
import type { OutboxEntry } from '../../db/tables';
// PARCEL-CATEGORY — the same five choices, the same locale keys and the
// same option order the drop-a-package leg flow has offered since
// R3-DELIVERY-V2. Read from one module so the two flows cannot drift.
import {
  PARCEL_CATEGORIES,
  parcelCategoryLabelKey,
} from '../../lib/parcel-category';
import type { ParcelCategory } from '@bimoto/shared';

// PILOT-UX G3 — the real VehicleType enum (the old local list carried
// CAR/BICYCLE/VAN, which the server rejects, and omitted the electric
// types entirely). Labels come from the shared compliance matrix.
const VEHICLE_TYPES = Object.values(VehicleType);
const SIZE_OPTIONS = ['small', 'medium', 'large'] as const;
type GoodsSize = typeof SIZE_OPTIONS[number];

// TEAM-SAID G3 — exactly two speed tiers (Jean, item 13). Two, and
// not three: the messenger tiers above this form (priority, urgent)
// are a different axis with their own multipliers, and Jean's answer
// was two.
//
// Note there is no surcharge here and no percentage. Express is a
// label the motari reads; the fare is agreed through the normal
// suggest/bid mechanic, which is exactly what the team asked for when
// they said to drop predetermined surcharges.
const SPEED_OPTIONS = [
  { value: DeliverySpeed.STANDARD, labelKey: 'delivery.speedStandard', descKey: 'delivery.speedStandardDesc' },
  { value: DeliverySpeed.EXPRESS, labelKey: 'delivery.speedExpress', descKey: 'delivery.speedExpressDesc' },
] as const;

interface Location {
  lat: number;
  lng: number;
  address: string;
}

export const GoodsRequestPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setActiveJourney } = useJourneyStore();
  const { showToast, isOnline } = useUIStore();

  // Location fields
  const [pickup, setPickup] = useState<Location | null>(null);
  const [pickupQuery, setPickupQuery] = useState('');
  const [destination, setDestination] = useState<Location | null>(null);
  const [destinationQuery, setDestinationQuery] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>(VehicleType.MOTO);
  const [wishPrice, setWishPrice] = useState('');

  // Goods-specific fields
  const [goodsDescription, setGoodsDescription] = useState('');
  const [goodsSize, setGoodsSize] = useState<GoodsSize>('medium');
  // PARCEL-CATEGORY — what the package CONTAINS. null until the sender
  // picks one, and defaulted to OTHER on submit rather than being
  // pre-selected here: the leg flow's convention exactly
  // (GoodsStopEditor), and it keeps "chose Other" distinguishable from
  // "was shown Other and never looked" for as long as the state lives.
  //
  // Deliberately independent of `isFragile` below. FRAGILE is a member
  // of this list because Faustin asked for the identical list the
  // drop-a-package flow uses, and `goodsFragile` is a separate handling
  // boolean feeding tier and handling logic — a fragile electronics
  // parcel is legitimately ELECTRONICS with the fragile box ticked,
  // exactly as it is on a leg today.
  const [parcelCategory, setParcelCategory] = useState<ParcelCategory | null>(
    null,
  );
  // FIELD-FIT G5 — the declared weight, checked against the team's
  // rules for the chosen machine (shared/constants/parcel-weight).
  const [goodsWeightKg, setGoodsWeightKg] = useState('');
  // TEAM-SAID G3 — standard by default, as Jean specified.
  const [deliverySpeed, setDeliverySpeed] = useState<DeliverySpeed>(
    DeliverySpeed.STANDARD,
  );
  // LIVE-WIRE G5 — Jean's item 13(c): STANDARD may carry an OPTIONAL
  // 1/2/3-hour window. null is a real, ordinary answer ("no particular
  // hour"), which is why it is the default and why the selector offers
  // a way back to it. Express means now and never carries one, so
  // switching to Express clears it (see the speed buttons below) and
  // the server drops it too — the two can never disagree.
  const [standardHours, setStandardHours] = useState<1 | 2 | 3 | null>(null);
  const [isFragile, setIsFragile] = useState(false);
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  // PILOT-UX-2 G2 — map-first layout (form in a sheet over the map).
  const [sheetState, setSheetState] = useState<SheetState>('expanded');
  // BOOK-UNBLOCK G2 — explicit route to pick-on-map: the buttons next
  // to the address fields collapse the sheet and select the target.
  const [pickRequest, setPickRequest] = useState<PickOnMapRequest | null>(null);
  const [searchUnavailable, setSearchUnavailable] = useState(isGeocodingUnavailable());
  // OUTBOX G2 — a parcel held on this phone because the create never
  // left it. Same surface as the passenger booking; a held parcel and a
  // held ride must read identically.
  const [queuedEntry, setQueuedEntry] = useState<OutboxEntry | null>(null);

  // LANDMARKS G4 — the passenger's own words about the place, for the
  // places no database knows.
  const [pickupDescription, setPickupDescription] = useState('');
  const [destinationDescription, setDestinationDescription] = useState('');

  const requestPickOnMap = (target: PickTarget) => {
    setPickRequest((prev) => ({ target, seq: (prev?.seq ?? 0) + 1 }));
    setSheetState('collapsed');
  };

  // LANDMARKS G3 — a landmark the catalog names but cannot place. The
  // name goes in the field, the area hint seeds the description, and the
  // map opens for the pin.
  const handleUnplaceableLandmark = (
    target: PickTarget,
    landmark: LandmarkSuggestion,
  ) => {
    if (target === 'pickup') {
      setPickup(null);
      setPickupQuery(landmark.name);
      if (landmark.areaHint) setPickupDescription((d) => d || landmark.areaHint!);
    } else {
      setDestination(null);
      setDestinationQuery(landmark.name);
      if (landmark.areaHint) setDestinationDescription((d) => d || landmark.areaHint!);
    }
    requestPickOnMap(target);
  };

  const handlePickerConfirm = (target: PickTarget, loc: PickedLocation) => {
    if (target === 'pickup') {
      setPickup({ lat: loc.lat, lng: loc.lng, address: loc.address });
      setPickupQuery(loc.address);
    } else {
      setDestination({ lat: loc.lat, lng: loc.lng, address: loc.address });
      setDestinationQuery(loc.address);
    }
  };

  // BOOK-UNBLOCK G3 — live mirror of the pickup state so the async
  // entry pre-fill can check "has the user set anything yet?" at
  // resolution time, not at call time.
  const pickupStateRef = useRef({ pickup, pickupQuery });
  pickupStateRef.current = { pickup, pickupQuery };

  // Shared GPS→pickup flow: the manual "use my location" button and the
  // BOOK-UNBLOCK G3 entry pre-fill both run this. Silent mode never
  // toasts and never overwrites a pickup (or typed query) the user has
  // already set.
  const fillPickupFromGps = async ({ silent }: { silent: boolean }) => {
    try {
      const coords = await geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
      });
      if (
        silent &&
        (pickupStateRef.current.pickup ||
          pickupStateRef.current.pickupQuery.trim().length > 0)
      ) {
        return;
      }
      const genericLabel = t('journey.currentLocation');
      setPickup({
        lat: coords.lat,
        lng: coords.lng,
        address: genericLabel,
      });
      setPickupQuery(genericLabel);
      // GEOCODE (G3) — swap the generic label for a human-readable
      // address once the server reverse-geocodes the fix; silent fallback.
      if (isOnline) {
        void reverseGeocodeOnce(coords.lat, coords.lng).then((place) => {
          if (!place) return;
          setPickup((prev) =>
            prev && prev.lat === coords.lat && prev.lng === coords.lng
              ? { ...prev, address: place.label }
              : prev,
          );
          setPickupQuery((prev) => (prev === genericLabel ? place.label : prev));
        });
      }
    } catch (err: any) {
      if (silent) return;
      const key = err?.code === 'unsupported' ? 'journey.geoNotSupported' : 'journey.geoFailed';
      showToast(t(key), 'error');
    }
  };

  const handleUseMyLocation = async () => {
    setIsLocating(true);
    try {
      await fillPickupFromGps({ silent: false });
    } finally {
      setIsLocating(false);
    }
  };

  // BOOK-UNBLOCK G3 — start the user one point ahead: one silent GPS
  // attempt on entry. No toast, no spinner; on failure the user simply
  // sets pickup manually as before.
  useEffect(() => {
    void fillPickupFromGps({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // FIELD-FIT G5 — the rule for the chosen machine on a parcel-only
  // run. Recomputed as the customer switches vehicle, so the stated
  // limit is always the one that will actually be enforced.
  const parcelAllowance = getParcelAllowance(vehicleType, false);
  const overWeightLimit =
    parcelAllowance.maxWeightKg != null &&
    goodsWeightKg.trim() !== '' &&
    Number(goodsWeightKg) > parcelAllowance.maxWeightKg;
  const overSizeAdvisory =
    validateParcelLoad({
      vehicleType,
      journeyType: JourneyType.GOODS,
      sizeCategory: goodsSize.toUpperCase(),
    }).advisory != null;

  const handleSubmit = async () => {
    if (!pickup) {
      showToast(t('journey.pickupRequired'), 'error');
      return;
    }
    if (!destination) {
      showToast(t('journey.destinationRequired'), 'error');
      return;
    }
    if (!goodsDescription.trim()) {
      showToast(t('goods.descriptionRequired'), 'error');
      return;
    }
    if (!recipientName.trim()) {
      showToast(t('goods.recipientNameRequired'), 'error');
      return;
    }
    if (!recipientPhone.trim()) {
      showToast(t('goods.recipientPhoneRequired'), 'error');
      return;
    }

    setIsSubmitting(true);
    // OUTBOX G2 — this attempt's own name, minted before the first send
    // and reused on every replay (see NewJourneyPage for the full note).
    const clientRequestId = newClientId();
    let sentBody: Record<string, unknown> | null = null;
    try {
      const body: Record<string, unknown> = {
        clientRequestId,
        type: JourneyType.GOODS,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        pickupName: pickup.address,
        destinationLat: destination.lat,
        destinationLng: destination.lng,
        destinationName: destination.address,
        // LANDMARKS G4 — only when the passenger wrote something. An
        // empty field adds no key, so the body is byte-identical to
        // what it was before this field existed.
        ...(pickupDescription.trim() ? { pickupDescription: pickupDescription.trim() } : {}),
        ...(destinationDescription.trim()
          ? { destinationDescription: destinationDescription.trim() }
          : {}),
        goodsDescription: goodsDescription.trim(),
        goodsSizeCategory: goodsSize.toUpperCase(),
        // PARCEL-CATEGORY — always sent, defaulting to OTHER when the
        // sender didn't pick, so the motari's card carries a concrete
        // answer. The server stores what it is sent and injects no
        // default of its own (the leg-flow convention).
        parcelCategory: parcelCategory ?? 'OTHER',
        // FIELD-FIT G5 — only when the customer declared one; an empty
        // field adds no key, so the body is unchanged for anyone who
        // does not answer.
        ...(goodsWeightKg.trim() ? { goodsWeightKg: Number(goodsWeightKg) } : {}),
        // TEAM-SAID G3 — the tier tag. Always sent (the sender always
        // has one selected), and it reaches no pricing code: there is
        // no wishPrice adjustment here and none on the server.
        deliverySpeed,
        ...(deliverySpeed === DeliverySpeed.STANDARD && standardHours
          ? { standardDeliveryHours: standardHours }
          : {}),
        goodsFragile: isFragile,
        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone.trim(),
      };

      // Every offered option is a real VehicleType, so the preference
      // is always sent as-is (the old CAR/VAN placeholders had to be
      // dropped here because the server rejects them).
      body.vehiclePreference = vehicleType;

      if (wishPrice) {
        body.wishPrice = parseInt(wishPrice, 10);
      }

      sentBody = body;
      const res = await apiFetch(`/api/journeys`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!res.ok) throw await apiErrorFromResponse(res);

      const journey = await res.json();
      setActiveJourney(journey);
      navigate(`/journey/${journey.id}/bids`, { replace: true });
    } catch (err) {
      // OUTBOX G2 — no answer came back, so nothing was refused: hold
      // the parcel request on this phone. A 4xx is a real answer and is
      // never queued (isConnectivityError covers OFFLINE/UNREACHABLE
      // only) — it falls through to presentApiError exactly as before.
      const userId = useAuthStore.getState().user?.id;
      if (isConnectivityError(err) && userId && sentBody) {
        try {
          const entry = await enqueueJourneyCreate({
            userId,
            clientId: clientRequestId,
            payload: sentBody,
          });
          setQueuedEntry(entry);
          return;
        } catch (queueErr) {
          console.debug('[outbox] enqueue failed:', queueErr);
        }
      }
      presentApiError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // OUTBOX G2 — the parcel request is held on this phone. A distinct
  // screen, not a banner over a still-live form, so the sender cannot
  // press the button again and queue the same delivery twice.
  if (queuedEntry) {
    return (
      <SavedOfflineNotice
        entry={queuedEntry}
        userId={queuedEntry.userId}
        onCancelled={() => {
          setQueuedEntry(null);
          showToast(t('outbox.cancelled'), 'info');
          navigate('/', { replace: true });
        }}
        onDone={() => navigate('/', { replace: true })}
      />
    );
  }

  return (
    <>
      {/* PILOT-UX-2 G2 — full-viewport map behind the sheet. */}
      <LocationPickerMap
        pickup={pickup}
        destination={destination}
        onConfirm={handlePickerConfirm}
        onUnavailable={() => setSheetState('expanded')}
        pickRequest={pickRequest}
      />
      <BottomSheet state={sheetState} onStateChange={setSheetState}>
        <div className="w-full max-w-sm mx-auto px-4 pb-6">
        {/* APP-HEADER G2 — the escape hatch moved to the shell
            header, which now carries it on every non-home screen. */}
        <h1 className="text-xl font-bold text-[#1B4F72] mb-4">
          {t('goods.title')}
        </h1>

        {/* PILOT-UX-2 G3/G4 — urgency tier as a selectable group with
            NORMAL as the default. Priority/urgent lead to the dedicated
            messenger flows (/customer/priority, /customer/urgent) —
            reachable from the parcel side only — and each of those
            offers a "Normal" option back here, so no tier is ever a
            one-way door. */}
        <div className="mb-4" data-testid="goods-tier-group">
          <div className="text-xs font-medium text-gray-600 mb-1">
            {t('goods.tierLabel')}
          </div>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('goods.tierLabel')}>
            <button
              type="button"
              role="radio"
              aria-checked={true}
              data-testid="tier-normal"
              className="min-h-[44px] px-2 py-2 rounded-lg border border-[#1B4F72] bg-[#1B4F72]/5 text-[#1B4F72] text-xs font-medium text-left"
            >
              {t('goods.tierNormal')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={false}
              data-testid="tier-priority"
              onClick={() => navigate('/customer/priority')}
              className="min-h-[44px] px-2 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-xs font-medium text-left hover:border-amber-400"
            >
              {t('urgent.tierTogglePriority')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={false}
              data-testid="tier-urgent"
              onClick={() => navigate('/customer/urgent')}
              className="min-h-[44px] px-2 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-xs font-medium text-left hover:border-red-400"
            >
              {t('urgent.tierToggleUrgent')}
            </button>
          </div>
        </div>

        {!isOnline && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
            {t('journey.offlineWarning')}
          </div>
        )}

        <div className="space-y-5">
          {/* Pickup Location */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('journey.pickup')}
            </label>
            <div className="flex gap-2">
              <AddressSearchInput
                placeholder={t('journey.pickupPlaceholder')}
                value={pickupQuery}
                onChangeText={(text) => {
                  // Typing never sets a location — a pin is only planted
                  // when the customer picks a suggestion or uses GPS.
                  setPickupQuery(text);
                  setPickup(null);
                }}
                onSelect={(s) => {
                  setPickup({ lat: s.lat, lng: s.lng, address: s.label });
                  setPickupQuery(s.label);
                }}
                className="flex-1"
                data-testid="pickup-address-input"
                onUnavailable={() => setSearchUnavailable(true)}
                onSelectUnplaceable={(l) => handleUnplaceableLandmark('pickup', l)}
              />
              <button
                type="button"
                onClick={handleUseMyLocation}
                disabled={isLocating}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors"
                aria-label={t('journey.useMyLocation')}
              >
                {isLocating ? (
                  <Spinner size="sm" />
                ) : (
                  <svg className="w-5 h-5 text-[#1B4F72]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>
            <PickOnMapButton
              target="pickup"
              primary={searchUnavailable}
              onClick={() => requestPickOnMap('pickup')}
            />
            <PlaceDescriptionInput
              target="pickup"
              value={pickupDescription}
              onChange={setPickupDescription}
            />
          </div>

          {/* Destination */}
          <div>
            <AddressSearchInput
              label={t('journey.destination')}
              placeholder={t('journey.destinationPlaceholder')}
              value={destinationQuery}
              onChangeText={(text) => {
                setDestinationQuery(text);
                setDestination(null);
              }}
              onSelect={(s) => {
                setDestination({ lat: s.lat, lng: s.lng, address: s.label });
                setDestinationQuery(s.label);
              }}
              data-testid="destination-address-input"
              onUnavailable={() => setSearchUnavailable(true)}
              onSelectUnplaceable={(l) => handleUnplaceableLandmark('destination', l)}
            />
            <PickOnMapButton
              target="destination"
              primary={searchUnavailable}
              onClick={() => requestPickOnMap('destination')}
            />
            <PlaceDescriptionInput
              target="destination"
              value={destinationDescription}
              onChange={setDestinationDescription}
            />
          </div>

          {/* Vehicle Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('journey.vehicleType')}
            </label>
            <div className="flex flex-wrap gap-2">
              {VEHICLE_TYPES.map((vt) => (
                <button
                  key={vt}
                  type="button"
                  onClick={() => setVehicleType(vt)}
                  className={`min-h-[44px] px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    vehicleType === vt
                      ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                  }`}
                  aria-pressed={vehicleType === vt}
                >
                  {t(getVehicleCompliance(vt).nameKey)}
                </button>
              ))}
            </div>
          </div>

          {/* FIELD-CLOSE G1 — suggested fare (GOODS + parcel-size
              premium included); tap fills the wish price, failures
              hide the hint silently. */}
          <FairPriceHint
            pickup={pickup}
            destination={destination}
            journeyType="GOODS"
            vehicleType={vehicleType}
            parcelSize={goodsSize.toUpperCase() as 'SMALL' | 'MEDIUM' | 'LARGE'}
            onUsePrice={(price) => setWishPrice(String(price))}
          />

          {/* Wish Price — TRUE-WORDS: the 13-Aug review asks the parcel
              form to say what the price field is for (set one, or wait for
              the driver's), which the ride form already does via
              journey.wishPriceHelper. The parcel wording is its own key
              because it names the parcel, not the ride. */}
          <Input
            label={t('journey.wishPrice')}
            placeholder={t('journey.wishPricePlaceholder')}
            type="number"
            value={wishPrice}
            onChange={(e) => setWishPrice(e.target.value)}
            suffix="RWF"
            helperText={t('goods.wishPriceHelper')}
          />

          {/* Goods-specific section */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
            <h2 className="text-base font-semibold text-gray-900">
              {t('goods.details')}
            </h2>

            {/* Goods Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('goods.description')}
              </label>
              <textarea
                value={goodsDescription}
                onChange={(e) => setGoodsDescription(e.target.value)}
                placeholder={t('goods.descriptionPlaceholder')}
                rows={3}
                className="block w-full px-3 py-2.5 rounded-lg border border-gray-300 text-base bg-white transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[#1B4F72] focus:border-[#1B4F72]"
              />
            </div>

            {/* Size Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('goods.size')}
              </label>
              <div className="flex gap-2">
                {SIZE_OPTIONS.map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setGoodsSize(size)}
                    className={`flex-1 min-h-[44px] px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      goodsSize === size
                        ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                    }`}
                    aria-pressed={goodsSize === size}
                  >
                    {t(`goods.size_${size}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* PARCEL-CATEGORY — what is in the package. The same
                question the drop-a-package flow has asked since
                R3-DELIVERY-V2, in the same five words, from the same
                three locale files. A motari reads the answer on the
                request card before he decides whether to carry it.

                Nothing is pre-selected: a sender who scrolls past this
                sends OTHER, which is honest, and a sender who answers
                sends what he answered. */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('delivery.parcelCategoryLabel')}
              </label>
              <div className="flex flex-wrap gap-2">
                {PARCEL_CATEGORIES.map((pc) => (
                  <button
                    key={pc}
                    type="button"
                    onClick={() => setParcelCategory(pc)}
                    data-testid={`goods-category-${pc}`}
                    aria-pressed={parcelCategory === pc}
                    className={`min-h-[44px] px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      parcelCategory === pc
                        ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                    }`}
                  >
                    {t(parcelCategoryLabelKey(pc))}
                  </button>
                ))}
              </div>
            </div>

            {/* FIELD-FIT G5 — weight, and the limit for the machine the
                customer has chosen. The rule is the team's own, and it
                is stated before the booking rather than after the
                refusal. A parcel travelling on its own is a GOODS
                journey, so this form is always the "alone" case. */}
            <div>
              <label
                className="block text-sm font-medium text-gray-700 mb-1"
                htmlFor="goods-weight-input"
              >
                {t('parcelWeight.label')}
              </label>
              <Input
                id="goods-weight-input"
                type="number"
                inputMode="decimal"
                min="0"
                value={goodsWeightKg}
                onChange={(e) => setGoodsWeightKg(e.target.value)}
                placeholder={t('parcelWeight.placeholder')}
                suffix="kg"
                data-testid="goods-weight-input"
              />
              <p
                className="text-xs text-gray-600 mt-1"
                data-testid="goods-weight-limit"
              >
                {parcelAllowance.maxWeightKg != null
                  ? t(parcelAllowance.copyKey, { max: parcelAllowance.maxWeightKg })
                  : t(parcelAllowance.copyKey)}
              </p>
              {/* FIELD-FIT G5 — the moto-alone envelope rule is stated,
                  not enforced, while the team decides whether it should
                  refuse bookings that work today (see
                  ENFORCE_MOTO_ALONE_SIZE_RULE). Saying it is the half
                  that needs no committee. */}
              {overSizeAdvisory && (
                <p
                  className="text-xs text-amber-700 mt-1"
                  data-testid="goods-size-advisory"
                >
                  {t('errors.parcelTooLargeForVehicle')}
                </p>
              )}
              {overWeightLimit && (
                <p
                  className="text-xs text-[#E74C3C] mt-1"
                  role="alert"
                  data-testid="goods-weight-over-limit"
                >
                  {t('errors.parcelTooHeavyForVehicle')}
                </p>
              )}
            </div>

            {/* TEAM-SAID G3 — how fast, in exactly two tiers. Standard
                carries the team's own "about 1 to 3 hours" promise;
                express says plainly that it costs whatever the motari
                bids, because that is the decision — no surcharge, no
                percentage, the same suggest/bid mechanic as every
                other fare on Bimoto. */}
            <div data-testid="delivery-speed-section">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('delivery.speedLabel')}
              </label>
              <div
                className="flex gap-2"
                role="radiogroup"
                aria-label={t('delivery.speedLabel')}
                data-testid="delivery-speed-options"
              >
                {SPEED_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={deliverySpeed === opt.value}
                    onClick={() => {
                      setDeliverySpeed(opt.value);
                      if (opt.value !== DeliverySpeed.STANDARD) setStandardHours(null);
                    }}
                    data-testid={`delivery-speed-${opt.value}`}
                    className={`flex-1 min-h-[44px] px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      deliverySpeed === opt.value
                        ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                    }`}
                  >
                    {t(opt.labelKey)}
                  </button>
                ))}
              </div>
              <p
                className="text-xs text-gray-600 mt-1"
                data-testid="delivery-speed-desc"
              >
                {t(
                  SPEED_OPTIONS.find((o) => o.value === deliverySpeed)!.descKey,
                )}
              </p>

              {/* LIVE-WIRE G5 — the optional window, and only where it
                  means anything. It is additive in every sense: it
                  changes no price (nothing multiplies a fare by it —
                  the same guarantee #160 proved for the speed tag), and
                  "Any time" is a first-class answer, not an absence. */}
              {deliverySpeed === DeliverySpeed.STANDARD && (
                <div className="mt-3" data-testid="standard-hours-section">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {t('delivery.standardHoursLabel')}
                  </label>
                  <div
                    className="flex gap-2"
                    role="radiogroup"
                    aria-label={t('delivery.standardHoursLabel')}
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={standardHours === null}
                      data-testid="standard-hours-any"
                      onClick={() => setStandardHours(null)}
                      className={`flex-1 min-h-[44px] px-2 py-2 rounded-lg border text-xs font-medium ${
                        standardHours === null
                          ? 'border-[#1B4F72] bg-[#1B4F72]/5 text-[#1B4F72]'
                          : 'border-gray-300 bg-white text-gray-700'
                      }`}
                    >
                      {t('delivery.standardHoursAny')}
                    </button>
                    {([1, 2, 3] as const).map((h) => (
                      <button
                        key={h}
                        type="button"
                        role="radio"
                        aria-checked={standardHours === h}
                        data-testid={`standard-hours-${h}`}
                        onClick={() => setStandardHours(h)}
                        className={`flex-1 min-h-[44px] px-2 py-2 rounded-lg border text-xs font-medium ${
                          standardHours === h
                            ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                            : 'border-gray-300 bg-white text-gray-700'
                        }`}
                      >
                        {t('delivery.standardHoursN', { count: h })}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">
                    {t('delivery.standardHoursNote')}
                  </p>
                </div>
              )}
            </div>

            {/* Fragile Toggle */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                {t('goods.fragile')}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={isFragile}
                onClick={() => setIsFragile(!isFragile)}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                  isFragile ? 'bg-[#1B4F72]' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    isFragile ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Recipient Info */}
            <Input
              label={t('goods.recipientName')}
              placeholder={t('goods.recipientNamePlaceholder')}
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
            />

            <Input
              label={t('goods.recipientPhone')}
              placeholder={t('goods.recipientPhonePlaceholder')}
              type="tel"
              value={recipientPhone}
              onChange={(e) => setRecipientPhone(e.target.value)}
            />
          </div>

          {/* Submit */}
          {/* BOOK-UNBLOCK G1 — whenever the button is disabled, say
              exactly what is still missing. The guard itself is
              unchanged: both points plus a goods description. */}
          <div className="space-y-2">
            {(!pickup || !destination || !goodsDescription.trim()) && (
              <div
                data-testid="submit-missing-hint"
                role="status"
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-secondary text-amber-900"
              >
                {!pickup && <p>{t('journey.missingPickup')}</p>}
                {!destination && <p>{t('journey.missingDestination')}</p>}
                {!goodsDescription.trim() && <p>{t('goods.missingDescription')}</p>}
              </div>
            )}
            <Button
              fullWidth
              size="lg"
              loading={isSubmitting}
              onClick={handleSubmit}
              disabled={!pickup || !destination || !goodsDescription.trim()}
            >
              {t('goods.submit')}
            </Button>
          </div>
        </div>
        </div>
      </BottomSheet>
    </>
  );
};

export default GoodsRequestPage;
