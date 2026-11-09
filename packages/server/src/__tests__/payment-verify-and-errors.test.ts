import { FlutterwaveError, mapFlwError, resetClientForTests } from '../services/payment';
import { verifyTransaction } from '../services/payment/verify';
import * as clientModule from '../services/payment/flutterwave-client';

describe('verifyTransaction', () => {
  const fakeClient = (impl: (payload: any) => Promise<any>) => {
    jest.spyOn(clientModule, 'getClient').mockReturnValue({
      Charge: {},
      MobileMoney: {},
      Transaction: { verify_by_tx: impl },
      Transfer: {},
    } as any);
  };

  beforeEach(() => {
    resetClientForTests();
    jest.restoreAllMocks();
  });

  test('returns canonical statuses', async () => {
    fakeClient(async () => ({
      status: 'success',
      data: { id: 1, status: 'successful', amount: 2000, customer: { name: 'A' }, tx_ref: 'r1' },
    }));
    expect((await verifyTransaction('r1')).status).toBe('SUCCESS');

    fakeClient(async () => ({
      status: 'success',
      data: { id: 2, status: 'failed', amount: 2000, tx_ref: 'r2' },
    }));
    expect((await verifyTransaction('r2')).status).toBe('FAILED');

    fakeClient(async () => ({
      status: 'success',
      data: { id: 3, status: 'pending', amount: 2000, tx_ref: 'r3' },
    }));
    expect((await verifyTransaction('r3')).status).toBe('PENDING');

    fakeClient(async () => ({
      status: 'error',
      message: 'No transaction was found for this id',
    }));
    expect((await verifyTransaction('r4')).status).toBe('NOT_FOUND');
  });
});

describe('mapFlwError', () => {
  test('covers all six categories', () => {
    expect(mapFlwError({ code: 'ECONNABORTED' }).code).toBe('TIMEOUT');
    expect(mapFlwError({ code: 'ECONNREFUSED' }).code).toBe('NETWORK_ERROR');
    expect(mapFlwError({ response: { status: 502 } }).code).toBe('GATEWAY_DOWN');
    expect(
      mapFlwError({
        response: { status: 400, data: { message: 'Insufficient funds' } },
      }).code,
    ).toBe('INSUFFICIENT_FUNDS');
    expect(
      mapFlwError({
        response: { status: 400, data: { message: 'Invalid wallet provided' } },
      }).code,
    ).toBe('INVALID_WALLET');
    expect(
      mapFlwError({
        response: { status: 400, data: { message: 'Bad request shape' } },
      }).code,
    ).toBe('VALIDATION_ERROR');
  });

  test('FlutterwaveError roundtrips through mapFlwError unchanged', () => {
    const original = new FlutterwaveError('TIMEOUT', { retryable: true });
    expect(mapFlwError(original)).toBe(original);
  });

  test('unknown error category surfaces as UNKNOWN', () => {
    expect(mapFlwError({ message: 'something weird' }).code).toBe('UNKNOWN');
  });
});
