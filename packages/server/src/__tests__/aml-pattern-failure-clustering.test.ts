jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    escrowAuditLog: { findMany: jest.fn() },
    user: { update: jest.fn().mockResolvedValue({}) },
    amlFlag: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'f' }),
      update: jest.fn(),
    },
  },
}));

import prisma from '../prisma';
import { detect } from '../services/aml/patterns/failure-clustering';

const audit = (prisma as any).escrowAuditLog;
const flag = (prisma as any).amlFlag;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('failure-clustering detector', () => {
  const now = new Date('2026-05-04T12:00:00Z');

  test('flags >5 CHARGE_FAILED events in any 1h window for one customer', async () => {
    const t = now.getTime();
    audit.findMany.mockResolvedValue([
      { createdAt: new Date(t - 50 * 60_000), escrow: { customerId: 'c1' } },
      { createdAt: new Date(t - 40 * 60_000), escrow: { customerId: 'c1' } },
      { createdAt: new Date(t - 30 * 60_000), escrow: { customerId: 'c1' } },
      { createdAt: new Date(t - 20 * 60_000), escrow: { customerId: 'c1' } },
      { createdAt: new Date(t - 10 * 60_000), escrow: { customerId: 'c1' } },
      { createdAt: new Date(t - 5 * 60_000), escrow: { customerId: 'c1' } },
    ]);
    const n = await detect(now);
    expect(n).toBe(1);
    expect(flag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'FAILURE_CLUSTERING', severity: 'LOW' }),
      }),
    );
  });

  test('does NOT flag 4 failures (insufficient-funds + retry is normal)', async () => {
    const t = now.getTime();
    audit.findMany.mockResolvedValue([
      { createdAt: new Date(t - 30 * 60_000), escrow: { customerId: 'c2' } },
      { createdAt: new Date(t - 20 * 60_000), escrow: { customerId: 'c2' } },
      { createdAt: new Date(t - 15 * 60_000), escrow: { customerId: 'c2' } },
      { createdAt: new Date(t - 10 * 60_000), escrow: { customerId: 'c2' } },
    ]);
    const n = await detect(now);
    expect(n).toBe(0);
  });

  test('does NOT flag failures spread across separate hours (not a cluster)', async () => {
    const t = now.getTime();
    audit.findMany.mockResolvedValue([
      { createdAt: new Date(t - 23 * 60 * 60_000), escrow: { customerId: 'c3' } },
      { createdAt: new Date(t - 20 * 60 * 60_000), escrow: { customerId: 'c3' } },
      { createdAt: new Date(t - 15 * 60 * 60_000), escrow: { customerId: 'c3' } },
      { createdAt: new Date(t - 10 * 60 * 60_000), escrow: { customerId: 'c3' } },
      { createdAt: new Date(t - 5 * 60 * 60_000), escrow: { customerId: 'c3' } },
      { createdAt: new Date(t - 1 * 60 * 60_000), escrow: { customerId: 'c3' } },
    ]);
    // 6 total (>5) but no 1h window contains >5.
    const n = await detect(now);
    expect(n).toBe(0);
  });
});
