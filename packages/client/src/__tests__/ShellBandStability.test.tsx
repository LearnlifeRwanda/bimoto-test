// __TESTS__/SHELL-BAND-STABILITY.TEST.TSX
//
// CHROME-C G4 — the chrome holds still AND covers nothing.
//
// This file has had three shapes, one per answer to the same question.
// PARCEL-PARITY G4 asked whether the four transient strips could stop
// MOVING content, and floated them: the box stopped moving, but the
// always-on "Connected" strip then covered the top 24 px of every
// screen permanently. Option C asks the better question — why is any
// of this on the screen at all — and the answer removes the dilemma:
// ambient status is two words inside the header, events are toasts,
// and anything still waiting is a badge.
//
// So the invariant is stronger than it was, and simpler to state:
// there is no longer any legal difference between the states. The shell
// above <main> is the header, in every state and every combination, and
// the only things allowed over content are a transient toast and a
// surface the user opened.
//
// jsdom has no layout engine — every getBoundingClientRect is zero — so
// this proves the STRUCTURAL invariant that produces the stability, the
// way route-slot-stability.test.tsx (OUTBOX G5) does for the slot it
// pins. The observational half is the completion report.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import 'fake-indexeddb/auto';
import { i18n } from './setup';

const connectionState = vi.fn(() => 'online');
vi.mock('../hooks/useConnectionState', () => ({
  useConnectionState: () => connectionState(),
}));

vi.mock('../sync/connectivity', () => ({
  getNextProbeAt: () => null,
  retryNow: async () => {},
}));

import { AppShell } from '../components/layout/AppShell';
import { EmergencySOS } from '../components/safety/EmergencySOS';
import { db } from '../db/dexie';
import { useAuthStore } from '../stores/auth.store';
import { useUIStore } from '../stores/ui.store';
import { useOutboxStore } from '../stores/outbox.store';
import { enqueueJourneyCreate, newClientId } from '../lib/outbox';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function hold(status: 'PENDING' | 'REJECTED') {
  const clientId = newClientId();
  const entry = await enqueueJourneyCreate({
    userId: ALICE,
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

// QUEUE-UNITY G2 — stamped as ALICE, who is the signed-in user in every
// test below. An unstamped row would now be quarantined and counted by
// nobody, which is the point of the stamp and would make these badge
// assertions test the wrong thing.
async function seedRejectedEvent(id: string, userId: string | null = ALICE) {
  await db.syncEvents.add({
    userId,
    clientEventId: id,
    eventType: 'JOURNEY_CREATED',
    payload: {},
    clientTimestamp: '2026-05-06T12:00:00Z',
    synced: false,
    failReason: 'UNKNOWN: server explosion',
  } as never);
}

function renderShell(children: React.ReactNode = <div data-testid="screen-content">Screen</div>) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<AppShell>{children}</AppShell>} />
        <Route path="/journey/:id/bids" element={<div data-testid="bid-list" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Everything a screen's position can depend on. Under Option C the
 * shell above <main> is one element, so this is short by construction —
 * and its shortness IS the invariant.
 */
function shellShape() {
  const header = screen.getByTestId('app-header');
  const band = header.parentElement as HTMLElement;
  const main = document.querySelector('main') as HTMLElement;
  return {
    bandChildren: Array.from(band.children).map((c) => ({
      tag: c.tagName,
      testid: (c as HTMLElement).dataset.testid ?? null,
    })),
    bandClassName: band.className,
    mainClassName: main.className,
    // The header's own box: h-12 and the safe-area inset are what
    // <main> starts below, and neither may vary with connectivity.
    headerBox: header.className
      .replace(/bg-\[#\w+\]|border-\[#\w+\]|text-\[#\w+\]|bg-white|border-gray-200/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  };
}

const status = () => screen.getByTestId('connection-status').dataset.status;

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      sync: {
        connected: 'Connected',
        syncing: 'Syncing',
        banner: { modalTitle: 'Refused', retry: 'Retry', discard: 'Discard' },
      },
      connection: {
        offline: "You're offline — reconnecting when network returns",
        unreachable: "Can't reach Bimoto — retrying…",
        retryNow: 'Try now',
        backOnline: 'Back online',
        shortOffline: 'Offline',
        shortNoServer: 'No server',
        openDetail: 'open details',
        detailTitle: 'Connection & saved bookings',
      },
      outbox: {
        waitingTitle: 'Waiting to send',
        savedRoute: '{{from}} → {{to}}',
        cancel: 'Cancel this booking',
        sentTitle: 'Your saved booking was sent',
        view: 'View the ride',
        dismiss: 'Dismiss',
        rejectedLabel: 'Saved booking',
        rejectedGeneric: 'The server did not accept this booking.',
        savedToast: 'Saved on this phone',
      },
      emergency: { button: 'EMERGENCY', label: 'Emergency' },
      layout: { mainContent: 'Main content', appHeader: 'Bimoto' },
      common: { close: 'Close' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

  connectionState.mockReturnValue('online');
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

describe('CHROME-C G4 — the shell above <main> is the header, and only the header', () => {
  test('nothing but the header sits above the content', () => {
    renderShell();
    const band = screen.getByTestId('app-header').parentElement as HTMLElement;

    expect(band.children.length).toBe(1);
    expect(band.children[0]).toBe(screen.getByTestId('app-header'));
    // The floating overlay PARCEL-PARITY G4 introduced is gone with the
    // strips it held.
    expect(screen.queryByTestId('shell-transient-band')).toBeNull();
  });

  test('the shell shape is IDENTICAL in every state and every combination', async () => {
    // 1. online, idle — the baseline every other state must match.
    const online = renderShell();
    await waitFor(() => expect(status()).toBe('connected'));
    const baseline = shellShape();
    online.unmount();

    // 2. syncing.
    useUIStore.setState({ isSyncing: true } as never);
    const syncing = renderShell();
    await waitFor(() => expect(status()).toBe('syncing'));
    expect(shellShape()).toEqual(baseline);
    syncing.unmount();
    useUIStore.setState({ isSyncing: false } as never);

    // 3. offline.
    connectionState.mockReturnValue('offline');
    const offline = renderShell();
    await waitFor(() => expect(status()).toBe('offline'));
    expect(shellShape()).toEqual(baseline);
    offline.unmount();

    // 4. unreachable — the one state that washes the header. Even the
    //    wash may only change COLOUR, never the box.
    connectionState.mockReturnValue('unreachable');
    const unreachable = renderShell();
    await waitFor(() => expect(status()).toBe('noServer'));
    expect(shellShape()).toEqual(baseline);
    unreachable.unmount();

    // 5. a rejected held booking.
    connectionState.mockReturnValue('online');
    await hold('REJECTED');
    const rejected = renderShell();
    await waitFor(() =>
      expect(screen.getByTestId('connection-status-badge').textContent).toBe('1'),
    );
    expect(shellShape()).toEqual(baseline);
    rejected.unmount();
    await db.outbox.clear();

    // 6. a held booking waiting to go out.
    await hold('PENDING');
    const pending = renderShell();
    await waitFor(() =>
      expect(screen.getByTestId('connection-status-badge').textContent).toBe('1'),
    );
    expect(shellShape()).toEqual(baseline);
    pending.unmount();

    // 7. ALL AT ONCE — offline, a refusal, a held booking and an
    //    unviewed offer. The 199 px worst case PARCEL-PARITY G4
    //    measured; now indistinguishable from idle.
    connectionState.mockReturnValue('offline');
    await hold('REJECTED');
    await seedRejectedEvent('e1');
    useOutboxStore.setState({
      lastSent: { journeyId: 'j9', pickupName: 'A', destinationName: 'B' },
    });
    const everything = renderShell();
    await waitFor(() =>
      expect(screen.getByTestId('connection-status-badge').textContent).toBe('4'),
    );
    expect(shellShape()).toEqual(baseline);
  });

  test('the wash is reserved for No server and changes colour only', async () => {
    connectionState.mockReturnValue('offline');
    const offline = renderShell();
    await waitFor(() => expect(status()).toBe('offline'));
    expect(screen.getByTestId('app-header').dataset.washed).toBe('false');
    offline.unmount();

    connectionState.mockReturnValue('unreachable');
    renderShell();
    await waitFor(() => expect(status()).toBe('noServer'));
    const header = screen.getByTestId('app-header');
    expect(header.dataset.washed).toBe('true');
    expect(header.className).toContain('bg-[#FCEBEB]');
    expect(header.className).toContain('border-[#F7C1C1]');
    expect(header.className).toContain('text-[#791F1F]');
  });
});

describe('CHROME-C G4 — the severity ladder renders its own values', () => {
  const cases: Array<[string, string, string[]]> = [
    ['connected', 'connected', ['bg-[#EAF3DE]', 'text-[#27500A]']],
    ['offline', 'offline', ['bg-[#C9821E]', 'text-white']],
    ['unreachable', 'noServer', ['bg-[#A32D2D]', 'text-white']],
  ];

  for (const [connection, kind, classes] of cases) {
    test(`${connection} renders the ${kind} pill`, async () => {
      connectionState.mockReturnValue(connection);
      renderShell();
      await waitFor(() => expect(status()).toBe(kind));
      const pill = screen.getByTestId('connection-status');
      for (const c of classes) expect(pill.className).toContain(c);
    });
  }

  test('the calm states carry the green dot; syncing carries a spinner', async () => {
    const online = renderShell();
    await waitFor(() => expect(status()).toBe('connected'));
    expect(screen.getByTestId('connection-status-dot').className).toContain('bg-[#639922]');
    online.unmount();

    useUIStore.setState({ isSyncing: true } as never);
    renderShell();
    await waitFor(() => expect(status()).toBe('syncing'));
    // Spinner replaces the dot — same pill, no second shape.
    expect(screen.queryByTestId('connection-status-dot')).toBeNull();
  });

  test('the badge carries the §0 red and the true count', async () => {
    await hold('PENDING');
    await seedRejectedEvent('e-badge');
    renderShell();

    const badge = await waitFor(() => {
      const b = screen.getByTestId('connection-status-badge');
      // Both queues feed one badge: a held booking and a refused sync
      // event are two things waiting, not two badges.
      expect(b.textContent).toBe('2');
      return b;
    });
    expect(badge.className).toContain('bg-[#E24B4A]');
    expect(badge.className).toContain('text-white');
  });

  test('no badge when nothing needs attention', async () => {
    renderShell();
    await waitFor(() => expect(status()).toBe('connected'));
    expect(screen.queryByTestId('connection-status-badge')).toBeNull();
  });
});

describe('CHROME-C G4 — every relocated action is still reachable', () => {
  /** The pill is the only door, exactly as a user has it. */
  const openSheet = () => fireEvent.click(screen.getByTestId('connection-status'));

  test('Try now — from ConnectionBanner', async () => {
    connectionState.mockReturnValue('unreachable');
    renderShell();
    await waitFor(() => expect(status()).toBe('noServer'));

    // Nothing is on the screen until asked.
    expect(screen.queryByTestId('status-detail-sheet')).toBeNull();
    openSheet();

    expect(screen.getByTestId('status-detail-sheet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try now' })).toBeInTheDocument();
  });

  test('Cancel a held booking — from OutboxBanner pending', async () => {
    const entry = await hold('PENDING');
    renderShell();
    await waitFor(() => screen.getByTestId('connection-status-badge'));
    openSheet();

    expect(
      await screen.findByTestId(`outbox-cancel-${entry.clientId}`),
    ).toBeInTheDocument();
  });

  test('View the ride — from OutboxBanner sent', async () => {
    useOutboxStore.setState({
      lastSent: { journeyId: 'j9', pickupName: 'A', destinationName: 'B' },
    });
    renderShell();
    await waitFor(() => screen.getByTestId('connection-status-badge'));
    openSheet();

    // Still an OFFER, never a navigation.
    expect(screen.queryByTestId('bid-list')).toBeNull();
    fireEvent.click(screen.getByTestId('outbox-sent-view'));
    await screen.findByTestId('bid-list');
  });

  test('Retry and Discard a refused sync event — from RejectedEventsBanner', async () => {
    await seedRejectedEvent('e-actions');
    renderShell();
    await waitFor(() => screen.getByTestId('connection-status-badge'));
    openSheet();

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });

  test('Discard a refused booking — from RejectedEventsBanner', async () => {
    const entry = await hold('REJECTED');
    renderShell();
    await waitFor(() => screen.getByTestId('connection-status-badge'));
    openSheet();

    expect(
      await screen.findByTestId(`outbox-discard-${entry.clientId}`),
    ).toBeInTheDocument();
  });
});

describe('CHROME-C G4 — the ladder above and below is untouched', () => {
  test('the permanent chrome keeps its band, and <main> its reserve', () => {
    renderShell();
    const band = screen.getByTestId('app-header').parentElement as HTMLElement;
    const main = document.querySelector('main') as HTMLElement;

    // z-10: above the full-bleed map (fixed z-0), below the bottom
    // sheet (z-30), BottomNav (z-40), the SOS (z-50) and Toast (z-[60]).
    expect(band.className).toContain('z-10');
    expect(main.className).toContain('pb-20');
    expect(main.parentElement?.lastElementChild?.tagName).toBe('NAV');
  });

  test('the SOS stays unobstructed with every state at once', async () => {
    connectionState.mockReturnValue('unreachable');
    await hold('PENDING');
    await hold('REJECTED');

    renderShell(<EmergencySOS journeyId="gj-1" />);
    await waitFor(() => expect(status()).toBe('noServer'));
    await waitFor(() =>
      expect(screen.getByTestId('connection-status-badge').textContent).toBe('2'),
    );

    const sos = screen.getByRole('button', { name: 'EMERGENCY' });
    // Opposite end of the screen from the header, and above every layer
    // it could meet in any case.
    expect(sos.className).toContain('bottom-24');
    expect(sos.className).toContain('right-4');
    expect(sos.className).toContain('z-50');
    expect(screen.getByTestId('app-header').contains(sos)).toBe(false);
  });

  test('the picker overlay no longer sits on the header', async () => {
    // CHROME-C G2 moved LocationPickerMap's overlay clear of the band.
    // Asserted from the source so the fix cannot be quietly undone by a
    // later edit to a file this test does not render.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src/components/map/LocationPickerMap.tsx'),
      'utf8',
    );
    expect(src).toContain('top-[calc(env(safe-area-inset-top)+3.5rem)]');
    expect(src).not.toContain('fixed inset-x-0 top-3 z-20');
  });
});
