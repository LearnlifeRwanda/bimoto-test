// SERVICES/DISCOVERY/CASCADE.TS
//
// Pure ring-math helpers for the bid-discovery cascade. No I/O, no
// database, no socket — just date math, geometry and the per-tier
// CascadeConfig from config.ts. This keeps the cascade logic
// trivially unit-testable and side-effect free.
//
// Reuses J's tierForCoordinates so the same Rwanda admin geography
// drives both mobility intelligence (J) and bid discovery (K1) — see
// services/mobility/tier-classification.ts.

import { tierForCoordinates } from '../mobility/tier-classification';
import {
  CASCADE_CONFIGS,
  DRIVER_LOCATION_FRESHNESS_SECONDS,
  RING_NO_LIMIT,
} from './config';
import type { CascadeConfig, CurrentRing, Tier } from './types';

const EARTH_RADIUS_METERS = 6_371_000;

export function cascadeConfigForPickup(
  pickupLat: number,
  pickupLng: number,
): CascadeConfig {
  const tier = tierForCoordinates(pickupLat, pickupLng);
  return CASCADE_CONFIGS[tier];
}

export function currentRingForElapsed(
  discoveryStartedAt: Date,
  tier: Tier,
  now: Date = new Date(),
): CurrentRing {
  const config = CASCADE_CONFIGS[tier];
  const elapsedSec = Math.max(
    0,
    (now.getTime() - discoveryStartedAt.getTime()) / 1000,
  );
  const lastIndex = config.rings.length - 1;
  const ringIndex = Math.min(
    Math.floor(elapsedSec / config.ringDurationSeconds),
    lastIndex,
  );
  const radiusMeters = config.rings[ringIndex];
  const ringStartedAt = new Date(
    discoveryStartedAt.getTime() +
      ringIndex * config.ringDurationSeconds * 1000,
  );
  const isLast = ringIndex === lastIndex;
  const ringEndsAt = isLast
    ? null
    : new Date(
        ringStartedAt.getTime() + config.ringDurationSeconds * 1000,
      );
  // Cascade is "complete" once we have stayed in the final ring for at
  // least one full ring duration — i.e. the radius has stopped growing
  // and the operator can reasonably say "we've shown this to everyone
  // we're going to show it to."
  const totalCascadeSec = config.ringDurationSeconds * config.rings.length;
  const isCascadeComplete = isLast && elapsedSec >= totalCascadeSec;
  return {
    ringIndex,
    radiusMeters,
    ringStartedAt,
    ringEndsAt,
    isCascadeComplete,
  };
}

/**
 * R3-T — urgent journeys bypass the time-based cascade. Returns the
 * final (widest) ring immediately so the journey is broadcast to
 * every eligible driver at journey creation. The caller (feed-filter
 * for read-side, broadcastUrgentImmediately for socket emit) gets
 * the same CurrentRing shape so downstream code is unchanged.
 */
export function currentRingForUrgent(
  tier: Tier,
  now: Date = new Date(),
): CurrentRing {
  const config = CASCADE_CONFIGS[tier];
  const lastIndex = config.rings.length - 1;
  return {
    ringIndex: lastIndex,
    radiusMeters: config.rings[lastIndex],
    ringStartedAt: now,
    ringEndsAt: null,
    isCascadeComplete: true,
  };
}

// R3-PRIORITY — half-speed cascade for PRIORITY_MESSENGER trips.
// Faster broadcast to wider radius than NORMAL but not full bypass
// (URGENT_MESSENGER bypasses to final ring immediately). Halving the
// per-ring duration is equivalent to doubling the elapsed time fed to
// currentRingForElapsed.
export const PRIORITY_CASCADE_SPEEDUP = 0.5;

/**
 * R3-PRIORITY — returns the cascade ring for a PRIORITY_MESSENGER
 * journey. Uses the same ring radii as the normal cascade but with
 * each ring's effective duration halved (PRIORITY_CASCADE_SPEEDUP).
 * At elapsed=0 the result matches NORMAL (ring 0); at half the time
 * NORMAL would expand to ring N, PRIORITY is already at ring N.
 */
export function currentRingForPriority(
  discoveryStartedAt: Date,
  tier: Tier,
  now: Date = new Date(),
): CurrentRing {
  const elapsedMs = Math.max(
    0,
    now.getTime() - discoveryStartedAt.getTime(),
  );
  const acceleratedStart = new Date(
    now.getTime() - elapsedMs / PRIORITY_CASCADE_SPEEDUP,
  );
  return currentRingForElapsed(acceleratedStart, tier, now);
}

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface DriverLocationProbe {
  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: Date | null;
}

export function isDriverInCurrentRing(
  driver: DriverLocationProbe,
  pickup: { lat: number; lng: number },
  ring: CurrentRing,
  now: Date = new Date(),
): boolean {
  if (
    driver.lastLat === null ||
    driver.lastLng === null ||
    driver.lastLocationAt === null
  ) {
    return false;
  }
  const ageSec =
    (now.getTime() - driver.lastLocationAt.getTime()) / 1000;
  if (ageSec > DRIVER_LOCATION_FRESHNESS_SECONDS) {
    return false;
  }
  if (ring.radiusMeters === RING_NO_LIMIT) {
    return true;
  }
  const dist = haversineMeters(
    { lat: driver.lastLat, lng: driver.lastLng },
    pickup,
  );
  return dist <= ring.radiusMeters;
}
