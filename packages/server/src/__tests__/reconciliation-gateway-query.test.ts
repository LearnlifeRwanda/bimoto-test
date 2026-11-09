import * as clientModule from '../services/payment/flutterwave-client';
import { queryFlutterwaveTransactions } from '../jobs/reconciliation/gateway-query';

function fakeClient(impl: (payload: any) => Promise<any>) {
  jest.spyOn(clientModule, 'getClient').mockReturnValue({
    Charge: {},
    MobileMoney: {},
    Transfer: {},
    Transaction: { fetch_multiple_transactions: impl },
  } as any);
}

beforeEach(() => {
  jest.restoreAllMocks();
});

describe('queryFlutterwaveTransactions', () => {
  test('returns canonical FlwTxnRecord array on single page', async () => {
    fakeClient(async () => ({
      data: [
        { tx_ref: 'r1', amount: 2000, status: 'successful', created_at: '2026-05-04T10:00:00Z', id: 100 },
        { tx_ref: 'r2', amount: 3000, status: 'failed', created_at: '2026-05-04T11:00:00Z', id: 101 },
      ],
      meta: { page_info: { total_pages: 1 } },
    }));
    const out = await queryFlutterwaveTransactions({
      from: new Date('2026-05-04T00:00:00Z'),
      to: new Date('2026-05-04T23:59:59Z'),
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      tx_ref: 'r1',
      amount: 2000,
      status: 'successful',
      created_at: '2026-05-04T10:00:00Z',
      flwId: '100',
    });
  });

  test('paginates across multiple pages', async () => {
    let calls = 0;
    fakeClient(async ({ page }: any) => {
      calls++;
      if (page === 1) {
        return {
          data: [{ tx_ref: 'r1', amount: 1, status: 'successful', created_at: 'x' }],
          meta: { page_info: { total_pages: 2 } },
        };
      }
      return {
        data: [{ tx_ref: 'r2', amount: 2, status: 'successful', created_at: 'y' }],
        meta: { page_info: { total_pages: 2 } },
      };
    });
    const out = await queryFlutterwaveTransactions({
      from: new Date('2026-05-04T00:00:00Z'),
      to: new Date('2026-05-04T23:59:59Z'),
    });
    expect(calls).toBe(2);
    expect(out.map((r) => r.tx_ref)).toEqual(['r1', 'r2']);
  });

  test('retries on 429 with backoff, then succeeds', async () => {
    let attempts = 0;
    fakeClient(async () => {
      attempts++;
      if (attempts < 2) {
        const err: any = new Error('rate limited');
        err.response = { status: 429 };
        throw err;
      }
      return { data: [], meta: { page_info: { total_pages: 1 } } };
    });
    const out = await queryFlutterwaveTransactions({
      from: new Date(),
      to: new Date(),
    });
    expect(out).toEqual([]);
    expect(attempts).toBe(2);
  });

  test('non-retryable errors propagate', async () => {
    fakeClient(async () => {
      const err: any = new Error('bad');
      err.response = { status: 400, data: { message: 'bad' } };
      throw err;
    });
    await expect(
      queryFlutterwaveTransactions({ from: new Date(), to: new Date() }),
    ).rejects.toBeDefined();
  });
});
