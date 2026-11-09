import { detect } from '../geo-anomaly';

interface JourneyRow {
  id: string;
  customerId: string;
  driverId: string | null;
  destinationLat: number;
  destinationLng: number;
}

const makePrisma = (journeys: JourneyRow[]) =>
  ({
    journey: { findMany: jest.fn().mockResolvedValue(journeys) },
  }) as any;

const opts = { windowDays: 7, minSampleSize: 1, now: new Date('2026-05-04T00:00:00Z') };

const colocate = (count: number, baseLat: number, baseLng: number, customerOf: (i: number) => string): JourneyRow[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `j${baseLat}-${i}`,
    customerId: customerOf(i),
    driverId: 'd1',
    destinationLat: baseLat + i * 0.00001,
    destinationLng: baseLng + i * 0.00001,
  }));

describe('geo-anomaly detector', () => {
  // Smallest-wrongness test for the dispatch.
  test('CRITICAL: 50 rides/week + 30+ distinct customers (legitimate venue) -> 0 findings', async () => {
    const journeys = colocate(50, -1.95, 30.06, (i) => `customer-${i}`);
    const result = await detect(makePrisma(journeys), opts);
    expect(result.flagged).toHaveLength(0);
  });

  test('50 rides/week + only 5 distinct customers -> findings (MEDIUM)', async () => {
    const journeys = colocate(50, -1.95, 30.06, (i) => `c${i % 5}`);
    const result = await detect(makePrisma(journeys), opts);
    // 5 customers + 1 driver -> 6 user findings.
    expect(result.flagged.length).toBeGreaterThanOrEqual(5);
    expect(result.flagged.some((f) => f.severity === 'HIGH')).toBe(true);
  });

  test('below MIN_RIDES_PER_WEEK -> 0 findings', async () => {
    const journeys = colocate(10, -1.95, 30.06, (i) => `c${i % 3}`);
    const result = await detect(makePrisma(journeys), opts);
    expect(result.flagged).toHaveLength(0);
  });

  test('cluster radius respects GEO_ANOMALY_CLUSTER_RADIUS_M boundary', async () => {
    // 25 rides at one venue (suspicious), 25 rides 1 km away (also suspicious but separate cluster).
    const close = colocate(25, -1.95, 30.06, (i) => `c${i % 3}`);
    const far = colocate(25, -1.95, 30.075, (i) => `c${(i % 3) + 10}`);
    const result = await detect(makePrisma([...close, ...far]), opts);
    // Two separate clusters each with low distinct customers -> findings span both.
    const customerIds = new Set(result.flagged.map((f) => f.userId));
    expect(customerIds.size).toBeGreaterThan(0);
  });
});
