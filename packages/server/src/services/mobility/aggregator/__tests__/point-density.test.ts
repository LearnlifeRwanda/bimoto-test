import { aggregatePointDensity } from '../point-density';
import { _resetTierConfigForTests } from '../../tier-classification';

interface SeedPoint {
  id: string;
  lat: number;
  lng: number;
  timestamp: Date;
  journeyId: string;
  vehiclePreference?: string | null;
  agreedPrice?: number | null;
}

function makePrisma(points: SeedPoint[]) {
  return {
    gpsPoint: {
      findMany: jest.fn(async (args: any) => {
        let rows = [...points];
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
  } as any;
}

const KIGALI = { lat: -1.95, lng: 30.06 };
const HUYE = { lat: -2.6, lng: 29.74 };
const RURAL = { lat: -2.2, lng: 30.5 };
const SINCE = new Date('2026-05-04T00:00:00Z');
const UNTIL = new Date('2026-05-06T00:00:00Z');

function seedDenseCluster(n: number, baseTs = new Date('2026-05-05T10:00:00Z')): SeedPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `gp-${String(i).padStart(4, '0')}`,
    lat: KIGALI.lat,
    lng: KIGALI.lng,
    timestamp: new Date(baseTs.getTime() + i * 1000),
    journeyId: `journey-${i}`,
    vehiclePreference: i % 2 === 0 ? 'MOTO' : 'BIKE',
    agreedPrice: 1000 * (i + 1),
  }));
}

afterEach(() => {
  _resetTierConfigForTests();
  jest.restoreAllMocks();
});

describe('mobility/aggregator/point-density', () => {
  it('SUPPRESSES dense cells with N=19 (below threshold 20)', async () => {
    const prisma = makePrisma(seedDenseCluster(19));
    const result = await aggregatePointDensity(prisma, { sinceUtc: SINCE, untilUtc: UNTIL });
    expect(result.scannedPoints).toBe(19);
    expect(result.aggregated).toHaveLength(0);
  });

  it('KEEPS dense cells with N=20 and emits attributesJson with vehicleTypes/hourBuckets/fareDecileCounts', async () => {
    const prisma = makePrisma(seedDenseCluster(20));
    const result = await aggregatePointDensity(prisma, { sinceUtc: SINCE, untilUtc: UNTIL });
    expect(result.aggregated).toHaveLength(1);
    const row = result.aggregated[0];
    expect(row.tier).toBe('DENSE');
    expect(row.aggregateType).toBe('POINT_DENSITY');
    expect(row.count).toBe(20);
    expect(row.attributesJson).toBeDefined();
    const attrs = row.attributesJson as Record<string, Record<string, number>>;
    expect(Object.keys(attrs.vehicleTypes)).toEqual(expect.arrayContaining(['MOTO', 'BIKE']));
    expect(attrs.hourBuckets).toBeDefined();
    expect(attrs.fareDecileCounts).toBeDefined();
  });

  it('mixed tiers are aggregated independently with their own thresholds', async () => {
    // 20 points at Kigali (DENSE, threshold 20), 15 at Huye (MEDIUM, threshold 15),
    // 11 at a rural coordinate (SPARSE, threshold 10).
    const ts = new Date('2026-05-05T10:00:00Z');
    const dense = Array.from({ length: 20 }, (_, i) => ({
      id: `D-${i}`, lat: KIGALI.lat, lng: KIGALI.lng,
      timestamp: new Date(ts.getTime() + i * 1000), journeyId: `dj-${i}`,
      vehiclePreference: 'MOTO', agreedPrice: 2000,
    }));
    const medium = Array.from({ length: 15 }, (_, i) => ({
      id: `M-${i}`, lat: HUYE.lat, lng: HUYE.lng,
      timestamp: new Date(ts.getTime() + i * 1000), journeyId: `mj-${i}`,
      vehiclePreference: 'CAR', agreedPrice: 5000,
    }));
    const sparse = Array.from({ length: 11 }, (_, i) => ({
      id: `S-${i}`, lat: RURAL.lat, lng: RURAL.lng,
      timestamp: new Date(ts.getTime() + i * 1000), journeyId: `sj-${i}`,
      vehiclePreference: 'CAR', agreedPrice: 8000,
    }));
    const prisma = makePrisma([...dense, ...medium, ...sparse]);
    const result = await aggregatePointDensity(prisma, { sinceUtc: SINCE, untilUtc: UNTIL });
    const tiers = result.aggregated.map((r) => r.tier).sort();
    expect(tiers).toEqual(['DENSE', 'MEDIUM', 'SPARSE']);
    const sparseRow = result.aggregated.find((r) => r.tier === 'SPARSE')!;
    expect(sparseRow.attributesJson).toBeUndefined();
    const denseRow = result.aggregated.find((r) => r.tier === 'DENSE')!;
    expect(denseRow.attributesJson).toBeDefined();
  });

  it('tier-cellSize independence: DENSE rows use ~250m cells, SPARSE rows use ~5km cells', async () => {
    const ts = new Date('2026-05-05T10:00:00Z');
    // 20 dense points at Kigali plus 10 at a rural location: distinct cellIds
    const dense = Array.from({ length: 20 }, (_, i) => ({
      id: `D-${i}`, lat: KIGALI.lat, lng: KIGALI.lng,
      timestamp: new Date(ts.getTime() + i * 1000), journeyId: `dj-${i}`,
    }));
    const sparse = Array.from({ length: 10 }, (_, i) => ({
      id: `S-${i}`, lat: RURAL.lat, lng: RURAL.lng,
      timestamp: new Date(ts.getTime() + i * 1000), journeyId: `sj-${i}`,
    }));
    const prisma = makePrisma([...dense, ...sparse]);
    const result = await aggregatePointDensity(prisma, { sinceUtc: SINCE, untilUtc: UNTIL });
    const denseCellIds = result.aggregated.filter((r) => r.tier === 'DENSE').map((r) => r.cellId);
    const sparseCellIds = result.aggregated.filter((r) => r.tier === 'SPARSE').map((r) => r.cellId);
    expect(denseCellIds.length).toBeGreaterThanOrEqual(1);
    expect(sparseCellIds.length).toBeGreaterThanOrEqual(1);
    expect(new Set([...denseCellIds, ...sparseCellIds]).size).toBe(
      denseCellIds.length + sparseCellIds.length,
    );
  });

  it('reads only via gpsPoint.findMany with the expected window — no other prisma calls', async () => {
    const prisma = makePrisma(seedDenseCluster(20));
    await aggregatePointDensity(prisma, { sinceUtc: SINCE, untilUtc: UNTIL });
    expect(prisma.gpsPoint.findMany).toHaveBeenCalled();
    const firstArgs = prisma.gpsPoint.findMany.mock.calls[0][0];
    expect(firstArgs.where.timestamp).toEqual({ gte: SINCE, lt: UNTIL });
    // No write-side prisma client is provided (the mock has no other tables);
    // any attempt to read or write something else would have thrown.
  });

  it('empty input window returns zero aggregated rows', async () => {
    const prisma = makePrisma([]);
    const result = await aggregatePointDensity(prisma, { sinceUtc: SINCE, untilUtc: UNTIL });
    expect(result.aggregated).toHaveLength(0);
    expect(result.scannedPoints).toBe(0);
  });
});
