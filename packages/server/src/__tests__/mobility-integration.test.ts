// End-to-end integration test for the Dispatch J mobility aggregation
// pipeline. Drives the cron entry point (runMobilityAggregationOnce)
// against an in-memory mock of prisma so the full pipeline executes:
// findMany → classify (per tier) → snap to cell+bucket → accumulate →
// k-anonymity gate → bulkInsertAggregates → row visible via findMany.

interface SeedPoint {
  id: string;
  lat: number;
  lng: number;
  timestamp: Date;
  vehiclePreference?: string | null;
  agreedPrice?: number | null;
}

interface StoreRow {
  tier: string;
  aggregateType: string;
  cellId: string;
  cellCenterLat: number;
  cellCenterLng: number;
  bucketStart: Date;
  bucketEnd: Date;
  count: number;
  attributesJson: any;
}

// INTEL-DECK G2 — the OD module reads completed journeys, so the fake
// prisma grows a journey table. Before this, OD_MATRIX was a stub that
// touched no table at all.
interface SeedJourney {
  id: string;
  pickupLat: number;
  pickupLng: number;
  destinationLat: number;
  destinationLng: number;
  vehiclePreference: string | null;
  startedAt: Date;
  endedAt: Date;
}

const seededPoints: SeedPoint[] = [];
const seededJourneys: SeedJourney[] = [];
const aggregateStore: StoreRow[] = [];

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: {
      findMany: jest.fn(async (args: any) => {
        let rows = seededJourneys.slice();
        const ended = args?.where?.endedAt ?? {};
        if (ended.gte) rows = rows.filter((r) => r.endedAt >= ended.gte);
        if (ended.lt) rows = rows.filter((r) => r.endedAt < ended.lt);
        rows.sort((a, b) => a.id.localeCompare(b.id));
        if (args?.cursor?.id) {
          const idx = rows.findIndex((r) => r.id === args.cursor.id);
          if (idx >= 0) rows = rows.slice(idx + (args.skip ?? 0));
        }
        return rows.slice(0, args?.take ?? rows.length);
      }),
    },
    gpsPoint: {
      findMany: jest.fn(async (args: any) => {
        let rows = seededPoints.slice();
        const ts = args?.where?.timestamp ?? {};
        if (ts.gte) rows = rows.filter((r) => r.timestamp >= ts.gte);
        if (ts.lt) rows = rows.filter((r) => r.timestamp < ts.lt);
        rows.sort((a, b) => a.id.localeCompare(b.id));
        if (args?.cursor?.id) {
          const idx = rows.findIndex((r) => r.id === args.cursor.id);
          if (idx >= 0) rows = rows.slice(idx + (args.skip ?? 0));
        }
        const take = args?.take ?? rows.length;
        return rows.slice(0, take).map((r) => ({
          id: r.id,
          lat: r.lat,
          lng: r.lng,
          timestamp: r.timestamp,
          journey: {
            vehiclePreference: r.vehiclePreference ?? null,
            agreedPrice: r.agreedPrice ?? null,
          },
        }));
      }),
    },
    mobilityAggregate: {
      createMany: jest.fn(async ({ data, skipDuplicates }: any) => {
        let inserted = 0;
        for (const row of data as StoreRow[]) {
          const dup = aggregateStore.find(
            (r) =>
              r.tier === row.tier &&
              r.aggregateType === row.aggregateType &&
              r.cellId === row.cellId &&
              r.bucketStart.getTime() === row.bucketStart.getTime(),
          );
          if (dup) {
            if (!skipDuplicates) {
              throw new Error('unique constraint');
            }
            continue;
          }
          aggregateStore.push(row);
          inserted += 1;
        }
        return { count: inserted };
      }),
      findMany: jest.fn(async ({ where = {} }: any = {}) => {
        return aggregateStore.filter((r) => {
          if (where.tier && r.tier !== where.tier) return false;
          if (where.aggregateType && r.aggregateType !== where.aggregateType)
            return false;
          if (where.bucketStart?.gte && r.bucketStart < where.bucketStart.gte)
            return false;
          if (where.bucketStart?.lt && r.bucketStart >= where.bucketStart.lt)
            return false;
          if (where.cellId && r.cellId !== where.cellId) return false;
          return true;
        });
      }),
    },
  },
}));

import { runMobilityAggregationOnce } from '../jobs/mobility-aggregation.job';
import prisma from '../prisma';
import { AGGREGATOR_MODULES } from '../services/mobility/aggregator';
import { MOBILITY_AGGREGATION_LOOKBACK_HOURS } from '../services/mobility/config';

const KIGALI = { lat: -1.95, lng: 30.06 };
const KIGALI_EAST = { lat: -1.949, lng: 30.09 }; // same DENSE tier, different cell
const HUYE = { lat: -2.6, lng: 29.74 };
const NYANZA = { lat: -2.345, lng: 29.745 };
const RURAL = { lat: -2.2, lng: 30.5 };

const ANCHOR = new Date('2026-05-04T10:00:00Z'); // 10:00 → 30-min bucket [10:00, 10:30)

function seedCluster(
  prefix: string,
  centre: { lat: number; lng: number },
  n: number,
): void {
  for (let i = 0; i < n; i++) {
    seededPoints.push({
      id: `${prefix}-${String(i).padStart(4, '0')}`,
      lat: centre.lat,
      lng: centre.lng,
      timestamp: new Date(ANCHOR.getTime() + i * 1000),
      vehiclePreference: i % 2 === 0 ? 'MOTO' : 'BIKE',
      agreedPrice: 1000 + i * 50,
    });
  }
}

function seedFlow(
  prefix: string,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  n: number,
): void {
  for (let i = 0; i < n; i++) {
    const at = new Date(ANCHOR.getTime() + i * 1000);
    seededJourneys.push({
      id: `${prefix}-${String(i).padStart(4, '0')}`,
      pickupLat: from.lat,
      pickupLng: from.lng,
      destinationLat: to.lat,
      destinationLng: to.lng,
      vehiclePreference: i % 2 === 0 ? 'MOTO' : 'BIKE',
      startedAt: at,
      endedAt: new Date(at.getTime() + 600_000),
    });
  }
}

beforeEach(() => {
  seededPoints.length = 0;
  seededJourneys.length = 0;
  aggregateStore.length = 0;
  jest.clearAllMocks();
});

describe('mobility-integration: full pipeline across all 4 tiers', () => {
  test('writes aggregates only when count meets the per-tier k-threshold', async () => {
    // DENSE k=20: seed 30 points → kept.
    seedCluster('D', KIGALI, 30);
    // MEDIUM k=15: seed 18 points → kept.
    seedCluster('M', HUYE, 18);
    // LOW k=10: seed 12 points → kept.
    seedCluster('L', NYANZA, 12);
    // SPARSE k=10: seed 8 points → SUPPRESSED.
    seedCluster('S', RURAL, 8);

    const result = await runMobilityAggregationOnce(
      new Date('2026-05-04T11:00:00Z'),
    );
    expect(result.modules).toBe(AGGREGATOR_MODULES.length);

    const all = await (prisma as any).mobilityAggregate.findMany({});
    const tiers = all.map((r: any) => r.tier).sort();
    expect(tiers).toEqual(['DENSE', 'LOW', 'MEDIUM']);

    const dense = all.find((r: any) => r.tier === 'DENSE');
    expect(dense.count).toBe(30);
    expect(dense.attributesJson.vehicleTypes).toBeDefined();
    expect(dense.attributesJson.hourBuckets).toBeDefined();
    expect(dense.attributesJson.fareDecileCounts).toBeDefined();

    const medium = all.find((r: any) => r.tier === 'MEDIUM');
    expect(medium.count).toBe(18);
    expect(medium.attributesJson.vehicleTypes).toBeDefined();
    expect(medium.attributesJson.fareDecileCounts).toBeUndefined();

    const low = all.find((r: any) => r.tier === 'LOW');
    expect(low.count).toBe(12);
    expect(low.attributesJson.hourBuckets).toBeDefined();
    expect(low.attributesJson.vehicleTypes).toBeUndefined();

    // SPARSE was suppressed.
    expect(all.find((r: any) => r.tier === 'SPARSE')).toBeUndefined();
    expect(result.suppressedByTier.SPARSE).toBeGreaterThanOrEqual(1);
  });

  test('SPARSE just-above threshold (10) IS written and has empty/undefined attributes', async () => {
    seedCluster('S', RURAL, 10);
    await runMobilityAggregationOnce(new Date('2026-05-04T11:00:00Z'));
    const all = await (prisma as any).mobilityAggregate.findMany({});
    const sparseRows = all.filter((r: any) => r.tier === 'SPARSE');
    expect(sparseRows).toHaveLength(1);
    expect(sparseRows[0].count).toBe(10);
    expect(sparseRows[0].attributesJson).toBeNull();
  });

  test('emits the run-metrics completion line with real counts', async () => {
    seedCluster('D', KIGALI, 30);
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    try {
      const result = await runMobilityAggregationOnce(
        new Date('2026-05-04T11:00:00Z'),
      );
      expect(result.scannedPoints).toBeGreaterThan(0);
      const line = logSpy.mock.calls
        .map((c) => String(c[0]))
        .find((l) => l.startsWith('[MOBILITY] run complete:'));
      expect(line).toBe(
        `[MOBILITY] run complete: points=${result.scannedPoints} aggregates=${result.insertedRows} suppressed=${Object.values(result.suppressedByTier).reduce((a, b) => a + b, 0)} durationMs=${result.durationMs}`,
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  // INTEL-DECK G2 — the OD matrix through the same cron, the same store
  // and the same unique index as point density.
  test('OD_MATRIX rows reach the store alongside POINT_DENSITY rows', async () => {
    seedCluster('D', KIGALI, 30);
    seedFlow('F', KIGALI, KIGALI_EAST, 22);

    await runMobilityAggregationOnce(new Date('2026-05-04T11:00:00Z'));
    const all = await (prisma as any).mobilityAggregate.findMany({});
    const od = all.filter((r: any) => r.aggregateType === 'OD_MATRIX');
    const density = all.filter((r: any) => r.aggregateType === 'POINT_DENSITY');
    expect(density.length).toBeGreaterThan(0);
    expect(od).toHaveLength(1);
    expect(od[0].count).toBe(22);
    expect(od[0].tier).toBe('DENSE');
    expect(od[0].attributesJson.originCellId).toBeDefined();
    expect(od[0].attributesJson.destCellId).toBeDefined();
    expect(od[0].attributesJson.originCellId).not.toBe(od[0].attributesJson.destCellId);
    // The plotted centre is the origin's.
    expect(od[0].cellCenterLat).toBeCloseTo(od[0].attributesJson.originCenterLat, 10);
  });

  test('two destinations from one origin survive the unique index as two rows', async () => {
    // The regression this row shape exists for: with cellId = origin
    // cell, the second flow would collide on
    // @@unique([tier, aggregateType, cellId, bucketStart]) and
    // skipDuplicates would drop it without a word.
    seedFlow('A', KIGALI, KIGALI_EAST, 21);
    seedFlow('B', KIGALI, HUYE, 21);

    await runMobilityAggregationOnce(new Date('2026-05-04T11:00:00Z'));
    const od = (await (prisma as any).mobilityAggregate.findMany({})).filter(
      (r: any) => r.aggregateType === 'OD_MATRIX',
    );
    expect(od).toHaveLength(2);
    expect(new Set(od.map((r: any) => r.attributesJson.originCellId)).size).toBe(1);
    expect(new Set(od.map((r: any) => r.cellId)).size).toBe(2);
    expect(od.map((r: any) => r.count).sort()).toEqual([21, 21]);
  });

  test('a flow below the stricter endpoint threshold never reaches the store', async () => {
    // 19 DENSE→DENSE journeys: one short of k=20 on both ends.
    seedFlow('F', KIGALI, KIGALI_EAST, 19);
    const result = await runMobilityAggregationOnce(new Date('2026-05-04T11:00:00Z'));
    const od = (await (prisma as any).mobilityAggregate.findMany({})).filter(
      (r: any) => r.aggregateType === 'OD_MATRIX',
    );
    expect(od).toHaveLength(0);
    expect(result.suppressedByTier.DENSE).toBeGreaterThanOrEqual(1);
  });

  test('idempotency: re-running aggregation does NOT double rows', async () => {
    seedCluster('D', KIGALI, 25);
    await runMobilityAggregationOnce(new Date('2026-05-04T11:00:00Z'));
    const before = aggregateStore.length;
    await runMobilityAggregationOnce(new Date('2026-05-04T11:00:00Z'));
    const after = aggregateStore.length;
    expect(after).toBe(before);
  });

  test('tier independence: forcing the POINT_DENSITY module to throw still completes the cycle', async () => {
    seedCluster('D', KIGALI, 25);
    seedCluster('M', HUYE, 20);
    const original = AGGREGATOR_MODULES[0].aggregate;
    AGGREGATOR_MODULES[0] = {
      ...AGGREGATOR_MODULES[0],
      aggregate: jest.fn(async () => {
        throw new Error('synthetic-failure');
      }),
    };
    try {
      const result = await runMobilityAggregationOnce(
        new Date('2026-05-04T11:00:00Z'),
      );
      // Cycle completed (modules count reflects the registry length).
      expect(result.modules).toBe(AGGREGATOR_MODULES.length);
      // The failing module produced no rows; OD_MATRIX has no journeys
      // seeded in this test so it produces none either. Net result:
      // zero rows in the store. Critically the cycle did NOT throw;
      // cron isolation worked.
      expect(aggregateStore).toHaveLength(0);
    } finally {
      AGGREGATOR_MODULES[0] = { ...AGGREGATOR_MODULES[0], aggregate: original };
    }
  });
});

// LOOSE-ENDS G6 — the explicit window that lets an admin re-run a past
// range. The claim that matters most is the NEGATIVE one: with no
// window the arithmetic is byte-identical to what the nightly cron has
// always run, so the cron's behaviour cannot have moved.
describe('mobility-aggregation: the optional window', () => {
  const windowSeenBy = (mod: number = 0) =>
    (prisma as any).gpsPoint.findMany.mock.calls[mod]?.[0]?.where?.timestamp ?? {};

  test('no window → now minus the configured lookback, exactly as before', async () => {
    seedCluster('D', KIGALI, 25);
    const now = new Date('2026-05-04T11:00:00Z');
    await runMobilityAggregationOnce(now);

    const ts = windowSeenBy();
    expect(ts.lt.toISOString()).toBe(now.toISOString());
    expect(now.getTime() - ts.gte.getTime()).toBe(
      MOBILITY_AGGREGATION_LOOKBACK_HOURS * 3600 * 1000,
    );
  });

  test('an empty window object is the same as no window', async () => {
    seedCluster('D', KIGALI, 25);
    const now = new Date('2026-05-04T11:00:00Z');
    await runMobilityAggregationOnce(now, {});

    const ts = windowSeenBy();
    expect(ts.lt.toISOString()).toBe(now.toISOString());
    expect(now.getTime() - ts.gte.getTime()).toBe(
      MOBILITY_AGGREGATION_LOOKBACK_HOURS * 3600 * 1000,
    );
  });

  test('an explicit window reaches the modules verbatim', async () => {
    seedCluster('D', KIGALI, 25);
    const sinceUtc = new Date('2026-04-01T00:00:00Z');
    const untilUtc = new Date('2026-05-01T00:00:00Z');
    await runMobilityAggregationOnce(new Date('2026-05-04T11:00:00Z'), { sinceUtc, untilUtc });

    const ts = windowSeenBy();
    expect(ts.gte.toISOString()).toBe(sinceUtc.toISOString());
    expect(ts.lt.toISOString()).toBe(untilUtc.toISOString());
  });

  test('the window actually selects the points — a past range aggregates past data', async () => {
    // ANCHOR is 2026-05-04T10:00Z; nothing lies in April.
    seedCluster('D', KIGALI, 25);

    await runMobilityAggregationOnce(new Date('2026-05-04T11:00:00Z'), {
      sinceUtc: new Date('2026-04-01T00:00:00Z'),
      untilUtc: new Date('2026-04-30T00:00:00Z'),
    });
    expect(aggregateStore).toHaveLength(0);

    await runMobilityAggregationOnce(new Date('2026-05-04T11:00:00Z'), {
      sinceUtc: new Date('2026-05-01T00:00:00Z'),
      untilUtc: new Date('2026-05-05T00:00:00Z'),
    });
    expect(aggregateStore.length).toBeGreaterThan(0);
  });

  test('one bound alone still falls back for the other', async () => {
    seedCluster('D', KIGALI, 25);
    const now = new Date('2026-05-04T11:00:00Z');
    await runMobilityAggregationOnce(now, { sinceUtc: new Date('2026-05-01T00:00:00Z') });

    const ts = windowSeenBy();
    expect(ts.gte.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(ts.lt.toISOString()).toBe(now.toISOString());
  });
});
