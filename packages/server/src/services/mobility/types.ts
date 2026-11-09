// SERVICES/MOBILITY/TYPES.TS
//
// Shared interfaces for the mobility intelligence aggregation pipeline
// (Dispatch J). Types are deliberately decoupled from the Prisma client
// representation so the aggregator can be unit-tested without a database.

import type { PrismaClient } from '@prisma/client';

export type Tier = 'DENSE' | 'MEDIUM' | 'LOW' | 'SPARSE';

export type AggregateTypeName = 'POINT_DENSITY' | 'OD_MATRIX';

export type AttributeKind = 'VEHICLE_TYPE' | 'HOUR_OF_DAY' | 'FARE_DECILE';

export type AttributeSet = Record<string, unknown>;

export interface TierConfig {
  tier: Tier;
  cellSizeMeters: number;
  bucketMinutes: number;
  kThreshold: number;
  attributes: AttributeKind[];
}

export interface TierBoundingBox {
  name: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface TierClassificationFile {
  version: string;
  tiers: Record<
    Tier,
    {
      criteria: string;
      boundingBoxes: TierBoundingBox[];
    }
  >;
}

export interface ClassifiedPoint {
  journeyId: string;
  vehicleType?: string;
  fareRwf?: number;
  lat: number;
  lng: number;
  timestamp: Date;
  tier: Tier;
  cellId: string;
  cellCenterLat: number;
  cellCenterLng: number;
  bucketStart: Date;
  bucketEnd: Date;
}

export interface AggregateRow {
  tier: Tier;
  aggregateType: AggregateTypeName;
  cellId: string;
  cellCenterLat: number;
  cellCenterLng: number;
  bucketStart: Date;
  bucketEnd: Date;
  count: number;
  attributesJson?: AttributeSet;
}

export interface AggregateModuleResult {
  aggregated: AggregateRow[];
  scannedPoints: number;
  durationMs: number;
  // Per-tier suppressed-row counts (rows that the aggregator computed
  // but did NOT include in `aggregated` because they fell below the
  // tier's k-anonymity threshold). The aggregator IS the privacy gate;
  // the cron only reports these for observability.
  suppressedByTier?: Record<Tier, number>;
}

export interface AggregateModuleOpts {
  sinceUtc: Date;
  untilUtc: Date;
}

export interface AggregateModule {
  name: AggregateTypeName;
  aggregate: (
    prisma: PrismaClient,
    opts: AggregateModuleOpts,
  ) => Promise<AggregateModuleResult>;
}
