// NET-UX G4 — failure-taxonomy unit coverage.
//
// Every way an API call can fail must map to exactly one ApiError kind
// (lib/api.ts) and one honest presentation (lib/api-error-presenter.ts):
// the Kigali field defect was one generic toast for session bugs, dead
// tunnels, airplane mode and real validation rejections alike.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { i18n } from './setup';
import {
  apiFetch,
  ApiError,
  apiErrorFromResponse,
  isConnectivityError,
} from '../lib/api';
import { presentApiError, showOfflineQueuedToast } from '../lib/api-error-presenter';
import {
  _resetConnectivityForTests,
  reportNetworkStatus,
  getConnectionState,
} from '../sync/connectivity';
import { useAuthStore } from '../stores/auth.store';
import { useUIStore } from '../stores/ui.store';

beforeEach(async () => {
  _resetConnectivityForTests();
  useAuthStore.setState({ token: 'opaque-token' } as any);
  useUIStore.setState({ toasts: [], toastMessage: null, toastType: null });
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      errors: {
        offlineQueued: "No connection — we'll keep your request ready",
        offlineRetry: 'No connection — check your connection and try again',
        serverProblem: 'Bimoto has a problem, not your phone',
        rejectedGeneric: 'The request was not accepted',
        unauthorized: 'Session expired',
        generic: 'Something went wrong',
        notJourneyCustomer: 'This ride belongs to a different account.',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetConnectivityForTests();
});

function jsonRes(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiFetch network-failure classification', () => {
  test('fetch threw while the device network is up → UNREACHABLE', async () => {
    reportNetworkStatus(true);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const err = await apiFetch('/api/journeys').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('UNREACHABLE');
    expect(isConnectivityError(err)).toBe(true);
    // the failure fed the G1 connectivity source of truth
    expect(getConnectionState()).toBe('unreachable');
  });

  test('fetch threw while the device network is down → OFFLINE', async () => {
    reportNetworkStatus(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const err = await apiFetch('/api/journeys').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('OFFLINE');
    expect(getConnectionState()).toBe('offline');
  });

  test('any HTTP response marks the API reachable again', async () => {
    reportNetworkStatus(true);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down'); }));
    await apiFetch('/api/journeys').catch(() => {});
    expect(getConnectionState()).toBe('unreachable');

    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ ok: false }, 500)));
    await apiFetch('/api/journeys');
    expect(getConnectionState()).toBe('online');
  });
});

describe('apiErrorFromResponse status classification', () => {
  test('5xx → SERVER', async () => {
    const err = await apiErrorFromResponse(jsonRes({}, 503));
    expect(err.kind).toBe('SERVER');
    expect(err.status).toBe(503);
  });

  test('4xx with the server error envelope → REJECTED carrying code + message key', async () => {
    const err = await apiErrorFromResponse(
      jsonRes({ error: { code: 'FORBIDDEN', message: 'errors.notJourneyCustomer' } }, 403),
    );
    expect(err.kind).toBe('REJECTED');
    expect(err.code).toBe('FORBIDDEN');
    expect(err.messageKey).toBe('errors.notJourneyCustomer');
  });

  test('401 → AUTH (post-refresh 401s already routed to logout by apiFetch)', async () => {
    const err = await apiErrorFromResponse(
      jsonRes({ error: { code: 'UNAUTHORIZED', message: 'errors.unauthorized' } }, 401),
    );
    expect(err.kind).toBe('AUTH');
  });

  test('legacy prose body stays prose (never resolves as an i18n key)', async () => {
    const err = await apiErrorFromResponse(jsonRes({ message: 'Journey not found' }, 404));
    expect(err.kind).toBe('REJECTED');
    expect(err.messageKey).toBe('Journey not found');
  });
});

describe('presentApiError — one honest language', () => {
  const toast = () => useUIStore.getState();

  test('UNREACHABLE without a queue → check-connection copy', () => {
    presentApiError(new ApiError('UNREACHABLE'));
    expect(toast().toastMessage).toBe('No connection — check your connection and try again');
    expect(toast().toastType).toBe('error');
  });

  test('OFFLINE with a queued request → keep-it-ready copy as info', () => {
    presentApiError(new ApiError('OFFLINE'), { queued: true });
    expect(toast().toastMessage).toBe("No connection — we'll keep your request ready");
    expect(toast().toastType).toBe('info');
  });

  test('SERVER → not-your-phone copy', () => {
    presentApiError(new ApiError('SERVER', { status: 500 }));
    expect(toast().toastMessage).toBe('Bimoto has a problem, not your phone');
  });

  test('REJECTED with a known server key renders the server message verbatim', () => {
    presentApiError(
      new ApiError('REJECTED', { status: 403, messageKey: 'errors.notJourneyCustomer' }),
    );
    expect(toast().toastMessage).toBe('This ride belongs to a different account.');
  });

  test('REJECTED with an unknown key falls back to generic-but-honest', () => {
    presentApiError(
      new ApiError('REJECTED', { status: 400, messageKey: 'errors.someKeyTheClientNeverHeardOf' }),
    );
    expect(toast().toastMessage).toBe('The request was not accepted');
  });

  test('REJECTED with a prose body never feeds t() and falls back honestly', () => {
    presentApiError(new ApiError('REJECTED', { status: 404, messageKey: 'Journey not found' }));
    expect(toast().toastMessage).toBe('The request was not accepted');
  });

  test('AUTH → session-expired copy', () => {
    presentApiError(new ApiError('AUTH', { status: 401 }));
    expect(toast().toastMessage).toBe('Session expired');
  });

  test('raw TypeError from an allowlisted pre-auth fetch reads as connection trouble', () => {
    presentApiError(new TypeError('Failed to fetch'));
    expect(toast().toastMessage).toBe('No connection — check your connection and try again');
  });

  test('unknown errors fall back to generic', () => {
    presentApiError(new Error('boom'));
    expect(toast().toastMessage).toBe('Something went wrong');
  });

  test('showOfflineQueuedToast — direct offline-branch toast', () => {
    showOfflineQueuedToast();
    expect(toast().toastMessage).toBe("No connection — we'll keep your request ready");
    expect(toast().toastType).toBe('info');
  });
});
