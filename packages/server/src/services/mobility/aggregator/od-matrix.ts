// SERVICES/MOBILITY/AGGREGATOR/OD-MATRIX.TS
//
// INTEL-DECK G2 — the origin→destination matrix, finally real. Dispatch
// J shipped this file as a stub returning nothing; the enum, the model
// and the cron's per-module loop have been waiting for a body ever
// since. This is that body, and it changes no signature: the registry
// (aggregator/index.ts) is untouched.
//
// What a row is: one (origin cell → destination cell) pair inside one
// time bucket, counted over COMPLETED journeys. The endpoints are
// classified INDEPENDENTLY — a ride out of Kigali into a village has a
// DENSE origin and a SPARSE destination, and neither end is coerced
// into the other's tier.
//
// ROW SHAPE — a deliberate departure from the dispatched sketch, stated
// here because it is load-bearing.
//
// The sketch put the origin cell in `cellId` and the destination in
// `attributesJson`. That cannot work against the model as it stands:
// MobilityAggregate is @@unique([tier, aggregateType, cellId,
// bucketStart]), so every pair leaving one origin in one bucket would
// collide on the same key, and bulkInsertAggregates (skipDuplicates:
// true) would silently keep the first and drop the rest. Nyabugogo at
// 08:00 would ship one destination and lose the other forty.
//
// So the PAIR is the identity: cellId = sha256("OD:" + originCellId +
// ":" + destCellId). This rides the existing model with no migration —
// it is still one opaque hash in a String column — keeps the unique
// index doing exactly the job it was designed for, and preserves
// grid.ts's discipline that coordinates are not recoverable from an id.
// Both endpoints then travel in attributesJson (originCellId,
// destCellId, and both centres), which is additive and readable.
// cellCenterLat/Lng keep their meaning as "where this row sits on the
// map" and carry the ORIGIN centre, so an OD row still plots.
//
// K-GATE — the stricter side wins. A pair passes only if its count
// meets max(k(originTier), k(destTier)): a flow into a k=20 Kigali cell
// is not laundered through a k=10 rural origin. k-anonymity.ts itself
// is untouched; this reuses its exported thresholdForTier and then
// passes the survivors through applyKAnonymity as a second net (which
// they clear by construction, since the pair threshold is never lower
// than the origin tier's).
//
// At pilot volume most pairs will be suppressed. That is the correct
// behaviour, not a bug, and suppressedByTier reports it honestly.

import type { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { TIER_CONFIGS } from '../config';
import { snapToCell, snapToBucket } from '../grid';
import { tierForCoordinates } from '../tier-classification';
import { applyKAnonymity, thresholdForTier } from '../k-anonymity';
import { sanitizeMarginals } from '../attribute-suppression';
import type {
  AggregateModuleOpts,
  AggregateModuleResult,
  AggregateRow,
  AttributeSet,
  Tier,
} from '../types';

const PAGE_SIZE = parseInt(process.env.MOBILITY_AGGREGATION_PAGE ?? '5000', 10);

interface Pair {
  originTier: Tier;
  destTier: Tier;
  cellId: string;
  originCellId: string;
  destCellId: string;
  originCenterLat: number;
  originCenterLng: number;
  destCenterLat: number;
  destCenterLng: number;
  bucketStart: Date;
  bucketEnd: Date;
  count: number;
  vehicleTypes: Record<string, number>;
  hourBuckets: Record<number, number>;
}

/** Opaque pair identity. Neither endpoint is recoverable from the hash. */
export function odPairCellId(originCellId: string, destCellId: string): string {
  return createHash('sha256').update(`OD:${originCellId}:${destCellId}`).digest('hex');
}

/**
 * The threshold a pair must clear: the stricter of the two endpoints.
 * Exported so the read paths and the tests can state the rule once.
 */
export function pairThreshold(originTier: Tier, destTier: Tier): number {
  return Math.max(thresholdForTier(originTier), thresholdForTier(destTier));
}

// v1 OD carries no fares — only the movement and who moved. The origin
// tier's own attribute list still governs, so a LOW-origin pair gets
// hours only and a SPARSE-origin pair gets nothing, exactly as
// point-density behaves.
function attributesFor(p: Pair): AttributeSet | undefined {
  const kinds = TIER_CONFIGS[p.originTier].attributes;
  const out: AttributeSet = {
    originCellId: p.originCellId,
    destCellId: p.destCellId,
    originCenterLat: p.originCenterLat,
    originCenterLng: p.originCenterLng,
    destCenterLat: p.destCenterLat,
    destCenterLng: p.destCenterLng,
    destTier: p.destTier,
  };
  if (kinds.includes('VEHICLE_TYPE')) out.vehicleTypes = p.vehicleTypes;
  if (kinds.includes('HOUR_OF_DAY')) out.hourBuckets = p.hourBuckets;
  // G3 — the write-side grain gate. The pair threshold said the row may
  // exist; this says no category inside it may be a crowd of one.
  return sanitizeMarginals(out);
}

interface JourneyRow {
  id: string;
  pickupLat: number;
  pickupLng: number;
  destinationLat: number;
  destinationLng: number;
  vehiclePreference: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
}

export async function aggregateOdMatrix(
  prisma: PrismaClient,
  opts: AggregateModuleOpts,
): Promise<AggregateModuleResult> {
  const startedAt = Date.now();
  const pairs = new Map<string, Pair>();
  let scanned = 0;

  let cursor: string | undefined;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page: JourneyRow[] = await prisma.journey.findMany({
      // The window is on endedAt: a journey belongs to the run that saw
      // it finish. The daily cron's 24 h lookback therefore never
      // half-counts a ride that was still in progress last night.
      where: {
        status: 'COMPLETED',
        endedAt: { gte: opts.sinceUtc, lt: opts.untilUtc },
      },
      select: {
        id: true,
        pickupLat: true,
        pickupLng: true,
        destinationLat: true,
        destinationLng: true,
        vehiclePreference: true,
        startedAt: true,
        endedAt: true,
      },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (page.length === 0) break;

    for (const j of page) {
      scanned += 1;
      // When the ride happened, not when it was recorded. startedAt is
      // the truth; endedAt stands in for the rides that predate it.
      const at = j.startedAt ?? j.endedAt;
      if (!at) continue;

      const originTier = tierForCoordinates(j.pickupLat, j.pickupLng);
      const destTier = tierForCoordinates(j.destinationLat, j.destinationLng);
      const origin = snapToCell(
        j.pickupLat,
        j.pickupLng,
        TIER_CONFIGS[originTier].cellSizeMeters,
        originTier,
      );
      const dest = snapToCell(
        j.destinationLat,
        j.destinationLng,
        TIER_CONFIGS[destTier].cellSizeMeters,
        destTier,
      );
      // Bucket length comes from the ORIGIN's tier, as dispatched: a
      // flow is filed under the rhythm of the place it leaves from.
      const bucket = snapToBucket(at, TIER_CONFIGS[originTier].bucketMinutes);
      const cellId = odPairCellId(origin.cellId, dest.cellId);
      const key = `${originTier}|${cellId}|${bucket.bucketStart.toISOString()}`;

      let pair = pairs.get(key);
      if (!pair) {
        pair = {
          originTier,
          destTier,
          cellId,
          originCellId: origin.cellId,
          destCellId: dest.cellId,
          originCenterLat: origin.centerLat,
          originCenterLng: origin.centerLng,
          destCenterLat: dest.centerLat,
          destCenterLng: dest.centerLng,
          bucketStart: bucket.bucketStart,
          bucketEnd: bucket.bucketEnd,
          count: 0,
          vehicleTypes: {},
          hourBuckets: {},
        };
        pairs.set(key, pair);
      }
      pair.count += 1;
      if (j.vehiclePreference) {
        pair.vehicleTypes[j.vehiclePreference] =
          (pair.vehicleTypes[j.vehiclePreference] ?? 0) + 1;
      }
      const hour = at.getUTCHours();
      pair.hourBuckets[hour] = (pair.hourBuckets[hour] ?? 0) + 1;
    }

    cursor = page[page.length - 1].id;
    if (page.length < PAGE_SIZE) break;
  }

  const all = Array.from(pairs.values());
  const suppressedByTier: Record<Tier, number> = {
    DENSE: 0,
    MEDIUM: 0,
    LOW: 0,
    SPARSE: 0,
  };
  const survivors: AggregateRow[] = [];
  for (const p of all) {
    if (p.count < pairThreshold(p.originTier, p.destTier)) {
      suppressedByTier[p.originTier] += 1;
      continue;
    }
    survivors.push({
      tier: p.originTier,
      aggregateType: 'OD_MATRIX',
      cellId: p.cellId,
      cellCenterLat: p.originCenterLat,
      cellCenterLng: p.originCenterLng,
      bucketStart: p.bucketStart,
      bucketEnd: p.bucketEnd,
      count: p.count,
      attributesJson: attributesFor(p),
    });
  }

  return {
    // Second net. Every survivor already clears a threshold at least as
    // strict as its own tier's, so this removes nothing — it is here so
    // that the cell-level gate is on this path too, unchanged.
    aggregated: applyKAnonymity(survivors),
    scannedPoints: scanned,
    durationMs: Date.now() - startedAt,
    suppressedByTier,
  };
}
