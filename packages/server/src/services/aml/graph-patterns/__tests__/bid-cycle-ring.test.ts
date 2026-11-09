import { detect } from '../bid-cycle-ring';

interface BidRow {
  driverId: string;
  status: 'ACCEPTED' | 'WITHDRAWN';
  withdrawnSource?: 'USER' | 'SYSTEM' | null;
  createdAt: Date;
  updatedAt: Date;
  journey: { id: string; customerId: string };
}

const makePrisma = (bids: BidRow[]) =>
  ({
    bid: { findMany: jest.fn().mockResolvedValue(bids) },
  }) as any;

const opts = { windowDays: 7, minSampleSize: 1, now: new Date('2026-05-04T00:00:00Z') };

const baseTime = new Date('2026-05-03T10:00:00Z');

const cycle = (
  driverId: string,
  customerId: string,
  n: number,
  journeyPrefix: string,
  withdrawnSource: 'USER' | 'SYSTEM' | null = null,
): BidRow[] => {
  const rows: BidRow[] = [];
  for (let i = 0; i < n; i++) {
    const ts = new Date(baseTime.getTime() + i * 60_000);
    rows.push({
      driverId,
      status: 'WITHDRAWN',
      withdrawnSource,
      createdAt: ts,
      updatedAt: ts,
      journey: { id: `${journeyPrefix}-${i}`, customerId },
    });
  }
  return rows;
};

describe('bid-cycle-ring detector', () => {
  test('3 pairs in connected component each with 5+ cycles -> CRITICAL findings', async () => {
    // Pairs: (d1,c1), (d1,c2), (d2,c1) — connected via d1 and c1.
    const bids = [
      ...cycle('d1', 'c1', 5, 'j1'),
      ...cycle('d1', 'c2', 5, 'j2'),
      ...cycle('d2', 'c1', 5, 'j3'),
    ];
    const result = await detect(makePrisma(bids), opts);
    expect(result.flagged.length).toBeGreaterThanOrEqual(3);
    expect(result.flagged.every((f) => f.severity === 'CRITICAL')).toBe(true);
    const ids = new Set(result.flagged.map((f) => f.userId));
    for (const id of ['d1', 'd2', 'c1', 'c2']) expect(ids.has(id)).toBe(true);
  });

  test('only 2 qualifying pairs -> 0 findings (BID_CYCLE_MIN_PAIRS=3)', async () => {
    const bids = [
      ...cycle('d1', 'c1', 3, 'j1'),
      ...cycle('d2', 'c2', 3, 'j2'),
    ];
    const result = await detect(makePrisma(bids), opts);
    expect(result.flagged).toHaveLength(0);
  });

  test('pair with too few cycles -> 0 findings', async () => {
    const bids = [
      ...cycle('d1', 'c1', 2, 'j1'),
      ...cycle('d1', 'c2', 2, 'j2'),
      ...cycle('d2', 'c1', 2, 'j3'),
    ];
    const result = await detect(makePrisma(bids), opts);
    expect(result.flagged).toHaveLength(0);
  });

  test('3 pairs with 3 cycles each -> HIGH severity (not CRITICAL)', async () => {
    const bids = [
      ...cycle('d1', 'c1', 3, 'j1'),
      ...cycle('d1', 'c2', 3, 'j2'),
      ...cycle('d2', 'c1', 3, 'j3'),
    ];
    const result = await detect(makePrisma(bids), opts);
    expect(result.flagged.length).toBeGreaterThan(0);
    expect(result.flagged.every((f) => f.severity === 'HIGH')).toBe(true);
  });

  test('SYSTEM withdrawals do not count: 2 of 3 per pair SYSTEM -> below MIN_PER_PAIR, 0 findings', async () => {
    const bids = [
      ...cycle('d1', 'c1', 1, 'j1u', 'USER'),
      ...cycle('d1', 'c1', 2, 'j1s', 'SYSTEM'),
      ...cycle('d1', 'c2', 1, 'j2u', 'USER'),
      ...cycle('d1', 'c2', 2, 'j2s', 'SYSTEM'),
      ...cycle('d2', 'c1', 1, 'j3u', 'USER'),
      ...cycle('d2', 'c1', 2, 'j3s', 'SYSTEM'),
    ];
    const result = await detect(makePrisma(bids), opts);
    expect(result.flagged).toHaveLength(0);
  });

  test('same fixture with USER withdrawals -> flagged, exclusion count in metadata', async () => {
    const bids = [
      ...cycle('d1', 'c1', 3, 'j1', 'USER'),
      ...cycle('d1', 'c2', 3, 'j2', 'USER'),
      ...cycle('d2', 'c1', 3, 'j3', 'USER'),
    ];
    const result = await detect(makePrisma(bids), opts);
    expect(result.flagged.length).toBeGreaterThan(0);
    expect(
      result.flagged.every((f) => (f.metadata as any).systemWithdrawnExcluded === 0),
    ).toBe(true);
  });

  test('legacy null-source withdrawals keep counting exactly as before', async () => {
    const bids = [
      ...cycle('d1', 'c1', 5, 'j1', null),
      ...cycle('d1', 'c2', 5, 'j2', null),
      ...cycle('d2', 'c1', 5, 'j3', null),
    ];
    const result = await detect(makePrisma(bids), opts);
    expect(result.flagged.length).toBeGreaterThanOrEqual(3);
    expect(result.flagged.every((f) => f.severity === 'CRITICAL')).toBe(true);
  });
});
