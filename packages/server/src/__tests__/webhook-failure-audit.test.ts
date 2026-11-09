jest.mock('../services/escrow.service', () => ({
  markEscrowChargeSucceeded: jest.fn().mockResolvedValue(undefined),
  markEscrowChargeFailed: jest.fn().mockResolvedValue(undefined),
}));

import express from 'express';
import request from 'supertest';
import webhookRoutes from '../routes/webhook.routes';
import * as escrowService from '../services/escrow.service';

const app = express();
app.use(express.json());
app.use('/api/webhooks', webhookRoutes);

const markFailed = escrowService.markEscrowChargeFailed as jest.Mock;
const markSucceeded = escrowService.markEscrowChargeSucceeded as jest.Mock;

const SECRET_HASH = 'webhook-secret-hash';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FLW_SECRET_HASH = SECRET_HASH;
});

afterAll(() => {
  delete process.env.FLW_SECRET_HASH;
});

describe('POST /api/webhooks/flutterwave', () => {
  test('failed-charge webhook calls markEscrowChargeFailed (NOT escrow.delete)', async () => {
    const res = await request(app)
      .post('/api/webhooks/flutterwave')
      .set('verif-hash', SECRET_HASH)
      .send({
        event: 'charge.completed',
        data: { status: 'failed', id: 'flw-7', meta: { escrowId: 'e-1' } },
      });
    expect(res.status).toBe(200);
    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markFailed.mock.calls[0][0]).toBe('e-1');
    expect(markFailed.mock.calls[0][1]).toBe('WEBHOOK_REPORTED_FAILURE');
  });

  test('failed-charge webhook passes full payload as metadata', async () => {
    const payload = { status: 'failed', id: 'flw-7', amount: 2000, meta: { escrowId: 'e-1' } };
    await request(app)
      .post('/api/webhooks/flutterwave')
      .set('verif-hash', SECRET_HASH)
      .send({ event: 'charge.completed', data: payload });
    const metadataArg = markFailed.mock.calls[0][2];
    expect(metadataArg.webhookPayload).toEqual(payload);
    expect(metadataArg).toHaveProperty('ipAddress');
  });

  test('signature still validated — invalid signature → 401, no service call', async () => {
    const res = await request(app)
      .post('/api/webhooks/flutterwave')
      .set('verif-hash', 'wrong-hash')
      .send({
        event: 'charge.completed',
        data: { status: 'failed', meta: { escrowId: 'e-1' } },
      });
    expect(res.status).toBe(401);
    expect(markFailed).not.toHaveBeenCalled();
  });

  test('successful-charge webhook calls markEscrowChargeSucceeded', async () => {
    const res = await request(app)
      .post('/api/webhooks/flutterwave')
      .set('verif-hash', SECRET_HASH)
      .send({
        event: 'charge.completed',
        data: { status: 'successful', id: 'flw-9', meta: { escrowId: 'e-2' } },
      });
    expect(res.status).toBe(200);
    expect(markSucceeded).toHaveBeenCalledWith('e-2', 'flw-9');
    expect(markFailed).not.toHaveBeenCalled();
  });

  test('webhook with no escrowId in meta is a noop (no service call)', async () => {
    const res = await request(app)
      .post('/api/webhooks/flutterwave')
      .set('verif-hash', SECRET_HASH)
      .send({ event: 'charge.completed', data: { status: 'failed', meta: {} } });
    expect(res.status).toBe(200);
    expect(markFailed).not.toHaveBeenCalled();
    expect(markSucceeded).not.toHaveBeenCalled();
  });
});
