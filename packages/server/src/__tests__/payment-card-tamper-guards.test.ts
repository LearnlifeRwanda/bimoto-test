// SETTLE-UP G5 — the anti-tamper guards fire, and the escrow proves it.
//
// charge.ts:187 and :195 defend real money against a customer who edits
// the widget's amount in dev tools or forges the transaction id the
// widget handed back. payment-charge-card.test.ts already proves each
// guard THROWS. What nothing proved is the thing that matters: that a
// tampered charge leaves the escrow NOT HELD. The route test that owns
// the escrow outcome mocks chargeCard away, so guard and consequence had
// never met in one test.
//
// This file joins them. chargeCard runs for real, escrow.service and
// escrow-audit.service run for real against a stateful prisma mock, and
// the ONLY fake is verifyTransaction — the gateway seam, the same seam
// the simulated client fakes. That is deliberate: simulated-client.ts
// omits data.id/amount ON PURPOSE (its own comment at :117-122 says so),
// because synthesising gateway values there would trip these very guards
// for a transaction that never crossed a gateway. So the simulated
// client stays exactly as it is, and the crafted verify results live
// here, where a forged transaction is the point.

jest.mock('../prisma', () => {
  const state = { escrows: new Map<string, any>(), auditRows: [] as any[] };
  const byId = (id: string) => state.escrows.get(id) ?? null;
  const db: any = {
    __state: state,
    $transaction: (fn: (tx: any) => Promise<any>) => fn(db),
    $executeRawUnsafe: jest.fn(async () => 0),
    escrow: {
      findUnique: jest.fn(async ({ where }: any) => {
        const row = byId(where.id);
        return row ? { ...row, customer: { phone: '+250788123456' } } : null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = byId(where.id);
        Object.assign(row, data);
        return { ...row };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = byId(where.id);
        if (!row) return { count: 0 };
        if (where.status !== undefined && row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    escrowAuditLog: {
      findFirst: jest.fn(async ({ where }: any) => {
        const rows = state.auditRows
          .filter((r: any) => r.escrowId === where.escrowId)
          .filter((r: any) => (where.action ? r.action === where.action : true))
          .sort((a: any, b: any) => a.sequenceNumber - b.sequenceNumber);
        return rows.length ? { ...rows[rows.length - 1] } : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        state.auditRows.push({ ...data });
        return { ...data };
      }),
    },
  };
  return { __esModule: true, default: db };
});

// AML is exercised by its own suites; here it must not reach prisma.
jest.mock('../services/aml', () => ({
  __esModule: true,
  assertAmlCheck: jest.fn().mockResolvedValue(undefined),
  AmlError: class AmlError extends Error {},
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import paymentRoutes from '../routes/payment.routes';
import { generateAccessToken } from '../utils/jwt';
import * as verifyModule from '../services/payment/verify';
import type { VerifyResult } from '../services/payment/verify';
import { _resetRateLimitForTests } from '../middleware/rate-limit';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/payments', paymentRoutes);

const state = (prisma as any).__state;
const customerToken = generateAccessToken({ userId: 'cust-1', role: 'CUSTOMER' });

const REAL_TX_ID = 'flw-real-1';
const ESCROW_ID = 'e1';

function seedPendingEscrow() {
  state.escrows.set(ESCROW_ID, {
    id: ESCROW_ID,
    customerId: 'cust-1',
    driverId: 'drv-1',
    journeyId: '11111111-2222-3333-4444-555555555555',
    amount: 2000,
    status: 'PENDING',
    txRef: 'card-ref-1',
    createdAt: new Date('2026-05-04T10:00:00.000Z'),
  });
}

// What the gateway says when asked about this txRef.
const gatewaySays = (result: Partial<VerifyResult>) =>
  jest
    .spyOn(verifyModule, 'verifyTransaction')
    .mockResolvedValue(result as VerifyResult);

const postCard = (flwTxId: string) =>
  request(app)
    .post('/api/payments/initiate-card')
    .set('Cookie', [`accessToken=${customerToken}`])
    .send({ escrowId: ESCROW_ID, flwTxId });

const chainActions = () =>
  state.auditRows
    .filter((r: any) => r.escrowId === ESCROW_ID)
    .map((r: any) => r.action);

beforeEach(() => {
  jest.restoreAllMocks();
  _resetRateLimitForTests();
  state.escrows.clear();
  state.auditRows.length = 0;
  seedPendingEscrow();
});

describe('card anti-tamper guards, end to end with the escrow outcome', () => {
  // The control. Without it the two failures below would prove only that
  // something is broken, not that the guards are what broke it.
  test('untampered: gateway agrees on amount and id → escrow HELD', async () => {
    gatewaySays({ status: 'SUCCESS', amount: 2000, flwTxId: REAL_TX_ID });

    const res = await postCard(REAL_TX_ID);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('HELD');
    expect(state.escrows.get(ESCROW_ID).status).toBe('HELD');
    expect(state.escrows.get(ESCROW_ID).flwTxId).toBe(REAL_TX_ID);
    expect(chainActions()).toContain('CHARGE_CONFIRMED');
  });

  test('amount tampered in the widget: AMOUNT_MISMATCH, and the money is NOT held', async () => {
    // The customer paid 500 but the escrow is for 2000: charge.ts:187.
    gatewaySays({ status: 'SUCCESS', amount: 500, flwTxId: REAL_TX_ID });

    const res = await postCard(REAL_TX_ID);

    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({
      code: 'CHARGE_FAILED',
      detail: 'AMOUNT_MISMATCH',
    });

    const escrow = state.escrows.get(ESCROW_ID);
    expect(escrow.status).not.toBe('HELD');
    expect(escrow.status).toBe('FAILED');
    expect(escrow.flwTxId).toBeUndefined();
    // The refusal is on the chain with its reason, and the customer keeps
    // their motari (this IS the retry surface — PAY-TRUTH G2 keep-match).
    expect(chainActions()).toEqual(['CHARGE_FAILED']);
    const entry = state.auditRows.find((r: any) => r.action === 'CHARGE_FAILED');
    expect(entry.metadata).toMatchObject({
      reason: 'AMOUNT_MISMATCH',
      disposition: 'keep-match',
    });
  });

  test('transaction id forged: TXID_MISMATCH, and the money is NOT held', async () => {
    // The gateway's id for this txRef is not the id the client claims:
    // charge.ts:195.
    gatewaySays({ status: 'SUCCESS', amount: 2000, flwTxId: REAL_TX_ID });

    const res = await postCard('flw-forged-by-client');

    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({
      code: 'CHARGE_FAILED',
      detail: 'TXID_MISMATCH',
    });

    const escrow = state.escrows.get(ESCROW_ID);
    expect(escrow.status).not.toBe('HELD');
    expect(escrow.status).toBe('FAILED');
    expect(chainActions()).toEqual(['CHARGE_FAILED']);
    expect(
      state.auditRows.find((r: any) => r.action === 'CHARGE_FAILED').metadata,
    ).toMatchObject({ reason: 'TXID_MISMATCH', disposition: 'keep-match' });
  });

  // SETTLE-UP G3 pairs with the above: the reason a guard refused for is
  // exactly what a returning customer now reads.
  test('the refused reason is what the status read hands back after a reload', async () => {
    gatewaySays({ status: 'SUCCESS', amount: 500, flwTxId: REAL_TX_ID });
    await postCard(REAL_TX_ID);

    const status = await request(app)
      .get(`/api/payments/${ESCROW_ID}/status`)
      .set('Cookie', [`accessToken=${customerToken}`]);

    expect(status.status).toBe(200);
    expect(status.body.status).toBe('FAILED');
    expect(status.body.failureReason).toBe('AMOUNT_MISMATCH');
  });

  // The guards only run on a SUCCESS verdict; a gateway that says the
  // transaction failed is refused earlier and must not read as tampering.
  test('a genuinely failed gateway verdict is VERIFICATION_FAILED, not a guard trip', async () => {
    gatewaySays({ status: 'FAILED', amount: 2000, flwTxId: REAL_TX_ID });

    const res = await postCard(REAL_TX_ID);

    expect(res.body.error.detail).toBe('VERIFICATION_FAILED');
    expect(state.escrows.get(ESCROW_ID).status).toBe('FAILED');
  });
});
