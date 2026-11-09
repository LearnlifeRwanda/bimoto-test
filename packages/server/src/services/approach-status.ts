// R3-N-3 — derive an `ApproachStatus` for a MATCHED journey from the
// driver's recent GPS history. Used by GET /api/journeys/:id/eta to
// gate the customer cancel modal between DRIVER_NO_SHOW (silent/lost)
// and DRIVER_LATE (visibly approaching but past 12 min).
//
// This helper intentionally does NOT share logic with the R3-N-2
// `deriveAttribution` helper in jobs/no-show-timeout.job.ts — that
// helper assigns blame at +30-min auto-cancel; this one describes
// where the driver currently is regardless of blame, takes a sequence
// of recent GPS points (not just the latest), and emits an
// `ApproachStatus` enum (not a `CancelReason`).

import { haversineMetres } from './eta/haversine';
import type { ApproachStatus } from '@bimoto/shared';

// Module-private thresholds. Tuned for the Kigali pilot; revise from
// operational data after first 100 rides.
const ARRIVED_RADIUS_M = 50;            // within this → arrived
const LOST_FAR_RADIUS_M = 800;          // outside this w/ recent GPS → lost
const RECENT_BROADCAST_MS = 5 * 60 * 1000;  // GPS within 5 min = "active"
const APPROACHING_MIN_DELTA_M = 30;     // distance must drop by this to count as moving toward pickup

export interface GpsPointInput {
  lat: number;
  lng: number;
  timestamp: Date;
}

export interface ApproachStatusResult {
  status: ApproachStatus;
  distanceMeters: number | null;
  // Latest GPS timestamp used to derive the status.
  lastGpsAt: Date | null;
}

/**
 * Derive an `ApproachStatus` from the driver's recent GPS history.
 *
 * `points` MUST be supplied in chronological order (oldest first).
 * Caller's responsibility — query DESC then `[...].reverse()` is the
 * idiom used by the journey ETA route.
 */
export function deriveApproachStatus(
  points: GpsPointInput[],
  pickupLat: number,
  pickupLng: number,
  now: Date,
): ApproachStatusResult {
  if (points.length === 0) {
    return { status: 'silent', distanceMeters: null, lastGpsAt: null };
  }

  const latest = points[points.length - 1];
  const ageMs = now.getTime() - latest.timestamp.getTime();
  const distanceMeters = haversineMetres(
    latest.lat,
    latest.lng,
    pickupLat,
    pickupLng,
  );

  if (ageMs > RECENT_BROADCAST_MS) {
    return { status: 'silent', distanceMeters, lastGpsAt: latest.timestamp };
  }

  if (distanceMeters < ARRIVED_RADIUS_M) {
    return { status: 'arrived', distanceMeters, lastGpsAt: latest.timestamp };
  }

  // Vector inspection: across the last min(3, points.length) points,
  // did distance to pickup decrease by at least APPROACHING_MIN_DELTA_M?
  const sample = points.slice(-3);
  if (sample.length >= 2) {
    const oldestSample = sample[0];
    const oldestDist = haversineMetres(
      oldestSample.lat,
      oldestSample.lng,
      pickupLat,
      pickupLng,
    );
    const delta = oldestDist - distanceMeters;
    if (delta >= APPROACHING_MIN_DELTA_M) {
      return {
        status: 'approaching',
        distanceMeters,
        lastGpsAt: latest.timestamp,
      };
    }
    if (distanceMeters > LOST_FAR_RADIUS_M && delta < APPROACHING_MIN_DELTA_M) {
      return { status: 'lost', distanceMeters, lastGpsAt: latest.timestamp };
    }
  }

  // Fallback: recent GPS but no clear vector. Favour "approaching"
  // unless the driver is far AND not visibly closing the gap.
  if (distanceMeters > LOST_FAR_RADIUS_M) {
    return { status: 'lost', distanceMeters, lastGpsAt: latest.timestamp };
  }
  return {
    status: 'approaching',
    distanceMeters,
    lastGpsAt: latest.timestamp,
  };
}
