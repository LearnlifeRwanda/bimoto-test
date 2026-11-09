// SERVICES/DISCOVERY/CONFIG.TS
//
// Tier-aware cascade configuration for Dispatch K1. Every threshold is
// env-overridable so pilot operators can tune behaviour per region
// without redeploying. The defaults below match the K1 dispatch:
//
//   DENSE  (Kigali City)    : 200 → 500 → 1000 → 2000 m, 30s rings
//   MEDIUM (secondary cities): 500 → 1000 → 2000 → 5000 m, 45s rings
//   LOW    (district capital): 1000 → 2000 → 5000 → 10000 m, 60s rings
//   SPARSE (everywhere else) : 2000 → 5000 → 10000 → -1 (all), 90s rings
//
// The "-1" sentinel in SPARSE's last ring removes the radius limit so
// rural ride requests eventually reach every online driver in the
// fleet rather than starving on geometry.
//
// Privacy floor: SUPPLY_PRIVACY_FLOOR_N (default 3) is the same
// k-anonymity discipline J's mobility intelligence layer uses. Counts
// below it return null from the supply API so the customer can't
// re-identify which person is "the 1 driver nearby" in a small village.

import type { CascadeConfig, Tier } from './types';

function parseRings(raw: string): number[] {
  return raw.split(',').map((s) => parseInt(s.trim(), 10));
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const CASCADE_CONFIGS: Record<Tier, CascadeConfig> = {
  DENSE: {
    tier: 'DENSE',
    rings: parseRings(process.env.K1_DENSE_RINGS_M ?? '200,500,1000,2000'),
    ringDurationSeconds: envInt('K1_DENSE_RING_SEC', 30),
  },
  MEDIUM: {
    tier: 'MEDIUM',
    rings: parseRings(process.env.K1_MEDIUM_RINGS_M ?? '500,1000,2000,5000'),
    ringDurationSeconds: envInt('K1_MEDIUM_RING_SEC', 45),
  },
  LOW: {
    tier: 'LOW',
    rings: parseRings(process.env.K1_LOW_RINGS_M ?? '1000,2000,5000,10000'),
    ringDurationSeconds: envInt('K1_LOW_RING_SEC', 60),
  },
  SPARSE: {
    tier: 'SPARSE',
    rings: parseRings(process.env.K1_SPARSE_RINGS_M ?? '2000,5000,10000,-1'),
    ringDurationSeconds: envInt('K1_SPARSE_RING_SEC', 90),
  },
};

// Privacy floor — counts strictly below this value are masked to
// `null` at the supply API. Do NOT lower without admin awareness.
export const SUPPLY_PRIVACY_FLOOR_N = envInt('K1_SUPPLY_FLOOR_N', 3);

// Above this raw count, supply numbers are rounded down to a bucket
// (e.g. 23 → 20) so the customer-facing "drivers nearby" widget
// doesn't leak fine-grained density signal.
export const SUPPLY_COUNT_ROUNDING_ABOVE = envInt('K1_SUPPLY_ROUND_ABOVE', 10);
export const SUPPLY_COUNT_ROUNDING_BUCKET = envInt('K1_SUPPLY_ROUND_BUCKET', 5);

// Driver location must have been updated within this window to count
// for cascade discovery and supply visibility. Stale-location drivers
// are excluded from both.
export const DRIVER_LOCATION_FRESHNESS_SECONDS = envInt(
  'K1_DRIVER_LOC_FRESH_SEC',
  300,
);

// "no radius limit" sentinel — exported so callers don't sprinkle -1s.
export const RING_NO_LIMIT = -1;
