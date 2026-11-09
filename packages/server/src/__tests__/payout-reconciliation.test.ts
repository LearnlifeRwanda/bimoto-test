jest.mock('../prisma', () => {
  const mock = {
    $transaction: jest.fn(),
    driverPayoutBatch: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    driverBalance: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
  return { __esModule: true, default: mock };
});

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import prisma from '../prisma';
import * as Sentry from '@sentry/node';
import {
  runPayoutReconciliationOnce,
  _setFetchTransferStatusForTests,
} from '../jobs/payout-reconciliation.job';
import { markBatchTransferReversed } from '../services/payout.service';

const m = prisma as any;
const findMany = m.driverPayoutBatch.findMany as jest.Mock;
const findUnique = m.driverPayoutBatch.findUnique as jest.Mock;
const updateBatch = m.driverPayoutBatch.update as jest.Mock;
const updateManyBatch = m.driverPayoutBatch.updateMany as jest.Mock;
const updateManyBalance = m.driverBalance.updateMany as jest.Mock;
const upsertBalance = m.driverBalance.upsert as jest.Mock;
const captureMessage = (Sentry as any).captureMessage as jest.Mock;

const NOW = new Date('2026-05-04T12:00:00.000Z');
const AGE_1H = new Date(NOW.getTime() - 60 * 60 * 1000);
const AGE_25H = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);

let fetchMock: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  findMany.mockResolvedValue([]);
  updateBatch.mockResolvedValue({});
  updateManyBatch.mockResolvedValue({ count: 1 });
  updateManyBalance.mockResolvedValue({ count: 1 });
  upsertBalance.mockResolvedValue({});
  // Run the transaction body against the same mock so batch/balance
  // assertions read naturally.
  (m.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(m));
  fetchMock = jest.fn();
  _setFetchTransferStatusForTests(fetchMock);
});

afterAll(() => {
  _setFetchTransferStatusForTests(null);
});

function pendingBatch(overrides: Partial<any> = {}): any {
  return {
    id: 'b1',
    driverId: 'd1',
    amount: 5000,
    txRef: 'ref-1',
    flwTransferId: 'flw-1',
    status: 'PENDING',
    held: false,
    createdAt: AGE_1H,
    ...overrides,
  };
}

describe('runPayoutReconciliationOnce', () => {
  test('only scans un-held PENDING rows older than 30 minutes', async () => {
    await runPayoutReconciliationOnce(NOW);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: 'PENDING',
        held: false,
        createdAt: { lt: new Date(NOW.getTime() - 30 * 60 * 1000) },
      },
    });
  });

  test('gateway SUCCESS → batch settled via markBatchPaidOut (balance deducted)', async () => {
    const batch = pendingBatch();
    findMany.mockResolvedValue([batch]);
    findUnique.mockResolvedValue(batch);
    m.driverBalance.findUnique.mockResolvedValue({ driverId: 'd1', pendingAmount: 5000 });
    fetchMock.mockResolvedValue({ status: 'SUCCESS' });

    await runPayoutReconciliationOnce(NOW);

    expect(fetchMock).toHaveBeenCalledWith('flw-1');
    expect(updateManyBatch).toHaveBeenCalledWith({
      where: { id: 'b1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'SUCCESS', flwTransferId: 'flw-1' }),
    });
    expect(updateManyBalance).toHaveBeenCalledWith({
      where: { driverId: 'd1', pendingAmount: { gte: 5000 } },
      data: { pendingAmount: { decrement: 5000 } },
    });
  });

  test('gateway FAILED → markBatchFailed(gateway_reported_failure), balance untouched', async () => {
    const batch = pendingBatch();
    findMany.mockResolvedValue([batch]);
    findUnique.mockResolvedValue(batch);
    fetchMock.mockResolvedValue({ status: 'FAILED' });

    await runPayoutReconciliationOnce(NOW);

    expect(updateManyBatch).toHaveBeenCalledWith({
      where: { id: 'b1', status: 'PENDING' },
      data: { status: 'FAILED', failureReason: 'gateway_reported_failure' },
    });
    expect(updateManyBalance).not.toHaveBeenCalled();
    expect(m.driverBalance.update).not.toHaveBeenCalled();
    expect(upsertBalance).not.toHaveBeenCalled();
  });

  test('gateway still PENDING → row left alone for the next tick', async () => {
    findMany.mockResolvedValue([pendingBatch()]);
    fetchMock.mockResolvedValue({ status: 'PENDING' });

    await runPayoutReconciliationOnce(NOW);

    expect(updateBatch).not.toHaveBeenCalled();
    expect(updateManyBatch).not.toHaveBeenCalled();
  });

  test('no transfer id + older than 24h → markBatchFailed(gateway_lost_or_timeout)', async () => {
    const batch = pendingBatch({ flwTransferId: null, createdAt: AGE_25H });
    findMany.mockResolvedValue([batch]);
    findUnique.mockResolvedValue(batch);

    await runPayoutReconciliationOnce(NOW);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateManyBatch).toHaveBeenCalledWith({
      where: { id: 'b1', status: 'PENDING' },
      data: { status: 'FAILED', failureReason: 'gateway_lost_or_timeout' },
    });
  });

  test('no transfer id + younger than 24h → untouched (webhook may still land)', async () => {
    findMany.mockResolvedValue([pendingBatch({ flwTransferId: null })]);

    await runPayoutReconciliationOnce(NOW);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateBatch).not.toHaveBeenCalled();
    expect(updateManyBatch).not.toHaveBeenCalled();
  });

  test("one row's fetch failure does not block siblings", async () => {
    const b1 = pendingBatch();
    const b2 = pendingBatch({ id: 'b2', driverId: 'd2', flwTransferId: 'flw-2', txRef: 'ref-2' });
    findMany.mockResolvedValue([b1, b2]);
    findUnique.mockResolvedValue(b2);
    fetchMock
      .mockRejectedValueOnce(new Error('gateway down'))
      .mockResolvedValueOnce({ status: 'FAILED' });

    await runPayoutReconciliationOnce(NOW);

    expect(updateManyBatch).toHaveBeenCalledWith({
      where: { id: 'b2', status: 'PENDING' },
      data: { status: 'FAILED', failureReason: 'gateway_reported_failure' },
    });
  });
});

describe('markBatchTransferReversed', () => {
  test('SUCCESS batch → FAILED + balance re-credited atomically + Sentry event', async () => {
    findUnique.mockResolvedValue({
      id: 'b1',
      driverId: 'd1',
      amount: 5000,
      status: 'SUCCESS',
    });

    await markBatchTransferReversed('b1', 'WEBHOOK_REPORTED_FAILURE');

    expect(updateBatch).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: {
        status: 'FAILED',
        failureReason: 'WEBHOOK_REPORTED_FAILURE',
        reversedAt: expect.any(Date),
      },
    });
    expect(upsertBalance).toHaveBeenCalledWith({
      where: { driverId: 'd1' },
      create: { driverId: 'd1', pendingAmount: 5000 },
      update: { pendingAmount: { increment: 5000 } },
    });
    expect(captureMessage).toHaveBeenCalledWith(
      'payout-transfer-reversed',
      expect.objectContaining({
        extra: expect.objectContaining({ batchId: 'b1', driverId: 'd1', amount: 5000 }),
      }),
    );
  });

  test('refuses (no-op) when batch is PENDING', async () => {
    findUnique.mockResolvedValue({ id: 'b1', driverId: 'd1', amount: 5000, status: 'PENDING' });

    await markBatchTransferReversed('b1', 'x');

    expect(updateBatch).not.toHaveBeenCalled();
    expect(upsertBalance).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  test('refuses (no-op) when batch is missing', async () => {
    findUnique.mockResolvedValue(null);

    await markBatchTransferReversed('missing', 'x');

    expect(updateBatch).not.toHaveBeenCalled();
    expect(upsertBalance).not.toHaveBeenCalled();
  });
});
