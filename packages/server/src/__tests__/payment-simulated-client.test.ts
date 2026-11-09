// PREPROTO-SIM G2 — the simulated FlwClient must satisfy EVERY getClient()
// consumer, not just the charge path: chargeMomo, chargeCard (verify),
// refundMomo, transferToWallet, fetchTransferStatus, and the
// reconciliation gateway query all run here against the real service code
// with only the gateway response faked.

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

// The real SDK must never be constructed in simulated mode.
jest.mock('flutterwave-node-v3', () =>
  jest.fn(() => {
    throw new Error('flutterwave-node-v3 must not be constructed in simulated mode');
  }),
);

import { getClient, resetClientForTests } from '../services/payment/flutterwave-client';
import { chargeMomo, chargeCard } from '../services/payment/charge';
import { verifyTransaction } from '../services/payment/verify';
import { refundMomo } from '../services/payment/refund';
import { transferToWallet, fetchTransferStatus } from '../services/payment/transfer';
import { queryFlutterwaveTransactions } from '../jobs/reconciliation/gateway-query';

// No type declarations ship for the SDK (production code require()s it
// lazily for the same reason) — pull the mock in the same untyped way.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Flutterwave = require('flutterwave-node-v3');

describe('simulated payment client (PAYMENTS_MODE=simulated)', () => {
  beforeEach(() => {
    resetClientForTests();
    (Flutterwave as unknown as jest.Mock).mockClear();
  });

  test('getClient returns the simulated client without touching keys or the SDK', () => {
    process.env.FLW_PUBLIC_KEY = 'should-be-ignored';
    process.env.FLW_SECRET_KEY = 'should-be-ignored';
    try {
      const client = getClient();
      expect(typeof client.MobileMoney.rwanda).toBe('function');
      expect(Flutterwave).not.toHaveBeenCalled();
      // Cached: same instance on the second call.
      expect(getClient()).toBe(client);
    } finally {
      delete process.env.FLW_PUBLIC_KEY;
      delete process.env.FLW_SECRET_KEY;
    }
  });

  test('chargeMomo yields SUCCESS with a sim- transaction id', async () => {
    const r = await chargeMomo({
      phone: '+250788123456',
      amount: 2000,
      txRef: 'bimoto-sim-1',
      narration: 'Bimoto ride',
    });
    expect(r.status).toBe('SUCCESS');
    expect(r.flwTxId).toMatch(/^sim-/);
    expect(r.walletNameOnReceipt).toBe('Simulated Wallet');
  });

  test('verifyTransaction yields SUCCESS without a synthetic id or amount', async () => {
    const r = await verifyTransaction('bimoto-sim-2');
    expect(r.status).toBe('SUCCESS');
    // Absent by design — chargeCard compares these against client-supplied
    // values when present, and synthetic ones would trip the tamper checks.
    expect(r.flwTxId).toBeUndefined();
    expect(r.amount).toBeUndefined();
  });

  test('chargeCard passes the anti-tamper checks and preserves the client tx id', async () => {
    const r = await chargeCard({
      flwTxId: 'client-widget-id-1',
      txRef: 'bimoto-sim-3',
      amount: 3500,
    });
    expect(r.status).toBe('SUCCESS');
    expect(r.flwTxId).toBe('client-widget-id-1');
  });

  test('refundMomo yields SUCCESS with a sim- refund id', async () => {
    const r = await refundMomo({ flwTxId: 'sim-original', amount: 1500 });
    expect(r.status).toBe('SUCCESS');
    expect(r.flwRefundTxId).toMatch(/^sim-/);
  });

  test('transferToWallet yields SUCCESS with a sim- transfer id', async () => {
    const r = await transferToWallet({
      phone: '+250789876543',
      amount: 1425,
      narration: 'Bimoto payout',
      reference: 'payout-sim-1',
    });
    expect(r.status).toBe('SUCCESS');
    expect(r.flwTransferId).toMatch(/^sim-/);
  });

  test('fetchTransferStatus yields SUCCESS for any sim transfer', async () => {
    const r = await fetchTransferStatus('sim-transfer-1');
    expect(r.status).toBe('SUCCESS');
  });

  test('reconciliation gateway query returns an empty, well-formed page', async () => {
    const rows = await queryFlutterwaveTransactions({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-02T00:00:00Z'),
    });
    expect(rows).toEqual([]);
  });
});
