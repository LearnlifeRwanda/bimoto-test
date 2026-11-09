// ANY-VEHICLE G2 — a coarse, honest trip-duration estimate.
//
// WHY THIS IS AN ESTIMATE AND NOT A ROUTED DURATION
//
// There is no pickup→destination duration endpoint in this codebase.
// The ETA service (services/eta) answers a different question — how
// long the motari needs to REACH the pickup from his last GPS fix
// (journey.routes.ts) — and nothing routes the trip itself. So a
// customer comparing vehicle kinds before any bid exists has no routed
// number available, and this helper must not pretend otherwise.
//
// It therefore returns a RANGE, never a point value, and every caller
// is required to label it as an estimate. A single number here would
// read as a promise the platform cannot keep.
//
// WHAT IT IS BUILT ON
//
// The compliance matrix's `maxPlausibleSpeedKmh` is the only
// per-vehicle speed the server already trusts. It is a CEILING used by
// the GPS plausibility engine to reject impossible traces — not a
// travel speed. Riding at it would put a moto across Kigali in a few
// minutes. So the band is a fraction of it, on both ends.
//
// The two fractions below are calibrated against a number the same
// customer is already shown on the same screen: VehicleTypeInfoCard
// displays a typical cruising speed per vehicle kind (bike 12, e-bike
// 18, moto 25, e-moto 28 km/h). The fractions are chosen so that each
// vehicle's band BRACKETS its own info-card figure — the fast end is
// optimistic against it, the slow end pessimistic — so the two
// surfaces cannot contradict each other:
//
//   vehicle  ceiling  fast (×0.40)  slow (×0.22)  info-card typical
//   BIKE       40        16.0          8.8              12   ✓
//   E_BIKE     50        20.0         11.0              18   ✓
//   MOTO       90        36.0         19.8              25   ✓
//   E_MOTO     80        32.0         17.6              28   ✓
//
// Deliberately NOT derived from the info card directly: the compliance
// matrix is the matrix a new vehicle type gets added to (see its own
// header), so a fifth vehicle kind picks up a band here for free.

import { VehicleType } from '../types/user.js';
import { getVehicleCompliance } from './vehicle-compliance.js';

/**
 * Straight-line (haversine) distance under-states road distance. Kigali
 * is hilly and its road network is not a grid: routes follow ridges and
 * valleys rather than the crow's line. 1.3 is a conservative detour
 * factor for the pilot area — it makes the estimate longer, never
 * shorter, which is the safe direction for a number a customer reads
 * before choosing.
 */
const ROAD_WINDING_FACTOR = 1.3;

/** Optimistic end of the band, as a fraction of `maxPlausibleSpeedKmh`. */
const TRIP_SPEED_FAST_FRACTION = 0.4;

/** Pessimistic end of the band, as a fraction of `maxPlausibleSpeedKmh`. */
const TRIP_SPEED_SLOW_FRACTION = 0.22;

/**
 * The floor, in minutes. No trip is quoted below it, however short:
 * rounding a two-block hop down to "0–1 min" reads as a glitch rather
 * than an estimate, and the pickup itself takes longer than that.
 */
const MIN_TRIP_MINUTES = 2;

export interface TripMinutesRange {
  /** Optimistic end, whole minutes. Always ≥ MIN_TRIP_MINUTES. */
  minMinutes: number;
  /** Pessimistic end, whole minutes. Always ≥ minMinutes. */
  maxMinutes: number;
}

/**
 * A coarse trip-duration band for one vehicle kind.
 *
 * Pure: no clock, no network, no I/O. Same inputs, same answer.
 *
 * `distanceMeters` is straight-line metres — the winding factor is
 * applied here, so callers pass the haversine distance directly.
 * A non-finite or non-positive distance yields the floor band rather
 * than NaN, so a half-filled form renders something honest.
 */
export function estimateTripMinutesRange(
  distanceMeters: number,
  vehicleType: VehicleType | string,
): TripMinutesRange {
  const ceilingKmh = getVehicleCompliance(String(vehicleType)).maxPlausibleSpeedKmh;

  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return { minMinutes: MIN_TRIP_MINUTES, maxMinutes: MIN_TRIP_MINUTES };
  }

  const roadKm = (distanceMeters / 1000) * ROAD_WINDING_FACTOR;
  const fastKmh = ceilingKmh * TRIP_SPEED_FAST_FRACTION;
  const slowKmh = ceilingKmh * TRIP_SPEED_SLOW_FRACTION;

  // Faster speed → shorter time, so the fast fraction gives minMinutes.
  const minMinutes = Math.max(MIN_TRIP_MINUTES, Math.round((roadKm / fastKmh) * 60));
  const maxMinutes = Math.max(minMinutes, Math.round((roadKm / slowKmh) * 60));

  return { minMinutes, maxMinutes };
}

/**
 * The vehicle kinds an any-vehicle request is compared across, in the
 * order the compliance matrix declares them. Exported so the client's
 * per-kind block and its tests cannot drift apart.
 */
export const COMPARABLE_VEHICLE_TYPES: VehicleType[] = [
  VehicleType.BIKE,
  VehicleType.E_BIKE,
  VehicleType.MOTO,
  VehicleType.E_MOTO,
];
