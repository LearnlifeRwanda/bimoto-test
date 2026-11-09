// __TESTS__/OUTBOX-BANNER.TEST.TSX
//
// OUTBOX G3 — the shell surfaces, including the one that must stay
// empty: a phone that has changed hands shows its new user nothing of
// the previous one's held bookings.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import 'fake-indexeddb/auto';
import { i18n } from './setup';

import { OutboxPanel } from '../components/sync/OutboxPanel';
import { RejectedItemsPanel } from '../components/sync/RejectedItemsPanel';

// CHROME-C G2 — was OutboxBanner.test.tsx. The two strips are gone: the
// waiting count and the sent offer are both header-badge contributions
// now, and these lists are sections of the status detail sheet. Every
// claim below is the original one — including the two that matter most,
// that a sent booking is OFFERED and never navigated to, and that a
// borrowed phone shows its new user nothing of the previous one's.
import { db } from '../db/dexie';
import { useAuthStore } from '../stores/auth.store';
import { useOutboxStore } from '../stores/outbox.store';
import { enqueueJourneyCreate, newClientId, listOutbox } from '../lib/outbox';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BROTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function hold(userId: string, status: 'PENDING' | 'REJECTED' = 'PENDING') {
  const clientId = newClientId();
  const entry = await enqueueJourneyCreate({
    userId,
    clientId,
    payload: {
      clientRequestId: clientId,
      pickupName: 'Sonatubes',
      destinationName: 'Giporoso',
    },
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

function signIn(userId: string) {
  useAuthStore.setState({
    user: { id: userId, role: 'CUSTOMER' } as any,
    isAuthenticated: true,
    token: 'tok',
  } as any);
}

function renderBanner(node: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<>{node}</>} />
        <Route path="/journey/:id/bids" element={<div data-testid="bid-list" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await db.outbox.clear();
  await db.syncEvents.clear();
  useOutboxStore.setState({ lastSent: null });
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      outbox: {
        savedRoute: '{{from}} → {{to}}',
        cancel: 'Cancel this booking',
        waitingTitle: 'Waiting to send',
        waitingCount_one: '{{count}} booking saved on this phone',
        waitingCount_other: '{{count}} bookings saved on this phone',
        waitingCount: '{{count}} bookings saved on this phone',
        empty: 'Nothing is waiting to be sent.',
        sentTitle: 'Your saved booking was sent',
        view: 'View the ride',
        dismiss: 'Dismiss',
        rejectedLabel: 'Saved booking',
        rejectedGeneric: 'The server did not accept this booking.',
      },
      errors: { accountFlagged: 'Your account is under review.' },
      sync: {
        banner: {
          failedCount_one: '{{count}} sync event failed — tap to review',
          failedCount_other: '{{count}} sync events failed — tap to review',
          failedCount: '{{count}} updates failed to sync',
          modalTitle: 'Failed sync events',
          discard: 'Discard',
          retry: 'Retry',
          empty: 'No failed events.',
        },
      },
      common: { close: 'Close' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  signIn(ALICE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OutboxPanel — what is waiting', () => {
  test('shows the count of this user’s held bookings', async () => {
    await hold(ALICE);
    await hold(ALICE);
    renderBanner(<OutboxPanel />);

    // Both held bookings are listed. The COUNT moved to the header
    // badge, asserted in ShellBandStability.test.tsx off the same query.
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
  });

  test('a borrowed phone shows its new user nothing of the previous one’s', async () => {
    await hold(ALICE);
    signIn(BROTHER);
    renderBanner(<OutboxPanel />);

    // Give the live query a chance to answer before asserting absence.
    await waitFor(() => expect(screen.queryByTestId('outbox-panel')).toBeNull());
    // Still hers, untouched.
    expect(await listOutbox(ALICE)).toHaveLength(1);
  });

  test('the held booking can be taken back from the shell', async () => {
    const entry = await hold(ALICE);
    renderBanner(<OutboxPanel />);

    fireEvent.click(await screen.findByTestId(`outbox-cancel-${entry.clientId}`));

    await waitFor(async () => expect(await listOutbox(ALICE)).toEqual([]));
  });

  test('a sent booking is OFFERED, not navigated to', async () => {
    useOutboxStore.setState({
      lastSent: { journeyId: 'j9', pickupName: 'Sonatubes', destinationName: 'Giporoso' },
    });
    renderBanner(<OutboxPanel />);

    // Nothing moved on its own.
    expect(screen.queryByTestId('bid-list')).toBeNull();
    const offer = await screen.findByTestId('outbox-sent-offer');
    expect(offer.textContent).toContain('Your saved booking was sent');

    // Only the passenger's own tap moves them.
    fireEvent.click(screen.getByTestId('outbox-sent-view'));
    await screen.findByTestId('bid-list');
  });

  test('the offer can be dismissed without going anywhere', async () => {
    useOutboxStore.setState({
      lastSent: { journeyId: 'j9', pickupName: 'A', destinationName: 'B' },
    });
    renderBanner(<OutboxPanel />);

    fireEvent.click(await screen.findByTestId('outbox-sent-dismiss'));
    await waitFor(() => expect(screen.queryByTestId('outbox-sent-offer')).toBeNull());
    expect(screen.queryByTestId('bid-list')).toBeNull();
  });
});

describe('RejectedItemsPanel — refused bookings join the existing surface', () => {
  test('a refused booking shows the server’s own reason and offers no retry', async () => {
    const entry = await hold(ALICE, 'REJECTED');
    renderBanner(<RejectedItemsPanel />);

    const reason = await screen.findByTestId(`outbox-rejected-reason-${entry.clientId}`);
    expect(reason.textContent).toBe('Your account is under review.');
    // Discard, yes. Retry, never — the server answered.
    expect(screen.getByTestId(`outbox-discard-${entry.clientId}`)).toBeInTheDocument();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  test('a refused booking belonging to someone else is not shown at all', async () => {
    await hold(ALICE, 'REJECTED');
    signIn(BROTHER);
    renderBanner(<RejectedItemsPanel />);

    await waitFor(() => expect(screen.queryByTestId('rejected-items-panel')).toBeNull());
  });

  test('discarding a refused booking removes it', async () => {
    const entry = await hold(ALICE, 'REJECTED');
    renderBanner(<RejectedItemsPanel />);

    fireEvent.click(await screen.findByTestId(`outbox-discard-${entry.clientId}`));

    await waitFor(async () => expect(await listOutbox(ALICE)).toEqual([]));
  });
});
