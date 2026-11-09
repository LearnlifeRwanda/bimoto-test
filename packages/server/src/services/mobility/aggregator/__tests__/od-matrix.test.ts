// INTEL-DECK G2 — the OD matrix's own contract.
//
// Dispatch J left this aggregator a stub; every assertion below is
// therefore new ground. The five things that must hold: pairs are
// counted per (origin cell → destination cell → bucket); a pair is
// suppressed at the STRICTER endpoint's k; marginals follow the origin
// tier's attribute list and carry no fares; cross-tier pairs keep both
// endpoints honest; an empty window produces nothing.

import { aggregateOdMatrix, odPairCellId, pairThreshold } from '../od-matrix';
import { _resetTierConfigForTests } from '../../tier-classification';

interface SeedJourney {
  id: string;
  pickupLat: number;
  pickupLng: number;
  destinationLat: number;
  destinationLng: number;
  vehiclePreference?: string | null;
  startedAt?: Date | null;
  endedAt: Date | null;
  status?: string;
}

function makePrisma(journeys: SeedJourney[]) {
  return {
    journey: {
      findMany: jest.fn(async (args: any) => {
        let rows = journeys.filter((j) => (j.status ?? 'COMPLETED') === args?.where?.status);
        const ended = args?.where?.endedAt ?? {};
        if (ended.gte) rows = rows.filter((r) => r.endedAt !== null && r.endedAt >= ended.gte);
        if (ended.lt) rows = rows.filter((r) => r.endedAt !== null && r.endedAt < ended.lt);
        rows.sort((a, b) => a.id.localeCompare(b.id));
        if (args?.cursor?.id) {
          const idx = rows.findIndex((r) => r.id === args.cursor.id);
          if (idx >= 0) rows = rows.slice(idx + (args.skip ?? 0));
        }
        return rows.slice(0, args?.take ?? rows.length).map((r) => ({
          id: r.id,
          pickupLat: r.pickupLat,
          pickupLng: r.pickupLng,
          destinationLat: r.destinationLat,
          destinationLng: r.destinationLng,
          vehiclePreference: r.vehiclePreference ?? null,
          startedAt: r.startedAt ?? null,
          endedAt: r.endedAt,
        }));
      }),
    },
  } as any;
}

// DENSE (Kigali City, k=20) — two cells ~2 km apart.
const NYABUGOGO = { lat: -1.939, lng: 30.045 };
const KACYIRU = { lat: -1.949, lng: 30.09 };
// MEDIUM (Huye, k=15) and SPARSE (unmatched default, k=10).
const HUYE = { lat: -2.6, lng: 29.74 };
const RURAL = { lat: -2.2, lng: 30.5 };

const SINCE = new Date('2026-05-04T00:00:00Z');
const UNTIL = new Date('2026-05-06T00:00:00Z');
const RIDE_AT = new Date('2026-05-05T08:10:00Z');

function ride(
  i: number,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  extra: Partial<SeedJourney> = {},
): SeedJourney {
  const at = new Date(RIDE_AT.getTime() + i * 1000);
  return {
    id: `j-${String(i).padStart(4, '0')}`,
    pickupLat: from.lat,
    pickupLng: from.lng,
    destinationLat: to.lat,
    destinationLng: to.lng,
    vehiclePreference: 'MOTO',
    startedAt: at,
    endedAt: new Date(at.getTime() + 600_000),
    ...extra,
  };
}

function rides(
  n: number,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  offset = 0,
  extra: Partial<SeedJourney> = {},
): SeedJourney[] {
  return Array.from({ length: n }, (_, i) => ride(offset + i, from, to, extra));
}

afterEach(() => {
  _resetTierConfigForTests();
  jest.restoreAllMocks();
});

describe('mobility/aggregator/od-matrix — pair counting', () => {
  it('counts journeys on a pair and files them under the origin cell', async () => {
    const prisma = makePrisma(rides(20, NYABUGOGO, KACYIRU));
    const result = await aggregateOdMatrix(prisma, { sinceUtc: SINCE, untilUtc: UNTIL });
    expect(result.scannedPoints).toBe(20);
    expect(result.aggregated).toHaveLength(1);
    const row = result.aggregated[0];
    expect(row.aggregateType).toBe('OD_MATRIX');
    expect(row.tier).toBe('DENSE');
    expect(row.count).toBe(20);
    const attrs = row.attributesJson as Record<string, unknown>;
    // The row's identity is the PAIR, not the origin — this is what
    // keeps two destinations out of one unique-index slot.
    expect(row.cellId).toBe(odPairCellId(attrs.originCellId as string, attrs.destCellId as string));
    expect(attrs.originCellId).not.toEqual(attrs.destCellId);
    // The plotted point is the origin centre.
    expect(row.cellCenterLat).toBeCloseTo(attrs.originCenterLat as number, 10);
    expect(row.cellCenterLng).toBeCloseTo(attrs.originCenterLng as number, 10);
    expect(typeof attrs.destCenterLat).toBe('number');
    expect(typeof attrs.destCenterLng).toBe('number');
  });

  it('two destinations from one origin in one bucket are two rows, not one', async () => {
    // The precise failure the pair-keyed cellId exists to prevent: with
    // cellId = origin, both of these would collide on
    // @@unique([tier, aggregateType, cellId, bucketStart]).
    const prisma = makePrisma([
      ...rides(20, NYABUGOGO, KACYIRU),
      ...rides(20, NYABUGOGO, HUYE, 100),
    ]);
    const result = await aggregateOdMatrix(prisma, { sinceUtc: SINCE, untilUtc: UNTIL });
    expect(result.aggregated).toHaveLength(2);
    const ids = result.aggregated.map((r) => r.cellId);
    expect(new Set(ids).size).toBe(2);
    const buckets = new Set(result.aggregated.map((r) => r.bucketStart.toISOString()));
    expect(buckets.size).toBe(1);
    const origins = new Set(
      result.aggregated.map((r) => (r.attributesJson as any).originCellId as string),
    );
    expect(origins.size).toBe(1);
  });

  it('the reverse direction is a different pair', async () => {
    const prisma = makePrisma([
      ...rides(20, NYABUGOGO, KACYIRU),
      ...rides(20, KACYIRU, NYABUGOGO, 100),
    ]);
    const result = await aggregateOdMatrix(prisma, { sinceUtc: SINCE, untilUtc: UNTIL });
    expect(result.aggregated).toHaveLength(2);
    expect(new Set(result.aggregated.map((r) => r.cellId)).size).toBe(2);
  });

  it('journeys that are not COMPLETED are never read', async () => {
    const prisma = makePrisma(rides(20, NYABUGOGO, KACYIRU));
    await aggregateOdMatrix(prisma, { sinceUtc: SINCE, untilUtc: UNTIL });
    const args = prisma.journey.findMany.mock.calls[0][0];
    expect(args.where.status).toBe('COMPLETED');
    expect(args.where.endedAt).toEqual({ gte: SINCE, lt: UNTIL });
    // The select list is the whole read surface: no customerId, no
    // driverId, no names — nothing that identifies a person.
    expect(Object.keys(args.select).sort()).toEqual([
      'destinationLat',
      'destinationLng',
      'endedAt',
      'id',
      'pickupLat',
      'pickupLng',
      'startedAt',
      'vehiclePreference',
    ]);
  });
});

describe('mobility/aggregator/od-matrix — the stricter k wins', () => {
  it('DENSE→DENSE at 19 is suppressed, at 20 it survives', async () => {
    const under = await aggregateOdMatrix(makePrisma(rides(19, NYABUGOGO, KACYIRU)), {
      sinceUtc: SINCE,
      untilUtc: UNTIL,
    });
    expect(under.aggregated).toHaveLength(0);
    expect(under.suppressedByTier?.DENSE).toBe(1);

    const over = await aggregateOdMatrix(makePrisma(rides(20, NYABUGOGO, KACYIRU)), {
      sinceUtc: SINCE,
      untilUtc: UNTIL,
    });
    expect(over.aggregated).toHaveLength(1);
    expect(over.suppressedByTier?.DENSE).toBe(0);
  });

  it('SPARSE origin (k=10) → DENSE destination (k=20) needs 20, not 10', async () => {
    // The laundering case: a rural origin must not weaken a Kigali
    // destination. 15 clears the origin's own threshold and is still
    // suppressed; 20 is the first count that survives.
    const fifteen = await aggregateOdMatrix(makePrisma(rides(15, RURAL, KACYIRU)), {
      sinceUtc: SINCE,
      untilUtc: UNTIL,
    });
    expect(fifteen.aggregated).toHaveLength(0);
    expect(fifteen.suppressedByTier?.SPARSE).toBe(1);

    const twenty = await aggregateOdMatrix(makePrisma(rides(20, RURAL, KACYIRU)), {
      sinceUtc: SINCE,
      untilUtc: UNTIL,
    });
    expect(twenty.aggregated).toHaveLength(1);
    expect(twenty.aggregated[0].tier).toBe('SPARSE');
    expect((twenty.aggregated[0].attributesJson as any).destTier).toBe('DENSE');
  });

  it('DENSE origin (k=20) → SPARSE destination (k=10) still needs 20', async () => {
    const nineteen = await aggregateOdMatrix(makePrisma(rides(19, KACYIRU, RURAL)), {
      sinceUtc: SINCE,
      untilUtc: UNTIL,
    });
    expect(nineteen.aggregated).toHaveLength(0);

    const twenty = await aggregateOdMatrix(makePrisma(rides(20, KACYIRU, RURAL)), {
      sinceUtc: SINCE,
      untilUtc: UNTIL,
    });
    expect(twenty.aggregated).toHaveLength(1);
  });

  it('MEDIUM→SPARSE clears at 15 (the MEDIUM side is the stricter one)', async () => {
    const fourteen = await aggregateOdMatrix(makePrisma(rides(14, HUYE, RURAL)), {
      sinceUtc: SINCE,
      untilUtc: UNTIL,
    });
    expect(fourteen.aggregated).toHaveLength(0);

    const fifteen = await aggregateOdMatrix(makePrisma(rides(15, HUYE, RURAL)), {
      sinceUtc: SINCE,
      untilUtc: UNTIL,
    });
    expect(fifteen.aggregated).toHaveLength(1);
  });

  it('pairThreshold states the rule symmetrically', () => {
    expect(pairThreshold('SPARSE', 'DENSE')).toBe(20);
    expect(pairThreshold('DENSE', 'SPARSE')).toBe(20);
    expect(pairThreshold('MEDIUM', 'LOW')).toBe(15);
    expect(pairThreshold('LOW', 'LOW')).toBe(10);
  });
});

describe('mobility/aggregator/od-matrix — marginals', () => {
  it('a DENSE-origin pair carries vehicleTypes and hourBuckets and NO fares', async () => {
    const prisma = makePrisma([
      ...rides(12, NYABUGOGO, KACYIRU, 0, { vehiclePreference: 'MOTO' }),
      ...rides(8, NYABUGOGO, KACYIRU, 100, { vehiclePreference: 'BIKE' }),
    ]);
    const result = await aggregateOdMatrix(prisma, { sinceUtc: SINCE, untilUtc: UNTIL });
    const attrs = result.aggregated[0].attributesJson as Record<string, any>;
    expect(attrs.vehicleTypes).toEqual({ MOTO: 12, BIKE: 8 });
    expect(Object.values(attrs.hourBuckets as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(20);
    expect(attrs.fareDecileCounts).toBeUndefined();
  });

  it('a SPARSE-origin pair carries no marginals at all (its tier lists none)', async () => {
    const prisma = makePrisma(rides(20, RURAL, KACYIRU));
    const result = await aggregateOdMatrix(prisma, { sinceUtc: SINCE, untilUtc: UNTIL });
    const attrs = result.aggregated[0].attributesJson as Record<string, any>;
    expect(attrs.vehicleTypes).toBeUndefined();
    expect(attrs.hourBuckets).toBeUndefined();
    // The endpoints themselves are still there — they are the row.
    expect(attrs.originCellId).toBeDefined();
    expect(attrs.destCellId).toBeDefined();
  });

  it('buckets by the ORIGIN tier length: a MEDIUM origin uses 60-minute buckets', async () => {
    // Two clusters 40 minutes apart: one 60-minute bucket for MEDIUM.
    const early = rides(15, HUYE, RURAL, 0);
    const later = rides(15, HUYE, RURAL, 200).map((j) => ({
      ...j,
      startedAt: new Date(j.startedAt!.getTime() + 40 * 60_000),
      endedAt: new Date(j.endedAt!.getTime() + 40 * 60_000),
    }));
    const result = await aggregateOdMatrix(makePrisma([...early, ...later]), {
      sinceUtc: SINCE,
      untilUtc: UNTIL,
    });
    expect(result.aggregated).toHaveLength(1);
    expect(result.aggregated[0].count).toBe(30);
    const span =
      result.aggregated[0].bucketEnd.getTime() - result.aggregated[0].bucketStart.getTime();
    expect(span).toBe(60 * 60_000);
  });
});

describe('mobility/aggregator/od-matrix — empty and degenerate windows', () => {
  it('an empty window returns nothing and scans nothing', async () => {
    const result = await aggregateOdMatrix(makePrisma([]), { sinceUtc: SINCE, untilUtc: UNTIL });
    expect(result.aggregated).toHaveLength(0);
    expect(result.scannedPoints).toBe(0);
    expect(result.suppressedByTier).toEqual({ DENSE: 0, MEDIUM: 0, LOW: 0, SPARSE: 0 });
  });

  it('journeys outside the window are not scanned', async () => {
    const outside = rides(20, NYABUGOGO, KACYIRU).map((j) => ({
      ...j,
      endedAt: new Date('2026-04-01T08:00:00Z'),
    }));
    const result = await aggregateOdMatrix(makePrisma(outside), {
      sinceUtc: SINCE,
      untilUtc: UNTIL,
    });
    expect(result.scannedPoints).toBe(0);
  });

  it('a round trip to the same cell is a self-pair, counted like any other', async () => {
    const result = await aggregateOdMatrix(makePrisma(rides(20, KACYIRU, KACYIRU)), {
      sinceUtc: SINCE,
      untilUtc: UNTIL,
    });
    expect(result.aggregated).toHaveLength(1);
    const attrs = result.aggregated[0].attributesJson as any;
    expect(attrs.originCellId).toBe(attrs.destCellId);
  });

  it('a journey with no startedAt falls back to endedAt rather than being dropped', async () => {
    const legacy = rides(20, NYABUGOGO, KACYIRU).map((j) => ({ ...j, startedAt: null }));
    const result = await aggregateOdMatrix(makePrisma(legacy), {
      sinceUtc: SINCE,
      untilUtc: UNTIL,
    });
    expect(result.aggregated).toHaveLength(1);
    expect(result.aggregated[0].count).toBe(20);
  });
});
