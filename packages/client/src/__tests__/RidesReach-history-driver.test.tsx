// RIDES-REACH G2 — the motari's Rides tab, alive.
//
// `/rides` is a DRIVER bottom-nav tab (BottomNav.tsx driverTabs, added
// once real DRIVER-role accounts existed). It fetches
// GET /api/journeys?history=true with no coordinates, and until
// RIDES-REACH G1 the server's driver arm threw 400 LOCATION_REQUIRED
// before it reached any branch — so the tab rendered an ErrorState for
// every motari, and the driver settlement view MONEY-VIEW (#207) built
// for exactly this list was unreachable from the only screen that shows
// it.
//
// PAGE-mounted (MONEY-PIN #203's placement rule): the real HistoryPage at
// its real route. Nothing in the page changed for this — the point is
// that nothing HAD to. The client half of the fix is the server's
// response now arriving at all, and these fixtures are that response.
//
// SHAPE, NOT ROLE. HistoryPage reads no role and gets no new conditional:
// the driver money block is the one CLEAN-SWEEP/#207 already guard with
// `hasFullCommissionBreakdown`, and the customer variant is guarded with
// `!full && hasCustomerSafeCommission`. A driver's row satisfies the full
// predicate because the server sends him the full settlement; a
// passenger's row satisfies only the safe four. The screen sorts itself
// out from the payload, which is the standing pattern.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

import { HistoryPage } from '../pages/shared/HistoryPage';
import { useAuthStore } from '../stores/auth.store';
import { _resetConnectivityForTests } from '../sync/connectivity';

const DRIVER_ID = 'd1';

/**
 * A ride he drove, exactly as `getJourneys`' driver arm now returns it:
 * `where: { driverId }`, and `toDriverSettlementCommission` attached on
 * the rows he is the driver of.
 */
const DRIVEN_COMPLETED = {
  id: 'j-driven',
  pickupName: 'Kimironko Market',
  destinationName: 'Kigali Heights',
  status: 'COMPLETED',
  agreedPrice: 2000,
  createdAt: '2026-08-20T10:00:00Z',
  driverId: DRIVER_ID,
  commissionBreakdown: {
    bidPrice: 2000,
    driverTier: 'REGULAR',
    driverCommissionRate: 0.1,
    customerTier: 'REGULAR',
    customerCommissionRate: 0.05,
    totalCommissionRate: 0.15,
    totalCommissionAmount: 300,
    driverPayout: 1700,
    customerSavings: 0,
    driverSavings: 0,
    feeWaiverApplied: false,
    chargedCommissionAmount: 300,
    waivedCommissionAmount: 0,
  },
};

/** A second driven ride, still running — no settlement yet, so no money block. */
const DRIVEN_IN_PROGRESS = {
  id: 'j-driving-now',
  pickupName: 'Nyabugogo',
  destinationName: 'Remera',
  status: 'IN_PROGRESS',
  createdAt: '2026-08-21T08:00:00Z',
  driverId: DRIVER_ID,
};

/**
 * A ride he drove for a passenger who had BOOKED IT FOR LATER. The
 * `scheduledFor` column is on the JOURNEY, so it comes back on his row
 * too — which is exactly the trap: `isUpcomingScheduledRide` must not
 * put a ride he is already driving into a passenger's "Upcoming"
 * section. It does not, because the predicate is scheduled-origin AND
 * pre-match (SCHEDULED | REQUESTED), and a ride with a driver is neither.
 */
const DRIVEN_FROM_A_BOOKING = {
  id: 'j-was-scheduled',
  pickupName: 'Kicukiro',
  destinationName: 'Kigali Airport',
  status: 'MATCHED',
  createdAt: '2026-08-19T09:00:00Z',
  scheduledFor: '2026-08-30T07:30:00.000Z',
  bidWindowOpensAt: '2026-08-30T06:30:00.000Z',
  driverId: DRIVER_ID,
};

beforeEach(async () => {
  _resetConnectivityForTests();
  useAuthStore.setState({
    token: 'tok',
    user: { id: DRIVER_ID, role: 'DRIVER' } as any,
  } as any);
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
        IN_PROGRESS: 'On the way',
        MATCHED: 'Matched',
        SCHEDULED: 'Scheduled',
        REQUESTED: 'Requested',
      },
      receipt: { viewReceipt: 'View receipt' },
      transparency: {
        platformFee: 'Platform fee',
        totalPaid: 'Total paid',
        driverCommission: 'Driver commission ({{tier}}, {{rate}}%)',
        customerCommission: 'Customer commission ({{tier}}, {{rate}}%)',
        netReceived: 'You receive',
        feeWaivedChip: 'Fee waived',
        feeWaivedAmount: 'Waived {{amount}}',
        customerTierLine: 'Your tier: {{tier}}',
        tierSavings: '{{tier}} saved you {{amount}}',
        customerFeeWaived: 'Fee waived',
      },
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/rides']}>
      <Routes>
        <Route path="/rides" element={<HistoryPage />} />
        <Route path="/journey/:id/receipt" element={<div data-testid="receipt-stub" />} />
        <Route
          path="/journey/:id/scheduled"
          element={<div data-testid="scheduled-ride-page-stub" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RIDES-REACH G2 — a motari opens his Rides tab', () => {
  test('his driven rides render, and there is no ErrorState', async () => {
    const fetchMock = stubFetchOk([
      DRIVEN_IN_PROGRESS,
      DRIVEN_COMPLETED,
      DRIVEN_FROM_A_BOOKING,
    ]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-row-j-driven')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('history-row-j-driving-now')).toBeInTheDocument();
    expect(screen.getByTestId('history-row-j-was-scheduled')).toBeInTheDocument();

    // The screen this dispatch exists to revive: not the error one.
    expect(screen.queryByText("This couldn't load")).not.toBeInTheDocument();
    expect(screen.queryByText('No rides yet')).not.toBeInTheDocument();

    // And the request it made is the one the server now answers — the
    // fetch is UNCHANGED by this dispatch, which is the finding.
    const url = String((fetchMock.mock.calls[0] as any[])[0]);
    expect(url).toContain('/api/journeys');
    expect(new URL(url, 'http://localhost').searchParams.get('history')).toBe('true');
  });

  test('a driven ride carries the DRIVER money block, by shape and not by role', async () => {
    stubFetchOk([DRIVEN_COMPLETED]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-row-j-driven')).toBeInTheDocument(),
    );

    // The collapsed chip: the full shape publishes a RATE, which is the
    // number the customer variant exists to withhold.
    expect(screen.getByText(/Platform fee/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('history-row-j-driven'));

    // MONEY-VIEW #207's settlement view, finally on a screen a motari can
    // reach: his net, off the settlement record.
    expect(screen.getByText('You receive')).toBeInTheDocument();
    expect(screen.getByText('1,700 RWF')).toBeInTheDocument();
    expect(screen.getByText(/Driver commission \(REGULAR, 10.0%\)/)).toBeInTheDocument();

    // And NOT the customer variant: the two blocks are mutually
    // exclusive, ordered so a full-shape row renders the full block only.
    expect(
      screen.queryByTestId('history-transparency-customer-j-driven'),
    ).not.toBeInTheDocument();
  });

  test('a driven ride with no settlement yet renders without a money block, not a crash', async () => {
    stubFetchOk([DRIVEN_IN_PROGRESS]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-row-j-driving-now')).toBeInTheDocument(),
    );
    // Shape 3 in commission-view's taxonomy — the key is omitted, and
    // every guard on this screen answers false rather than dereferencing.
    expect(screen.queryByText('You receive')).not.toBeInTheDocument();
    expect(screen.queryByText(/Platform fee/)).not.toBeInTheDocument();
    expect(screen.queryByText("This couldn't load")).not.toBeInTheDocument();
  });

  test('the Upcoming partition stays customer-shaped — no driven ride enters it', async () => {
    stubFetchOk([DRIVEN_IN_PROGRESS, DRIVEN_COMPLETED, DRIVEN_FROM_A_BOOKING]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-row-j-driven')).toBeInTheDocument(),
    );

    // The section does not render at all — `upcoming.length > 0` is the
    // guard, and a motari's rides never satisfy the predicate.
    expect(screen.queryByTestId('history-upcoming-section')).not.toBeInTheDocument();
    for (const id of ['j-driving-now', 'j-driven', 'j-was-scheduled']) {
      expect(screen.queryByTestId(`history-upcoming-row-${id}`)).not.toBeInTheDocument();
    }
    // The scheduled-origin ride he is driving is in the ordinary list,
    // where a ride with a driver belongs.
    expect(screen.getByTestId('history-row-j-was-scheduled')).toBeInTheDocument();
  });

  test('a completed driven ride still opens its receipt', async () => {
    stubFetchOk([DRIVEN_COMPLETED]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-row-j-driven')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('history-row-j-driven'));
    fireEvent.click(screen.getByTestId('history-receipt-link-j-driven'));

    await waitFor(() =>
      expect(screen.getByTestId('receipt-stub')).toBeInTheDocument(),
    );
  });

  test('a 400 from the arm is still an ErrorState — the cure is the server, not a swallow', async () => {
    // The regression guard reading the other way: if the arm ever throws
    // again, this screen must say so rather than show an empty list.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 'LOCATION_REQUIRED', message: 'errors.locationRequired' } }),
            { status: 400 },
          ),
      ),
    );
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("This couldn't load")).toBeInTheDocument(),
    );
    expect(screen.queryByText('No rides yet')).not.toBeInTheDocument();
  });
});
