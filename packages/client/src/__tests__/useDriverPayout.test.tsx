import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { i18n } from './setup';

const showToast = vi.fn();

vi.mock('../stores/auth.store', () => {
  // AUTH-REFRESH G2 — apiFetch reads the token via useAuthStore.getState(),
  // so the mock needs the static accessor too.
  const state = { token: 't', logout: vi.fn() };
  const useAuthStore = (selector: (s: any) => unknown) => selector(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

vi.mock('../stores/ui.store', () => {
  // NET-UX G2 — the presenter reads showToast via useUIStore.getState().
  // showToast is referenced lazily: this factory is hoisted above the
  // const declaration.
  const useUIStore = (selector: (s: any) => unknown) =>
    selector({ showToast });
  useUIStore.getState = () => ({ showToast });
  return { useUIStore };
});

import { useDriverPayout, PayoutSummary } from '../hooks/useDriverPayout';

const SUMMARY: PayoutSummary = {
  pendingAmount: 12500,
  storedPreference: 'AT_SHIFT_END',
  effectivePreference: 'TWICE_DAILY',
  trainingWheelsActive: true,
  completedShifts: 2,
  canEndShift: false,
  nextScheduledPayout: '2026-07-02T16:00:00.000Z',
  payoutsFrozen: false,
};

function jsonResponse(body: any, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  showToast.mockClear();
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      payout: { fetchFailed: 'Could not load your money info' },
      errors: {
        network: 'Network problem',
        generic: 'Something went wrong',
        serverProblem: 'Bimoto has a problem, not your phone',
        // PILOT-GUARD Item 2 — the catalogue keys now carry the
        // server's own spelling; this stub follows the catalogue.
        notShiftEndMode: 'Not in shift-end mode',
        otpInvalid: 'Wrong code',
        preferenceChangeRateLimited: 'Already changed today',
      },
    },
    true,
    true,
  );
});

describe('useDriverPayout', () => {
  test('fetches summary on mount', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(SUMMARY));
    vi.stubGlobal('fetch', fetchMock as any);

    const { result } = renderHook(() => useDriverPayout());
    await waitFor(() => expect(result.current.summary).not.toBeNull());

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/payout/summary'),
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(result.current.summary).toEqual(SUMMARY);
    expect(result.current.loading).toBe(false);
  });

  test('summary fetch 500 shows the honest server-problem toast (NET-UX G2)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)) as any);

    renderHook(() => useDriverPayout());
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Bimoto has a problem, not your phone', 'error'),
    );
  });

  test('endShift returns batchId + amount + expectedDeliveryAt', async () => {
    const payload = {
      batchId: 'batch-1',
      amount: 5000,
      expectedDeliveryAt: '2026-07-02T15:00:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/end-shift') ? jsonResponse(payload) : jsonResponse(SUMMARY),
      ) as any,
    );

    const { result } = renderHook(() => useDriverPayout());
    let outcome: any;
    await act(async () => {
      outcome = await result.current.endShift();
    });
    expect(outcome).toEqual(payload);
  });

  test('endShift surfaces NOT_SHIFT_END_MODE as translated error toast', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/end-shift')
          ? jsonResponse(
              { error: { code: 'NOT_SHIFT_END_MODE', message: 'errors.notShiftEndMode' } },
              400,
            )
          : jsonResponse(SUMMARY),
      ) as any,
    );

    const { result } = renderHook(() => useDriverPayout());
    let outcome: any;
    await act(async () => {
      outcome = await result.current.endShift();
    });
    expect(outcome).toBeNull();
    expect(showToast).toHaveBeenCalledWith('Not in shift-end mode', 'error');
  });

  test('requestPreferenceOtp returns otpId + expiresAt', async () => {
    const otp = { otpId: 'otp-1', expiresAt: '2026-07-02T13:10:00.000Z' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/request-otp') ? jsonResponse(otp) : jsonResponse(SUMMARY),
      ) as any,
    );

    const { result } = renderHook(() => useDriverPayout());
    let outcome: any;
    await act(async () => {
      outcome = await result.current.requestPreferenceOtp('DAILY_22H');
    });
    expect(outcome).toEqual(otp);
  });

  test('changePreference success re-fetches the summary', async () => {
    const summaryCalls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/api/payout/preference') && init?.method === 'POST') {
          return jsonResponse({
            newPreference: 'DAILY_22H',
            immediatePayoutQueued: true,
            queuedFor: '2026-07-02T14:00:00.000Z',
          });
        }
        summaryCalls.push(url);
        return jsonResponse(SUMMARY);
      }) as any,
    );

    const { result } = renderHook(() => useDriverPayout());
    await waitFor(() => expect(result.current.summary).not.toBeNull());
    const callsBefore = summaryCalls.length;

    let outcome: any;
    await act(async () => {
      outcome = await result.current.changePreference('DAILY_22H', 'otp-1', '123456');
    });
    expect(outcome?.immediatePayoutQueued).toBe(true);
    expect(summaryCalls.length).toBeGreaterThan(callsBefore);
  });

  test('changePreference rate limit surfaces as info toast, not error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) =>
        url.includes('/api/payout/preference') && init?.method === 'POST'
          ? jsonResponse(
              {
                error: {
                  code: 'PREFERENCE_CHANGE_RATE_LIMITED',
                  message: 'errors.preferenceChangeRateLimited',
                },
              },
              429,
            )
          : jsonResponse(SUMMARY),
      ) as any,
    );

    const { result } = renderHook(() => useDriverPayout());
    let outcome: any;
    await act(async () => {
      outcome = await result.current.changePreference('DAILY_22H', 'otp-1', '123456');
    });
    expect(outcome).toBeNull();
    expect(showToast).toHaveBeenCalledWith('Already changed today', 'info');
  });
});
