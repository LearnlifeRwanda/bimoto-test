// PREPROTO-SIM G2 — integration: POST /api/payments/initiate under
// PAYMENTS_MODE=simulated drives the escrow HELD synchronously through the
// REAL chargeMomo (only the gateway client is the simulated one). This is
// the §1 smallest-wrongness net: if the simulated charge shape ever stops
// satisfying `charge.status==='SUCCESS' && charge.flwTxId`, this fails.

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
    FLW_SECRET_KEY: '',
    ALLOW_SIMULATED_IN_PROD: false,
  },
}));

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    escrow: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ frozenAt: null }),
    },
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
import { _resetRateLimitForTests } from '../middleware/rate-limit';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/payments', paymentRoutes);

const m = prisma as jest.Mocked<typeof prisma>;
const markSucceeded = escrowService.markEscrowChargeSucceeded as jest.Mock;

const customerToken = generateAccessToken({ userId: 'cust-1', role: 'CUSTOMER' });

const baseEscrow = {
  id: 'e1',
  customerId: 'cust-1',
  driverId: 'drv-1',
  amount: 2000,
  status: 'PENDING',
  txRef: 'bimoto-sim-ref',
  createdAt: new Date('2026-07-16T10:00:00.000Z'),
  journeyId: '11111111-2222-3333-4444-555555555555',
  customer: { phoneEncrypted: encrypt('+250788123456') },
};

beforeEach(() => {
  jest.clearAllMocks();
  _resetRateLimitForTests();
  resetClientForTests();
  (m.user.findUnique as jest.Mock).mockResolvedValue({ frozenAt: null });
  (m.escrow.update as jest.Mock).mockResolvedValue({});
});

describe('POST /api/payments/initiate under PAYMENTS_MODE=simulated', () => {
  test('returns HELD synchronously and flips the escrow via a sim- tx id', async () => {
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...baseEscrow });
    const res = await request(app)
      .post('/api/payments/initiate')
      .set('Cookie', [`accessToken=${customerToken}`])
      .send({ escrowId: 'e1' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('HELD');
    expect(markSucceeded).toHaveBeenCalledWith('e1', expect.stringMatching(/^sim-/));
  });

  test('FAILED escrow retries straight to HELD with a fresh txRef', async () => {
    (m.escrow.findUnique as jest.Mock).mockResolvedValue({ ...baseEscrow, status: 'FAILED' });
    const res = await request(app)
      .post('/api/payments/initiate')
      .set('Cookie', [`accessToken=${customerToken}`])
      .send({ escrowId: 'e1' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('HELD');
    expect(res.body.txRef).toMatch(/^bimoto-/);
  });
});
