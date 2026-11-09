jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    escrow: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    // SETTLE-UP G3 — the status read joins the escrow's latest
    // CHARGE_FAILED audit entry to name the gateway's reason.
    escrowAuditLog: {
      findFirst: jest.fn(),
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
    chargeMomo: jest.fn(),
  };
});

import express from 'express';
import { encrypt } from '../utils/crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import paymentRoutes from '../routes/payment.routes';
import { generateAccessToken } from '../utils/jwt';
import { chargeMomo } from '../services/payment';
import * as escrowService from '../services/escrow.service';
import { _resetRateLimitForTests } from '../middleware/rate-limit';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/payments', paymentRoutes);

const m = prisma as jest.Mocked<typeof prisma>;
const chargeMock = chargeMomo as jest.Mock;
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
  txRef: 'old-ref',
  createdAt: new Date('2026-05-04T10:00:00.000Z'),
  journeyId: '11111111-2222-3333-4444-555555555555',
  customer: { phoneEncrypted: encrypt('+250788123456') },
};

beforeEach(() => {
  jest.clearAllMocks();
  _resetRateLimitForTests();
  (m.escrow.update as jest.Mock).mockResolvedValue({});
});

describe('GET /api/payments/:escrowId/status', () => {
  test('returns escrow status shape for owning customer', async () => {
    (m.escrow.findUnique as jest.Mock).mockResolvedValue(baseEscrow);
    const res = await request(app)
      .get('/api/payments/e1/status')
      .set('Cookie', [`accessToken=${customerToken}`]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'PENDING',
      txRef: 'old-ref',
      lastUpdatedAt: '2026-05-04T10:00:00.000Z',
      failureReason: null,
    });
    // A healthy escrow never pays for the join.
    expect((m as any).escrowAuditLog.findFirst).not.toHaveBeenCalled();
  });

  // SETTLE-UP G3 — a customer who closed the app on a declined charge and
  // came back used to get the generic "the payment did not go through".
  // The reason was never lost: markEscrowChargeFailed writes it onto the
  // CHARGE_FAILED audit entry, and this read hands it back.
  test('FAILED escrow: names the gateway reason from the latest CHARGE_FAILED entry', async () => {
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...baseEscrow, status: 'FAILED' });
    ((m as any).escrowAuditLog.findFirst as jest.Mock).mockResolvedValue({
      metadata: { reason: 'INSUFFICIENT_FUNDS', disposition: 'release-match' },
    });
    const res = await request(app)
      .get('/api/payments/e1/status')
      .set('Cookie', [`accessToken=${customerToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('FAILED');
    expect(res.body.failureReason).toBe('INSUFFICIENT_FUNDS');
    // The LATEST failure, not the first: a second decline must not be
    // reported with the first attempt's reason.
    const arg = ((m as any).escrowAuditLog.findFirst as jest.Mock).mock.calls[0][0];
    expect(arg.where).toMatchObject({ escrowId: 'e1', action: 'CHARGE_FAILED' });
    expect(arg.orderBy).toEqual({ sequenceNumber: 'desc' });
  });

  test('FAILED escrow with no reason on the entry: null, not a crash', async () => {
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...baseEscrow, status: 'FAILED' });
    ((m as any).escrowAuditLog.findFirst as jest.Mock).mockResolvedValue({ metadata: null });
    const res = await request(app)
      .get('/api/payments/e1/status')
      .set('Cookie', [`accessToken=${customerToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.failureReason).toBeNull();
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/payments/e1/status');
    expect(res.status).toBe(401);
  });

  test('returns 403 to a stranger (not customer/driver/admin)', async () => {
    (m.escrow.findUnique as jest.Mock).mockResolvedValue(baseEscrow);
    const otherToken = generateAccessToken({ userId: 'other', role: 'CUSTOMER' });
    const res = await request(app)
      .get('/api/payments/e1/status')
      .set('Cookie', [`accessToken=${otherToken}`]);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/payments/initiate', () => {
  test('requires auth', async () => {
    const res = await request(app).post('/api/payments/initiate').send({ escrowId: 'e1' });
    expect(res.status).toBe(401);
  });

  test('rejects driver role (customer-only)', async () => {
    const res = await request(app)
      .post('/api/payments/initiate')
      .set('Cookie', [`accessToken=${driverToken}`])
      .send({ escrowId: 'e1' });
    expect(res.status).toBe(403);
  });

  test('refuses to (re-)initiate for HELD escrow', async () => {
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...baseEscrow, status: 'HELD' });
    const res = await request(app)
      .post('/api/payments/initiate')
      .set('Cookie', [`accessToken=${customerToken}`])
      .send({ escrowId: 'e1' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ESCROW_NOT_RETRIABLE');
  });

  test('retries cleanly for FAILED escrow with a fresh txRef', async () => {
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...baseEscrow, status: 'FAILED' });
    chargeMock.mockResolvedValue({ status: 'PENDING', flwTxId: null });
    const res = await request(app)
      .post('/api/payments/initiate')
      .set('Cookie', [`accessToken=${customerToken}`])
      .send({ escrowId: 'e1' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDING');
    const updateArg = (m.escrow.update as jest.Mock).mock.calls[0][0];
    expect(updateArg.data.status).toBe('PENDING');
    expect(updateArg.data.txRef).toMatch(/^bimoto-/);
  });

  test('initiate returns HELD when gateway responds SUCCESS synchronously', async () => {
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...baseEscrow });
    chargeMock.mockResolvedValue({ status: 'SUCCESS', flwTxId: 'flw-7' });
    const res = await request(app)
      .post('/api/payments/initiate')
      .set('Cookie', [`accessToken=${customerToken}`])
      .send({ escrowId: 'e1' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('HELD');
    expect(markSucceeded).toHaveBeenCalledWith('e1', 'flw-7');
  });

  test('initiate marks FAILED on non-retryable gateway error', async () => {
    const { FlutterwaveError } = jest.requireActual('../services/payment');
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...baseEscrow });
    chargeMock.mockRejectedValue(new FlutterwaveError('INSUFFICIENT_FUNDS', { retryable: false }));
    const res = await request(app)
      .post('/api/payments/initiate')
      .set('Cookie', [`accessToken=${customerToken}`])
      .send({ escrowId: 'e1' });
    expect(res.status).toBe(502);
    // PAY-TRUTH G2 — the retry surface's own decline keeps the match:
    // the customer is holding the phone and must stay on this escrow,
    // with this motari, free to try again.
    expect(markFailed).toHaveBeenCalledWith('e1', 'INSUFFICIENT_FUNDS', undefined, 'keep-match');
  });
});
