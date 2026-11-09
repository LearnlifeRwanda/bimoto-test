import fs from 'node:fs';
import path from 'node:path';
import { resetClientForTests, FlutterwaveError } from '../services/payment';
import { refundMomo } from '../services/payment/refund';
import * as clientModule from '../services/payment/flutterwave-client';

describe('refundMomo', () => {
  const fakeClient = (impl: (payload: any) => Promise<any>) => {
    jest.spyOn(clientModule, 'getClient').mockReturnValue({
      Charge: {},
      MobileMoney: {},
      Transaction: { refund: impl },
      Transfer: {},
    } as any);
  };

  beforeEach(() => {
    resetClientForTests();
    jest.restoreAllMocks();
    delete process.env.FLW_PUBLIC_KEY;
    delete process.env.FLW_SECRET_KEY;
  });

  test('successful refund returns flwRefundTxId + SUCCESS', async () => {
    fakeClient(async (payload) => {
      expect(payload.id).toBe('orig-flw-1');
      expect(payload.amount).toBe(5000);
      return {
        status: 'success',
        data: { id: 'flw-refund-123', status: 'successful', amount_refunded: 5000 },
      };
    });

    const r = await refundMomo({ flwTxId: 'orig-flw-1', amount: 5000 });
    expect(r.flwRefundTxId).toBe('flw-refund-123');
    expect(r.status).toBe('SUCCESS');
  });

  test('pending refund status passes through as PENDING', async () => {
    fakeClient(async () => ({ status: 'success', data: { id: 'rid', status: 'pending' } }));

    const r = await refundMomo({ flwTxId: 'orig-flw-2', amount: 1000 });
    expect(r.flwRefundTxId).toBe('rid');
    expect(r.status).toBe('PENDING');
  });

  test('gateway error-status response throws VALIDATION_ERROR', async () => {
    fakeClient(async () => ({ status: 'error', message: 'transaction not refundable' }));

    await expect(refundMomo({ flwTxId: 'orig-flw-3', amount: 1000 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  test('SDK throw is mapped via mapFlwError (timeout → TIMEOUT, retryable)', async () => {
    fakeClient(async () => {
      const err: any = new Error('Request timeout');
      err.code = 'ECONNABORTED';
      throw err;
    });

    await expect(refundMomo({ flwTxId: 'orig-flw-4', amount: 1000 })).rejects.toMatchObject({
      code: 'TIMEOUT',
      retryable: true,
    });
  });

  test('throws NO_KEYS_CONFIGURED when env keys are unset (stub client)', async () => {
    // No fakeClient mock + no env keys → getClient returns the throwing stub.
    await expect(refundMomo({ flwTxId: 'orig-flw-5', amount: 1000 })).rejects.toBeInstanceOf(
      FlutterwaveError,
    );
    await expect(refundMomo({ flwTxId: 'orig-flw-5', amount: 1000 })).rejects.toMatchObject({
      code: 'NO_KEYS_CONFIGURED',
    });
  });

  test('contract: refund.ts performs no DB writes (no prisma reference)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/payment/refund.ts'),
      'utf-8',
    );
    expect(src).not.toMatch(/prisma/i);
  });
});
