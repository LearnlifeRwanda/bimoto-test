import { AppError } from '../../middleware/error-handler';
import {
  AUTO_FALLBACK_LEAD_MS,
  BID_WINDOW_LEAD_MS,
  KIGALI_BOUNDS,
  MAX_LEAD_TIME_MS,
  MIN_LEAD_TIME_MS,
} from '@bimoto/shared';

// HYGIENE W3 G5 — the four lead times now live in
// packages/shared/src/constants/time.ts. They are re-exported here because
// this module has been their import site since SCHED, and re-pointing every
// consumer would be a wider diff than the rule is worth. The values are
// unchanged.
export { MIN_LEAD_TIME_MS, MAX_LEAD_TIME_MS, BID_WINDOW_LEAD_MS, AUTO_FALLBACK_LEAD_MS };

export function validateScheduledFor(scheduledFor: Date, now: Date = new Date()): void {
  const diff = scheduledFor.getTime() - now.getTime();
  if (Number.isNaN(scheduledFor.getTime())) {
    throw new AppError(400, 'SCHEDULED_FOR_INVALID', 'errors.scheduledForInvalid');
  }
  if (diff < MIN_LEAD_TIME_MS) {
    throw new AppError(400, 'SCHEDULED_FOR_TOO_SOON', 'errors.scheduledForTooSoon');
  }
  if (diff > MAX_LEAD_TIME_MS) {
    throw new AppError(400, 'SCHEDULED_FOR_TOO_FAR', 'errors.scheduledForTooFar');
  }
}

function getBoundsFromEnv() {
  const minLat = process.env.PICKUP_BOUNDS_MIN_LAT
    ? Number(process.env.PICKUP_BOUNDS_MIN_LAT)
    : KIGALI_BOUNDS.minLat;
  const maxLat = process.env.PICKUP_BOUNDS_MAX_LAT
    ? Number(process.env.PICKUP_BOUNDS_MAX_LAT)
    : KIGALI_BOUNDS.maxLat;
  const minLng = process.env.PICKUP_BOUNDS_MIN_LNG
    ? Number(process.env.PICKUP_BOUNDS_MIN_LNG)
    : KIGALI_BOUNDS.minLng;
  const maxLng = process.env.PICKUP_BOUNDS_MAX_LNG
    ? Number(process.env.PICKUP_BOUNDS_MAX_LNG)
    : KIGALI_BOUNDS.maxLng;
  return { minLat, maxLat, minLng, maxLng };
}

export function validatePickupCoords(lat: number, lng: number): void {
  if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
    throw new AppError(400, 'PICKUP_COORDS_INVALID', 'errors.pickupCoordsInvalid');
  }
  const bounds = getBoundsFromEnv();
  if (lat < bounds.minLat || lat > bounds.maxLat || lng < bounds.minLng || lng > bounds.maxLng) {
    throw new AppError(400, 'PICKUP_COORDS_OUT_OF_BOUNDS', 'errors.pickupCoordsOutOfBounds');
  }
}

export function computeBidWindowTimes(
  scheduledFor: Date,
): { bidWindowOpensAt: Date; autoFallbackAt: Date } {
  const bidWindowOpensAt = new Date(scheduledFor.getTime() - BID_WINDOW_LEAD_MS);
  const autoFallbackAt = new Date(scheduledFor.getTime() - AUTO_FALLBACK_LEAD_MS);
  return { bidWindowOpensAt, autoFallbackAt };
}
