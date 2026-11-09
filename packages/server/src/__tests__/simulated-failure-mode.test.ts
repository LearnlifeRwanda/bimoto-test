// PAY-TRUTH G5 — the simulated gateway fails the way a real one does.
//
// The whole value of SIMULATED_FAILURE_MODE rests on one claim: that its
// faults are shaped closely enough to Flutterwave's that errors.ts
// mapFlwError classifies them through its REAL branches, with the real
// retryable flags. If that claim ever stops holding, the simulated
// failures stop being a rehearsal and become a separate fiction — and
// Kigali would again be testing something the live path does not do.
//
// So these assert the mapping end to end, through the real chargeMomo and
// verifyTransaction rather than against the fake's internals.

jest.mock('../config', () => ({
  config: {
    PAYMENTS_MODE: 'simulated',
    SIMULATED_FAILURE_MODE: 'none',
    FLW_SECRET_KEY: '',
  },
}));

jest.mock('../services/aml', () => ({
  assertAmlCheck: jest.fn().mockResolvedValue(undefined),
}));

import {
  chargeMomo,
  verifyTransaction,
  FlutterwaveError,
  setSimulatedFailureMode,
  type SimulatedFailureMode,
} from '../services/payment';
import { resetClientForTests } from '../services/payment/flutterwave-client';

beforeEach(() => {
  resetClientForTests();
  setSimulatedFailureMode('none');
});

afterAll(() => setSimulatedFailureMode('none'));

const charge = () =>
  chargeMomo({
    phone: '+250788123456',
    amount: 2000,
    txRef: 'bimoto-test-1',
    narration: 'test',
  });

describe('SIMULATED_FAILURE_MODE maps through the real error taxonomy', () => {
  test.each<[SimulatedFailureMode, string, boolean]>([
    // mode, expected FlwErrorCode, expected retryable
    ['insufficient_funds', 'INSUFFICIENT_FUNDS', false],
    ['invalid_wallet', 'INVALID_WALLET', false],
    ['declined', 'VALIDATION_ERROR', false],
    ['timeout', 'TIMEOUT', true],
    ['gateway_down', 'GATEWAY_DOWN', true],
  ])('%s → %s (retryable: %s)', async (mode, code, retryable) => {
    setSimulatedFailureMode(mode);
    await expect(charge()).rejects.toMatchObject({ code, retryable });
    await expect(charge()).rejects.toBeInstanceOf(FlutterwaveError);
  });

  test("'none' keeps the pre-existing always-succeeds behaviour", async () => {
    const res = await charge();
    expect(res.status).toBe('SUCCESS');
    expect(res.flwTxId).toEqual(expect.stringContaining('sim-'));
  });

  test('the retryable split is what decides whether a customer is told they failed', async () => {
    // Non-retryable faults are the ones that reach markEscrowChargeFailed
    // and put the retry panel on screen; retryable ones leave the escrow
    // PENDING for the reconciler and say nothing. Getting this backwards
    // would either hide a real decline or declare a live charge dead.
    setSimulatedFailureMode('insufficient_funds');
    await expect(charge()).rejects.toMatchObject({ retryable: false });
    setSimulatedFailureMode('gateway_down');
    await expect(charge()).rejects.toMatchObject({ retryable: true });
  });
});

describe('the card rail fails at its own seam (verify, not charge)', () => {
  test("'declined' makes verify report a FAILED transaction", async () => {
    setSimulatedFailureMode('declined');
    const res = await verifyTransaction('bimoto-test-1');
    expect(res.status).toBe('FAILED');
  });

  test('transport faults still throw out of verify', async () => {
    setSimulatedFailureMode('timeout');
    await expect(verifyTransaction('bimoto-test-1')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  test("'none' verifies successfully, with no id or amount to trip the anti-tamper guards", async () => {
    const res = await verifyTransaction('bimoto-test-1');
    expect(res.status).toBe('SUCCESS');
    expect(res.flwTxId).toBeUndefined();
    expect(res.amount).toBeUndefined();
  });
});
