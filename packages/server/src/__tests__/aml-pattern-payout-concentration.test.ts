jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    escrow: { findMany: jest.fn() },
    user: { update: jest.fn().mockResolvedValue({}) },
    amlFlag: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'f' }),
      update: jest.fn(),
    },
  },
}));

import prisma from '../prisma';
import { detect } from '../services/aml/patterns/payout-concentration';

const e = (prisma as any).escrow;
const flag = (prisma as any).amlFlag;

beforeEach(() => {
  jest.clearAllMocks();
});

function escrowsFor(driverId: string, count: number, perAmount: number) {
  return Array.from({ length: count }, (_, i) => ({
    driverId,
    customerId: `cust-${driverId}-${i}`,
    driverPayout: perAmount,
  }));
}

describe('payout-concentration detector', () => {
  test('flags driver with >15 unique customers in 1h (count clause, CRITICAL)', async () => {
    e.findMany.mockResolvedValue(escrowsFor('d1', 16, 5_000));
    const n = await detect();
    expect(n).toBe(1);
    expect(flag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'PAYOUT_CONCENTRATION',
          severity: 'CRITICAL',
          metadata: expect.objectContaining({ triggerClause: 'count' }),
        }),
      }),
    );
  });

  test('flags driver with >RWF 200K from >10 unique customers (amount clause)', async () => {
    e.findMany.mockResolvedValue(escrowsFor('d2', 11, 25_000)); // 11*25K = 275K
    const n = await detect();
    expect(n).toBe(1);
    expect(flag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ triggerClause: 'amount' }),
        }),
      }),
    );
  });

  test('does NOT flag busy CBD driver with 12 unique / RWF 60K (false-positive resistance)', async () => {
    e.findMany.mockResolvedValue(escrowsFor('d3', 12, 5_000)); // 60K total
    const n = await detect();
    expect(n).toBe(0);
    expect(flag.create).not.toHaveBeenCalled();
  });

  test('repeat customers reduce unique count (deduped by customerId)', async () => {
    // 20 escrows but only 5 unique customers — not concentrated.
    const repeats = Array.from({ length: 20 }, (_, i) => ({
      driverId: 'd4',
      customerId: `cust-${i % 5}`,
      driverPayout: 50_000,
    }));
    e.findMany.mockResolvedValue(repeats);
    const n = await detect();
    expect(n).toBe(0);
  });
});
