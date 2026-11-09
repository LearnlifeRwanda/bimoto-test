// R3-PAYMENT-CARD-CLIENT — unit tests for the card-charge helper.
// Mocks window.FlutterwaveCheckout + fetch to exercise the widget
// outcomes (success, cancel, no-tx-id, verify-failure, script-load
// failure) and the double-fire guard.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { chargeWithCard } from '../payment';
import { useAuthStore } from '../../stores/auth.store';

const cardCheckout = { escrowId: 'esc1', txRef: 'bimoto-j1abc-123', amount: 2000 };
const customer = { email: 'c@bimoto.app', phone: '+250788111111', name: 'Aljo' };
const baseArgs = {
  cardCheckout,
  customer,
};

beforeEach(() => {
  vi.stubEnv('VITE_FLW_PUBLIC_KEY', 'FLWPUBK_TEST-abc');
  // AUTH-REFRESH G2 — the verify now goes through apiFetch, which
  // injects the access token from the auth store.
  useAuthStore.setState({ token: 'tok-1' });
  // Pretend the FLW script is already present so loadFlwInlineScript
  // short-circuits; individual tests override window.FlutterwaveCheckout.
  (window as any).FlutterwaveCheckout = vi.fn();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete (window as any).FlutterwaveCheckout;
  vi.restoreAllMocks();
});

describe('chargeWithCard', () => {
  test('happy path: resolves { status: HELD } and POSTs the verify with escrowId + flwTxId', async () => {
    (window as any).FlutterwaveCheckout = vi.fn((config: any) => {
      config.callback({ transaction_id: 'fake-tx-99' });
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'HELD', txRef: cardCheckout.txRef }),
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    const result = await chargeWithCard(baseArgs);

    expect(result).toEqual({ status: 'HELD' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('http://localhost:3000/api/payments/initiate-card');
    expect(JSON.parse(init.body)).toEqual({ escrowId: 'esc1', flwTxId: 'fake-tx-99' });
    expect(init.headers.Authorization).toBe('Bearer tok-1');
  });

  test('widget cancelled (onclose before callback) rejects CARD_WIDGET_CANCELLED and never verifies', async () => {
    (window as any).FlutterwaveCheckout = vi.fn((config: any) => {
      config.onclose();
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as any);

    await expect(chargeWithCard(baseArgs)).rejects.toThrow('CARD_WIDGET_CANCELLED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('widget callback with no transaction id rejects CARD_WIDGET_NO_TX_ID and never verifies', async () => {
    (window as any).FlutterwaveCheckout = vi.fn((config: any) => {
      config.callback({});
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as any);

    await expect(chargeWithCard(baseArgs)).rejects.toThrow('CARD_WIDGET_NO_TX_ID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('server verify failure rejects CARD_VERIFY_FAILED', async () => {
    (window as any).FlutterwaveCheckout = vi.fn((config: any) => {
      config.callback({ transaction_id: 'fake-tx-99' });
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) })) as any,
    );

    await expect(chargeWithCard(baseArgs)).rejects.toThrow('CARD_VERIFY_FAILED');
  });

  test('surfaces the server error code when verify returns a structured error', async () => {
    (window as any).FlutterwaveCheckout = vi.fn((config: any) => {
      config.callback({ transaction_id: 'fake-tx-99' });
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: { code: 'AMOUNT_MISMATCH' } }),
      })) as any,
    );

    await expect(chargeWithCard(baseArgs)).rejects.toThrow('AMOUNT_MISMATCH');
  });

  test('script load failure rejects CARD_WIDGET_SCRIPT_LOAD_FAILED', async () => {
    delete (window as any).FlutterwaveCheckout;
    // Force the injected <script> to error on the next tick.
    const appendSpy = vi
      .spyOn(document.head, 'appendChild')
      .mockImplementation((node: any) => {
        setTimeout(() => node.onerror?.(new Event('error')), 0);
        return node;
      });

    await expect(chargeWithCard(baseArgs)).rejects.toThrow('CARD_WIDGET_SCRIPT_LOAD_FAILED');
    appendSpy.mockRestore();
  });

  test('double-fire safe: onclose after a successful callback is ignored (single verify)', async () => {
    (window as any).FlutterwaveCheckout = vi.fn((config: any) => {
      config.callback({ transaction_id: 'fake-tx-99' });
      // Race: the customer closes the frame after a successful charge.
      config.onclose();
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'HELD' }),
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    const result = await chargeWithCard(baseArgs);

    expect(result).toEqual({ status: 'HELD' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('onVerifying fires exactly once, between widget success and the verify POST', async () => {
    const events: string[] = [];
    (window as any).FlutterwaveCheckout = vi.fn((config: any) => {
      events.push('widget-success');
      config.callback({ transaction_id: 'fake-tx-99' });
    });
    const fetchMock = vi.fn(async () => {
      events.push('verify-post');
      return { ok: true, json: async () => ({ status: 'HELD' }) };
    });
    vi.stubGlobal('fetch', fetchMock as any);
    const onVerifying = vi.fn(() => events.push('verifying'));

    await chargeWithCard({ ...baseArgs, onVerifying });

    expect(onVerifying).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['widget-success', 'verifying', 'verify-post']);
  });

  test('onVerifying is not fired when the widget is cancelled', async () => {
    (window as any).FlutterwaveCheckout = vi.fn((config: any) => {
      config.onclose();
    });
    vi.stubGlobal('fetch', vi.fn() as any);
    const onVerifying = vi.fn();

    await expect(chargeWithCard({ ...baseArgs, onVerifying })).rejects.toThrow(
      'CARD_WIDGET_CANCELLED',
    );
    expect(onVerifying).not.toHaveBeenCalled();
  });

  test('onVerifying is not fired when the widget returns no transaction id', async () => {
    (window as any).FlutterwaveCheckout = vi.fn((config: any) => {
      config.callback({});
    });
    vi.stubGlobal('fetch', vi.fn() as any);
    const onVerifying = vi.fn();

    await expect(chargeWithCard({ ...baseArgs, onVerifying })).rejects.toThrow(
      'CARD_WIDGET_NO_TX_ID',
    );
    expect(onVerifying).not.toHaveBeenCalled();
  });

  test('missing public key rejects CARD_WIDGET_NO_PUBLIC_KEY before opening the widget', async () => {
    vi.stubEnv('VITE_FLW_PUBLIC_KEY', '');
    const checkoutSpy = vi.fn();
    (window as any).FlutterwaveCheckout = checkoutSpy;

    await expect(chargeWithCard(baseArgs)).rejects.toThrow('CARD_WIDGET_NO_PUBLIC_KEY');
    expect(checkoutSpy).not.toHaveBeenCalled();
  });
});
