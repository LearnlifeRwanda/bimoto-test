import { resetClientForTests, FlutterwaveError } from '../services/payment';
import { chargeMomo } from '../services/payment/charge';
import * as clientModule from '../services/payment/flutterwave-client';

describe('chargeMomo', () => {
  const fakeClient = (impl: (payload: any) => Promise<any>) => {
    jest.spyOn(clientModule, 'getClient').mockReturnValue({
      Charge: {},
      MobileMoney: { rwanda: impl },
      Transaction: {},
      Transfer: {},
    } as any);
  };

  beforeEach(() => {
    resetClientForTests();
    jest.restoreAllMocks();
    delete process.env.FLW_PUBLIC_KEY;
    delete process.env.FLW_SECRET_KEY;
  });

  test('idempotent on same txRef — gateway returns prior result, we surface it', async () => {
    let callCount = 0;
    fakeClient(async (payload) => {
      callCount++;
      expect(payload.tx_ref).toBe('bimoto-1');
      return { status: 'success', data: { id: 999, status: 'pending', tx_ref: 'bimoto-1' } };
    });

    const r1 = await chargeMomo({ phone: '+250788123456', amount: 2000, txRef: 'bimoto-1', narration: 'r' });
    const r2 = await chargeMomo({ phone: '+250788123456', amount: 2000, txRef: 'bimoto-1', narration: 'r' });
    expect(r1.flwTxId).toBe('999');
    expect(r2.flwTxId).toBe('999');
    expect(callCount).toBe(2); // both invocations made; idempotency is gateway-side
  });

  test('maps insufficient-funds to INSUFFICIENT_FUNDS', async () => {
    fakeClient(async () => {
      throw {
        response: { status: 400, data: { message: 'Insufficient balance in wallet' } },
      };
    });

    await expect(
      chargeMomo({ phone: '+250788123456', amount: 999999, txRef: 't1', narration: 'x' }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  });

  test('maps timeout to TIMEOUT (retryable)', async () => {
    fakeClient(async () => {
      const err: any = new Error('Request timeout');
      err.code = 'ECONNABORTED';
      throw err;
    });

    await expect(
      chargeMomo({ phone: '+250788123456', amount: 2000, txRef: 't2', narration: 'x' }),
    ).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
  });

  test('surfaces wallet name on success', async () => {
    fakeClient(async () => ({
      status: 'success',
      data: { id: 1, status: 'successful', customer: { name: 'Jean Bosco' } },
    }));

    const r = await chargeMomo({ phone: '+250788123456', amount: 2000, txRef: 't3', narration: 'x' });
    expect(r.status).toBe('SUCCESS');
    expect(r.walletNameOnReceipt).toBe('Jean Bosco');
  });

  test('throws NO_KEYS_CONFIGURED in dev with no env', async () => {
    jest.spyOn(clientModule, 'getClient').mockImplementation(() => {
      // Simulate the real lazy-init returning a stub-throwing client
      return clientModule.getClient.call(null);
    });
    // Re-enable real getClient by un-mocking and ensuring env stays empty.
    jest.restoreAllMocks();
    resetClientForTests();
    await expect(
      chargeMomo({ phone: '+250788123456', amount: 2000, txRef: 't4', narration: 'x' }),
    ).rejects.toBeInstanceOf(FlutterwaveError);
  });
});
