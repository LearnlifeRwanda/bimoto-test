jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    escrow: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../services/escrow.service', () => ({
  markEscrowChargeSucceeded: jest.fn().mockResolvedValue(undefined),
  markEscrowChargeFailed: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/payment', () => {
  const actual = jest.requireActual('../services/payment');
  return {
    ...actual,
    chargeCard: jest.fn(),
  };
});

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import paymentRoutes from '../routes/payment.routes';
import { generateAccessToken } from '../utils/jwt';
import { chargeCard } from '../services/payment';
import * as escrowService from '../services/escrow.service';
import { _resetRateLimitForTests } from '../middleware/rate-limit';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/payments', paymentRoutes);

const m = prisma as jest.Mocked<typeof prisma>;
const chargeCardMock = chargeCard as jest.Mock;
const markSucceeded = escrowService.markEscrowChargeSucceeded as jest.Mock;
const markFailed = escrowService.markEscrowChargeFailed as jest.Mock;

const customerToken = generateAccessToken({ userId: 'cust-1', role: 'CUSTOMER' });
const driverToken = generateAccessToken({ userId: 'drv-1', role: 'DRIVER' });

const baseEscrow = {
  id: 'e1',
  customerId: 'cust-1',
  driverId: 'drv-1',
  amount: 2000,
  status: 'PENDING',
  txRef: 'card-ref-1',
  createdAt: new Date('2026-05-04T10:00:00.000Z'),
  journeyId: '11111111-2222-3333-4444-555555555555',
  customer: { phone: '+250788123456' },
};

beforeEach(() => {
  jest.clearAllMocks();
  _resetRateLimitForTests();
  (m.escrow.update as jest.Mock).mockResolvedValue({});
});

describe('POST /api/payments/initiate-card', () => {
  test('requires auth', async () => {
    const res = await request(app)
      .post('/api/payments/initiate-card')
      .send({ escrowId: 'e1', flwTxId: 'flw-1' });
    expect(res.status).toBe(401);
  });

  test('rejects driver role (customer-only)', async () => {
    const res = await request(app)
      .post('/api/payments/initiate-card')
      .set('Cookie', [`accessToken=${driverToken}`])
      .send({ escrowId: 'e1', flwTxId: 'flw-1' });
    expect(res.status).toBe(403);
  });

  test('400 when flwTxId is missing', async () => {
    const res = await request(app)
      .post('/api/payments/initiate-card')
      .set('Cookie', [`accessToken=${customerToken}`])
      .send({ escrowId: 'e1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BODY');
  });

  test('happy path: PENDING escrow + valid flwTxId returns HELD', async () => {
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...baseEscrow });
    chargeCardMock.mockResolvedValue({ status: 'SUCCESS', flwTxId: 'flw-7' });
    const res = await request(app)
      .post('/api/payments/initiate-card')
      .set('Cookie', [`accessToken=${customerToken}`])
      .send({ escrowId: 'e1', flwTxId: 'flw-7' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'HELD', txRef: 'card-ref-1' });
    expect(markSucceeded).toHaveBeenCalledWith('e1', 'flw-7');
    // Verified against the escrow's existing txRef, not a regenerated one.
    expect(chargeCardMock).toHaveBeenCalledWith(
      expect.objectContaining({ flwTxId: 'flw-7', txRef: 'card-ref-1', amount: 2000 }),
    );
  });

  test('PENDING gateway response returns PENDING', async () => {
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...baseEscrow });
    chargeCardMock.mockResolvedValue({ status: 'PENDING', flwTxId: 'flw-8' });
    const res = await request(app)
      .post('/api/payments/initiate-card')
      .set('Cookie', [`accessToken=${customerToken}`])
      .send({ escrowId: 'e1', flwTxId: 'flw-8' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'PENDING', txRef: 'card-ref-1' });
    expect(markSucceeded).not.toHaveBeenCalled();
  });

  test('403 for a different user\'s escrow', async () => {
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...baseEscrow, customerId: 'someone-else' });
    const res = await request(app)
      .post('/api/payments/initiate-card')
      .set('Cookie', [`accessToken=${customerToken}`])
      .send({ escrowId: 'e1', flwTxId: 'flw-1' });
    expect(res.status).toBe(403);
  });

  test('409 for a HELD (non-retriable) escrow', async () => {
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...baseEscrow, status: 'HELD' });
    const res = await request(app)
      .post('/api/payments/initiate-card')
      .set('Cookie', [`accessToken=${customerToken}`])
      .send({ escrowId: 'e1', flwTxId: 'flw-1' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ESCROW_NOT_RETRIABLE');
  });

  test('502 and marks FAILED on non-retryable verification failure', async () => {
    const { FlutterwaveError } = jest.requireActual('../services/payment');
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...baseEscrow });
    chargeCardMock.mockRejectedValue(
      new FlutterwaveError('VERIFICATION_FAILED', { retryable: false }),
    );
    const res = await request(app)
      .post('/api/payments/initiate-card')
      .set('Cookie', [`accessToken=${customerToken}`])
      .send({ escrowId: 'e1', flwTxId: 'flw-forged' });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('CHARGE_FAILED');
    // PAY-TRUTH G2 — the retry surface's own decline keeps the match:
    // the customer is holding the phone and must stay on this escrow,
    // with this motari, free to try again.
    expect(markFailed).toHaveBeenCalledWith('e1', 'VERIFICATION_FAILED', undefined, 'keep-match');
  });

  test('NO_KEYS_CONFIGURED returns PENDING with no_gateway_keys warning', async () => {
    const { FlutterwaveError } = jest.requireActual('../services/payment');
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...baseEscrow });
    chargeCardMock.mockRejectedValue(
      new FlutterwaveError('NO_KEYS_CONFIGURED', { retryable: false }),
    );
    const res = await request(app)
      .post('/api/payments/initiate-card')
      .set('Cookie', [`accessToken=${customerToken}`])
      .send({ escrowId: 'e1', flwTxId: 'flw-1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'PENDING', txRef: 'card-ref-1', warning: 'no_gateway_keys' });
    expect(markFailed).not.toHaveBeenCalled();
  });
});
