jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { groupBy: jest.fn(), findMany: jest.fn() },
    user: { update: jest.fn().mockResolvedValue({}) },
    amlFlag: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'f' }),
      update: jest.fn(),
    },
  },
}));

import prisma from '../prisma';
import { detect } from '../services/aml/patterns/burst-silence';

const j = (prisma as any).journey;
const flag = (prisma as any).amlFlag;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('burst-silence detector', () => {
  const now = new Date('2026-05-04T12:00:00Z');

  test('flags 20+ rides with high spend in 48h then 14+ days silence', async () => {
    j.groupBy.mockImplementation(({ where }: any) => {
      // recently active (>= silence cutoff): empty → silent
      if (where.createdAt?.gte && !where.createdAt?.lt) return Promise.resolve([]);
      // earlier active: c1 was active
      return Promise.resolve([{ customerId: 'c1' }]);
    });
    // 20 rides in a 24h window, RWF 10K each = 200K spend (above 100K threshold)
    const burstStart = new Date(now.getTime() - 30 * 86_400_000);
    j.findMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        id: `j${i}`,
        createdAt: new Date(burstStart.getTime() + i * 60 * 60 * 1000),
        escrow: { amount: 10_000 },
      })),
    );
    const n = await detect(now);
    expect(n).toBe(1);
    expect(flag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'BURST_SILENCE', severity: 'HIGH' }),
      }),
    );
  });

  test('does NOT flag tourist-pattern burst with low spend (false-positive resistance)', async () => {
    j.groupBy.mockImplementation(({ where }: any) => {
      if (where.createdAt?.gte && !where.createdAt?.lt) return Promise.resolve([]);
      return Promise.resolve([{ customerId: 'c2' }]);
    });
    const burstStart = new Date(now.getTime() - 30 * 86_400_000);
    // 20 rides but only RWF 2K each = 40K spend (below 100K threshold).
    j.findMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        id: `j${i}`,
        createdAt: new Date(burstStart.getTime() + i * 60 * 60 * 1000),
        escrow: { amount: 2_000 },
      })),
    );
    const n = await detect(now);
    expect(n).toBe(0);
  });

  test('does NOT flag user who is still active (no silence period)', async () => {
    // Active recently → in recentlyActiveSet → skipped.
    j.groupBy.mockImplementation(({ where }: any) => {
      if (where.createdAt?.gte && !where.createdAt?.lt) return Promise.resolve([{ customerId: 'c3' }]);
      return Promise.resolve([{ customerId: 'c3' }]);
    });
    const n = await detect(now);
    expect(n).toBe(0);
    expect(flag.create).not.toHaveBeenCalled();
  });
});
