jest.mock('../services/escrow.service', () => ({
  markEscrowChargeSucceeded: jest.fn().mockResolvedValue(undefined),
  markEscrowChargeFailed: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import webhookRoutes from '../routes/webhook.routes';
import * as escrowService from '../services/escrow.service';
import * as Sentry from '@sentry/node';

const app = express();
app.use(express.json());
app.use('/api/webhooks', webhookRoutes);

const markSucceeded = escrowService.markEscrowChargeSucceeded as jest.Mock;
const markFailed = escrowService.markEscrowChargeFailed as jest.Mock;
const captureMessage = (Sentry as any).captureMessage as jest.Mock;
const captureException = (Sentry as any).captureException as jest.Mock;

const SECRET_HASH = 'a'.repeat(64); // 64-byte hex-like secret

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FLW_SECRET_HASH = SECRET_HASH;
});

afterAll(() => {
  delete process.env.FLW_SECRET_HASH;
});

describe('Flutterwave webhook signature: constant-time comparison', () => {
  test('valid signature (length-matched, value-matched) → 200', async () => {
    const res = await request(app)
      .post('/api/webhooks/flutterwave')
      .set('verif-hash', SECRET_HASH)
      .send({
        event: 'charge.completed',
        data: { status: 'successful', id: 'flw-1', meta: { escrowId: 'e-1' } },
      });
    expect(res.status).toBe(200);
    expect(markSucceeded).toHaveBeenCalledWith('e-1', 'flw-1');
  });

  test('invalid signature (length-matched, value-mismatched) → 401', async () => {
    const res = await request(app)
      .post('/api/webhooks/flutterwave')
      .set('verif-hash', 'b'.repeat(64))
      .send({ event: 'charge.completed', data: { status: 'successful', meta: { escrowId: 'e-1' } } });
    expect(res.status).toBe(401);
    expect(markSucceeded).not.toHaveBeenCalled();
  });

  test('SMALLEST WRONGNESS: length-mismatched signature returns 401, NOT RangeError', async () => {
    // Naïvely calling crypto.timingSafeEqual on different-length buffers
    // throws RangeError. Verify the length-equality guard prevents that.
    const res = await request(app)
      .post('/api/webhooks/flutterwave')
      .set('verif-hash', 'short')
      .send({ event: 'charge.completed', data: { status: 'successful', meta: { escrowId: 'e-1' } } });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid signature');
    expect(markSucceeded).not.toHaveBeenCalled();
  });

  test('a much longer wrong signature also returns 401, not RangeError', async () => {
    const res = await request(app)
      .post('/api/webhooks/flutterwave')
      .set('verif-hash', 'x'.repeat(256))
      .send({ event: 'charge.completed', data: { status: 'successful', meta: { escrowId: 'e-1' } } });
    expect(res.status).toBe(401);
  });

  test('empty signature → 401 (length 0 ≠ secret length)', async () => {
    const res = await request(app)
      .post('/api/webhooks/flutterwave')
      .set('verif-hash', '')
      .send({ event: 'charge.completed', data: { status: 'successful', meta: { escrowId: 'e-1' } } });
    expect(res.status).toBe(401);
  });

  test('missing signature header → 401', async () => {
    const res = await request(app)
      .post('/api/webhooks/flutterwave')
      .send({ event: 'charge.completed', data: { status: 'successful', meta: { escrowId: 'e-1' } } });
    expect(res.status).toBe(401);
  });

  test('missing FLW_SECRET_HASH env var → 500 with Sentry warning', async () => {
    delete process.env.FLW_SECRET_HASH;
    const res = await request(app)
      .post('/api/webhooks/flutterwave')
      .set('verif-hash', SECRET_HASH)
      .send({ event: 'charge.completed', data: { status: 'successful', meta: { escrowId: 'e-1' } } });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Webhook misconfigured');
    expect(captureMessage).toHaveBeenCalledWith(
      'FLW_SECRET_HASH not configured',
      'warning',
    );
    process.env.FLW_SECRET_HASH = SECRET_HASH;
  });

  test('handler-internal throw → 500 with Sentry capture (idempotent retry)', async () => {
    markSucceeded.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app)
      .post('/api/webhooks/flutterwave')
      .set('verif-hash', SECRET_HASH)
      .send({
        event: 'charge.completed',
        data: { status: 'successful', id: 'flw-2', meta: { escrowId: 'e-2' } },
      });
    expect(res.status).toBe(500);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1]).toEqual({
      tags: { route: 'flutterwave-webhook' },
    });
  });
});
