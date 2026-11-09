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
import { detect } from '../services/aml/patterns/new-account-value';

const e = (prisma as any).escrow;
const flag = (prisma as any).amlFlag;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('new-account-value detector', () => {
  test('flags low-rides + high-amount (triggerClause=rides)', async () => {
    e.findMany.mockResolvedValue([
      {
        id: 'esc-1',
        amount: 600_000,
        customerId: 'c1',
        journeyId: 'j1',
        customer: { completedRides: 1, createdAt: new Date('2025-01-01') }, // old account but few rides
      },
    ]);
    const n = await detect(new Date('2026-05-04'));
    expect(n).toBe(1);
    expect(flag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'NEW_ACCOUNT_HIGH_VALUE',
          severity: 'MEDIUM',
          metadata: expect.objectContaining({ triggerClause: 'rides' }),
        }),
      }),
    );
  });

  test('flags fresh-account + high-amount (triggerClause=age)', async () => {
    const now = new Date('2026-05-04');
    e.findMany.mockResolvedValue([
      {
        id: 'esc-2',
        amount: 700_000,
        customerId: 'c2',
        journeyId: 'j2',
        customer: { completedRides: 50, createdAt: new Date(now.getTime() - 2 * 86_400_000) }, // 2 days old
      },
    ]);
    await detect(now);
    expect(flag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ triggerClause: 'age' }),
        }),
      }),
    );
  });

  test('does NOT flag established + high-amount (false-positive resistance)', async () => {
    const now = new Date('2026-05-04');
    e.findMany.mockResolvedValue([
      {
        id: 'esc-3',
        amount: 800_000,
        customerId: 'c3',
        journeyId: 'j3',
        customer: { completedRides: 100, createdAt: new Date('2024-01-01') },
      },
    ]);
    const n = await detect(now);
    expect(n).toBe(0);
  });
});
