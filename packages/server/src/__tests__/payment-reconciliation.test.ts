jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    escrow: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../services/payment', () => {
  const actual = jest.requireActual('../services/payment');
  return {
    ...actual,
    verifyTransaction: jest.fn(),
  };
});

jest.mock('../services/escrow.service', () => ({
  markEscrowChargeSucceeded: jest.fn(),
  markEscrowChargeFailed: jest.fn(),
}));

import prisma from '../prisma';
import { verifyTransaction } from '../services/payment';
import * as escrowService from '../services/escrow.service';
import { runPaymentReconciliationOnce } from '../jobs/payment-reconciliation.job';
import { reconcileSinglePending } from '../jobs/payment-reconciliation/reconcile-pending';

const m = prisma as jest.Mocked<typeof prisma>;
const verifyMock = verifyTransaction as jest.Mock;
const markSucceeded = escrowService.markEscrowChargeSucceeded as jest.Mock;
const markFailed = escrowService.markEscrowChargeFailed as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('reconcileSinglePending', () => {
  test('transitions to HELD on verify SUCCESS', async () => {
    verifyMock.mockResolvedValue({ status: 'SUCCESS', flwTxId: 'flw-1' });
    await reconcileSinglePending({
      id: 'e1',
      txRef: 'r1',
      lastChargeAttemptAt: new Date(),
    });
    expect(markSucceeded).toHaveBeenCalledWith('e1', 'flw-1');
    expect(markFailed).not.toHaveBeenCalled();
  });

  test('transitions to FAILED on verify FAILED', async () => {
    verifyMock.mockResolvedValue({ status: 'FAILED' });
    await reconcileSinglePending({
      id: 'e2',
      txRef: 'r2',
      lastChargeAttemptAt: new Date(),
    });
    expect(markFailed).toHaveBeenCalledWith('e2', 'gateway_reported_failure');
  });

  test('transitions to FAILED after 5min timeout on NOT_FOUND', async () => {
    verifyMock.mockResolvedValue({ status: 'NOT_FOUND' });
    await reconcileSinglePending({
      id: 'e3',
      txRef: 'r3',
      lastChargeAttemptAt: new Date(Date.now() - 6 * 60 * 1000),
    });
    expect(markFailed).toHaveBeenCalledWith('e3', 'gateway_lost_or_timeout');
  });

  test('keeps PENDING on NOT_FOUND when fresh', async () => {
    verifyMock.mockResolvedValue({ status: 'NOT_FOUND' });
    await reconcileSinglePending({
      id: 'e4',
      txRef: 'r4',
      lastChargeAttemptAt: new Date(),
    });
    expect(markSucceeded).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
  });
});

describe('runPaymentReconciliationOnce', () => {
  test('skips fresh PENDING (< 30s old) — uses createdAt cutoff', async () => {
    (m.escrow.findMany as jest.Mock).mockResolvedValue([]);
    await runPaymentReconciliationOnce();
    const callArg = (m.escrow.findMany as jest.Mock).mock.calls[0][0];
    expect(callArg.where.status).toBe('PENDING');
    expect(callArg.where.createdAt.lt).toBeInstanceOf(Date);
  });

  test('one row failure does not block siblings', async () => {
    (m.escrow.findMany as jest.Mock).mockResolvedValue([
      { id: 'e1', txRef: 'r1', lastChargeAttemptAt: new Date() },
      { id: 'e2', txRef: 'r2', lastChargeAttemptAt: new Date() },
    ]);
    verifyMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ status: 'SUCCESS', flwTxId: 'flw-2' });

    await runPaymentReconciliationOnce();

    expect(markSucceeded).toHaveBeenCalledWith('e2', 'flw-2');
  });
});
