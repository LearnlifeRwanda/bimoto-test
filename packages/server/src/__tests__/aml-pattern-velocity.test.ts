jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { groupBy: jest.fn(), findMany: jest.fn() },
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
import { detect } from '../services/aml/patterns/velocity';

const j = (prisma as any).journey;
const audit = (prisma as any).escrowAuditLog;
const flag = (prisma as any).amlFlag;

beforeEach(() => {
  jest.clearAllMocks();
  audit.findMany.mockResolvedValue([]);
});

describe('velocity detector', () => {
  test('flags customer with >5 requests in 1h (no retries)', async () => {
    const now = new Date('2026-05-04T12:00:00Z');
    j.groupBy.mockResolvedValue([{ customerId: 'c1', _count: { _all: 6 } }]);
    j.findMany.mockResolvedValue([
      { id: 'a', createdAt: new Date(now.getTime() - 50 * 60_000) },
      { id: 'b', createdAt: new Date(now.getTime() - 40 * 60_000) },
      { id: 'c', createdAt: new Date(now.getTime() - 30 * 60_000) },
      { id: 'd', createdAt: new Date(now.getTime() - 20 * 60_000) },
      { id: 'e', createdAt: new Date(now.getTime() - 10 * 60_000) },
      { id: 'f', createdAt: new Date(now.getTime() - 5 * 60_000) },
    ]);
    const n = await detect(now);
    expect(n).toBe(1);
    expect(flag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'VELOCITY_EXCEEDED', severity: 'MEDIUM' }),
      }),
    );
  });

  test('does NOT flag when retries-after-CHARGE_FAILED bring adjusted count back under threshold', async () => {
    const now = new Date('2026-05-04T12:00:00Z');
    j.groupBy.mockResolvedValue([{ customerId: 'c1', _count: { _all: 6 } }]);
    const failureAt = new Date(now.getTime() - 25 * 60_000);
    audit.findMany.mockResolvedValue([{ createdAt: failureAt }]);
    // 4 of the 6 are within 5 min after the failure → excluded as retries.
    j.findMany.mockResolvedValue([
      { id: 'a', createdAt: new Date(now.getTime() - 50 * 60_000) },
      { id: 'b', createdAt: new Date(now.getTime() - 40 * 60_000) },
      { id: 'c', createdAt: new Date(failureAt.getTime() + 1 * 60_000) },
      { id: 'd', createdAt: new Date(failureAt.getTime() + 2 * 60_000) },
      { id: 'e', createdAt: new Date(failureAt.getTime() + 3 * 60_000) },
      { id: 'f', createdAt: new Date(failureAt.getTime() + 4 * 60_000) },
    ]);
    const n = await detect(now);
    expect(n).toBe(0); // adjusted=2, under threshold
    expect(flag.create).not.toHaveBeenCalled();
  });

  test('does NOT flag at threshold (5 exactly, > not >=)', async () => {
    j.groupBy.mockResolvedValue([{ customerId: 'c1', _count: { _all: 5 } }]);
    const n = await detect();
    expect(n).toBe(0);
  });
});
