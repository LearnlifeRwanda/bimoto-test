// SERVICES/MOBILITY/CONFIG.TS
//
// Per-tier (cellSize, bucketMinutes, kThreshold, attributes) configuration
// for the mobility intelligence aggregation pipeline (Dispatch J). All
// thresholds are env-overridable; defaults are conservative for the
// Kigali pilot.

import type { Tier, TierConfig } from './types';

export const TIER_CONFIGS: Record<Tier, TierConfig> = {
  DENSE: {
    tier: 'DENSE',
    cellSizeMeters: parseInt(process.env.MOBILITY_DENSE_CELL_M ?? '250', 10),
    bucketMinutes: parseInt(process.env.MOBILITY_DENSE_BUCKET_MIN ?? '30', 10),
    kThreshold: parseInt(process.env.MOBILITY_DENSE_K ?? '20', 10),
    attributes: ['VEHICLE_TYPE', 'HOUR_OF_DAY', 'FARE_DECILE'],
  },
  MEDIUM: {
    tier: 'MEDIUM',
    cellSizeMeters: parseInt(process.env.MOBILITY_MEDIUM_CELL_M ?? '500', 10),
    bucketMinutes: parseInt(process.env.MOBILITY_MEDIUM_BUCKET_MIN ?? '60', 10),
    kThreshold: parseInt(process.env.MOBILITY_MEDIUM_K ?? '15', 10),
    attributes: ['VEHICLE_TYPE', 'HOUR_OF_DAY'],
  },
  LOW: {
    tier: 'LOW',
    cellSizeMeters: parseInt(process.env.MOBILITY_LOW_CELL_M ?? '1000', 10),
    bucketMinutes: parseInt(process.env.MOBILITY_LOW_BUCKET_MIN ?? '120', 10),
    kThreshold: parseInt(process.env.MOBILITY_LOW_K ?? '10', 10),
    attributes: ['HOUR_OF_DAY'],
  },
  SPARSE: {
    tier: 'SPARSE',
    cellSizeMeters: parseInt(process.env.MOBILITY_SPARSE_CELL_M ?? '5000', 10),
    bucketMinutes: parseInt(process.env.MOBILITY_SPARSE_BUCKET_MIN ?? '240', 10),
    kThreshold: parseInt(process.env.MOBILITY_SPARSE_K ?? '10', 10),
    attributes: [],
  },
};

export const MOBILITY_AGGREGATION_CRON =
  process.env.MOBILITY_AGGREGATION_CRON ?? '0 4 * * *';

export const MOBILITY_AGGREGATION_LOOKBACK_HOURS = parseInt(
  process.env.MOBILITY_LOOKBACK_HOURS ?? '24',
  10,
);

export const MOBILITY_AGGREGATION_TIMEZONE =
  process.env.MOBILITY_TIMEZONE ?? 'Africa/Kigali';

export const MOBILITY_AGGREGATION_TIMEOUT_MS = parseInt(
  process.env.MOBILITY_TIMEOUT_MS ?? '900000',
  10,
);

export const MOBILITY_RUN_NOW_MAX_RANGE_DAYS = parseInt(
  process.env.MOBILITY_RUN_NOW_MAX_RANGE_DAYS ?? '90',
  10,
);

export function tierConfigFor(tier: Tier): TierConfig {
  const cfg = TIER_CONFIGS[tier];
  if (!cfg) {
    throw new Error(`mobility-config: unknown tier ${String(tier)}`);
  }
  return cfg;
}
