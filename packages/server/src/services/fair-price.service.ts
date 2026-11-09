import type { VehicleType, ParcelSize, JourneyType } from '@prisma/client';
import { vehicleFareMultiplier } from '@bimoto/shared';
import prisma from '../prisma';

/**
 * Fair price estimation service.
 * Simple formula for MVP: base fare + per-km rate.
 * Returns a price range (min, max) in RWF.
 */

const BASE_FARE_RWF = 300;
const MIN_PER_KM_RWF = 200;
const MAX_PER_KM_RWF = 400;

// R3-V — per-vehicle-type fare-band multipliers.
//
// ANY-VEHICLE G2 moved the ladder itself to @bimoto/shared
// (constants/vehicle-fare.ts), values unchanged, because the
// any-vehicle request form needs the same numbers on the client to
// show a per-kind typical price. This stays the server's door onto it
// so every existing caller keeps its signature.
export function vehicleTypeMultiplier(vehicleType: VehicleType | null | undefined): number {
  return vehicleFareMultiplier(vehicleType);
}

// R3-T — urgency premium on top of the R3-V vehicle multiplier.
// 1.3x reflects driver-side opportunity cost of dropping a normal
// run for an urgent parcel. Compositional with vehicle multiplier:
// final price = base * vehicleMultiplier * urgencyMultiplier.
export const URGENCY_MULTIPLIER = 1.3;

// R3-PRIORITY — intermediate tier between NORMAL (1.0x) and URGENT
// (1.3x). Customer pays a smaller premium for a faster-than-normal
// cascade but without the full bypass / SLA window of URGENT.
export const PRIORITY_MULTIPLIER = 1.15;

export function urgencyMultiplier(
  journeyType: JourneyType | string | null | undefined,
): number {
  switch (journeyType) {
    case 'URGENT_MESSENGER':
      return URGENCY_MULTIPLIER;
    case 'PRIORITY_MESSENGER':
      return PRIORITY_MULTIPLIER;
    default:
      return 1.0;
  }
}

// R3-CHILD — child-passenger safety overhead premium. Composes
// multiplicatively with VEHICLE_MULTIPLIER and URGENCY_MULTIPLIER
// in getFairPriceRange. The coefficient is intentionally small
// (10% over the base): child journeys carry more driver responsibility
// (drive-slower, helmet check, longer pickup) but the premium has to
// remain affordable for parents using daily transport.
export const CHILD_PASSENGER_MULTIPLIER = 1.1;

export function childPassengerMultiplier(
  hasChildPassenger: boolean | null | undefined,
): number {
  return hasChildPassenger ? CHILD_PASSENGER_MULTIPLIER : 1.0;
}

// R3-DELIVERY — parcel-size fare multiplier. Composes multiplicatively
// with vehicleTypeMultiplier × urgencyMultiplier × childPassengerMultiplier
// in getFairPriceRange. The coefficient reflects driver overhead at the
// stop (loading, securing, time at recipient) — small parcels add minimal
// time, large parcels add meaningful time + may require cargo-capable
// vehicle. Future R3-DELIVERY-V2 may calibrate per pilot data.
export const PARCEL_MULTIPLIER: Record<ParcelSize, number> = {
  SMALL: 1.0, // courier envelope, small box — minimal overhead
  MEDIUM: 1.1, // ~10% overhead for typical retail package
  LARGE: 1.25, // ~25% overhead for bulk goods, may need cargo bike
};

export function parcelMultiplier(parcelSize: ParcelSize | null | undefined): number {
  if (!parcelSize) return 1.0;
  return PARCEL_MULTIPLIER[parcelSize] ?? 1.0;
}

// R3-DELIVERY — the journey's parcel-size for fare composition is the
// LARGEST parcel across its goods stops. Reasoning: the driver's
// vehicle/effort is dictated by the biggest cargo it must carry, not
// the average. Returns null when no goods stops exist.
export function largestParcelSize(
  legs: { parcelSize?: ParcelSize | null }[],
): ParcelSize | null {
  const sizes = legs
    .map((l) => l.parcelSize)
    .filter((s): s is ParcelSize => Boolean(s));
  if (sizes.length === 0) return null;
  if (sizes.includes('LARGE')) return 'LARGE';
  if (sizes.includes('MEDIUM')) return 'MEDIUM';
  return 'SMALL';
}

export function estimatePrice(distanceKm: number): { min: number; max: number } {
  const min = Math.round(BASE_FARE_RWF + MIN_PER_KM_RWF * distanceKm);
  const max = Math.round(BASE_FARE_RWF + MAX_PER_KM_RWF * distanceKm);

  return { min, max };
}

interface PriceRange {
  min: number;
  max: number;
  median: number;
  sampleSize: number;
}

/**
 * Calculate the fair price range for a journey based on historical data.
 * Uses completed journeys within the last 30 days with similar distances.
 * Returns null if insufficient data (fewer than 5 comparable rides).
 */
export async function getFairPriceRange(
  estimatedDistanceKm: number,
  toleranceKm: number = 1.0,
  vehicleType?: VehicleType | null,
  // R3-PRIORITY refactor: was `isUrgent?: boolean | null`. Now takes
  // the JourneyType so URGENT_MESSENGER (1.3x), PRIORITY_MESSENGER
  // (1.15x) and other types (1.0x) compose uniformly.
  journeyType?: JourneyType | string | null,
  hasChildPassenger?: boolean | null,
  parcelSize?: ParcelSize | null,
): Promise<PriceRange | null> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const minDistance = Math.max(0, estimatedDistanceKm - toleranceKm);
  const maxDistance = estimatedDistanceKm + toleranceKm;

  const completedJourneys = await prisma.journey.findMany({
    where: {
      status: 'COMPLETED',
      confirmedAt: { gte: thirtyDaysAgo },
      estimatedDistance: { gte: minDistance, lte: maxDistance },
      agreedPrice: { not: null },
    },
    select: { agreedPrice: true },
    orderBy: { agreedPrice: 'asc' },
  });

  if (completedJourneys.length < 5) return null;

  const prices = completedJourneys
    .map((j: any) => j.agreedPrice!)
    .sort((a: number, b: number) => a - b);

  // Remove top and bottom 10% as outliers
  const trimCount = Math.floor(prices.length * 0.1);
  const trimmedPrices = prices.slice(trimCount, prices.length - trimCount);
  if (trimmedPrices.length === 0) return null;

  const rawMin = trimmedPrices[0];
  const rawMax = trimmedPrices[trimmedPrices.length - 1];
  const medianIdx = Math.floor(trimmedPrices.length / 2);
  const rawMedian = trimmedPrices.length % 2 === 0
    ? Math.round((trimmedPrices[medianIdx - 1] + trimmedPrices[medianIdx]) / 2)
    : trimmedPrices[medianIdx];

  const m =
    vehicleTypeMultiplier(vehicleType) *
    urgencyMultiplier(journeyType) *
    childPassengerMultiplier(hasChildPassenger) *
    parcelMultiplier(parcelSize);
  return {
    min: Math.round(rawMin * m),
    max: Math.round(rawMax * m),
    median: Math.round(rawMedian * m),
    sampleSize: completedJourneys.length,
  };
}
