// __TESTS__/OUTBOX-TOASTS.TEST.TSX
//
// CHROME-C G3 — the events announce themselves once, then leave.
//
// A booking saved, a booking sent, a booking refused: each used to be a
// strip that appeared across every screen and stayed until dismissed.
// News does not work that way. It arrives, is read, and goes; what
// still needs a decision stays, and staying is the badge's job.
//
// The two properties that make this safe rather than noisy are both
// asserted here: nothing is announced on MOUNT (a phone with two
// refusals already in Dexie must not shout when the shell renders), and
// nothing is announced when a count goes DOWN (cancelling one of three
// held bookings must not re-announce the other two).
//
// EVERY ARRIVAL TEST WAITS FOR THE BADGE FIRST, and that is not
// ceremony. The hook seeds itself from the queues the moment Dexie
// first answers; a row written before that answer arrives is part of
// the seed, not an arrival, and correctly says nothing. The badge
// settling is the user-visible proof that the seed has happened, so
// waiting on it is what makes "then something arrived" mean what it
// says. Without it these tests depend on whether Dexie beat the test
// to the punch — which is how the first version of this file passed
// locally and failed on CI.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import 'fake-indexeddb/auto';
import { i18n } from './setup';

vi.mock('../hooks/useConnectionState', () => ({
  useConnectionState: () => 'online',
}));

import { AppShell } from '../components/layout/AppShell';
import { Toast } from '../components/ui/Toast';
import { db } from '../db/dexie';
import { useAuthStore } from '../stores/auth.store';
import { useUIStore } from '../stores/ui.store';
import { useOutboxStore } from '../stores/outbox.store';
import { enqueueJourneyCreate, newClientId, cancelOutboxEntry } from '../lib/outbox';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function hold(status: 'PENDING' | 'REJECTED' = 'PENDING') {
  const clientId = newClientId();
  const entry = await enqueueJourneyCreate({
    userId: ALICE,
    clientId,
    payload: { clientRequestId: clientId, pickupName: 'Sonatubes', destinationName: 'Giporoso' },
  });
  if (status === 'REJECTED') {
    await db.outbox.update(entry.id!, {
      status: 'REJECTED',
      failCode: 'ACCOUNT_FLAGGED',
      failMessage: 'errors.accountFlagged',
    });
  }
  return entry;
}

/** The shell, plus the single Toast mount App.tsx provides in the app. */
function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Toast />
      <AppShell>
        <div>Screen</div>
      </AppShell>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      outbox: {
        savedToast: 'Saved on this phone — it will go out when there is signal',
        sentTitle: 'Your saved booking was sent',
        savedRoute: '{{from}} → {{to}}',
        cancel: 'Cancel this booking',
        waitingTitle: 'Waiting to send',
        view: 'View the ride',
        dismiss: 'Dismiss',
      },
      sync: {
        connected: 'Connected',
        banner: {
          // All three plural forms, deliberately. i18n is a module-level
          // singleton shared by every test file in a worker, and two
          // sibling files register `failedCount_one`, which would win
          // over the base key for count=1. Pinning all three keeps this
          // file's assertions independent of worker scheduling.
          failedCount: '{{count}} updates could not be saved',
          failedCount_one: '{{count}} updates could not be saved',
          failedCount_other: '{{count}} updates could not be saved',
          modalTitle: 'Refused',
        },
      },
      connection: { shortOffline: 'Offline', shortNoServer: 'No server', openDetail: 'open details', detailTitle: 'Connection' },
      layout: { mainContent: 'Main', appHeader: 'Bimoto' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  useAuthStore.setState({
    user: { id: ALICE, role: 'CUSTOMER' } as never,
    isAuthenticated: true,
    token: 'tok',
  } as never);
  useUIStore.setState({ isSyncing: false, toasts: [], toastMessage: null, toastType: null } as never);
  useOutboxStore.setState({ lastSent: null });
  await db.outbox.clear();
  await db.syncEvents.clear();
});

afterEach(async () => {
  await db.outbox.clear();
  await db.syncEvents.clear();
  vi.clearAllMocks();
});

describe('CHROME-C G3 — arrivals speak once', () => {
  test('a booking saved while the shell is up announces itself', async () => {
    // One already held, so the badge can prove the seed has landed.
    await hold('PENDING');
    renderShell();
    await waitFor(() =>
      expect(screen.getByTestId('connection-status-badge').textContent).toBe('1'),
    );

    await act(async () => {
      await hold('PENDING');
    });

    await waitFor(() =>
      expect(
        screen.getByText('Saved on this phone — it will go out when there is signal'),
      ).toBeInTheDocument(),
    );
  });

  test('a booking going out announces itself', async () => {
    // No badge wait needed: the sent notice is seeded synchronously off
    // useOutboxStore on the first render, so there is no race to lose.
    renderShell();
    await waitFor(() => expect(screen.getByTestId('connection-status')).toBeInTheDocument());

    act(() => {
      useOutboxStore.setState({
        lastSent: { journeyId: 'j9', pickupName: 'Sonatubes', destinationName: 'Giporoso' },
      });
    });

    await waitFor(() =>
      expect(screen.getByText('Your saved booking was sent')).toBeInTheDocument(),
    );
  });

  test('a refusal arriving announces itself', async () => {
    await hold('PENDING');
    renderShell();
    await waitFor(() =>
      expect(screen.getByTestId('connection-status-badge').textContent).toBe('1'),
    );

    await act(async () => {
      await hold('REJECTED');
    });

    await waitFor(() =>
      expect(screen.getByText('1 updates could not be saved')).toBeInTheDocument(),
    );
  });
});

describe('CHROME-C G3 — and only once, and only on arrival', () => {
  test('a phone that already has held bookings says nothing on mount', async () => {
    await hold('PENDING');
    await hold('REJECTED');

    renderShell();
    await waitFor(() => expect(screen.getByTestId('connection-status')).toBeInTheDocument());
    // The badge carries them; nothing shouts. Give the live queries
    // time to resolve before asserting the silence.
    await waitFor(() =>
      expect(screen.getByTestId('connection-status-badge').textContent).toBe('2'),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('taking a held booking back does not re-announce the rest', async () => {
    const first = await hold('PENDING');
    await hold('PENDING');

    renderShell();
    await waitFor(() =>
      expect(screen.getByTestId('connection-status-badge').textContent).toBe('2'),
    );

    await act(async () => {
      await cancelOutboxEntry(first.id!, ALICE);
    });

    await waitFor(() =>
      expect(screen.getByTestId('connection-status-badge').textContent).toBe('1'),
    );
    // A count going DOWN is not news.
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
