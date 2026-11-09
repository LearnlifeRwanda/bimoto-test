jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: { update: jest.fn().mockResolvedValue({}) },
    amlFlag: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

import prisma from '../prisma';
import { recordFlag, getOpenFlags, resolveFlag } from '../services/aml';

const flag = (prisma as any).amlFlag;
const userUpdate = (prisma as any).user.update as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('flag-store', () => {
  test('recordFlag creates a row when no recent dup exists', async () => {
    flag.findFirst.mockResolvedValue(null);
    flag.create.mockResolvedValue({ id: 'f1' });
    const r = await recordFlag({ userId: 'u1', type: 'PAIR_FREQUENCY', severity: 'HIGH' });
    expect(r).toEqual({ flagId: 'f1', merged: false });
    expect(flag.create).toHaveBeenCalled();
  });

  test('recordFlag merges duplicates within dedupe window (no new row)', async () => {
    flag.findFirst.mockResolvedValue({ id: 'f0', metadata: { count: 1 } });
    flag.update.mockResolvedValue({});
    const r = await recordFlag({
      userId: 'u1',
      type: 'PAIR_FREQUENCY',
      severity: 'HIGH',
      metadata: { count: 2 },
    });
    expect(r).toEqual({ flagId: 'f0', merged: true });
    expect(flag.create).not.toHaveBeenCalled();
    expect(flag.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ count: 2, lastDetectedAt: expect.any(String) }),
        }),
      }),
    );
  });

  test('recordFlag with CRITICAL severity flips User.isFlagged + flagReason', async () => {
    flag.findFirst.mockResolvedValue(null);
    flag.create.mockResolvedValue({ id: 'fX' });
    await recordFlag({ userId: 'u1', type: 'HARD_LIMIT_EXCEEDED', severity: 'CRITICAL' });
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({ isFlagged: true, flagReason: 'HARD_LIMIT_EXCEEDED' }),
      }),
    );
  });

  test('recordFlag with non-CRITICAL severity does NOT touch User', async () => {
    flag.findFirst.mockResolvedValue(null);
    flag.create.mockResolvedValue({ id: 'fY' });
    await recordFlag({ userId: 'u1', type: 'SOFT_LIMIT_EXCEEDED', severity: 'LOW' });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  test('getOpenFlags filters and returns total count', async () => {
    flag.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    flag.count.mockResolvedValue(2);
    const r = await getOpenFlags({ status: 'OPEN', severity: 'HIGH' });
    expect(r.total).toBe(2);
    expect(r.flags).toHaveLength(2);
    expect(flag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'OPEN', severity: 'HIGH' }),
      }),
    );
  });

  test('resolveFlag updates row with resolvedBy + status', async () => {
    flag.findUnique.mockResolvedValue({ id: 'fZ', severity: 'HIGH' });
    flag.update.mockResolvedValue({});
    await resolveFlag({
      flagId: 'fZ',
      resolvedBy: 'admin-1',
      resolutionNotes: 'reviewed',
      status: 'DISMISSED',
    });
    expect(flag.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fZ' },
        data: expect.objectContaining({
          status: 'DISMISSED',
          resolvedBy: 'admin-1',
          resolutionNotes: 'reviewed',
        }),
      }),
    );
  });

  test('CRITICAL → DISMISSED requires confirmCriticalDismiss', async () => {
    flag.findUnique.mockResolvedValue({ id: 'fC', severity: 'CRITICAL' });
    await expect(
      resolveFlag({ flagId: 'fC', resolvedBy: 'a1', status: 'DISMISSED' }),
    ).rejects.toMatchObject({ code: 'CRITICAL_DISMISS_REQUIRES_CONFIRM' });

    // With the flag set, it succeeds.
    await resolveFlag({
      flagId: 'fC',
      resolvedBy: 'a1',
      status: 'DISMISSED',
      confirmCriticalDismiss: true,
    });
    expect(flag.update).toHaveBeenCalled();
  });
});
