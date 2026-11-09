// GAP-CLOSE G3 — the scheduled-ride re-access hole (team item lmHAk6VU-3:
// "when you leave the confirmation page of a scheduled ride you cannot
// access it back").
//
// PAGE-mounted (MONEY-PIN #203's placement rule): the real HistoryPage at
// its real route, because what was broken is what the SCREEN did with rows
// it already had — not what any component did with props.
//
// The list's own query is the reason no second fetch was added:
// GET /api/journeys?history=true is not filtered to past rides, so
// getJourneys runs with status undefined and returns every journey of
// this customer. SCHEDULED rows were arriving all along and rendering as
// inert history rows. The fixtures below are that response verbatim.
//
// RIDES-REACH G1 — `history` IS a declared key now (journeyQuerySchema),
// and on the DRIVER arm it selects `where: { driverId }`. This file is
// the CUSTOMER half and is unchanged by that: her arm reads the flag and
// ignores it, because `customerId: userId` is already her whole answer.
// The driver half of the same screen is pinned in
// RidesReach-history-driver.test.tsx.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

import { HistoryPage } from '../pages/shared/HistoryPage';
import { useAuthStore } from '../stores/auth.store';
import { _resetConnectivityForTests } from '../sync/connectivity';

const PAST = {
  id: 'j-past',
  pickupName: 'Kimironko Market',
  destinationName: 'Kigali Heights',
  status: 'COMPLETED',
  agreedPrice: 2000,
  createdAt: '2026-07-20T10:00:00Z',
};

const SCHEDULED = {
  id: 'j-sched',
  pickupName: 'Nyabugogo',
  destinationName: 'Kigali Airport',
  status: 'SCHEDULED',
  createdAt: '2026-08-01T09:00:00Z',
  scheduledFor: '2026-08-26T07:30:00.000Z',
  bidWindowOpensAt: '2026-08-26T06:30:00.000Z',
};

const SCHEDULED_LATER = {
  id: 'j-sched-2',
  pickupName: 'Remera',
  destinationName: 'Musanze',
  status: 'SCHEDULED',
  createdAt: '2026-08-02T09:00:00Z',
  scheduledFor: '2026-08-28T14:00:00.000Z',
  bidWindowOpensAt: '2026-08-28T13:00:00.000Z',
};

beforeEach(async () => {
  _resetConnectivityForTests();
  useAuthStore.setState({ token: 'tok' } as any);
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      common: { retry: 'Retry' },
      states: { loadFailed: "This couldn't load", loadFailedHint: 'Try again.' },
      history: {
        title: 'My rides',
        empty: 'No rides yet',
        emptyHint: 'Request your first ride and it will appear here.',
      },
      scheduled: { upcomingTitle: 'Upcoming rides' },
      status: {
        COMPLETED: 'Completed',
        SCHEDULED: 'Scheduled',
        REQUESTED: 'Requested',
        MATCHED: 'Matched',
      },
      receipt: { viewReceipt: 'View receipt' },
      transparency: { platformFee: 'Platform fee' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetConnectivityForTests();
});

function stubFetchOk(body: unknown) {
  const mock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

// Mounted with the /journey/:id/scheduled route present so the navigation
// is asserted against the REAL route table entry, not a mock.
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/rides']}>
      <Routes>
        <Route path="/rides" element={<HistoryPage />} />
        <Route
          path="/journey/:id/scheduled"
          element={<div data-testid="scheduled-ride-page-stub" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('HistoryPage upcoming section (GAP-CLOSE G3)', () => {
  test('a SCHEDULED row renders in the Upcoming section, with destination and time', async () => {
    stubFetchOk([PAST, SCHEDULED]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-upcoming-section')).toBeInTheDocument(),
    );
    const row = screen.getByTestId('history-upcoming-row-j-sched');
    expect(row.textContent).toContain('Kigali Airport');
    // The pickup time, device-locale formatted — assert on the date parts
    // the formatter cannot drop rather than on a fixed locale string.
    expect(row.textContent).toMatch(/2026/);
    expect(screen.getByText('Upcoming rides')).toBeInTheDocument();
  });

  test('tapping an upcoming row opens ScheduledRidePage', async () => {
    stubFetchOk([PAST, SCHEDULED]);
    renderPage();

    const row = await screen.findByTestId('history-upcoming-row-j-sched');
    fireEvent.click(row);

    await waitFor(() =>
      expect(screen.getByTestId('scheduled-ride-page-stub')).toBeInTheDocument(),
    );
  });

  test('soonest first', async () => {
    // Server order is createdAt desc, so the later pickup arrives first.
    stubFetchOk([SCHEDULED_LATER, SCHEDULED, PAST]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-upcoming-section')).toBeInTheDocument(),
    );
    const rows = screen
      .getAllByTestId(/^history-upcoming-row-/)
      .map((el) => el.getAttribute('data-testid'));
    expect(rows).toEqual(['history-upcoming-row-j-sched', 'history-upcoming-row-j-sched-2']);
  });

  test('no SCHEDULED rides: the section is absent entirely', async () => {
    stubFetchOk([PAST]);
    renderPage();

    await waitFor(() => expect(screen.getByText(/Kimironko/)).toBeInTheDocument());
    expect(screen.queryByTestId('history-upcoming-section')).not.toBeInTheDocument();
    expect(screen.queryByText('Upcoming rides')).not.toBeInTheDocument();
  });

  test('a SCHEDULED row no longer sits in the history list below', async () => {
    stubFetchOk([PAST, SCHEDULED]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-upcoming-section')).toBeInTheDocument(),
    );
    // It moved, it was not duplicated: the scheduled ride's PICKUP name
    // appears nowhere (the upcoming row shows the destination only), and
    // its destination appears exactly once.
    expect(screen.queryByText('Nyabugogo')).not.toBeInTheDocument();
    expect(screen.getAllByText('Kigali Airport')).toHaveLength(1);
  });
});

describe('HistoryPage history behaviour is unchanged (GAP-CLOSE G3)', () => {
  test('a past ride still expands and still offers its receipt', async () => {
    stubFetchOk([PAST]);
    renderPage();

    const row = await screen.findByText(/Kimironko/);
    // Receipt link is behind the expander, exactly as before.
    expect(screen.queryByTestId('history-receipt-link-j-past')).not.toBeInTheDocument();
    fireEvent.click(row);
    await waitFor(() =>
      expect(screen.getByTestId('history-receipt-link-j-past')).toBeInTheDocument(),
    );
  });

  test('empty response still renders the empty state, not an empty Upcoming section', async () => {
    stubFetchOk([]);
    renderPage();

    expect(await screen.findByText('No rides yet')).toBeInTheDocument();
    expect(screen.queryByTestId('history-upcoming-section')).not.toBeInTheDocument();
  });

  test('failed load still renders the retryable error state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    renderPage();

    expect(await screen.findByText("This couldn't load")).toBeInTheDocument();
    expect(screen.queryByText('No rides yet')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-upcoming-section')).not.toBeInTheDocument();
  });

  test('the page still issues exactly ONE request — no second query was added', async () => {
    const mock = stubFetchOk([PAST, SCHEDULED]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-upcoming-section')).toBeInTheDocument(),
    );
    expect(mock).toHaveBeenCalledTimes(1);
    const [requestedUrl] = mock.mock.calls[0] as unknown as [RequestInfo | URL];
    expect(String(requestedUrl)).toContain('/api/journeys');
  });
});

// CLEAN-SWEEP G2 — the row survives the window flip.
//
// The bid-window-opener job (jobs/bid-window-opener.job.ts) flips
// SCHEDULED -> REQUESTED an hour before pickup, and GAP-CLOSE's partition
// keyed on SCHEDULED alone. At the flip the row left Upcoming and landed
// in the history list as an inert row — the dead state GAP-CLOSE had just
// cured, returning at the worst moment: the one where the ride has just
// started attracting bids.
//
// PAGE-mounted, and ACROSS the flip: the SAME ride, both statuses, in one
// test. A pair of separate tests would each pass against a partition that
// duplicated the row.
describe('HistoryPage across the bid-window flip (CLEAN-SWEEP G2)', () => {
  // One ride. `scheduledFor` is what makes it scheduled-ORIGIN; the job
  // changes the status and nothing else.
  const BEFORE_FLIP = {
    id: 'j-flip',
    pickupName: 'Nyabugogo',
    destinationName: 'Kigali Airport',
    status: 'SCHEDULED',
    createdAt: '2026-08-01T09:00:00Z',
    scheduledFor: '2026-08-26T07:30:00.000Z',
    bidWindowOpensAt: '2026-08-26T06:30:00.000Z',
  };
  const AFTER_FLIP = { ...BEFORE_FLIP, status: 'REQUESTED' };

  test('the same ride is in Upcoming before AND after the flip — moved, never duplicated', async () => {
    for (const [label, row] of [
      ['before the flip (SCHEDULED)', BEFORE_FLIP],
      ['after the flip (REQUESTED)', AFTER_FLIP],
    ] as const) {
      stubFetchOk([PAST, row]);
      const { unmount } = renderPage();

      await waitFor(() =>
        expect(screen.getByTestId('history-upcoming-section')).toBeInTheDocument(),
      );

      // Present in Upcoming, once.
      const rows = screen.getAllByTestId('history-upcoming-row-j-flip');
      expect(rows, `${label}: exactly one Upcoming row`).toHaveLength(1);
      expect(rows[0].textContent).toContain('Kigali Airport');

      // And NOT also in the list below. The lower list renders a status
      // pill; the Upcoming row does not. A duplicated row would put the
      // ride's status label on the screen.
      expect(screen.queryByText('Requested'), `${label}: not duplicated below`).toBeNull();
      expect(screen.queryByText('Scheduled'), `${label}: not duplicated below`).toBeNull();

      // The past row is still where it belongs, both times.
      expect(screen.getByText('Completed')).toBeInTheDocument();

      unmount();
      vi.unstubAllGlobals();
    }
  });

  test('after the flip the row still opens ScheduledRidePage, which hands over to the bid list', async () => {
    stubFetchOk([AFTER_FLIP]);
    renderPage();

    const row = await screen.findByTestId('history-upcoming-row-j-flip');
    fireEvent.click(row);

    await waitFor(() =>
      expect(screen.getByTestId('scheduled-ride-page-stub')).toBeInTheDocument(),
    );
  });

  test('an INSTANT hail in REQUESTED is not a scheduled ride and stays in the list below', async () => {
    // `scheduledFor` is the discriminator, not the status: widening on
    // status alone would have swept every open instant request into
    // "Upcoming rides".
    const INSTANT = {
      id: 'j-instant',
      pickupName: 'Remera',
      destinationName: 'Kimironko',
      status: 'REQUESTED',
      createdAt: '2026-08-24T09:00:00Z',
    };
    stubFetchOk([INSTANT]);
    renderPage();

    await waitFor(() => expect(screen.getByText('Kimironko')).toBeInTheDocument());
    expect(screen.queryByTestId('history-upcoming-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-upcoming-row-j-instant')).not.toBeInTheDocument();
    expect(screen.getByText('Requested')).toBeInTheDocument();
  });

  test('a MATCHED scheduled ride has a driver and belongs to the list below', async () => {
    stubFetchOk([{ ...BEFORE_FLIP, status: 'MATCHED' }]);
    renderPage();

    await waitFor(() => expect(screen.getByText('Matched')).toBeInTheDocument());
    expect(screen.queryByTestId('history-upcoming-row-j-flip')).not.toBeInTheDocument();
  });

  // CLEAN-SWEEP G2 — the colourless pill. Five of the ten JourneyStatus
  // values had no STATUS_COLORS entry and fell through to grey, MATCHED
  // and REQUESTED among them — the two a scheduled-origin row reaches
  // right after leaving Upcoming.
  test('every status a row can carry has a colour, not the grey fallback', async () => {
    const STATUSES = [
      'SCHEDULED', 'REQUESTED', 'MATCHED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION',
      'COMPLETED', 'CANCELLED', 'INTERRUPTED', 'DISPUTED', 'EXPIRED',
    ];
    const { STATUS_COLORS } = await import('../pages/shared/HistoryPage');
    for (const s of STATUSES) {
      expect(STATUS_COLORS[s as keyof typeof STATUS_COLORS], `${s} has a colour`).toBeTruthy();
    }
    expect(Object.keys(STATUS_COLORS).sort()).toEqual([...STATUSES].sort());
  });
});
