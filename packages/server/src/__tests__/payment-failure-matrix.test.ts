// PAY-TRUTH G5 — docs/payment-failure-matrix.md, as a test suite.
//
// Every row of the matrix G1 reproduced by hand is a case below, and each
// one asserts the RECOVERY, not just the failure: the customer ends in a
// state they can act on. A test that only proved "the charge fails" would
// be re-proving the bug.
//
// The gateway here is the REAL simulated client under a fault mode, so
// each row runs the production error mapping (errors.ts mapFlwError), the
// production route branches and the production escrow disposition. Only
// prisma and the escrow service are mocked — the seam this suite is about
// is the route's behaviour, and the disposition it asks for.

jest.mock('../config', () => ({
  config: {
    DATABASE_URL: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16-chars',
    ENCRYPTION_KEY: 'a'.repeat(64),
    PORT: 3000,
    CLIENT_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
    PAYMENTS_MODE: 'simulated',
    SMS_MODE: 'live',
    SIMULATED_FAILURE_MODE: 'none',
    FLW_SECRET_KEY: '',
    ALLOW_SIMULATED_IN_PROD: false,
  },
}));

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    escrow: { findUnique: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));

jest.mock('../services/escrow.service', () => ({
  markEscrowChargeSucceeded: jest.fn().mockResolvedValue(undefined),
  markEscrowChargeFailed: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/aml', () => ({
  assertAmlCheck: jest.fn().mockResolvedValue(undefined),
}));

import express from 'express';
import { encrypt } from '../utils/crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import paymentRoutes from '../routes/payment.routes';
import { generateAccessToken } from '../utils/jwt';
import * as escrowService from '../services/escrow.service';
import { resetClientForTests } from '../services/payment/flutterwave-client';
import { setSimulatedFailureMode } from '../services/payment';
import { _resetRateLimitForTests } from '../middleware/rate-limit';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/payments', paymentRoutes);

const m = prisma as jest.Mocked<typeof prisma>;
const markSucceeded = escrowService.markEscrowChargeSucceeded as jest.Mock;
const markFailed = escrowService.markEscrowChargeFailed as jest.Mock;

const customerToken = generateAccessToken({ userId: 'cust-1', role: 'CUSTOMER' });

/** The state a customer is left in by a declined charge, post-G2. */
const failedEscrow = {
  id: 'e1',
  customerId: 'cust-1',
  driverId: 'drv-1',
  amount: 2000,
  status: 'FAILED',
  txRef: 'bimoto-aaaaaaaa-1',
  createdAt: new Date('2026-08-01T10:00:00.000Z'),
  journeyId: '11111111-2222-3333-4444-555555555555',
  customer: { phoneEncrypted: encrypt('+250788123456') },
};

beforeEach(() => {
  jest.clearAllMocks();
  _resetRateLimitForTests();
  resetClientForTests();
  setSimulatedFailureMode('none');
  (m.user.findUnique as jest.Mock).mockResolvedValue({ frozenAt: null });
  (m.escrow.update as jest.Mock).mockResolvedValue({});
});

afterAll(() => setSimulatedFailureMode('none'));

function post(body: Record<string, unknown>, path = '/api/payments/initiate') {
  return request(app).post(path).set('Cookie', [`accessToken=${customerToken}`]).send(body);
}

describe('PAY-TRUTH matrix — a failed charge always leaves a way forward', () => {
  // R1 / R5. Both matrix rows end in the same place: escrow FAILED over a
  // journey that G2 keeps MATCHED. The recovery is what is asserted.
  test('R1 insufficient funds: retry on the FAILED escrow reaches HELD', async () => {
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...failedEscrow });
    const res = await post({ escrowId: 'e1' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('HELD');
    // The SAME escrow row, revived with a FRESH reference — no second row,
    // nothing deleted. Escrow.journeyId is unique; reuse is the only
    // recovery there is.
    expect(markSucceeded).toHaveBeenCalledWith('e1', expect.any(String));
    const update = (m.escrow.update as jest.Mock).mock.calls[0][0];
    expect(update.where).toEqual({ id: 'e1' });
    expect(update.data.status).toBe('PENDING');
    expect(update.data.txRef).not.toBe(failedEscrow.txRef);
    expect(res.body.txRef).toBe(update.data.txRef);
  });

  test('R1 declined again: 502 with the gateway reason, and the match is KEPT', async () => {
    setSimulatedFailureMode('insufficient_funds');
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...failedEscrow });
    const res = await post({ escrowId: 'e1' });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('CHARGE_FAILED');
    // The client needs WHICH failure, not just THAT one happened — this is
    // what the retry panel turns into passenger words.
    expect(res.body.error.detail).toBe('INSUFFICIENT_FUNDS');
    // And the customer keeps the motari: a second decline on the retry
    // surface must leave them exactly where they were.
    expect(markFailed).toHaveBeenCalledWith('e1', 'INSUFFICIENT_FUNDS', undefined, 'keep-match');
  });

  test('R1b invalid wallet is named separately from insufficient funds', async () => {
    setSimulatedFailureMode('invalid_wallet');
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...failedEscrow });
    const res = await post({ escrowId: 'e1' });

    expect(res.status).toBe(502);
    expect(res.body.error.detail).toBe('INVALID_WALLET');
  });

  // R2. A timeout is retryable: the money may still be moving, so nothing
  // is marked failed and the escrow is left PENDING for the reconciler.
  test('R2 gateway timeout: 200 PENDING, nothing marked failed', async () => {
    setSimulatedFailureMode('timeout');
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...failedEscrow });
    const res = await post({ escrowId: 'e1' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.warning).toBe('transient_error');
    expect(markFailed).not.toHaveBeenCalled();
    expect(markSucceeded).not.toHaveBeenCalled();
  });

  // R3. Same shape as R2 — a 5xx is Bimoto's problem to retry, not the
  // customer's money to write off.
  test('R3 gateway 5xx: 200 PENDING, nothing marked failed', async () => {
    setSimulatedFailureMode('gateway_down');
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...failedEscrow });
    const res = await post({ escrowId: 'e1' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.warning).toBe('transient_error');
    expect(markFailed).not.toHaveBeenCalled();
  });

  // R4. The customer force-quit; the charge landed anyway. Re-opening the
  // app must not re-charge them — the settled escrow refuses.
  test('R4 force-quit then reopen: an already-HELD escrow refuses a second charge', async () => {
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...failedEscrow, status: 'HELD' });
    const res = await post({ escrowId: 'e1' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ESCROW_NOT_RETRIABLE');
    expect(m.escrow.update).not.toHaveBeenCalled();
  });

  // R5. Two taps in flight. The second finds the escrow already revived to
  // PENDING and re-uses its reference rather than minting a rival one —
  // one escrow, one txRef, one charge.
  test('R5 double tap: the second attempt re-uses the in-flight txRef', async () => {
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...failedEscrow, status: 'PENDING' });
    const res = await post({ escrowId: 'e1' });

    expect(res.status).toBe(200);
    expect(res.body.txRef).toBe(failedEscrow.txRef);
    const update = (m.escrow.update as jest.Mock).mock.calls[0][0];
    expect(update.data).toEqual({ lastChargeAttemptAt: expect.any(Date) });
  });

  // R7 / R8 — the guard this dispatch may not weaken, on BOTH rails.
  test.each([
    ['RELEASED'],
    ['REFUNDED'],
    ['FROZEN'],
    ['HELD'],
  ])('a %s escrow is never rechargeable on either rail', async (status) => {
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...failedEscrow, status });

    const momo = await post({ escrowId: 'e1' });
    expect(momo.status).toBe(409);
    expect(momo.body.error.code).toBe('ESCROW_NOT_RETRIABLE');

    const card = await post({ escrowId: 'e1', flwTxId: 'x' }, '/api/payments/initiate-card');
    expect(card.status).toBe(409);
    expect(card.body.error.code).toBe('ESCROW_NOT_RETRIABLE');

    expect(m.escrow.update).not.toHaveBeenCalled();
  });
});

describe('PAY-TRUTH — switching method after a MoMo failure', () => {
  test('the card rail revives the SAME escrow and keeps its txRef', async () => {
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...failedEscrow });
    const res = await post({ escrowId: 'e1', flwTxId: 'card-tx-1' }, '/api/payments/initiate-card');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('HELD');
    // The widget charged against the escrow's CURRENT reference, so the
    // card rail must verify against that same one — regenerating it here
    // would leave nothing to verify. This is why the two rails cannot
    // fight over one escrow.
    expect(res.body.txRef).toBe(failedEscrow.txRef);
    const update = (m.escrow.update as jest.Mock).mock.calls[0][0];
    expect(update.data.status).toBe('PENDING');
    expect(update.data.txRef).toBeUndefined();
    expect(markSucceeded).toHaveBeenCalledWith('e1', 'card-tx-1');
  });

  test('a declined card leaves the match, exactly as MoMo does', async () => {
    setSimulatedFailureMode('declined');
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...failedEscrow });
    const res = await post({ escrowId: 'e1', flwTxId: 'card-tx-1' }, '/api/payments/initiate-card');

    expect(res.status).toBe(502);
    expect(res.body.error.detail).toBe('VERIFICATION_FAILED');
    expect(markFailed).toHaveBeenCalledWith('e1', 'VERIFICATION_FAILED', undefined, 'keep-match');
  });
});
