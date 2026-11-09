// PAGES/CUSTOMER/URGENT-MESSENGER-PAGE.TSX
//
// R3-T / R3-PRIORITY — tier-aware faster-than-normal goods page.
// Hosts both URGENT_MESSENGER (1.3x premium, cascade bypass, 30-min
// SLA) and PRIORITY_MESSENGER (1.15x premium, half-speed cascade,
// no SLA window). The page reads the URL on mount to pick its
// default tier:
//   - /customer/urgent (or no ?tier=)            → URGENT
//   - /customer/urgent?tier=priority             → PRIORITY
//   - /customer/priority                          → PRIORITY
// A toggle is always visible so the user can switch tiers in-page.
// The submit payload's `journeyType` and the fair-price fetch's
// `journeyType` query param both reflect the selected tier.

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import { AddressSearchInput } from '../../components/journey/AddressSearchInput';
import { reverseGeocodeOnce } from '../../hooks/useGeocodeSearch';
import { LocationPickerMap, type PickTarget, type PickedLocation } from '../../components/map/LocationPickerMap';
import { BottomSheet, type SheetState } from '../../components/map/BottomSheet';
import { useAuthStore } from '../../stores/auth.store';
import { useJourneyStore } from '../../stores/journey.store';
import { useUIStore } from '../../stores/ui.store';
import { geolocation } from '../../hooks/useGeolocation';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';

type MessengerTier = 'URGENT_MESSENGER' | 'PRIORITY_MESSENGER';

function defaultTierFromUrl(pathname: string, search: string): MessengerTier {
  // Path-based default takes precedence over query.
  if (pathname.startsWith('/customer/priority')) return 'PRIORITY_MESSENGER';
  const params = new URLSearchParams(search);
  if (params.get('tier') === 'priority') return 'PRIORITY_MESSENGER';
  return 'URGENT_MESSENGER';
}

const SIZE_OPTIONS = ['small', 'medium', 'large'] as const;
type GoodsSize = typeof SIZE_OPTIONS[number];

interface Location {
  lat: number;
  lng: number;
  address: string;
}

interface FairPriceRange {
  min: number;
  median: number;
  max: number;
}

function haversineKm(a: Location, b: Location): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const UrgentMessengerPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = useAuthStore();
  const { setActiveJourney } = useJourneyStore();
  const { showToast, isOnline } = useUIStore();

  // R3-PRIORITY — tier defaults from the URL on mount. The toggle
  // overrides this; it stays editable for the duration of the visit.
  const initialTier = useMemo(
    () => defaultTierFromUrl(location.pathname, location.search),
    // intentionally only on mount: re-deriving on every search change
    // would clobber an in-page toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [tier, setTier] = useState<MessengerTier>(initialTier);
  const isPriority = tier === 'PRIORITY_MESSENGER';

  const [pickup, setPickup] = useState<Location | null>(null);
  const [pickupQuery, setPickupQuery] = useState('');
  const [destination, setDestination] = useState<Location | null>(null);
  const [destinationQuery, setDestinationQuery] = useState('');

  const [goodsDescription, setGoodsDescription] = useState('');
  const [goodsSize, setGoodsSize] = useState<GoodsSize>('small');
  const [isFragile, setIsFragile] = useState(false);
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');

  const [fairPriceRange, setFairPriceRange] = useState<FairPriceRange | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  // PILOT-UX-2 G2 — map-first layout (form in a sheet over the map).
  const [sheetState, setSheetState] = useState<SheetState>('expanded');

  const handlePickerConfirm = (target: PickTarget, loc: PickedLocation) => {
    if (target === 'pickup') {
      setPickup({ lat: loc.lat, lng: loc.lng, address: loc.address });
      setPickupQuery(loc.address);
    } else {
      setDestination({ lat: loc.lat, lng: loc.lng, address: loc.address });
      setDestinationQuery(loc.address);
    }
  };

  const distanceKm =
    pickup && destination ? haversineKm(pickup, destination) : 0;

  // R3-T / R3-PRIORITY — fetch the fair-price band keyed on the
  // currently-selected tier. The server composes vehicle × urgency
  // multipliers; URGENT applies 1.3x and PRIORITY applies 1.15x.
  useEffect(() => {
    if (distanceKm <= 0 || !token) return;
    let cancelled = false;
    apiFetch(
      `/api/journeys/fair-price?distance=${distanceKm.toFixed(2)}&journeyType=${tier}`,
      { credentials: 'include' },
    )
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setFairPriceRange(d.range ?? null);
      })
      .catch(() => {
        if (!cancelled) setFairPriceRange(null);
      });
    return () => {
      cancelled = true;
    };
  }, [distanceKm, token, tier]);

  const handleUseMyLocation = async () => {
    setIsLocating(true);
    try {
      const coords = await geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
      });
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
      const key =
        err?.code === 'unsupported'
          ? 'journey.geoNotSupported'
          : 'journey.geoFailed';
      showToast(t(key), 'error');
    } finally {
      setIsLocating(false);
    }
  };

  const handleSubmit = async () => {
    if (!pickup) {
      showToast(t('journey.pickupRequired'), 'error');
      return;
    }
    if (!destination) {
      showToast(t('journey.destinationRequired'), 'error');
      return;
    }
    if (!recipientName.trim()) {
      showToast(t('urgent.recipientNameRequired'), 'error');
      return;
    }
    if (!recipientPhone.trim()) {
      showToast(t('urgent.recipientPhoneRequired'), 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        type: tier,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        pickupName: pickup.address,
        destinationLat: destination.lat,
        destinationLng: destination.lng,
        destinationName: destination.address,
        goodsDescription: goodsDescription.trim(),
        goodsSizeCategory: goodsSize.toUpperCase(),
        goodsFragile: isFragile,
        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone.trim(),
      };
      if (fairPriceRange?.median) {
        body.wishPrice = fairPriceRange.median;
      }

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
      presentApiError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* PILOT-UX-2 G2 — full-viewport map behind the sheet. */}
      <LocationPickerMap
        pickup={pickup}
        destination={destination}
        onConfirm={handlePickerConfirm}
        onUnavailable={() => setSheetState('expanded')}
      />
      <BottomSheet state={sheetState} onStateChange={setSheetState}>
        <div className="w-full max-w-sm mx-auto px-4 pb-6">
        {/* APP-HEADER G2 — the escape hatch moved to the shell
            header, which now carries it on every non-home screen. */}
        <h1 className="text-xl font-bold text-[#1B4F72] mb-4">
          {isPriority ? t('urgent.priorityTitle') : t('urgent.title')}
        </h1>

        {/* R3-PRIORITY — tier toggle. Always visible so the customer
            can switch between the two faster-than-normal tiers in-page
            even if they arrived from a default link. PILOT-UX-2 G4
            adds the NORMAL option so no tier is a one-way door: it
            returns to the goods flow, whose default tier is normal. */}
        <div className="mb-4" data-testid="tier-toggle">
          <div className="text-xs font-medium text-gray-600 mb-1">
            {t('urgent.tierToggleLabel')}
          </div>
          <div className="grid grid-cols-3 gap-2" role="radiogroup">
            <button
              type="button"
              role="radio"
              aria-checked={false}
              onClick={() => navigate('/journey/goods')}
              data-testid="tier-normal"
              className="min-h-[44px] px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-xs font-medium text-left hover:border-gray-400 transition-colors"
            >
              {t('goods.tierNormal')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={isPriority}
              onClick={() => setTier('PRIORITY_MESSENGER')}
              data-testid="tier-priority"
              className={`min-h-[44px] px-3 py-2 rounded-lg border text-xs font-medium transition-colors text-left ${
                isPriority
                  ? 'border-amber-500 bg-amber-50 text-amber-900'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
              }`}
            >
              {t('urgent.tierTogglePriority')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!isPriority}
              onClick={() => setTier('URGENT_MESSENGER')}
              data-testid="tier-urgent"
              className={`min-h-[44px] px-3 py-2 rounded-lg border text-xs font-medium transition-colors text-left ${
                !isPriority
                  ? 'border-red-500 bg-red-50 text-red-900'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
              }`}
            >
              {t('urgent.tierToggleUrgent')}
            </button>
          </div>
        </div>

        {/* R3-T / R3-PRIORITY — urgency disclosure banner. Always shown
            so the customer knows the premium and SLA semantics up-front
            before they fill the form. Colour and copy reflect the
            currently-selected tier. */}
        <div
          className={`mb-4 p-3 rounded-lg ${
            isPriority
              ? 'bg-amber-50 border border-amber-200'
              : 'bg-red-50 border border-red-200'
          }`}
          role="status"
          data-testid="urgent-banner"
          data-tier={tier}
        >
          <p
            className={`text-sm font-semibold ${
              isPriority ? 'text-amber-800' : 'text-red-800'
            }`}
          >
            {isPriority ? t('urgent.priorityBannerTitle') : t('urgent.bannerTitle')}
          </p>
          <p
            className={`text-xs mt-1 ${
              isPriority ? 'text-amber-700' : 'text-red-700'
            }`}
          >
            {isPriority
              ? t('urgent.priorityBannerDescription')
              : t('urgent.bannerDescription')}
          </p>
        </div>

        {!isOnline && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
            {t('journey.offlineWarning')}
          </div>
        )}

        <div className="space-y-5">
          {/* Pickup */}
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
                  <svg
                    className="w-5 h-5 text-[#1B4F72]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Destination */}
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
          />

          {/* Recipient */}
          <Input
            label={t('urgent.recipientLabel')}
            placeholder={t('urgent.recipientPlaceholder')}
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
          />

          <Input
            label={t('urgent.recipientPhoneLabel')}
            placeholder={t('urgent.recipientPhonePlaceholder')}
            type="tel"
            value={recipientPhone}
            onChange={(e) => setRecipientPhone(e.target.value)}
          />

          {/* Description (optional, helps the driver) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('urgent.descriptionLabel')}
            </label>
            <textarea
              value={goodsDescription}
              onChange={(e) => setGoodsDescription(e.target.value)}
              placeholder={t('urgent.descriptionPlaceholder')}
              rows={2}
              className="block w-full px-3 py-2.5 rounded-lg border border-gray-300 text-base bg-white transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[#1B4F72] focus:border-[#1B4F72]"
            />
          </div>

          {/* Size */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('urgent.packageSizeLabel')}
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

          {/* Fragile */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              {t('urgent.fragileLabel')}
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

          {/* Price hint — already includes the active tier premium */}
          {fairPriceRange && (
            <div
              className="text-xs text-gray-600 bg-white rounded-lg border border-gray-200 px-3 py-2"
              data-testid="urgent-price-hint"
            >
              {t(isPriority ? 'urgent.priorityPriceHint' : 'urgent.priceHint', {
                min: fairPriceRange.min,
                max: fairPriceRange.max,
              })}
            </div>
          )}

          <p className="text-xs text-gray-500">
            {isPriority
              ? t('urgent.priorityBroadcastNotice')
              : t('urgent.broadcastNotice')}
          </p>

          {/* Submit */}
          <Button
            fullWidth
            size="lg"
            loading={isSubmitting}
            onClick={handleSubmit}
            disabled={!pickup || !destination}
          >
            {isPriority ? t('urgent.prioritySubmit') : t('urgent.submit')}
          </Button>
        </div>
        </div>
      </BottomSheet>
    </>
  );
};

export default UrgentMessengerPage;
