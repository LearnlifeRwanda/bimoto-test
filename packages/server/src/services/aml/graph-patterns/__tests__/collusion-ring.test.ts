import { detect } from '../collusion-ring';

const makePrisma = (journeys: Array<{ customerId: string; driverId: string }>, users: Array<{ id: string; role: 'CUSTOMER' | 'DRIVER' }>) => ({
  journey: { findMany: jest.fn().mockResolvedValue(journeys) },
  user: {
    findMany: jest.fn(({ where }: any) => {
      const ids: string[] = where.id.in;
      return Promise.resolve(users.filter((u) => ids.includes(u.id)));
    }),
  },
}) as any;

const opts = { windowDays: 7, minSampleSize: 1, now: new Date('2026-05-04T00:00:00Z') };

describe('collusion-ring detector', () => {
  test('tight 3x3 ring (9 rides, density 1.0, no external) -> 6 CRITICAL findings', async () => {
    const customers = ['c1', 'c2', 'c3'];
    const drivers = ['d1', 'd2', 'd3'];
    const journeys: Array<{ customerId: string; driverId: string }> = [];
    for (const c of customers) for (const d of drivers) journeys.push({ customerId: c, driverId: d });
    // Bump to >=15 internal rides by repeating.
    journeys.push(...journeys, ...journeys);
    const users = [
      ...customers.map((id) => ({ id, role: 'CUSTOMER' as const })),
      ...drivers.map((id) => ({ id, role: 'DRIVER' as const })),
    ];
    const result = await detect(makePrisma(journeys, users), opts);
    expect(result.patternName).toBe('COLLUSION_RING');
    expect(result.flagged).toHaveLength(6);
    expect(result.flagged.every((f) => f.severity === 'CRITICAL')).toBe(true);
    const meta = result.flagged[0].metadata as any;
    expect(meta.density).toBe(1);
    expect(meta.externalEdgeRatio).toBe(0);
    expect(meta.totalRides).toBeGreaterThanOrEqual(15);
  });

  test('3x3 ring missing 2 pairs (density 0.78) -> HIGH not CRITICAL', async () => {
    const customers = ['c1', 'c2', 'c3'];
    const drivers = ['d1', 'd2', 'd3'];
    const journeys: Array<{ customerId: string; driverId: string }> = [];
    for (const c of customers) {
      for (const d of drivers) {
        // Skip 2 pairs to drop density to 7/9 = 0.778.
        if ((c === 'c1' && d === 'd3') || (c === 'c3' && d === 'd1')) continue;
        journeys.push({ customerId: c, driverId: d });
      }
    }
    journeys.push(...journeys, ...journeys);
    const users = [
      ...customers.map((id) => ({ id, role: 'CUSTOMER' as const })),
      ...drivers.map((id) => ({ id, role: 'DRIVER' as const })),
    ];
    const result = await detect(makePrisma(journeys, users), opts);
    expect(result.flagged.length).toBe(6);
    expect(result.flagged.every((f) => f.severity === 'HIGH')).toBe(true);
    const meta = result.flagged[0].metadata as any;
    expect(meta.density).toBeLessThan(0.85);
    expect(meta.density).toBeGreaterThanOrEqual(0.6);
  });

  test('star-shaped CRITICAL component -> hub CRITICAL, periphery capped at HIGH', async () => {
    // Hub customer c1 rides each of 3 drivers 5x; low-degree cLow rides
    // each once. Density 6/6 = 1.0, no external edges -> CRITICAL
    // component. Degrees: c1=15, drivers=6, cLow=3; median 6 — only the
    // hub sits strictly above it.
    const journeys: Array<{ customerId: string; driverId: string }> = [];
    for (const d of ['d1', 'd2', 'd3']) {
      for (let i = 0; i < 5; i++) journeys.push({ customerId: 'c1', driverId: d });
      journeys.push({ customerId: 'cLow', driverId: d });
    }
    const users = [
      { id: 'c1', role: 'CUSTOMER' as const },
      { id: 'cLow', role: 'CUSTOMER' as const },
      { id: 'd1', role: 'DRIVER' as const },
      { id: 'd2', role: 'DRIVER' as const },
      { id: 'd3', role: 'DRIVER' as const },
    ];
    const result = await detect(makePrisma(journeys, users), opts);
    expect(result.flagged).toHaveLength(5);
    const byUser = new Map(result.flagged.map((f) => [f.userId, f]));
    expect(byUser.get('c1')!.severity).toBe('CRITICAL');
    for (const periphery of ['cLow', 'd1', 'd2', 'd3']) {
      expect(byUser.get(periphery)!.severity).toBe('HIGH');
    }
    const hubMeta = byUser.get('c1')!.metadata as any;
    expect(hubMeta.internalDegree).toBe(15);
    expect(hubMeta.componentMedianDegree).toBe(6);
    expect((byUser.get('cLow')!.metadata as any).internalDegree).toBe(3);
  });

  test('uniform 2x2 CRITICAL ring has no periphery -> all members CRITICAL', async () => {
    const journeys: Array<{ customerId: string; driverId: string }> = [];
    for (const c of ['c1', 'c2']) {
      for (const d of ['d1', 'd2']) {
        for (let i = 0; i < 4; i++) journeys.push({ customerId: c, driverId: d });
      }
    }
    const users = [
      { id: 'c1', role: 'CUSTOMER' as const },
      { id: 'c2', role: 'CUSTOMER' as const },
      { id: 'd1', role: 'DRIVER' as const },
      { id: 'd2', role: 'DRIVER' as const },
    ];
    const result = await detect(makePrisma(journeys, users), opts);
    expect(result.flagged).toHaveLength(4);
    expect(result.flagged.every((f) => f.severity === 'CRITICAL')).toBe(true);
    expect(
      result.flagged.every((f) => (f.metadata as any).internalDegree === 8),
    ).toBe(true);
  });

  test('sparse component (density 0.2) -> 0 findings', async () => {
    // 5 customers, 5 drivers, only 5 rides connecting them in a chain — density very low.
    const journeys = [
      { customerId: 'c1', driverId: 'd1' },
      { customerId: 'c2', driverId: 'd1' },
      { customerId: 'c2', driverId: 'd2' },
      { customerId: 'c3', driverId: 'd2' },
      { customerId: 'c3', driverId: 'd3' },
    ];
    const users = [
      { id: 'c1', role: 'CUSTOMER' as const },
      { id: 'c2', role: 'CUSTOMER' as const },
      { id: 'c3', role: 'CUSTOMER' as const },
      { id: 'd1', role: 'DRIVER' as const },
      { id: 'd2', role: 'DRIVER' as const },
      { id: 'd3', role: 'DRIVER' as const },
    ];
    const result = await detect(makePrisma(journeys, users), opts);
    expect(result.flagged).toHaveLength(0);
  });

  test('component below MIN_NODES (3) -> 0 findings', async () => {
    const journeys = [
      { customerId: 'c1', driverId: 'd1' },
      { customerId: 'c1', driverId: 'd1' },
    ];
    const users = [
      { id: 'c1', role: 'CUSTOMER' as const },
      { id: 'd1', role: 'DRIVER' as const },
    ];
    const result = await detect(makePrisma(journeys, users), opts);
    expect(result.flagged).toHaveLength(0);
  });

  test('total rides below MIN_RIDES -> 0 findings', async () => {
    const customers = ['c1', 'c2'];
    const drivers = ['d1', 'd2'];
    const journeys: Array<{ customerId: string; driverId: string }> = [];
    for (const c of customers) for (const d of drivers) journeys.push({ customerId: c, driverId: d });
    // Only 4 rides — well below 15.
    const users = [
      ...customers.map((id) => ({ id, role: 'CUSTOMER' as const })),
      ...drivers.map((id) => ({ id, role: 'DRIVER' as const })),
    ];
    const result = await detect(makePrisma(journeys, users), opts);
    expect(result.flagged).toHaveLength(0);
  });
});
