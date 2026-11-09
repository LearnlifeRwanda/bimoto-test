// SERVICES/MOBILITY/AGGREGATOR/POINT-DENSITY.TS
//
// Point-density aggregator: counts distinct GpsPoints per (tier, cell,
// time-bucket). Each input GpsPoint is classified into its tier via
// tier-classification.ts, snapped to a tier-appropriate hex cell and
// time bucket, accumulated into per-cell counts, and then filtered
// through the k-anonymity gate before being emitted as AggregateRow[].

import type { PrismaClient } from '@prisma/client';
import { TIER_CONFIGS } from '../config';
import { classifyPoint } from '../grid';
import { tierForCoordinates } from '../tier-classification';
import { applyKAnonymity, countSuppressed } from '../k-anonymity';
import { sanitizeMarginals } from '../attribute-suppression';
import type {
  AggregateModuleOpts,
  AggregateModuleResult,
  AggregateRow,
  AttributeKind,
  AttributeSet,
  Tier,
} from '../types';

const PAGE_SIZE = parseInt(process.env.MOBILITY_AGGREGATION_PAGE ?? '5000', 10);

interface Bucket {
  tier: Tier;
  cellId: string;
  cellCenterLat: number;
  cellCenterLng: number;
  bucketStart: Date;
  bucketEnd: Date;
  count: number;
  vehicleTypes: Record<string, number>;
  hourBuckets: Record<number, number>;
  fareDeciles: Record<number, number>;
}

function emptyBucket(seed: Omit<Bucket, 'count' | 'vehicleTypes' | 'hourBuckets' | 'fareDeciles'>): Bucket {
  return {
    ...seed,
    count: 0,
    vehicleTypes: {},
    hourBuckets: {},
    fareDeciles: {},
  };
}

function fareDecile(fare: number | null | undefined): number | null {
  if (fare === null || fare === undefined || Number.isNaN(fare)) return null;
  if (fare <= 0) return 0;
  // Coarse fare deciles: 0..9 mapped to log-buckets up to ~50_000 RWF.
  const capped = Math.min(fare, 50_000);
  return Math.min(9, Math.floor((capped / 50_000) * 10));
}

function attributesFor(tier: Tier, b: Bucket): AttributeSet | undefined {
  const kinds = TIER_CONFIGS[tier].attributes;
  if (kinds.length === 0) return undefined;
  const out: AttributeSet = {};
  const include = (k: AttributeKind) => kinds.includes(k);
  if (include('VEHICLE_TYPE')) out.vehicleTypes = b.vehicleTypes;
  if (include('HOUR_OF_DAY')) out.hourBuckets = b.hourBuckets;
  if (include('FARE_DECILE')) out.fareDecileCounts = b.fareDeciles;
  // INTEL-DECK G3 — the cell-level k said this cell may exist; the grain
  // gate says no category inside it may be a crowd of one. Applied here
  // on the WRITE side so nothing unsafe is ever stored; the read paths
  // run the same function again for the rows written before it existed.
  return sanitizeMarginals(out);
}

export async function aggregatePointDensity(
  prisma: PrismaClient,
  opts: AggregateModuleOpts,
): Promise<AggregateModuleResult> {
  const startedAt = Date.now();
  const buckets = new Map<string, Bucket>();
  let scanned = 0;

  let cursor: string | undefined;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page: Array<{
      id: string;
      lat: number;
      lng: number;
      timestamp: Date;
      journey: { vehiclePreference: string | null; agreedPrice: number | null };
    }> = await prisma.gpsPoint.findMany({
      where: {
        timestamp: { gte: opts.sinceUtc, lt: opts.untilUtc },
      },
      include: {
        journey: { select: { vehiclePreference: true, agreedPrice: true } },
      },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (page.length === 0) break;

    for (const p of page) {
      scanned += 1;
      const tier = tierForCoordinates(p.lat, p.lng);
      const cls = classifyPoint(
        { lat: p.lat, lng: p.lng, timestamp: p.timestamp },
        tier,
      );
      const key = `${tier}|${cls.cellId}|${cls.bucketStart.toISOString()}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = emptyBucket({
          tier,
          cellId: cls.cellId,
          cellCenterLat: cls.cellCenterLat,
          cellCenterLng: cls.cellCenterLng,
          bucketStart: cls.bucketStart,
          bucketEnd: cls.bucketEnd,
        });
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      const vt = p.journey?.vehiclePreference;
      if (vt) bucket.vehicleTypes[vt] = (bucket.vehicleTypes[vt] ?? 0) + 1;
      const hour = p.timestamp.getUTCHours();
      bucket.hourBuckets[hour] = (bucket.hourBuckets[hour] ?? 0) + 1;
      const dec = fareDecile(p.journey?.agreedPrice);
      if (dec !== null) bucket.fareDeciles[dec] = (bucket.fareDeciles[dec] ?? 0) + 1;
    }

    cursor = page[page.length - 1].id;
    if (page.length < PAGE_SIZE) break;
  }

  const all: AggregateRow[] = Array.from(buckets.values()).map((b) => ({
    tier: b.tier,
    aggregateType: 'POINT_DENSITY',
    cellId: b.cellId,
    cellCenterLat: b.cellCenterLat,
    cellCenterLng: b.cellCenterLng,
    bucketStart: b.bucketStart,
    bucketEnd: b.bucketEnd,
    count: b.count,
    attributesJson: attributesFor(b.tier, b),
  }));

  const safe = applyKAnonymity(all);
  const suppressedByTier = countSuppressed(all);
  return {
    aggregated: safe,
    scannedPoints: scanned,
    durationMs: Date.now() - startedAt,
    suppressedByTier,
  };
}
