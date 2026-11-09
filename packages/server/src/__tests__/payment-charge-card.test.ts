import { FlutterwaveError, resetClientForTests } from '../services/payment';
import { chargeCard } from '../services/payment/charge';
import * as verifyModule from '../services/payment/verify';
import * as amlModule from '../services/aml';
import { AmlError } from '../services/aml';

describe('chargeCard', () => {
  beforeEach(() => {
    resetClientForTests();
    jest.restoreAllMocks();
    // AML is a no-op by default; individual tests override it where relevant.
    jest.spyOn(amlModule, 'assertAmlCheck').mockResolvedValue(undefined);
  });

  const mockVerify = (result: Partial<verifyModule.VerifyResult>) =>
    jest
      .spyOn(verifyModule, 'verifyTransaction')
      .mockResolvedValue(result as verifyModule.VerifyResult);

  test('successful verification returns SUCCESS with card details', async () => {
    const spy = mockVerify({
      status: 'SUCCESS',
      amount: 2000,
      flwTxId: 'flw-100',
      cardBrand: 'VISA',
      cardLast4: '4242',
    });
    const r = await chargeCard({
      flwTxId: 'flw-100',
      txRef: 'ref-1',
      amount: 2000,
      customerId: 'c1',
      escrowId: 'e1',
    });
    expect(spy).toHaveBeenCalledWith('ref-1');
    expect(r).toEqual({
      flwTxId: 'flw-100',
      status: 'SUCCESS',
      cardBrand: 'VISA',
      cardLast4: '4242',
    });
  });

  test('pending verification returns PENDING', async () => {
    mockVerify({ status: 'PENDING', amount: 2000, flwTxId: 'flw-101' });
    const r = await chargeCard({ flwTxId: 'flw-101', txRef: 'ref-2', amount: 2000 });
    expect(r.status).toBe('PENDING');
    expect(r.flwTxId).toBe('flw-101');
  });

  test('failed verification throws VERIFICATION_FAILED (never returns SUCCESS)', async () => {
    mockVerify({ status: 'FAILED', amount: 2000, flwTxId: 'flw-102' });
    await expect(
      chargeCard({ flwTxId: 'flw-102', txRef: 'ref-3', amount: 2000 }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_FAILED', retryable: false });
  });

  test('amount mismatch throws AMOUNT_MISMATCH (client-side amount tampering)', async () => {
    mockVerify({ status: 'SUCCESS', amount: 5000, flwTxId: 'flw-103' });
    await expect(
      chargeCard({ flwTxId: 'flw-103', txRef: 'ref-4', amount: 2000 }),
    ).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH', retryable: false });
  });

  // The dispatch's "txRef mismatch" check; in the live shape verifyTransaction
  // queries BY txRef, so the meaningful forgery guard is the returned gateway
  // tx id vs the client-supplied one.
  test('tx id mismatch throws TXID_MISMATCH (client forged the id)', async () => {
    mockVerify({ status: 'SUCCESS', amount: 2000, flwTxId: 'flw-real' });
    await expect(
      chargeCard({ flwTxId: 'flw-forged', txRef: 'ref-5', amount: 2000 }),
    ).rejects.toMatchObject({ code: 'TXID_MISMATCH', retryable: false });
  });

  test('AML hard-cap throws BEFORE verifyTransaction is called', async () => {
    const verifySpy = jest.spyOn(verifyModule, 'verifyTransaction');
    jest
      .spyOn(amlModule, 'assertAmlCheck')
      .mockRejectedValue(new AmlError('AML_HARD_LIMIT_EXCEEDED', 403));
    await expect(
      chargeCard({
        flwTxId: 'flw-104',
        txRef: 'ref-6',
        amount: 9_000_000,
        customerId: 'c1',
        escrowId: 'e1',
      }),
    ).rejects.toBeInstanceOf(AmlError);
    expect(verifySpy).not.toHaveBeenCalled();
  });

  test('forged tx_ref the gateway never saw (NOT_FOUND) throws VERIFICATION_FAILED', async () => {
    mockVerify({ status: 'NOT_FOUND' });
    await expect(
      chargeCard({ flwTxId: 'flw-105', txRef: 'ref-forged', amount: 2000 }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
  });

  test('a gateway error from verify propagates as a FlutterwaveError', async () => {
    jest
      .spyOn(verifyModule, 'verifyTransaction')
      .mockRejectedValue(new Error('transaction not found'));
    await expect(
      chargeCard({ flwTxId: 'flw-106', txRef: 'ref-7', amount: 2000 }),
    ).rejects.toBeInstanceOf(FlutterwaveError);
  });

  // --- E2E_FAKE_PAYMENTS skip path (R3-PAYMENT-CARD-E2E) --------------------
  // When the env var is set (CI workflow env), chargeCard short-circuits the
  // live FLW gateway and returns a synthetic SUCCESS — but only AFTER the AML
  // check, so AML coverage in E2E is preserved.

  const withFakePayments = async (fn: () => Promise<void>) => {
    const prev = process.env.E2E_FAKE_PAYMENTS;
    process.env.E2E_FAKE_PAYMENTS = '1';
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env.E2E_FAKE_PAYMENTS;
      else process.env.E2E_FAKE_PAYMENTS = prev;
    }
  };

  test('E2E_FAKE_PAYMENTS=1 returns synthetic SUCCESS without calling verifyTransaction', async () => {
    await withFakePayments(async () => {
      const verifySpy = jest.spyOn(verifyModule, 'verifyTransaction');
      const r = await chargeCard({
        flwTxId: 'flw-e2e',
        txRef: 'ref-e2e',
        amount: 2000,
        customerId: 'c1',
        escrowId: 'e1',
      });
      expect(verifySpy).not.toHaveBeenCalled();
      expect(r).toEqual({
        flwTxId: 'flw-e2e',
        status: 'SUCCESS',
        cardBrand: 'VISA',
        cardLast4: '4242',
      });
    });
  });

  test('E2E_FAKE_PAYMENTS=1 STILL runs the AML check (hard cap throws before the skip)', async () => {
    await withFakePayments(async () => {
      const verifySpy = jest.spyOn(verifyModule, 'verifyTransaction');
      jest
        .spyOn(amlModule, 'assertAmlCheck')
        .mockRejectedValue(new AmlError('AML_HARD_LIMIT_EXCEEDED', 403));
      await expect(
        chargeCard({
          flwTxId: 'flw-e2e-aml',
          txRef: 'ref-e2e-aml',
          amount: 9_000_000,
          customerId: 'c1',
          escrowId: 'e1',
        }),
      ).rejects.toBeInstanceOf(AmlError);
      // The skip must not have fired before AML: no synthetic SUCCESS leaked.
      expect(verifySpy).not.toHaveBeenCalled();
    });
  });
});
