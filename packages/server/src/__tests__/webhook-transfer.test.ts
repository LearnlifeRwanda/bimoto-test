jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    driverPayoutBatch: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../services/escrow.service', () => ({
  markEscrowChargeSucceeded: jest.fn().mockResolvedValue(undefined),
  markEscrowChargeFailed: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/payout.service', () => ({
  markBatchPaidOut: jest.fn().mockResolvedValue(undefined),
  markBatchFailed: jest.fn().mockResolvedValue(undefined),
  markBatchTransferReversed: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import prisma from '../prisma';
import webhookRoutes from '../routes/webhook.routes';
import {
  markBatchPaidOut,
  markBatchFailed,
  markBatchTransferReversed,
} from '../services/payout.service';

const app = express();
app.use(express.json());
app.use('/api/webhooks', webhookRoutes);

const findBatch = (prisma as any).driverPayoutBatch.findUnique as jest.Mock;
const markPaid = markBatchPaidOut as jest.Mock;
const markFailed = markBatchFailed as jest.Mock;
const markReversed = markBatchTransferReversed as jest.Mock;

const SECRET_HASH = 'a'.repeat(64);

function post(body: object, signature: string = SECRET_HASH) {
  return request(app)
    .post('/api/webhooks/flutterwave')
    .set('verif-hash', signature)
    .send(body);
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FLW_SECRET_HASH = SECRET_HASH;
});

afterAll(() => {
  delete process.env.FLW_SECRET_HASH;
});

describe('Flutterwave webhook: transfer.completed', () => {
  const pendingBatch = {
    id: 'b1',
    driverId: 'd1',
    amount: 5000,
    txRef: 'bimoto-payout-ref-1',
    status: 'PENDING',
  };

  test('successful transfer + PENDING batch → markBatchPaidOut', async () => {
    findBatch.mockResolvedValue(pendingBatch);
    const res = await post({
      event: 'transfer.completed',
      data: { id: 12345, reference: 'bimoto-payout-ref-1', status: 'SUCCESSFUL' },
    });
    expect(res.status).toBe(200);
    expect(findBatch).toHaveBeenCalledWith({ where: { txRef: 'bimoto-payout-ref-1' } });
    expect(markPaid).toHaveBeenCalledWith('d1', 'b1', '12345');
    expect(markFailed).not.toHaveBeenCalled();
  });

  test('failed transfer + PENDING batch → markBatchFailed (balance untouched)', async () => {
    findBatch.mockResolvedValue(pendingBatch);
    const res = await post({
      event: 'transfer.completed',
      data: { id: 12345, reference: 'bimoto-payout-ref-1', status: 'FAILED' },
    });
    expect(res.status).toBe(200);
    expect(markFailed).toHaveBeenCalledWith('b1', 'WEBHOOK_REPORTED_FAILURE');
    expect(markPaid).not.toHaveBeenCalled();
  });

  test('failed transfer + SUCCESS batch → markBatchTransferReversed', async () => {
    findBatch.mockResolvedValue({ ...pendingBatch, status: 'SUCCESS' });
    const res = await post({
      event: 'transfer.completed',
      data: { id: 12345, reference: 'bimoto-payout-ref-1', status: 'FAILED' },
    });
    expect(res.status).toBe(200);
    expect(markPaid).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
    expect(markReversed).toHaveBeenCalledWith('b1', 'WEBHOOK_REPORTED_FAILURE');
  });

  test('unknown reference → 200, nothing marked (idempotent ack)', async () => {
    findBatch.mockResolvedValue(null);
    const res = await post({
      event: 'transfer.completed',
      data: { id: 12345, reference: 'unknown-ref', status: 'SUCCESSFUL' },
    });
    expect(res.status).toBe(200);
    expect(markPaid).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
  });

  test('already-consistent state (successful + SUCCESS batch) → 200, no-op', async () => {
    findBatch.mockResolvedValue({ ...pendingBatch, status: 'SUCCESS' });
    const res = await post({
      event: 'transfer.completed',
      data: { id: 12345, reference: 'bimoto-payout-ref-1', status: 'SUCCESSFUL' },
    });
    expect(res.status).toBe(200);
    expect(markPaid).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
  });

  test('missing reference → 200, no lookup marking', async () => {
    const res = await post({
      event: 'transfer.completed',
      data: { id: 12345, status: 'SUCCESSFUL' },
    });
    expect(res.status).toBe(200);
    expect(findBatch).not.toHaveBeenCalled();
    expect(markPaid).not.toHaveBeenCalled();
  });

  test('invalid signature → 401, handler never touches the batch', async () => {
    const res = await post(
      {
        event: 'transfer.completed',
        data: { id: 12345, reference: 'bimoto-payout-ref-1', status: 'SUCCESSFUL' },
      },
      'b'.repeat(64),
    );
    expect(res.status).toBe(401);
    expect(findBatch).not.toHaveBeenCalled();
    expect(markPaid).not.toHaveBeenCalled();
  });

  test('handler-internal throw → 500 so Flutterwave retries', async () => {
    findBatch.mockResolvedValue(pendingBatch);
    markPaid.mockRejectedValueOnce(new Error('db down'));
    const res = await post({
      event: 'transfer.completed',
      data: { id: 12345, reference: 'bimoto-payout-ref-1', status: 'SUCCESSFUL' },
    });
    expect(res.status).toBe(500);
  });
});
