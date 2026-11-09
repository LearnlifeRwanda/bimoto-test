// __TESTS__/CONNECTIVITY-TRUTH.TEST.TSX
//
// MAP-TRUTH G5 — "offline" must mean offline.
//
// Barack's second field report: the Requests and Scheduled pages showed
// "offline" on a working connection. Those pages never mention
// connectivity themselves — the word came from SyncIndicator in the
// shell above them, which read the API-derived useUIStore.isOnline and
// printed "Offline - changes will sync when connected" whenever our API
// had not answered. And it did so directly above ConnectionBanner saying
// "Can't reach Bimoto", two contradicting claims on one screen.
//
// The trigger was cheaper still: apiFetch reported a network failure for
// ANY rejected fetch, including a deliberate abort — and useGeocodeSearch
// aborts on every keystroke.
//
// CHROME-C G2 moved the subject under test. SyncIndicator is gone; the
// header pill is the single thing that speaks about the connection now,
// so these assertions follow it there. Every claim below is the
// original one, restated against the pill:
//
//   * an unreachable API must not be reported as the DEVICE being
//     offline. It was "say nothing at all" while two widgets shared the
//     job; with one pill it is "say the true thing" — No server, never
//     Offline. Stronger than the original, and the libel it was written
//     to catch still cannot happen.
//   * the API-derived isOnline flag is still not consulted.
//
// The two abort tests below are untouched — they are about
// connectivity.ts, not about any widget.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

const connectionStateMock = vi.fn(() => 'online' as string);
vi.mock('../hooks/useConnectionState', () => ({
  useConnectionState: () => connectionStateMock(),
}));

import { ConnectionStatus } from '../components/layout/ConnectionStatus';
import { useUIStore } from '../stores/ui.store';
import {
  reportApiFailure,
  reportNetworkStatus,
  getConnectionState,
  _resetConnectivityForTests,
} from '../sync/connectivity';

beforeEach(() => {
  connectionStateMock.mockReset().mockReturnValue('online');
  useUIStore.setState({ isSyncing: false, isOnline: true });
  _resetConnectivityForTests();
});

function renderStatus() {
  return render(<ConnectionStatus onOpenDetail={() => {}} />);
}

describe('the header never libels a working connection (MAP-TRUTH G5)', () => {
  test('API unreachable, device fine → it never says the device is offline', () => {
    connectionStateMock.mockReturnValue('unreachable');

    renderStatus();

    // The libel this test exists to catch: blaming the phone for the
    // server. One pill, one truth — and that truth is No server.
    expect(screen.getByTestId('connection-status').dataset.status).toBe('noServer');
    expect(screen.getByTestId('connection-status')).not.toHaveTextContent(/offline/i);
  });

  test('device genuinely offline → it does say offline', () => {
    connectionStateMock.mockReturnValue('offline');

    renderStatus();

    expect(screen.getByTestId('connection-status').dataset.status).toBe('offline');
    expect(screen.getByTestId('connection-status')).toHaveTextContent(/offline/i);
  });

  test('online → connected', () => {
    connectionStateMock.mockReturnValue('online');

    renderStatus();

    expect(screen.getByTestId('connection-status').dataset.status).toBe('connected');
    expect(screen.getByTestId('connection-status')).not.toHaveTextContent(/offline/i);
  });

  test('an unreachable server outranks a sync in progress', () => {
    // The original asserted the opposite, because SyncIndicator and
    // ConnectionBanner were two mouths: the strip kept saying "Syncing"
    // while the banner said "Can't reach Bimoto". With one pill the
    // ladder has to choose, and severity wins — a server we cannot
    // reach is the more useful thing to know. The sync attempt is not
    // hidden: it is in the sheet, one tap away.
    connectionStateMock.mockReturnValue('unreachable');
    useUIStore.setState({ isSyncing: true });

    renderStatus();

    expect(screen.getByTestId('connection-status').dataset.status).toBe('noServer');
  });

  test('syncing shows whenever the connection has nothing worse to report', () => {
    connectionStateMock.mockReturnValue('online');
    useUIStore.setState({ isSyncing: true });

    renderStatus();

    expect(screen.getByTestId('connection-status').dataset.status).toBe('syncing');
  });

  test('it no longer reads the API-derived isOnline flag', () => {
    // The flag means "can we usefully talk to the API", which is not a
    // statement about the user's connection.
    connectionStateMock.mockReturnValue('online');
    useUIStore.setState({ isOnline: false });

    renderStatus();

    expect(screen.getByTestId('connection-status')).not.toHaveTextContent(/offline/i);
  });
});

describe('an abort is not a network signal (MAP-TRUTH G5)', () => {
  test('reportApiFailure still marks a REAL failure unreachable', () => {
    reportNetworkStatus(true);
    reportApiFailure();
    expect(getConnectionState()).toBe('unreachable');
  });

  test('aborting a request leaves the connection state untouched', async () => {
    const { apiFetch } = await import('../lib/api');
    reportNetworkStatus(true);
    expect(getConnectionState()).toBe('online');

    const controller = new AbortController();
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pending = apiFetch('/api/geocode/search?q=Kim', {
      signal: controller.signal,
    }).catch((e: unknown) => e);
    controller.abort();
    const err = await pending;

    // The abort propagates as an abort — callers already handle it —
    // and connectivity is untouched. A keystroke is not an outage.
    expect((err as DOMException).name).toBe('AbortError');
    expect(getConnectionState()).toBe('online');

    vi.unstubAllGlobals();
  });

  test('a genuine network throw is still reported', async () => {
    const { apiFetch } = await import('../lib/api');
    reportNetworkStatus(true);

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    await apiFetch('/api/users/me').catch(() => undefined);

    expect(getConnectionState()).toBe('unreachable');
    vi.unstubAllGlobals();
  });
});
