import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import { AddressSearchInput } from '../../components/journey/AddressSearchInput';
import { reverseGeocodeOnce } from '../../hooks/useGeocodeSearch';
import { VehicleTypeInfoCard } from '../../components/journey/VehicleTypeInfoCard';
import { GoodsStopEditor } from '../../components/journey/GoodsStopEditor';
import { FairPriceHint } from '../../components/journey/FairPriceHint';
import { JourneyLegsDisplay } from '../../components/journey/JourneyLegsDisplay';
import { RoutePreviewMap } from '../../components/journey/RoutePreviewMap';
import { LocationPickerMap, type PickTarget, type PickedLocation, type PickOnMapRequest } from '../../components/map/LocationPickerMap';
import { PickOnMapButton } from '../../components/journey/PickOnMapButton';
import { PlaceDescriptionInput } from '../../components/journey/PlaceDescriptionInput';
import { vehicleIcon } from '../../components/journey/vehicle-icons';
import type { LandmarkSuggestion } from '../../lib/landmark-search';
import { isGeocodingUnavailable } from '../../hooks/useGeocodeSearch';
import { BottomSheet, type SheetState } from '../../components/map/BottomSheet';
import { useJourneyStore } from '../../stores/journey.store';
import { useUIStore } from '../../stores/ui.store';
import { geolocation } from '../../hooks/useGeolocation';
import { JourneyType, VehicleType, getVehicleCompliance, type LegInput, type ParcelSize } from '@bimoto/shared';
import {
  MIN_LEAD_TIME_MS,
  MAX_LEAD_TIME_MS,
  validateScheduledForLocal,
  toDatetimeLocalValue,
} from '../../lib/scheduled';
import { apiFetch, apiErrorFromResponse, ApiError, isConnectivityError } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';
import { useAuthStore } from '../../stores/auth.store';
import { enqueueJourneyCreate, newClientId } from '../../lib/outbox';
import { SavedOfflineNotice } from '../../components/journey/SavedOfflineNotice';
import type { OutboxEntry } from '../../db/tables';

// R3-DELIVERY — mirrors the server-side largestParcelSize helper.
// The journey's parcel-size for fare composition is the LARGEST
// parcel across its goods stops.
function largestParcelSize(legs: LegInput[]): ParcelSize | null {
  const sizes = legs
    .map((l) => l.parcelSize)
    .filter((s): s is ParcelSize => Boolean(s));
  if (sizes.length === 0) return null;
  if (sizes.includes('LARGE')) return 'LARGE';
  if (sizes.includes('MEDIUM')) return 'MEDIUM';
  return 'SMALL';
}

// PILOT-UX G3 — the real VehicleType enum (the old local list carried
// CAR/BICYCLE/VAN, which the server rejects, and omitted the electric
// types entirely). Labels come from the shared compliance matrix.
const VEHICLE_TYPES = Object.values(VehicleType);

interface Location {
  lat: number;
  lng: number;
  address: string;
}

export const NewJourneyPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setActiveJourney } = useJourneyStore();
  const { showToast, isOnline } = useUIStore();

  const [pickup, setPickup] = useState<Location | null>(null);
  const [pickupQuery, setPickupQuery] = useState('');
  const [destination, setDestination] = useState<Location | null>(null);
  const [destinationQuery, setDestinationQuery] = useState('');
  // ANY-VEHICLE G1 — `null` is the "Any vehicle" choice, not "unset".
  // The default stays MOTO (unchanged): a customer who never touches
  // the picker sends exactly the body he sent before this option
  // existed. Choosing Any OMITS vehiclePreference from the create
  // body, which the shared schema already marks optional and which
  // the feed's vehicle prefilter already reads as "every motari may
  // take this" (journey.service.ts:658-661).
  const [vehicleType, setVehicleType] = useState<VehicleType | null>(VehicleType.MOTO);
  const [wishPrice, setWishPrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  // PILOT-READY G2 — the child-passenger declaration is out of the
  // booking flow for the pilot (founder decision, 28 Jul: minors travel
  // with a guardian; under-12 is not a booking option). The create body
  // simply omits hasChildPassenger and its companions — the shared
  // schema marks them optional, so the server validator and the
  // child-safety services stay in place as the backstop. Re-enable by
  // restoring the UI block; no server change needed.
  // R3-DELIVERY — multi-stop goods declaration. Customer toggles
  // "Drop a package on the way", adds 1+ goods stops via the inline
  // GoodsStopEditor. The journey's largest parcelSize feeds the
  // fair-price hint; the legs[] array is sent as-is to createJourney.
  const [hasDeliveryStops, setHasDeliveryStops] = useState(false);
  const [deliveryStops, setDeliveryStops] = useState<LegInput[]>([]);
  const [showStopEditor, setShowStopEditor] = useState(false);
  // SCHED-UI G1 — advance booking. IMMEDIATE preserves the existing
  // submit body untouched; SCHEDULED adds bookingMode + scheduledFor
  // (ISO) to the same createJourney POST.
  const [bookingMode, setBookingMode] = useState<'IMMEDIATE' | 'SCHEDULED'>('IMMEDIATE');
  const [scheduledForLocal, setScheduledForLocal] = useState('');
  const [scheduledError, setScheduledError] = useState<string | null>(null);
  // OUTBOX G2 — set when the create never left the phone and the
  // booking was held instead. Non-null swaps this screen for the honest
  // "saved on this phone" confirmation.
  const [queuedEntry, setQueuedEntry] = useState<OutboxEntry | null>(null);
  // PILOT-UX-2 G2 — map-first layout. The form lives in a sliding
  // sheet over the background map; collapsing it exposes pick-on-map.
  const [sheetState, setSheetState] = useState<SheetState>('expanded');
  // BOOK-UNBLOCK G2 — explicit route to pick-on-map: the buttons next
  // to the address fields collapse the sheet and select the target.
  // searchUnavailable promotes them to primary once the geocode proxy
  // reports 503 (session-sticky, so initialise from the shared flag).
  const [pickRequest, setPickRequest] = useState<PickOnMapRequest | null>(null);
  const [searchUnavailable, setSearchUnavailable] = useState(isGeocodingUnavailable());

  // LANDMARKS G4 — the passenger's own words about the place, for the
  // places no database knows. Optional, capped, and carried through to
  // the motari's screen.
  const [pickupDescription, setPickupDescription] = useState('');
  const [destinationDescription, setDestinationDescription] = useState('');

  // TEAM-SAID G1 — "Travelling with a child?". The team confirmed the
  // child-passenger flow stays off for the pilot (item 9, 6 of 7) and
  // asked for one honest signal in its place, so the motari knows
  // before he arrives instead of at the kerb.
  //
  // This is not the flow coming back. It has no age field, no guardian
  // phone, no helmet acknowledgment, no fare premium; it never reaches
  // hasChildPassenger and can never raise a child 422. It is a
  // checkbox that travels with the request and shows on his screen.
  const [travellingWithChild, setTravellingWithChild] = useState(false);

  const requestPickOnMap = (target: PickTarget) => {
    setPickRequest((prev) => ({ target, seq: (prev?.seq ?? 0) + 1 }));
    setSheetState('collapsed');
  };

  // LANDMARKS G3 — a landmark the catalog names but cannot place. The
  // name goes in the field, the area hint seeds the description so the
  // passenger edits rather than writes, and the map opens for the pin.
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

  // PILOT-UX-2 G2 — a point confirmed on the map behaves exactly like
  // a search selection: it sets the location AND the visible query text.
  const handlePickerConfirm = (target: PickTarget, loc: PickedLocation) => {
    if (target === 'pickup') {
      setPickup({ lat: loc.lat, lng: loc.lng, address: loc.address });
      setPickupQuery(loc.address);
    } else {
      setDestination({ lat: loc.lat, lng: loc.lng, address: loc.address });
      setDestinationQuery(loc.address);
    }
  };

  // R3-DELIVERY-V2 — swap a goods stop with its neighbor. Sequence
  // numbers are re-stamped at submission time (createLegsForJourney
  // assigns sequence based on array index), so reordering here is
  // a pure array shuffle — no server-side change required.
  const handleReorderStop = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0) return;
    setDeliveryStops((prev) => {
      if (toIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
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
      // address once the server reverse-geocodes the fix. Fire-and-forget:
      // on failure/unavailability/offline the generic label stays, and the
      // update is skipped if the user has since picked something else.
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

  const handleSubmit = async () => {
    if (!pickup) {
      showToast(t('journey.pickupRequired'), 'error');
      return;
    }
    if (!destination) {
      showToast(t('journey.destinationRequired'), 'error');
      return;
    }

    // SCHED-UI G1 — client-side mirror of the server's lead-time
    // validation so the customer gets an immediate, localised error.
    let scheduledForIso: string | null = null;
    if (bookingMode === 'SCHEDULED') {
      const validationKey = validateScheduledForLocal(scheduledForLocal);
      if (validationKey) {
        setScheduledError(t(validationKey));
        showToast(t(validationKey), 'error');
        return;
      }
      setScheduledError(null);
      scheduledForIso = new Date(scheduledForLocal).toISOString();
    }

    setIsSubmitting(true);
    // OUTBOX G2 — this booking attempt's own name, minted BEFORE the
    // first send and carried on every later send of the same booking.
    // It travels in the body, so a create whose 201 dies on the way back
    // to a phone in a dead zone is recognised on replay instead of
    // producing a second ride (server: journey.service.ts).
    const clientRequestId = newClientId();
    // Hoisted so the catch below can hold the exact body that failed.
    let sentBody: Record<string, unknown> | null = null;
    try {
      const body: Record<string, unknown> = {
        clientRequestId,
        type: JourneyType.PASSENGER,
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
        // TEAM-SAID G1 — only when the passenger ticked it. Leaving the
        // box alone adds no key, so the body is byte-identical to what
        // it was before this field existed.
        ...(travellingWithChild ? { travellingWithChild: true } : {}),
      };

      // Every offered option is a real VehicleType, so the preference
      // is sent as-is (the old CAR/VAN placeholders had to be dropped
      // here because the server rejects them).
      //
      // ANY-VEHICLE G1 — except "Any vehicle", which OMITS the key
      // rather than serialising null. The schema field is optional,
      // not nullable, so an explicit null would fail validation; and
      // an absent key cannot later be mistaken for "we forgot to ask".
      if (vehicleType) {
        body.vehiclePreference = vehicleType;
      }

      if (wishPrice) {
        body.wishPrice = parseInt(wishPrice, 10);
      }

      // R3-DELIVERY — attach the legs[] array when the customer has
      // declared at least one goods stop. Empty array is identical to
      // omitting the field per the §8 backward-compat invariant.
      if (hasDeliveryStops && deliveryStops.length > 0) {
        body.legs = deliveryStops;
      }

      // SCHED-UI G1 — only attach the two scheduling fields when the
      // customer picked "Schedule"; the IMMEDIATE body is unchanged.
      if (bookingMode === 'SCHEDULED' && scheduledForIso) {
        body.bookingMode = 'SCHEDULED';
        body.scheduledFor = scheduledForIso;
      }

      sentBody = body;
      const res = await apiFetch(`/api/journeys`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        // NET-UX G2 — classify first (clone-based), then read the body
        // for the page-specific code maps below.
        const apiErr = await apiErrorFromResponse(res);
        const data = await res.json().catch(() => ({}));
        // R3-CHILD — surface a typed block with localised copy when
        // the server returns 422 with a child-specific code.
        const code: string | undefined = data?.error?.code ?? data?.code;
        if (code) {
          // SCHED-UI G1 — localise the scheduledFor validation errors
          // (codes from services/scheduled-rides/validators.ts and
          // journey.service.createJourney).
          const scheduledMap: Record<string, string> = {
            SCHEDULED_FOR_REQUIRED: t('errors.scheduledForRequired'),
            SCHEDULED_FOR_INVALID: t('errors.scheduledForInvalid'),
            SCHEDULED_FOR_TOO_SOON: t('errors.scheduledForTooSoon'),
            SCHEDULED_FOR_TOO_FAR: t('errors.scheduledForTooFar'),
          };
          if (scheduledMap[code]) {
            setScheduledError(scheduledMap[code]);
            throw new Error(scheduledMap[code]);
          }
        }
        throw apiErr;
      }

      const journey = await res.json();
      setActiveJourney(journey);

      // NOTIFY G2 — the ✓-sent moment, from the CREATE RESPONSE.
      //
      // Fired here and not from a socket on purpose: this is the server
      // answering "yes, I have it", which is the one confirmation a
      // passenger needs before the screen changes under her, and there
      // is no socket event for it — nor should there be, since the only
      // person it concerns is the one who just tapped.
      //
      // Notification-class, so it survives the navigation on the next
      // line and is still on the bid list when she arrives: a toast that
      // expires during a route change is a toast nobody saw.
      showToast(t('bidList.request.sentToast'), 'success', 'notification');
      // SCHED-UI G2 — a SCHEDULED journey has no open bid window yet;
      // land on the dedicated state screen instead of the bid list.
      if (journey.status === 'SCHEDULED') {
        navigate(`/journey/${journey.id}/scheduled`, { replace: true });
      } else {
        navigate(`/journey/${journey.id}/bids`, { replace: true });
      }
    } catch (err: any) {
      // OUTBOX G2 — the request never got an answer, so nothing has been
      // refused: hold the booking on this phone and say so.
      //
      // isConnectivityError is the whole test, and it is deliberately
      // narrow: OFFLINE and UNREACHABLE only. A 4xx is a real answer —
      // a validation error, a flagged account, a child-safety block —
      // and queueing one would mean re-sending a request the server has
      // already refused, forever. Those keep falling through to
      // presentApiError exactly as before.
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
          // Dexie is unavailable (private mode, quota, a browser with no
          // IndexedDB). We could not hold it either, so tell the truth
          // by falling through to the normal connectivity error.
          console.debug('[outbox] enqueue failed:', queueErr);
        }
      }
      // API failures speak the shared taxonomy; the child/scheduled
      // blocks above carry pre-translated copy.
      if (err instanceof ApiError) presentApiError(err);
      else showToast(err?.message || t('journey.createFailed'), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // OUTBOX G2 — the booking is held on this phone. This is a distinct
  // screen and not a banner over the form on purpose: the form's job is
  // done, and leaving it up invites the passenger to press the button
  // again and queue the same ride twice.
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
      {/* PILOT-UX-2 G2 — full-viewport map behind the sheet; tapping
          it (sheet collapsed) sets pickup then destination pins. */}
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
        <h1 className="text-title font-bold text-[#1B4F72] mb-6">
          {t('journey.newRide')}
        </h1>

        {/* PILOT-UX-2 G3 — this page is passenger-only. The old
            priority/urgent delivery tiles moved behind the customer
            home's "Send a parcel" fork: urgency tiers are
            parcel/messenger concepts and have no place in a ride
            request. Upcoming scheduled rides render on the home sheet. */}

        {!isOnline && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-secondary text-yellow-800">
            {t('journey.offlineWarning')}
          </div>
        )}

        <div className="space-y-5">
          {/* SCHED-UI G1 — booking-mode segmented control. "Leave now"
              is the default and keeps the existing flow untouched;
              "Schedule" reveals the pickup-time picker. */}
          <div data-testid="booking-mode-section">
            <div
              className="flex gap-2"
              role="group"
              aria-label={t('scheduled.bookingModeLabel')}
            >
              {([
                { mode: 'IMMEDIATE' as const, label: t('scheduled.leaveNow'), testId: 'booking-mode-now' },
                { mode: 'SCHEDULED' as const, label: t('scheduled.scheduleLater'), testId: 'booking-mode-schedule' },
              ]).map(({ mode, label, testId }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setBookingMode(mode);
                    if (mode === 'IMMEDIATE') setScheduledError(null);
                  }}
                  data-testid={testId}
                  aria-pressed={bookingMode === mode}
                  className={`flex-1 min-h-[44px] px-4 py-2 rounded-lg border text-secondary font-medium transition-colors ${
                    bookingMode === mode
                      ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {bookingMode === 'SCHEDULED' && (
              <div className="mt-3 space-y-2 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
                <label
                  htmlFor="scheduled-for-input"
                  className="block text-secondary font-medium text-gray-700"
                >
                  {t('scheduled.pickupTimeLabel')}
                </label>
                <input
                  id="scheduled-for-input"
                  type="datetime-local"
                  value={scheduledForLocal}
                  onChange={(e) => {
                    setScheduledForLocal(e.target.value);
                    setScheduledError(null);
                  }}
                  min={toDatetimeLocalValue(new Date(Date.now() + MIN_LEAD_TIME_MS))}
                  max={toDatetimeLocalValue(new Date(Date.now() + MAX_LEAD_TIME_MS))}
                  data-testid="scheduled-for-input"
                  className="w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-secondary text-gray-900 focus:border-[#1B4F72] focus:outline-none"
                />
                <p className="text-caption text-gray-500">
                  {t('scheduled.pickupTimeHelper')}
                </p>
                {scheduledError && (
                  <div
                    className="rounded-md border border-red-200 bg-red-50 p-2 text-caption text-red-800"
                    data-testid="scheduled-error"
                    role="alert"
                  >
                    {scheduledError}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Pickup Location */}
          <div>
            <label className="block text-secondary font-medium text-gray-700 mb-1">
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
            <label className="block text-secondary font-medium text-gray-700 mb-1">
              {t('journey.destination')}
            </label>
            <AddressSearchInput
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
            <label className="block text-secondary font-medium text-gray-700 mb-2">
              {t('journey.vehicleType')}
            </label>
            <div className="flex flex-wrap gap-2">
              {/* ANY-VEHICLE G1 — offered FIRST, because it is the
                  widest choice: it opens the request to every motari
                  in range instead of narrowing it before a single
                  offer has arrived. It is not the default (MOTO still
                  is), so nobody is opted into it silently. */}
              <button
                type="button"
                data-testid="journey-vehicle-ANY"
                onClick={() => setVehicleType(null)}
                className={`min-h-[44px] px-4 py-2 rounded-lg border text-secondary font-medium transition-colors flex items-center gap-2 ${
                  vehicleType === null
                    ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                }`}
                aria-pressed={vehicleType === null}
              >
                {t('journey.any_vehicle')}
              </button>
              {VEHICLE_TYPES.map((vt) => (
                <button
                  key={vt}
                  type="button"
                  data-testid={`journey-vehicle-${vt}`}
                  onClick={() => setVehicleType(vt)}
                  className={`min-h-[44px] px-4 py-2 rounded-lg border text-secondary font-medium transition-colors flex items-center gap-2 ${
                    vehicleType === vt
                      ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                  }`}
                  aria-pressed={vehicleType === vt}
                >
                  {vehicleIcon(vt, 'w-5 h-5')}
                  {t(getVehicleCompliance(vt).nameKey)}
                </button>
              ))}
            </div>
            <div className="mt-3">
              <VehicleTypeInfoCard vehicleType={vehicleType} anyVehicle={vehicleType === null} />
            </div>
          </div>

          {/* R3-DELIVERY-V2 — route preview map. Renders once both
              pickup and destination coordinates are set. Shows the
              multi-stop polyline + numbered markers including any
              intermediate goods stops added below. */}
          {pickup && destination && (
            <RoutePreviewMap
              pickupLat={pickup.lat}
              pickupLng={pickup.lng}
              pickupName={pickup.address}
              destinationLat={destination.lat}
              destinationLng={destination.lng}
              destinationName={destination.address}
              legs={hasDeliveryStops ? deliveryStops : []}
            />
          )}

          {/* TEAM-SAID G1 — one checkbox, one job: tell the motari a
              child is coming so he knows before he arrives. Nothing
              below it: no age, no guardian, no helmet step, no price
              change. The under-12 policy itself lives in the guide and
              in the terms, not in a booking gate.

              PILOT-GUARD Item 9 — but it is mutually exclusive with the
              parcel declaration below. They were two independent
              checkboxes, so a passenger could tick both and send a
              motari a booking that says "a child is riding with me AND I
              am handing you packages to drop on the way" — one seat, one
              child, one pair of hands. The board's promise is that
              picking either closes the other; picking neither is
              unchanged. */}
          <div data-testid="child-travel-section">
            <label
              className={`flex items-center gap-2 text-secondary font-medium ${
                hasDeliveryStops ? 'text-gray-500' : 'text-gray-700'
              }`}
            >
              <input
                type="checkbox"
                checked={travellingWithChild}
                disabled={hasDeliveryStops}
                onChange={(e) => setTravellingWithChild(e.target.checked)}
                data-testid="child-travel-toggle"
                className="h-4 w-4"
              />
              {t('childTravel.toggle')}
            </label>
            <p className="mt-1 text-caption text-gray-500">
              {hasDeliveryStops
                ? t('childTravel.blockedByParcel')
                : t('childTravel.toggleHelper')}
            </p>
          </div>

          {/* R3-DELIVERY — multi-stop delivery declaration block */}
          <div data-testid="delivery-stops-section">
            <label
              className={`flex items-center gap-2 text-secondary font-medium ${
                travellingWithChild ? 'text-gray-500' : 'text-gray-700'
              }`}
            >
              <input
                type="checkbox"
                checked={hasDeliveryStops}
                // PILOT-GUARD Item 9 — the other half of the exclusion.
                disabled={travellingWithChild}
                onChange={(e) => {
                  setHasDeliveryStops(e.target.checked);
                  if (!e.target.checked) {
                    setDeliveryStops([]);
                    setShowStopEditor(false);
                  }
                }}
                data-testid="delivery-toggle"
                className="h-4 w-4"
              />
              {t('delivery.addStopToggle')}
            </label>
            {travellingWithChild && (
              <p className="mt-1 text-caption text-gray-500" data-testid="delivery-blocked-note">
                {t('delivery.blockedByChild')}
              </p>
            )}

            {hasDeliveryStops && (
              <div className="mt-3 space-y-3 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
                {/* Existing-stop preview */}
                {deliveryStops.length > 0 && (
                  <div className="space-y-2">
                    <JourneyLegsDisplay
                      legs={deliveryStops}
                      mode="preview"
                      onReorder={handleReorderStop}
                    />
                    <ul className="space-y-1">
                      {deliveryStops.map((_, idx) => (
                        <li key={idx} className="flex justify-end">
                          <button
                            type="button"
                            onClick={() =>
                              setDeliveryStops((prev) =>
                                prev.filter((_, i) => i !== idx),
                              )
                            }
                            data-testid={`remove-stop-${idx}`}
                            className="text-caption text-red-700 underline"
                          >
                            {t('delivery.removeStop')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Inline editor for a new stop */}
                {showStopEditor ? (
                  <GoodsStopEditor
                    onSave={(leg) => {
                      setDeliveryStops((prev) => [...prev, leg]);
                      setShowStopEditor(false);
                    }}
                    onCancel={() => setShowStopEditor(false)}
                  />
                ) : (
                  <Button
                    variant="secondary"
                    fullWidth
                    onClick={() => setShowStopEditor(true)}
                    data-testid="add-stop-button"
                  >
                    {t('delivery.addStopButton')}
                  </Button>
                )}

                {/* Info card */}
                <div
                  className="rounded-lg border border-blue-200 bg-blue-50 p-3"
                  data-testid="delivery-info-card"
                >
                  <h4 className="mb-1 text-caption font-medium text-blue-900">
                    {t('delivery.infoCardTitle')}
                  </h4>
                  <ul className="space-y-1 text-caption text-blue-800">
                    <li>{t('delivery.infoCardLine1')}</li>
                    <li>{t('delivery.infoCardLine2')}</li>
                  </ul>
                  {largestParcelSize(deliveryStops) && (
                    <p
                      className="mt-1 text-caption text-blue-700"
                      data-testid="largest-parcel-hint"
                    >
                      {t('delivery.parcelSizeLabel')}: {largestParcelSize(deliveryStops)}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* FIELD-CLOSE G1 — suggested fare from the existing
              fair-price endpoint, shown once both points are set.
              Tapping "use this price" fills the wish-price field;
              any fetch failure hides the hint silently. */}
          <FairPriceHint
            pickup={pickup}
            destination={destination}
            journeyType="PASSENGER"
            vehicleType={vehicleType}
            anyVehicle={vehicleType === null}
            parcelSize={
              hasDeliveryStops ? largestParcelSize(deliveryStops) : null
            }
            onUsePrice={(price) => setWishPrice(String(price))}
          />

          {/* Wish Price */}
          <Input
            label={t('journey.wishPrice')}
            placeholder={t('journey.wishPricePlaceholder')}
            type="number"
            value={wishPrice}
            onChange={(e) => setWishPrice(e.target.value)}
            suffix="RWF"
            helperText={t('journey.wishPriceHelper')}
          />

          {/* Submit */}
          {/* BOOK-UNBLOCK G1 — whenever the button is disabled, say
              exactly what is still missing. The guard itself is
              unchanged: a journey still needs both points. */}
          <div className="space-y-2">
            {(!pickup || !destination) && (
              <div
                data-testid="submit-missing-hint"
                role="status"
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-secondary text-amber-900"
              >
                {!pickup && <p>{t('journey.missingPickup')}</p>}
                {!destination && <p>{t('journey.missingDestination')}</p>}
              </div>
            )}
            <Button
              fullWidth
              size="lg"
              loading={isSubmitting}
              onClick={handleSubmit}
              disabled={!pickup || !destination}
            >
              {bookingMode === 'SCHEDULED'
                ? t('scheduled.submit')
                : t('journey.findDrivers')}
            </Button>
          </div>
        </div>
        </div>
      </BottomSheet>
    </>
  );
};

export default NewJourneyPage;
