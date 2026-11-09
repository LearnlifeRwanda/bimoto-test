jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    driverBalance: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    driverPayoutBatch: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ frozenAt: null }),
    },
  },
}));

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import prisma from '../prisma';
import * as Sentry from '@sentry/node';
import * as payout from '../services/payout.service';

const m = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => jest.clearAllMocks());

describe('payout.service', () => {
  test('creditDriverBalance is idempotent on multiple calls (upsert+increment)', async () => {
    (m.driverBalance.upsert as jest.Mock).mockResolvedValue({});
    await payout.creditDriverBalance('d1', 1000);
    await payout.creditDriverBalance('d1', 1500);
    expect(m.driverBalance.upsert).toHaveBeenCalledTimes(2);
    const calls = (m.driverBalance.upsert as jest.Mock).mock.calls;
    expect(calls[0][0].update.pendingAmount).toEqual({ increment: 1000 });
    expect(calls[1][0].update.pendingAmount).toEqual({ increment: 1500 });
  });

  test('creditDriverBalance is a no-op for zero or negative amounts', async () => {
    await payout.creditDriverBalance('d1', 0);
    await payout.creditDriverBalance('d1', -50);
    expect(m.driverBalance.upsert).not.toHaveBeenCalled();
  });

  test('getPendingDriverPayouts excludes zero-balance drivers (via where clause)', async () => {
    (m.driverBalance.findMany as jest.Mock).mockResolvedValue([
      { driverId: 'd1', pendingAmount: 5000 },
      { driverId: 'd2', pendingAmount: 3000 },
    ]);
    ((m as any).user.findMany as jest.Mock).mockResolvedValue([
      { id: 'd1', frozenAt: null },
      { id: 'd2', frozenAt: null },
    ]);
    ((m as any).driverPayoutBatch.findMany as jest.Mock).mockResolvedValue([]);
    const result = await payout.getPendingDriverPayouts();
    expect(m.driverBalance.findMany).toHaveBeenCalledWith({
      where: { pendingAmount: { gt: 0 } },
    });
    expect(result).toEqual([
      { driverId: 'd1', amount: 5000 },
      { driverId: 'd2', amount: 3000 },
    ]);
  });

  // Stateful tx mock: batch flip honors the status predicate; the balance
  // decrement honors the gte guard and composes like Postgres increments do.
  function buildPaidOutTx(batch: any, balance: { pendingAmount: number } | null) {
    const state = { batch: { ...batch }, balance: balance ? { driverId: batch.driverId, ...balance } : null };
    const txMock = {
      __state: state,
      driverPayoutBatch: {
        findUnique: jest.fn(async () => ({ ...state.batch })),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (where.status !== undefined && state.batch.status !== where.status) {
            return { count: 0 };
          }
          Object.assign(state.batch, data);
          return { count: 1 };
        }),
      },
      driverBalance: {
        findUnique: jest.fn(async () => (state.balance ? { ...state.balance } : null)),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (!state.balance) return { count: 0 };
          const gte = where.pendingAmount?.gte;
          if (gte !== undefined && state.balance.pendingAmount < gte) {
            return { count: 0 };
          }
          state.balance.pendingAmount -= data.pendingAmount.decrement;
          return { count: 1 };
        }),
      },
    };
    (m.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(txMock));
    return txMock;
  }

  test('markBatchPaidOut atomically updates batch + balance (conditional decrement)', async () => {
    const txMock = buildPaidOutTx(
      { id: 'b1', driverId: 'd1', amount: 5000, status: 'PENDING' },
      { pendingAmount: 5000 },
    );

    await payout.markBatchPaidOut('d1', 'b1', 'flw-9999');

    expect(txMock.driverPayoutBatch.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'SUCCESS', flwTransferId: 'flw-9999' }),
    });
    expect(txMock.driverBalance.updateMany).toHaveBeenCalledWith({
      where: { driverId: 'd1', pendingAmount: { gte: 5000 } },
      data: { pendingAmount: { decrement: 5000 } },
    });
    expect((txMock as any).__state.balance.pendingAmount).toBe(0);
  });

  test('markBatchPaidOut refuses to mark a non-PENDING batch', async () => {
    const txMock = buildPaidOutTx(
      { id: 'b1', driverId: 'd1', amount: 5000, status: 'SUCCESS' },
      { pendingAmount: 5000 },
    );

    await expect(payout.markBatchPaidOut('d1', 'b1', 'flw-x')).rejects.toThrow('errors.batchNotPending');
    expect(txMock.driverBalance.updateMany).not.toHaveBeenCalled();
  });

  test('markBatchPaidOut throws 409 when the predicated flip loses a race', async () => {
    // Stale read says PENDING, but the predicated flip finds the row already
    // settled — the loser must not touch the balance.
    const txMock = buildPaidOutTx(
      { id: 'b1', driverId: 'd1', amount: 5000, status: 'PENDING' },
      { pendingAmount: 5000 },
    );
    ((txMock as any).driverPayoutBatch.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });

    await expect(payout.markBatchPaidOut('d1', 'b1', 'flw-x')).rejects.toThrow('errors.batchNotPending');
    expect(txMock.driverBalance.updateMany).not.toHaveBeenCalled();
  });

  test('balance never goes negative if batch.amount > balance.pendingAmount', async () => {
    const txMock = buildPaidOutTx(
      { id: 'b1', driverId: 'd1', amount: 8000, status: 'PENDING' },
      { pendingAmount: 3000 },
    );

    await payout.markBatchPaidOut('d1', 'b1', 'flw-z');

    // Clamp path still decrements (never an absolute overwrite): exactly the
    // observed 3000 is removed, landing on zero.
    expect(txMock.driverBalance.updateMany).toHaveBeenLastCalledWith({
      where: { driverId: 'd1' },
      data: { pendingAmount: { decrement: 3000 } },
    });
    expect((txMock as any).__state.balance.pendingAmount).toBe(0);
    // The clamp hides a real discrepancy (paid more than the tracked
    // balance) — it must be surfaced as a money-integrity event.
    expect((Sentry as any).captureMessage).toHaveBeenCalledWith(
      'payout-clamp-discrepancy',
      expect.objectContaining({
        extra: expect.objectContaining({
          driverId: 'd1',
          batchId: 'b1',
          batchAmount: 8000,
          pendingAmount: 3000,
        }),
      }),
    );
  });

  test('no clamp-discrepancy event when the balance covers the batch', async () => {
    buildPaidOutTx(
      { id: 'b1', driverId: 'd1', amount: 3000, status: 'PENDING' },
      { pendingAmount: 5000 },
    );

    await payout.markBatchPaidOut('d1', 'b1', 'flw-z');

    expect((Sentry as any).captureMessage).not.toHaveBeenCalled();
  });

  test('markBatchFailed is a no-op on a SUCCESS batch (predicated write)', async () => {
    ((m as any).driverPayoutBatch.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

    await payout.markBatchFailed('b1', 'gateway_reported_failure');

    expect((m as any).driverPayoutBatch.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', status: 'PENDING' },
      data: { status: 'FAILED', failureReason: 'gateway_reported_failure' },
    });
  });

  test('createPendingBatch refuses zero/negative amount', async () => {
    await expect(payout.createPendingBatch('d1', 0, 'r1')).rejects.toThrow('errors.invalidPayoutAmount');
  });

  // Regression (double-pay fix): a driver whose earlier transfer is still in
  // flight (ordinary un-held PENDING batch) must not be paid the full balance
  // again by the next scheduled run.
  test('getPendingDriverPayouts skips a driver with an un-held PENDING batch', async () => {
    (m.driverBalance.findMany as jest.Mock).mockResolvedValue([
      { driverId: 'd1', pendingAmount: 5000 },
      { driverId: 'd2', pendingAmount: 3000 },
    ]);
    ((m as any).user.findMany as jest.Mock).mockResolvedValue([
      { id: 'd1', frozenAt: null },
      { id: 'd2', frozenAt: null },
    ]);
    ((m as any).driverPayoutBatch.findMany as jest.Mock).mockResolvedValue([
      { driverId: 'd1' }, // un-held PENDING batch — Flutterwave still settling
    ]);

    const result = await payout.getPendingDriverPayouts();

    expect((m as any).driverPayoutBatch.findMany).toHaveBeenCalledWith({
      where: { driverId: { in: ['d1', 'd2'] }, status: 'PENDING', paidOutAt: null },
      select: { driverId: true },
    });
    expect(result).toEqual([{ driverId: 'd2', amount: 3000 }]);
  });

  // Regression (double-pay fix): end-shift goes through
  // firePreferenceChangeBatch, which must refuse while a transfer is in
  // flight for the driver.
  test('firePreferenceChangeBatch refuses while an un-settled PENDING batch exists', async () => {
    ((m as any).user.findUnique as jest.Mock).mockResolvedValue({ frozenAt: null });
    ((m as any).driverPayoutBatch.findFirst as jest.Mock).mockResolvedValue({ id: 'b-inflight' });

    const result = await payout.firePreferenceChangeBatch('d1', 'SHIFT_END');

    expect((m as any).driverPayoutBatch.findFirst).toHaveBeenCalledWith({
      where: { driverId: 'd1', status: 'PENDING', paidOutAt: null },
      select: { id: true },
    });
    expect(result).toEqual({ batchId: null, amount: 0 });
    expect((m as any).driverPayoutBatch.create).not.toHaveBeenCalled();
  });
});
