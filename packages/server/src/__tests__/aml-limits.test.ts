jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    escrow: { findMany: jest.fn() },
    journey: { count: jest.fn() },
    user: { update: jest.fn().mockResolvedValue({}) },
    amlFlag: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'flag-1' }),
      update: jest.fn(),
    },
  },
}));

import prisma from '../prisma';
import { assertAmlCheck, AmlError } from '../services/aml';
import {
  HARD_SINGLE_TX_RWF,
  SOFT_SINGLE_TX_RWF,
  HARD_DAILY_CUMULATIVE_RWF,
  SOFT_DAILY_CUMULATIVE_RWF,
} from '../services/aml/thresholds';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.escrow.findMany as jest.Mock).mockResolvedValue([]);
  (mockPrisma.journey.count as jest.Mock).mockResolvedValue(0);
  ((prisma as any).amlFlag.findFirst as jest.Mock).mockResolvedValue(null);
  ((prisma as any).amlFlag.create as jest.Mock).mockResolvedValue({ id: 'flag-1' });
});

describe('assertAmlCheck', () => {
  test('1. charge under soft threshold passes silently — no flag', async () => {
    await assertAmlCheck({ userId: 'u1', amount: SOFT_SINGLE_TX_RWF - 1, action: 'CHARGE' });
    expect((prisma as any).amlFlag.create).not.toHaveBeenCalled();
  });

  test('2. charge at soft threshold writes LOW flag, transaction proceeds', async () => {
    await assertAmlCheck({ userId: 'u1', amount: SOFT_SINGLE_TX_RWF, action: 'CHARGE' });
    expect((prisma as any).amlFlag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'SOFT_LIMIT_EXCEEDED', severity: 'LOW' }),
      }),
    );
  });

  test('3. soft daily cumulative writes MEDIUM flag (small charge, large existing)', async () => {
    (mockPrisma.escrow.findMany as jest.Mock).mockResolvedValue([
      { amount: SOFT_DAILY_CUMULATIVE_RWF }, // already at the threshold
    ]);
    await assertAmlCheck({ userId: 'u1', amount: 50_000, action: 'CHARGE' }); // small, but cumulative trips
    expect((prisma as any).amlFlag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'DAILY_CUMULATIVE_EXCEEDED',
          severity: 'MEDIUM',
        }),
      }),
    );
  });

  test('4. charge at hard single threshold throws AmlError, no transaction', async () => {
    await expect(
      assertAmlCheck({ userId: 'u1', amount: HARD_SINGLE_TX_RWF + 1, action: 'CHARGE' }),
    ).rejects.toBeInstanceOf(AmlError);
  });

  test('5. charge crossing hard daily cumulative throws AmlError', async () => {
    (mockPrisma.escrow.findMany as jest.Mock).mockResolvedValue([
      { amount: HARD_DAILY_CUMULATIVE_RWF - 100_000 },
    ]);
    await expect(
      assertAmlCheck({ userId: 'u1', amount: 200_000, action: 'CHARGE' }),
    ).rejects.toMatchObject({ code: 'AML_HARD_LIMIT_EXCEEDED' });
  });

  test('6. boundary: charge at HARD_SINGLE_TX_RWF exactly throws (>= not >)', async () => {
    await expect(
      assertAmlCheck({ userId: 'u1', amount: HARD_SINGLE_TX_RWF, action: 'CHARGE' }),
    ).rejects.toMatchObject({ code: 'AML_HARD_LIMIT_EXCEEDED' });
  });

  test('7. boundary: charge at HARD_SINGLE_TX_RWF - 1 passes (paired)', async () => {
    await expect(
      assertAmlCheck({ userId: 'u1', amount: HARD_SINGLE_TX_RWF - 1, action: 'CHARGE' }),
    ).resolves.toBeUndefined();
  });

  test('8. soft-flag write failure does NOT block transaction', async () => {
    ((prisma as any).amlFlag.create as jest.Mock).mockRejectedValueOnce(
      new Error('db down'),
    );
    // Use a soft-but-not-hard amount so the path goes through safeRecordFlag.
    await expect(
      assertAmlCheck({ userId: 'u1', amount: SOFT_SINGLE_TX_RWF + 100, action: 'CHARGE' }),
    ).resolves.toBeUndefined();
  });

  test('9. payout action sums driverPayout, not amount', async () => {
    (mockPrisma.escrow.findMany as jest.Mock).mockResolvedValue([
      { driverPayout: HARD_DAILY_CUMULATIVE_RWF },
    ]);
    await expect(
      assertAmlCheck({ userId: 'd1', amount: 1, action: 'PAYOUT' }),
    ).rejects.toMatchObject({ code: 'AML_HARD_LIMIT_EXCEEDED' });
    // Verify it queried by driverId, not customerId.
    expect(mockPrisma.escrow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ driverId: 'd1' }),
      }),
    );
  });
});
