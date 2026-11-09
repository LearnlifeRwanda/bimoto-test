import { detect } from '../money-funnel';

const makePrisma = (
  escrows: Array<{ driverId: string; customerId: string; driverPayout: number }>,
) =>
  ({
    escrow: { findMany: jest.fn().mockResolvedValue(escrows) },
  }) as any;

const opts = { windowDays: 7, minSampleSize: 1, now: new Date('2026-05-04T00:00:00Z') };

describe('money-funnel detector', () => {
  test('concentrated driver with 8 distinct customers -> CRITICAL driver + MEDIUM customers', async () => {
    // Top 5 carry 1,000k of 1,030k (concentration 0.97); the 3 tail
    // customers push the driver past MONEY_FUNNEL_MIN_TOTAL_CUSTOMERS.
    const escrows = [
      { driverId: 'dA', customerId: 'cX', driverPayout: 600_000 },
      { driverId: 'dA', customerId: 'cY', driverPayout: 200_000 },
      { driverId: 'dA', customerId: 'cZ', driverPayout: 100_000 },
      { driverId: 'dA', customerId: 'cQ', driverPayout: 50_000 },
      { driverId: 'dA', customerId: 'cR', driverPayout: 50_000 },
      { driverId: 'dA', customerId: 'cT1', driverPayout: 10_000 },
      { driverId: 'dA', customerId: 'cT2', driverPayout: 10_000 },
      { driverId: 'dA', customerId: 'cT3', driverPayout: 10_000 },
    ];
    const result = await detect(makePrisma(escrows), opts);
    const driverFindings = result.flagged.filter((f) => f.userId === 'dA');
    const customerFindings = result.flagged.filter((f) => f.userId !== 'dA');
    expect(driverFindings).toHaveLength(1);
    expect(driverFindings[0].severity).toBe('CRITICAL');
    expect(customerFindings.length).toBeGreaterThan(0);
    expect(customerFindings.every((f) => f.severity === 'MEDIUM')).toBe(true);
    const meta = driverFindings[0].metadata as any;
    expect(meta.totalEarnings).toBe(1_030_000);
    expect(meta.concentration).toBeGreaterThanOrEqual(0.85);
    expect(meta.totalDistinctCustomers).toBe(8);
  });

  test('same concentration but only 4 distinct customers -> not flagged (eligibility guard)', async () => {
    const escrows = [
      { driverId: 'dA', customerId: 'cX', driverPayout: 600_000 },
      { driverId: 'dA', customerId: 'cY', driverPayout: 100_000 },
      { driverId: 'dA', customerId: 'cZ', driverPayout: 50_000 },
      { driverId: 'dA', customerId: 'cQ', driverPayout: 50_000 },
    ];
    const result = await detect(makePrisma(escrows), opts);
    expect(result.flagged).toHaveLength(0);
  });

  test('9 distinct customers, concentration >= 0.7, total >= 500k -> flagged', async () => {
    // Top 5 = 520k of 640k total (concentration 0.8125).
    const escrows = [
      { driverId: 'dA', customerId: 'c1', driverPayout: 200_000 },
      { driverId: 'dA', customerId: 'c2', driverPayout: 100_000 },
      { driverId: 'dA', customerId: 'c3', driverPayout: 100_000 },
      { driverId: 'dA', customerId: 'c4', driverPayout: 60_000 },
      { driverId: 'dA', customerId: 'c5', driverPayout: 60_000 },
      { driverId: 'dA', customerId: 'c6', driverPayout: 30_000 },
      { driverId: 'dA', customerId: 'c7', driverPayout: 30_000 },
      { driverId: 'dA', customerId: 'c8', driverPayout: 30_000 },
      { driverId: 'dA', customerId: 'c9', driverPayout: 30_000 },
    ];
    const result = await detect(makePrisma(escrows), opts);
    const driverFinding = result.flagged.find((f) => f.userId === 'dA');
    expect(driverFinding).toBeDefined();
    expect(driverFinding!.severity).toBe('HIGH');
    const meta = driverFinding!.metadata as any;
    expect(meta.totalDistinctCustomers).toBe(9);
    expect(meta.concentration).toBeGreaterThanOrEqual(0.7);
  });

  test('driver below MIN_AMOUNT -> no findings', async () => {
    const escrows = [
      { driverId: 'dA', customerId: 'cX', driverPayout: 100_000 },
      { driverId: 'dA', customerId: 'cY', driverPayout: 100_000 },
    ];
    const result = await detect(makePrisma(escrows), opts);
    expect(result.flagged).toHaveLength(0);
  });

  test('driver with even distribution -> no findings', async () => {
    const escrows = Array.from({ length: 10 }, (_, i) => ({
      driverId: 'dA',
      customerId: `c${i}`,
      driverPayout: 100_000,
    }));
    const result = await detect(makePrisma(escrows), opts);
    expect(result.flagged).toHaveLength(0);
  });

  test('concentration in 0.7-0.85 band -> HIGH severity', async () => {
    // 8 distinct customers; top 5 = 950k of 1,130k total → 0.84 (HIGH band).
    const escrows = [
      { driverId: 'dA', customerId: 'cX', driverPayout: 400_000 },
      { driverId: 'dA', customerId: 'cY', driverPayout: 200_000 },
      { driverId: 'dA', customerId: 'cZ', driverPayout: 150_000 },
      { driverId: 'dA', customerId: 'cQ', driverPayout: 100_000 },
      { driverId: 'dA', customerId: 'cR', driverPayout: 100_000 },
      { driverId: 'dA', customerId: 'cS', driverPayout: 50_000 },
      { driverId: 'dA', customerId: 'cT', driverPayout: 60_000 },
      { driverId: 'dA', customerId: 'cU', driverPayout: 70_000 },
    ];
    const result = await detect(makePrisma(escrows), opts);
    const driverFinding = result.flagged.find((f) => f.userId === 'dA');
    expect(driverFinding).toBeDefined();
    const meta = driverFinding!.metadata as any;
    if (meta.concentration >= 0.85) {
      expect(driverFinding!.severity).toBe('CRITICAL');
    } else {
      expect(driverFinding!.severity).toBe('HIGH');
    }
  });
});
