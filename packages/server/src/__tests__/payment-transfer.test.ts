import { resetClientForTests } from '../services/payment';
import { transferToWallet, fetchTransferStatus } from '../services/payment/transfer';
import * as clientModule from '../services/payment/flutterwave-client';

describe('transferToWallet', () => {
  const fakeClient = (impl: (payload: any) => Promise<any>) => {
    jest.spyOn(clientModule, 'getClient').mockReturnValue({
      Charge: {},
      MobileMoney: {},
      Transaction: {},
      Transfer: { initiate: impl },
    } as any);
  };

  beforeEach(() => {
    resetClientForTests();
    jest.restoreAllMocks();
  });

  test('idempotent on same reference (gateway-side guarantee)', async () => {
    let observed: string[] = [];
    fakeClient(async (payload) => {
      observed.push(payload.reference);
      return { status: 'success', data: { id: 42, status: 'NEW', reference: payload.reference } };
    });

    await transferToWallet({ phone: '+250788000111', amount: 5000, narration: 'd', reference: 'pay-1' });
    await transferToWallet({ phone: '+250788000111', amount: 5000, narration: 'd', reference: 'pay-1' });

    expect(observed).toEqual(['pay-1', 'pay-1']);
  });

  test('maps invalid wallet to INVALID_WALLET', async () => {
    fakeClient(async () => ({
      status: 'error',
      message: 'Invalid wallet number provided',
    }));

    await expect(
      transferToWallet({ phone: '+25099bad', amount: 5000, narration: 'd', reference: 'pay-2' }),
    ).rejects.toMatchObject({ code: 'INVALID_WALLET' });
  });

  test('SUCCESS path returns flwTransferId', async () => {
    fakeClient(async () => ({
      status: 'success',
      data: { id: 7777, status: 'SUCCESSFUL' },
    }));

    const r = await transferToWallet({ phone: '+250788111222', amount: 3000, narration: 'd', reference: 'pay-3' });
    expect(r).toEqual({ flwTransferId: '7777', status: 'SUCCESS' });
  });

  test('PENDING path keeps the row pending until verify', async () => {
    fakeClient(async () => ({
      status: 'success',
      data: { id: 8888, status: 'NEW' },
    }));

    const r = await transferToWallet({ phone: '+250788111222', amount: 3000, narration: 'd', reference: 'pay-4' });
    expect(r).toEqual({ flwTransferId: '8888', status: 'PENDING' });
  });
});

describe('fetchTransferStatus', () => {
  const fakeFetchClient = (impl: (payload: any) => Promise<any>) => {
    jest.spyOn(clientModule, 'getClient').mockReturnValue({
      Charge: {},
      MobileMoney: {},
      Transaction: {},
      Transfer: { fetch: impl },
    } as any);
  };

  beforeEach(() => {
    resetClientForTests();
    jest.restoreAllMocks();
  });

  test('maps SUCCESSFUL to SUCCESS', async () => {
    fakeFetchClient(async () => ({ status: 'success', data: { id: 42, status: 'SUCCESSFUL' } }));
    await expect(fetchTransferStatus('42')).resolves.toEqual({ status: 'SUCCESS' });
  });

  test('maps FAILED to FAILED', async () => {
    fakeFetchClient(async () => ({ status: 'success', data: { id: 42, status: 'FAILED' } }));
    await expect(fetchTransferStatus('42')).resolves.toEqual({ status: 'FAILED' });
  });

  test('envelope success alone does NOT imply transfer success (NEW → PENDING)', async () => {
    fakeFetchClient(async () => ({ status: 'success', data: { id: 42, status: 'NEW' } }));
    await expect(fetchTransferStatus('42')).resolves.toEqual({ status: 'PENDING' });
  });

  test('missing data.status → PENDING (defensive)', async () => {
    fakeFetchClient(async () => ({ status: 'success', data: { id: 42 } }));
    await expect(fetchTransferStatus('42')).resolves.toEqual({ status: 'PENDING' });
  });

  test('envelope error → FlutterwaveError', async () => {
    fakeFetchClient(async () => ({ status: 'error', message: 'not found' }));
    await expect(fetchTransferStatus('42')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('passes the transfer id to Transfer.fetch as { id }', async () => {
    const seen: any[] = [];
    fakeFetchClient(async (payload) => {
      seen.push(payload);
      return { status: 'success', data: { id: 42, status: 'SUCCESSFUL' } };
    });
    await fetchTransferStatus('42');
    expect(seen).toEqual([{ id: '42' }]);
  });
});
