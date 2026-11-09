// __TESTS__/CONNECTION-STATUS.TEST.TSX
//
// NET-UX G4 — connection behaviour. Was ConnectionBanner.test.tsx;
// CHROME-C G2 moved the subject, not the claims.
//
// The 24 July field scenario is unchanged: tunnel dies → the app must
// say so in friendly words with a manual Try now, never a raw error;
// recovery flashes "Back online" and fires the boolean connectivity
// listeners — the exact channel SyncManager.startMonitoring subscribes
// to for flushing the offline queue (the "nudge").
//
// What moved is where the user reads it. The banner is gone; the header
// pill carries the state, and the words, the countdown and Try now live
// in the sheet the pill opens. So this drives the real header and taps
// through to the sheet, which is also what proves the action survived
// the relocation.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import 'fake-indexeddb/auto';
import { i18n } from './setup';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));
vi.mock('@capacitor/network', () => ({
  Network: { getStatus: vi.fn(), addListener: vi.fn() },
}));

import { AppHeader } from '../components/layout/AppHeader';
import {
  _resetConnectivityForTests,
  reportApiFailure,
  reportApiSuccess,
  reportNetworkStatus,
  onConnectivityChange,
  getNextProbeAt,
} from '../sync/connectivity';

function renderHeader() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AppHeader />
    </MemoryRouter>,
  );
}

/** The pill is the only way in, exactly as a user has it. */
function openSheet() {
  fireEvent.click(screen.getByTestId('connection-status'));
}

const status = () => screen.getByTestId('connection-status').dataset.status;

beforeEach(async () => {
  _resetConnectivityForTests();
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      connection: {
        offline: "You're offline — reconnecting when network returns",
        unreachable: "Can't reach Bimoto — retrying…",
        retryCountdown: 'Retrying in {{seconds}}s',
        retryNow: 'Try now',
        backOnline: 'Back online',
        shortOffline: 'Offline',
        shortNoServer: 'No server',
        openDetail: 'open details',
        detailTitle: 'Connection & saved bookings',
      },
      sync: { connected: 'Connected', syncing: 'Syncing' },
      layout: { appHeader: 'Bimoto' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  Object.defineProperty(global.navigator, 'onLine', { configurable: true, value: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetConnectivityForTests();
});

describe('the header states the connection, in every state', () => {
  test('online is a calm tint pill and no wash', () => {
    renderHeader();
    expect(status()).toBe('connected');
    expect(screen.getByTestId('app-header').dataset.washed).toBe('false');
  });

  test('an apiFetch failure with network up says No server and washes the header', async () => {
    renderHeader();
    act(() => {
      reportApiFailure();
    });
    await waitFor(() => expect(status()).toBe('noServer'));

    // The one state allowed to raise its voice.
    expect(screen.getByTestId('app-header').dataset.washed).toBe('true');
    // a backoff probe is scheduled while disconnected
    expect(getNextProbeAt()).not.toBeNull();
  });

  test('device network loss says Offline — solid, but never washed', async () => {
    renderHeader();
    act(() => {
      reportNetworkStatus(false);
    });
    await waitFor(() => expect(status()).toBe('offline'));

    // Being offline is normal in Kigali and the app works offline by
    // design; the wash is reserved for a server we cannot reach.
    expect(screen.getByTestId('app-header').dataset.washed).toBe('false');
  });
});

describe('the words and the action moved into the sheet, not away', () => {
  test('the unreachable sentence and Try now are one tap from the pill', async () => {
    renderHeader();
    act(() => {
      reportApiFailure();
    });
    await waitFor(() => expect(status()).toBe('noServer'));

    openSheet();

    expect(screen.getByTestId('connection-panel-unreachable').textContent).toContain(
      "Can't reach Bimoto — retrying…",
    );
    expect(screen.getByRole('button', { name: 'Try now' })).toBeInTheDocument();
  });

  test('the offline sentence is there too', async () => {
    renderHeader();
    act(() => {
      reportNetworkStatus(false);
    });
    await waitFor(() => expect(status()).toBe('offline'));

    openSheet();

    expect(screen.getByTestId('connection-panel-offline').textContent).toContain(
      "You're offline — reconnecting when network returns",
    );
  });

  test('Try now probes immediately', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    renderHeader();
    act(() => {
      reportApiFailure();
    });
    await waitFor(() => expect(status()).toBe('noServer'));
    openSheet();

    const tryNow = await screen.findByRole('button', { name: 'Try now' });
    act(() => {
      tryNow.click();
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/health'),
        expect.anything(),
      ),
    );
    // the successful probe recovered the connection
    await waitFor(() => expect(status()).toBe('backOnline'));
  });
});

describe('recovery', () => {
  test('flashes Back online, nudges the sync listeners, then settles', async () => {
    const syncNudge = vi.fn();
    // SyncManager.startMonitoring subscribes exactly like this; a `true`
    // call is what triggers its offline-queue flush.
    const unsubscribe = onConnectivityChange(syncNudge);

    renderHeader();
    act(() => {
      reportApiFailure();
    });
    await waitFor(() => expect(status()).toBe('noServer'));

    act(() => {
      reportApiSuccess();
    });

    await waitFor(() => expect(status()).toBe('backOnline'));
    // The flash is a WORD SWAP now — same tint pill, no wash, no motion.
    // The strip it replaced moved every screen down 36 px and back up
    // again, unprompted, on every recovery.
    expect(screen.getByTestId('app-header').dataset.washed).toBe('false');
    expect(syncNudge).toHaveBeenCalledWith(true);

    // probe scheduling stops once healthy — no polling when online
    expect(getNextProbeAt()).toBeNull();

    // the flash leaves on its own
    await waitFor(() => expect(status()).toBe('connected'), { timeout: 4000 });
    unsubscribe();
  });
});
