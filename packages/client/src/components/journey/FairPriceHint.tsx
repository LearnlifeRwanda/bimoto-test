// FIELD-CLOSE G1 — surface the existing fair-price endpoint on the
// request forms. The server has computed a suggested fare band since
// R3-T, but only the urgent/priority messenger flow ever showed it;
// the ride and parcel forms left the customer typing a price blind.
//
// This component fetches GET /api/journeys/fair-price (through
// apiFetch) once both points are set, debounced so dragging a pin
// doesn't spam the endpoint, and renders the band's median as a hint
// with a one-tap "use this price" fill. Every failure path — offline,
// 5xx, sparse data (range: null) — renders nothing: the hint is
// guidance only and must never block submission.

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VehicleType, ParcelSize } from '@bimoto/shared';
import {
  COMPARABLE_VEHICLE_TYPES,
  estimateTripMinutesRange,
  getVehicleCompliance,
  vehicleFareMultiplier,
} from '@bimoto/shared';
import { apiFetch } from '../../lib/api';

const DEBOUNCE_MS = 500;

interface LatLng {
  lat: number;
  lng: number;
}

interface FairPriceRange {
  min: number;
  median: number;
  max: number;
}

function haversineKm(a: LatLng, b: LatLng): number {
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

interface FairPriceHintProps {
  pickup: LatLng | null;
  destination: LatLng | null;
  /** PASSENGER or GOODS — the endpoint accepts both (1.0 multiplier). */
  journeyType: 'PASSENGER' | 'GOODS';
  vehicleType?: VehicleType | null;
  /**
   * ANY-VEHICLE G2 — the customer chose "Any vehicle", so instead of
   * one number this renders a compact per-kind block: what each kind
   * of machine typically costs for this trip, and roughly how long it
   * takes. Every figure is labelled an estimate; see the block itself
   * for why a duration here can only ever be a range.
   */
  anyVehicle?: boolean;
  hasChildPassenger?: boolean;
  parcelSize?: ParcelSize | null;
  /** Fills the wish-price field with the suggested (median) fare. */
  onUsePrice: (price: number) => void;
}

export const FairPriceHint: React.FC<FairPriceHintProps> = ({
  pickup,
  destination,
  journeyType,
  vehicleType,
  anyVehicle,
  hasChildPassenger,
  parcelSize,
  onUsePrice,
}) => {
  const { t } = useTranslation();
  const [range, setRange] = useState<FairPriceRange | null>(null);

  // Two decimals ≈ 10 m resolution — enough that nudging a pin a few
  // metres neither refetches nor changes the suggestion.
  const distanceKm =
    pickup && destination ? haversineKm(pickup, destination) : 0;
  const distanceParam = distanceKm > 0 ? distanceKm.toFixed(2) : null;

  useEffect(() => {
    if (!distanceParam) {
      setRange(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        distance: distanceParam,
        journeyType,
      });
      if (vehicleType) params.set('vehicleType', vehicleType);
      if (hasChildPassenger) params.set('hasChildPassenger', 'true');
      if (parcelSize) params.set('parcelSize', parcelSize);
      apiFetch(`/api/journeys/fair-price?${params.toString()}`, {
        credentials: 'include',
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled) setRange(d?.range ?? null);
        })
        .catch(() => {
          if (!cancelled) setRange(null);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [distanceParam, journeyType, vehicleType, hasChildPassenger, parcelSize]);

  if (!range) return null;

  // ANY-VEHICLE G2 — the per-kind block.
  //
  // Two honest numbers per vehicle kind, and no third:
  //
  //   TYPICAL PRICE. The fetch above ran WITHOUT a vehicleType (the
  //   customer has not picked one), so `range.median` is the
  //   vehicle-agnostic base band. Scaling it by the same R3-V ladder
  //   the server applies gives what each kind of machine typically
  //   costs for a trip this long. It is context, not a quote: the
  //   actual price is whatever a motari bids, and the customer still
  //   states ONE wish price across all kinds (founder ruling, 24 Aug)
  //   — there is no per-type price input here or anywhere.
  //
  //   DURATION. A RANGE, never a single number. Nothing in this
  //   codebase routes pickup→destination: the ETA service answers the
  //   different question of how long a motari needs to REACH the
  //   pickup. So the estimate is derived in shared from the compliance
  //   matrix's plausible-speed ceilings with a stated road-winding
  //   factor (constants/trip-estimate.ts). A single minute figure here
  //   would read as a promise the platform cannot keep.
  //
  // Both are labelled estimates, and "use this price" keeps filling
  // the wish-price field from the vehicle-agnostic base — unchanged.
  if (anyVehicle) {
    const distanceMeters = distanceKm * 1000;
    return (
      <div
        className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2"
        data-testid="fair-price-hint-any"
      >
        <p className="text-xs font-medium text-blue-900">
          {t('journey.estimateLabel')}
        </p>
        <ul className="mt-1.5 space-y-1">
          {COMPARABLE_VEHICLE_TYPES.map((vt) => {
            const typical = Math.round(range.median * vehicleFareMultiplier(vt));
            const { minMinutes, maxMinutes } = estimateTripMinutesRange(distanceMeters, vt);
            return (
              <li
                key={vt}
                data-testid={`fair-price-any-row-${vt}`}
                className="flex items-baseline justify-between gap-2 text-xs text-blue-900"
              >
                <span className="shrink-0">{t(getVehicleCompliance(vt).nameKey)}</span>
                <span className="text-right tabular-nums">
                  {t('journey.estimateTypicalPrice', {
                    price: typical.toLocaleString(),
                  })}
                  {' · '}
                  {t('journey.estimateDurationRange', {
                    min: minMinutes,
                    max: maxMinutes,
                  })}
                </span>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={() => onUsePrice(range.median)}
          data-testid="use-fair-price"
          className="mt-2 min-h-[44px] w-full rounded-lg border border-[#1B4F72] px-3 py-1 text-xs font-semibold text-[#1B4F72] hover:bg-[#1B4F72]/5 transition-colors"
        >
          {t('journey.useSuggestedPrice')}
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2"
      data-testid="fair-price-hint"
    >
      <p className="text-xs text-blue-900">
        {t('journey.fair_price', { price: range.median.toLocaleString() })}
      </p>
      <button
        type="button"
        onClick={() => onUsePrice(range.median)}
        data-testid="use-fair-price"
        className="min-h-[44px] shrink-0 rounded-lg border border-[#1B4F72] px-3 py-1 text-xs font-semibold text-[#1B4F72] hover:bg-[#1B4F72]/5 transition-colors"
      >
        {t('journey.useSuggestedPrice')}
      </button>
    </div>
  );
};
