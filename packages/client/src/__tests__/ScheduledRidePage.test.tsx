// SCHED-UI G6 — customer scheduled state screen: pickup time,
// bidding-opens time (scheduledFor - 60 min), fallback note, cancel via
// the existing journey-cancel flow, and hand-off to the bid list once
// the window has opened.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<any>);
  return { ...actual, useNavigate: () => mockNavigate };
});

import { ScheduledRidePage } from '../pages/customer/ScheduledRidePage';
import { useAuthStore } from '../stores/auth.store';
import { formatScheduledDateTime } from '../lib/scheduled';

const JOURNEY = {
  id: 'j1',
  status: 'SCHEDULED',
  bookingMode: 'SCHEDULED',
  scheduledFor: '2026-07-24T07:30:00.000Z',
  pickupName: 'Kimironko Market',
  destinationName: 'Kigali Heights',
};

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      scheduled: {
        title: 'Ride scheduled',
        pickupAt: 'Pickup: {{time}}',
        biddingOpensAt: 'Drivers can bid from {{time}}',
        fallbackNote: 'fallback note',
        waitingNote: 'waiting note',
        cancelRide: 'Cancel scheduled ride',
        cancelConfirmTitle: 'Cancel this scheduled ride?',
        cancelConfirmBody: 'Your scheduled pickup will be cancelled.',
        viewOffers: 'View offers',
      },
      matched: { cancelled: 'Cancelled', cancelFailed: 'Cancel failed' },
      common: { back: 'Back' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  mockNavigate.mockReset();
  useAuthStore.setState({ token: 'tok' } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubFetch(journey: any) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: any) => {
    const u = String(url);
    if (u.endsWith('/api/journeys/j1/cancel') && init?.method === 'POST') {
      return new Response(JSON.stringify({ id: 'j1', status: 'CANCELLED' }), { status: 200 });
    }
    if (u.endsWith('/api/journeys/j1')) {
      return new Response(JSON.stringify(journey), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/journey/j1/scheduled']}>
      <Routes>
        <Route path="/journey/:id/scheduled" element={<ScheduledRidePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ScheduledRidePage', () => {
  test('shows pickup time, bidding-opens time and fallback note', async () => {
    stubFetch(JOURNEY);
    renderPage();
    await screen.findByTestId('scheduled-state-screen');

    const pickupTime = formatScheduledDateTime(JOURNEY.scheduledFor);
    const opensTime = formatScheduledDateTime(
      new Date(new Date(JOURNEY.scheduledFor).getTime() - 60 * 60 * 1000).toISOString(),
    );
    expect(screen.getByTestId('scheduled-pickup-time').textContent).toBe(
      `Pickup: ${pickupTime}`,
    );
    expect(screen.getByTestId('scheduled-bidding-opens').textContent).toBe(
      `Drivers can bid from ${opensTime}`,
    );
    expect(screen.getByTestId('scheduled-fallback-note').textContent).toBe('fallback note');
    expect(screen.getByText('waiting note')).toBeInTheDocument();
  });

  test('cancel confirms through the existing journey-cancel flow', async () => {
    const fetchMock = stubFetch(JOURNEY);
    renderPage();
    await screen.findByTestId('scheduled-state-screen');

    fireEvent.click(screen.getByTestId('scheduled-cancel-button'));
    fireEvent.click(await screen.findByTestId('scheduled-cancel-confirm'));

    await waitFor(() => {
      const cancelCall = fetchMock.mock.calls.find(([u, init]: any[]) =>
        String(u).endsWith('/api/journeys/j1/cancel') && init?.method === 'POST',
      );
      expect(cancelCall).toBeDefined();
      expect(JSON.parse((cancelCall![1] as any).body)).toEqual({
        reason: 'CUSTOMER_CHANGED_MIND',
      });
    });
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }),
    );
  });

  test('hands over to the bid list once the window has opened (REQUESTED)', async () => {
    stubFetch({ ...JOURNEY, status: 'REQUESTED' });
    renderPage();
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/journey/j1/bids', { replace: true }),
    );
  });
});

// GAP-CLOSE G3 — the way in to the offers.
//
// The bid-window-opener job flips SCHEDULED -> REQUESTED, and the loader
// hands over to the bid list the moment it sees REQUESTED. Between
// bidWindowOpensAt passing and that job's next tick the ride sits on this
// screen with offers already arriving and nothing to open them with.
//
// PAGE-mounted: the link's whole condition is a field of the payload this
// SCREEN fetches, so the screen is what has to be mounted to test it.
describe('ScheduledRidePage view-offers link (GAP-CLOSE G3)', () => {
  // Stamps are relative to the running clock, not absolute. The condition
  // under test is "the stamp is in the past", and an absolute fixture
  // would quietly change meaning as it aged. (Fake timers are not an
  // option here: the page's own loader is async, and a frozen clock
  // deadlocks findBy*'s polling.)
  const MINUTE = 60 * 1000;
  const ago = (mins: number) => new Date(Date.now() - mins * MINUTE).toISOString();
  const ahead = (mins: number) => new Date(Date.now() + mins * MINUTE).toISOString();

  test('window OPEN (bidWindowOpensAt has passed): the link is there and opens /bids', async () => {
    stubFetch({
      ...JOURNEY,
      scheduledFor: ahead(45),
      bidWindowOpensAt: ago(15),
    });
    renderPage();
    await screen.findByTestId('scheduled-state-screen');

    const link = screen.getByTestId('scheduled-view-offers');
    expect(link.textContent).toContain('View offers');

    fireEvent.click(link);
    expect(mockNavigate).toHaveBeenCalledWith('/journey/j1/bids');
  });

  test('window NOT open yet: no link — the bid list would be empty by design', async () => {
    stubFetch({
      ...JOURNEY,
      scheduledFor: ahead(135),
      bidWindowOpensAt: ahead(75),
    });
    renderPage();
    await screen.findByTestId('scheduled-state-screen');

    expect(screen.queryByTestId('scheduled-view-offers')).not.toBeInTheDocument();
  });

  test('no bidWindowOpensAt on the row at all: no link, and the screen still renders', async () => {
    stubFetch(JOURNEY);
    renderPage();
    await screen.findByTestId('scheduled-state-screen');

    expect(screen.queryByTestId('scheduled-view-offers')).not.toBeInTheDocument();
    // The rest of the screen is untouched.
    expect(screen.getByTestId('scheduled-cancel-button')).toBeInTheDocument();
    expect(screen.getByText('waiting note')).toBeInTheDocument();
  });
});
