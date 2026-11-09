// SERVICES/DISCOVERY/SUPPLY.TS
//
// Real-time "drivers nearby" supply count for the customer-facing
// waiting screen. Two layers:
//
//   1. getNearbyDriverCount(prisma, pickup, ring) — DB query for
//      online + fresh + non-frozen drivers within the cascade ring.
//   2. applyPrivacyFloor(rawCount) — pure function that masks counts
//      below SUPPLY_PRIVACY_FLOOR_N (default 3) to null and rounds
//      counts above SUPPLY_COUNT_ROUNDING_ABOVE to a coarse bucket.
//
// The privacy floor protects driver anonymity in low-density areas
// where exposing "1 driver nearby" effectively names the person.

import type { PrismaClient } from '@prisma/client';
import { haversineMeters } from './cascade';
import {
  DRIVER_LOCATION_FRESHNESS_SECONDS,
  RING_NO_LIMIT,
  SUPPLY_COUNT_ROUNDING_ABOVE,
  SUPPLY_COUNT_ROUNDING_BUCKET,
  SUPPLY_PRIVACY_FLOOR_N,
} from './config';
import type { CurrentRing, SupplyCount } from './types';

// Lat/lng degree → meter conversions for bounding-box prefilter.
// 1° latitude ≈ 111.32 km; 1° longitude varies with cos(lat).
const METERS_PER_DEG_LAT = 111_320;

function metersToDegLng(meters: number, lat: number): number {
  const cos = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  return meters / (METERS_PER_DEG_LAT * cos);
}

export async function getNearbyDriverCount(
  prisma: PrismaClient,
  pickup: { lat: number; lng: number },
  ring: CurrentRing,
  now: Date = new Date(),
): Promise<SupplyCount> {
  const freshSince = new Date(
    now.getTime() - DRIVER_LOCATION_FRESHNESS_SECONDS * 1000,
  );

  const baseWhere = {
    isOnline: true,
    lastLocationAt: { gte: freshSince },
    lastLat: { not: null as number | null },
    lastLng: { not: null as number | null },
    user: { frozenAt: null },
  } as const;

  let candidates: Array<{
    lastLat: number | null;
    lastLng: number | null;
  }>;

  if (ring.radiusMeters === RING_NO_LIMIT) {
    candidates = await prisma.driverProfile.findMany({
      where: baseWhere,
      select: { lastLat: true, lastLng: true },
    });
  } else {
    // Bounding-box prefilter — Postgres can use the existing isOnline
    // index plus simple range comparisons; we then refine with
    // Haversine in JS for exact in-ring membership.
    const dLat = ring.radiusMeters / METERS_PER_DEG_LAT;
    const dLng = metersToDegLng(ring.radiusMeters, pickup.lat);
    candidates = await prisma.driverProfile.findMany({
      where: {
        ...baseWhere,
        lastLat: { gte: pickup.lat - dLat, lte: pickup.lat + dLat },
        lastLng: { gte: pickup.lng - dLng, lte: pickup.lng + dLng },
      },
      select: { lastLat: true, lastLng: true },
    });
  }

  let rawCount = 0;
  if (ring.radiusMeters === RING_NO_LIMIT) {
    rawCount = candidates.length;
  } else {
    for (const d of candidates) {
      if (d.lastLat === null || d.lastLng === null) continue;
      const dist = haversineMeters(
        { lat: d.lastLat, lng: d.lastLng },
        pickup,
      );
      if (dist <= ring.radiusMeters) rawCount++;
    }
  }

  return applyPrivacyFloor(rawCount);
}

// Pure transform from raw count → customer-facing supply payload.
// Exported so unit tests can cover the privacy floor without a DB.
export function applyPrivacyFloor(rawCount: number): SupplyCount {
  if (rawCount < SUPPLY_PRIVACY_FLOOR_N) {
    return {
      count: null,
      displayHint: 'few',
      estimatedFirstBidSeconds: rawCount === 0 ? null : 60,
    };
  }
  if (rawCount > SUPPLY_COUNT_ROUNDING_ABOVE) {
    const rounded =
      Math.floor(rawCount / SUPPLY_COUNT_ROUNDING_BUCKET) *
      SUPPLY_COUNT_ROUNDING_BUCKET;
    return {
      count: rounded,
      displayHint: 'many',
      estimatedFirstBidSeconds: 30,
    };
  }
  return {
    count: rawCount,
    displayHint: rawCount >= 6 ? 'some' : 'few',
    estimatedFirstBidSeconds: 45,
  };
}
