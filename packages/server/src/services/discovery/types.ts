// SERVICES/DISCOVERY/TYPES.TS
//
// Shared interfaces for the bid-discovery cascade (Dispatch K1).
//
// The cascade exposes a posted ride request to drivers in expanding
// concentric "rings" around the pickup. Closest drivers see it first
// and have a brief monopoly window to bid; if no bid lands, the ring
// expands. Ring radii and durations are tier-aware (DENSE Kigali
// shrinks fast; SPARSE rural opens wide).
//
// CurrentRing is computed on read from `Journey.discoveryStartedAt +
// elapsed time` — never persisted. This keeps the schema minimal and
// avoids cron / race-condition hazards.

import type { Tier } from '../mobility/types';

export type { Tier };

export interface CascadeConfig {
  tier: Tier;
  // Radii in meters, smallest → largest. The sentinel value -1 means
  // "no radius limit" — used as the last ring for SPARSE so rural
  // requests eventually reach every online driver.
  rings: number[];
  ringDurationSeconds: number;
}

export interface CurrentRing {
  // 0-indexed position in CascadeConfig.rings.
  ringIndex: number;
  // Radius for THIS ring. -1 means no radius limit (SPARSE last ring).
  radiusMeters: number;
  ringStartedAt: Date;
  // null when this is the final ring of the cascade.
  ringEndsAt: Date | null;
  // True once elapsed time has exceeded the total cascade duration.
  isCascadeComplete: boolean;
}

export interface SupplyCount {
  // null when raw count < SUPPLY_PRIVACY_FLOOR_N: the UI must show
  // "drivers nearby" without a number to protect driver anonymity in
  // low-density areas.
  count: number | null;
  displayHint: 'few' | 'some' | 'many';
  // Optional client-side hint for "first bid expected within ~Xs".
  // null means "we don't know" (e.g. count=0).
  estimatedFirstBidSeconds: number | null;
}

export interface NearbyDriverRow {
  userId: string;
  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: Date | null;
  isOnline: boolean;
  frozenAt: Date | null;
}
