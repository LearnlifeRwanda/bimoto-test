jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    driverBalance: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
    driverPayoutBatch: { findMany: jest.fn(), findFirst: jest.fn() },
  },
}));

import prisma from '../prisma';
import {
  getPendingForCohort,
  getPendingDriverPayouts,
} from '../services/payout.service';

const balanceFindMany = (prisma as any).driverBalance.findMany as jest.Mock;
const userFindMany = (prisma as any).user.findMany as jest.Mock;
const batchFindMany = (prisma as any).driverPayoutBatch.findMany as jest.Mock;

const driverActiveA = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  frozenAt: null,
  payoutPreference: 'TWICE_DAILY',
  completedShifts: 10,
};
const driverFrozenB = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  frozenAt: new Date('2026-05-01T12:00:00Z'),
  payoutPreference: 'TWICE_DAILY',
  completedShifts: 10,
};
const driverActiveC = {
  id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  frozenAt: null,
  payoutPreference: 'TWICE_DAILY',
  completedShifts: 10,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('payout cohort filter — frozen drivers + in-flight (PENDING) batches', () => {
  test('TWICE_DAILY excludes frozen drivers and drivers with un-settled batches; only A pays', async () => {
    balanceFindMany.mockResolvedValue([
      { driverId: driverActiveA.id, pendingAmount: 5000 },
      { driverId: driverFrozenB.id, pendingAmount: 4000 },
      { driverId: driverActiveC.id, pendingAmount: 6000 },
    ]);
    userFindMany.mockResolvedValue([driverActiveA, driverFrozenB, driverActiveC]);
    batchFindMany.mockResolvedValue([{ driverId: driverActiveC.id }]);

    const result = await getPendingForCohort('TWICE_DAILY');
    expect(result.map((r) => r.driverId)).toEqual([driverActiveA.id]);
    expect(result[0].amount).toBe(5000);
  });

  test('exclusion covers ANY un-settled PENDING batch, not just held ones (double-pay fix)', async () => {
    balanceFindMany.mockResolvedValue([
      { driverId: driverActiveA.id, pendingAmount: 5000 },
    ]);
    userFindMany.mockResolvedValue([driverActiveA]);
    batchFindMany.mockResolvedValue([]);

    await getPendingForCohort('TWICE_DAILY');
    expect(batchFindMany).toHaveBeenCalledWith({
      where: {
        driverId: { in: [driverActiveA.id] },
        status: 'PENDING',
        paidOutAt: null,
      },
      select: { driverId: true },
    });
  });

  test('after un-freezing B and settling C’s batch, both pay in next cycle', async () => {
    balanceFindMany.mockResolvedValue([
      { driverId: driverActiveA.id, pendingAmount: 5000 },
      { driverId: driverFrozenB.id, pendingAmount: 4000 },
      { driverId: driverActiveC.id, pendingAmount: 6000 },
    ]);
    userFindMany.mockResolvedValue([
      driverActiveA,
      { ...driverFrozenB, frozenAt: null },
      driverActiveC,
    ]);
    batchFindMany.mockResolvedValue([]);

    const result = await getPendingForCohort('TWICE_DAILY');
    const ids = result.map((r) => r.driverId).sort();
    expect(ids).toEqual(
      [driverActiveA.id, driverFrozenB.id, driverActiveC.id].sort(),
    );
  });

  test('getPendingDriverPayouts also filters frozen + in-flight', async () => {
    balanceFindMany.mockResolvedValue([
      { driverId: driverActiveA.id, pendingAmount: 5000 },
      { driverId: driverFrozenB.id, pendingAmount: 4000 },
      { driverId: driverActiveC.id, pendingAmount: 6000 },
    ]);
    userFindMany.mockResolvedValue([driverActiveA, driverFrozenB, driverActiveC]);
    batchFindMany.mockResolvedValue([{ driverId: driverActiveC.id }]);

    const result = await getPendingDriverPayouts();
    expect(result.map((r) => r.driverId)).toEqual([driverActiveA.id]);
  });

  test('empty balance list short-circuits without further queries', async () => {
    balanceFindMany.mockResolvedValue([]);
    const result = await getPendingForCohort('TWICE_DAILY');
    expect(result).toEqual([]);
    expect(userFindMany).not.toHaveBeenCalled();
    expect(batchFindMany).not.toHaveBeenCalled();
  });
});
