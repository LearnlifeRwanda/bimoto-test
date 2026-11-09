// BOTH-RIDES G1 (founder ruling D28) — "My rides" tells a dual-role
// account the whole truth.
//
// A legacy BOTH-role motari is a passenger AND a driver on one login. The
// rides list asked exactly one question — GET /api/journeys?history=true,
// no `viewAs` — and getJourneys resolves a BOTH caller to
// effectiveRole 'customer' (journey.service.ts:573), so the screen showed
// the rides she TOOK and silently omitted every ride he DROVE. #208
// measured it: 0 rows shown against 16 driven.
//
// The server needed nothing. `viewAs=driver&history=true` from the same
// account resolves effectiveRole 'driver' and takes #208's own-rides
// branch — `where: { driverId: userId }`, no coordinates, the settlement
// view attached. The door was open; the page never knocked. It knocks now,
// and only when the account is BOTH.
//
// PAGE-mounted (MONEY-PIN #203's placement rule): the real HistoryPage at
// its real route, with the real auth store, because what is under test is
// what the SCREEN does with a role — which fetches it issues, which
// headers it draws, and which list feeds the Upcoming partition.
//
// The byte-identity pin lives here too: a pure CUSTOMER and a pure DRIVER
// must issue ONE request and render NO section header. D28 changes what a
// dual-role account sees and nothing else.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

import { HistoryPage } from '../pages/shared/HistoryPage';
import { useAuthStore } from '../stores/auth.store';
import { _resetConnectivityForTests } from '../sync/connectivity';

const USER_ID = 'u-both';

/** A ride she TOOK, in the customer-safe shape #207 built for her. */
const TOOK_COMPLETED = {
  id: 'j-took',
  pickupName: 'Kacyiru',
  destinationName: 'Nyamirambo',
  status: 'COMPLETED',
  agreedPrice: 1500,
  createdAt: '2026-08-18T10:00:00Z',
  commissionBreakdown: {
    bidPrice: 1500,
    customerTier: 'SILVER',
    customerSavings: 120,
    feeWaiverApplied: false,
  },
};

/** A ride she BOOKED for later and nobody has taken — her Upcoming row. */
const TOOK_SCHEDULED = {
  id: 'j-booked',
  pickupName: 'Remera',
  destinationName: 'Musanze',
  status: 'SCHEDULED',
  createdAt: '2026-08-17T09:00:00Z',
  scheduledFor: '2026-08-30T14:00:00.000Z',
  bidWindowOpensAt: '2026-08-30T13:00:00.000Z',
};

/** A ride he DROVE, with the full settlement the driver arm attaches. */
const DROVE_COMPLETED = {
  id: 'j-drove',
  pickupName: 'Kimironko Market',
  destinationName: 'Kigali Heights',
  status: 'COMPLETED',
  agreedPrice: 2000,
  createdAt: '2026-08-20T10:00:00Z',
  driverId: USER_ID,
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

/**
 * THE TRAP, and the reason §0.5 is pinned twice.
 *
 * A ride he drove for a passenger who had booked it for later carries
 * `scheduledFor` on the same journey row — so if the driven list were ever
 * fed to `isUpcomingScheduledRide`, a shift he already worked would appear
 * in HER "Upcoming rides". It is not: `upcoming` reads the passenger list
 * and only the passenger list. This fixture is REQUESTED-shaped on purpose,
 * which is a status the predicate DOES accept, so the pin below fails on
 * the plumbing rather than passing for #208's status-based reason.
 */
const DROVE_FROM_A_BOOKING = {
  id: 'j-drove-booked',
  pickupName: 'Kicukiro',
  destinationName: 'Kigali Airport',
  status: 'REQUESTED',
  createdAt: '2026-08-21T09:00:00Z',
  scheduledFor: '2026-08-31T07:30:00.000Z',
  bidWindowOpensAt: '2026-08-31T06:30:00.000Z',
  driverId: USER_ID,
};

/** Newest of the driven rides — used for the newest-first pin. */
const DROVE_NEWEST = {
  id: 'j-drove-newest',
  pickupName: 'Nyabugogo',
  destinationName: 'Gisozi',
  status: 'IN_PROGRESS',
  createdAt: '2026-08-24T08:00:00Z',
  driverId: USER_ID,
};

function setRole(role: string) {
  useAuthStore.setState({
    token: 'tok',
    user: { id: USER_ID, role } as any,
  } as any);
}

beforeEach(async () => {
  _resetConnectivityForTests();
  setRole('BOTH');
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
        sectionAsPassenger: 'As passenger',
        sectionAsMotari: 'As motari',
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

/** True for the driver-view call and only for it. */
function isDriverCall(url: string): boolean {
  return new URL(url, 'http://localhost').searchParams.get('viewAs') === 'driver';
}

/**
 * Answers the two calls by their query string, not by call order — the
 * page issues them in parallel and nothing about the fix promises which
 * settles first.
 */
function stubFetchByView(opts: {
  passenger?: unknown;
  driven?: unknown;
  passengerStatus?: number;
  drivenStatus?: number;
}) {
  const mock = vi.fn(async (input: any) => {
    const url = String(input);
    if (isDriverCall(url)) {
      const status = opts.drivenStatus ?? 200;
      return new Response(
        JSON.stringify(
          status === 200
            ? (opts.driven ?? [])
            : { error: { code: 'SERVER_ERROR', message: 'errors.generic' } },
        ),
        { status },
      );
    }
    const status = opts.passengerStatus ?? 200;
    return new Response(
      JSON.stringify(
        status === 200
          ? (opts.passenger ?? [])
          : { error: { code: 'SERVER_ERROR', message: 'errors.generic' } },
      ),
      { status },
    );
  });
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

describe('BOTH-RIDES G1 — a dual-role account opens My rides', () => {
  test('both lists render, sectioned, and the second call is the driver view', async () => {
    const fetchMock = stubFetchByView({
      passenger: [TOOK_COMPLETED, TOOK_SCHEDULED],
      driven: [DROVE_COMPLETED, DROVE_NEWEST, DROVE_FROM_A_BOOKING],
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-section-motari')).toBeInTheDocument(),
    );

    // Two honest sections, each named.
    expect(screen.getByTestId('history-section-passenger')).toBeInTheDocument();
    expect(screen.getByText('As passenger')).toBeInTheDocument();
    expect(screen.getByText('As motari')).toBeInTheDocument();

    // Her rides, in her section.
    const passengerSection = screen.getByTestId('history-section-passenger');
    expect(passengerSection).toContainElement(screen.getByTestId('history-row-j-took'));
    expect(passengerSection).toContainElement(
      screen.getByTestId('history-upcoming-row-j-booked'),
    );

    // His rides, in his — including the one #208 measured as missing.
    const motariSection = screen.getByTestId('history-section-motari');
    expect(motariSection).toContainElement(screen.getByTestId('history-row-j-drove'));
    expect(motariSection).toContainElement(
      screen.getByTestId('history-row-j-drove-newest'),
    );
    expect(motariSection).toContainElement(
      screen.getByTestId('history-row-j-drove-booked'),
    );

    // TWO calls, and the pair is exactly {passenger view, driver view}.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => String((c as any[])[0]));
    expect(urls.every((u) => u.includes('/api/journeys'))).toBe(true);
    expect(
      urls.every(
        (u) => new URL(u, 'http://localhost').searchParams.get('history') === 'true',
      ),
    ).toBe(true);
    expect(urls.filter(isDriverCall)).toHaveLength(1);
    expect(urls.filter((u) => !isDriverCall(u))).toHaveLength(1);
  });

  test('each section renders the money shape its rows carry, and never the other', async () => {
    stubFetchByView({
      passenger: [TOOK_COMPLETED],
      driven: [DROVE_COMPLETED],
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-row-j-drove')).toBeInTheDocument(),
    );

    // One row expands at a time — the screen's standing behaviour, and
    // `expandedId` is one page-level id, unchanged by D28. So each row is
    // opened in turn rather than both at once.

    // HIS row: the full settlement — his net, off the settlement record.
    fireEvent.click(screen.getByTestId('history-row-j-drove'));
    expect(screen.getByText('You receive')).toBeInTheDocument();
    expect(screen.getByText('1,700 RWF')).toBeInTheDocument();
    expect(screen.getByText(/Driver commission \(REGULAR, 10.0%\)/)).toBeInTheDocument();
    expect(
      screen.queryByTestId('history-transparency-customer-j-drove'),
    ).not.toBeInTheDocument();

    // HER row: the customer-safe four, and no driver payout anywhere near it.
    fireEvent.click(screen.getByTestId('history-row-j-took'));
    const herPanel = screen.getByTestId('history-transparency-customer-j-took');
    expect(herPanel).toBeInTheDocument();
    expect(herPanel).toHaveTextContent('Your tier: SILVER');
    expect(herPanel).toHaveTextContent('SILVER saved you 120');
    expect(herPanel).not.toHaveTextContent('You receive');
    // His panel closed when hers opened, so the driver block is gone with
    // it — the two never coexist in the DOM, and neither ever renders the
    // other's shape.
    expect(screen.queryByText('You receive')).not.toBeInTheDocument();

    // Neither block is new: both are the guards #206/#207 already wrote,
    // firing on shape. No role decides a money line on this screen.
  });

  test('Upcoming draws ONLY from the passenger list — a driven booking never enters it', async () => {
    stubFetchByView({
      passenger: [TOOK_COMPLETED, TOOK_SCHEDULED],
      driven: [DROVE_FROM_A_BOOKING, DROVE_COMPLETED],
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-upcoming-section')).toBeInTheDocument(),
    );

    // Her booking is there.
    expect(screen.getByTestId('history-upcoming-row-j-booked')).toBeInTheDocument();

    // His is NOT — and this fixture is REQUESTED with a scheduledFor, a
    // shape isUpcomingScheduledRide accepts. It stays out because the
    // driven list is never handed to the partition at all.
    expect(
      screen.queryByTestId('history-upcoming-row-j-drove-booked'),
    ).not.toBeInTheDocument();

    // The Upcoming section belongs to the passenger half of the screen.
    expect(screen.getByTestId('history-section-passenger')).toContainElement(
      screen.getByTestId('history-upcoming-section'),
    );
    // And his booking renders as an ordinary row in HIS section.
    expect(screen.getByTestId('history-section-motari')).toContainElement(
      screen.getByTestId('history-row-j-drove-booked'),
    );
  });

  test('the driven list is newest first', async () => {
    stubFetchByView({
      passenger: [],
      // Deliberately oldest-first on the wire.
      driven: [DROVE_COMPLETED, DROVE_FROM_A_BOOKING, DROVE_NEWEST],
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-row-j-drove-newest')).toBeInTheDocument(),
    );

    const rows = Array.from(
      screen
        .getByTestId('history-section-motari')
        .querySelectorAll('[data-testid^="history-row-"]'),
    ).map((el) => el.getAttribute('data-testid'));
    expect(rows).toEqual([
      'history-row-j-drove-newest', // 2026-08-24
      'history-row-j-drove-booked', // 2026-08-21
      'history-row-j-drove', // 2026-08-20
    ]);
  });

  test('an empty driven list still shows the section, with the empty state', async () => {
    stubFetchByView({ passenger: [TOOK_COMPLETED], driven: [] });
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-section-motari')).toBeInTheDocument(),
    );

    // The point of D28: the section does not silently vanish. A BOTH
    // account that has driven nothing is told so, rather than shown a
    // screen that looks like it has only ever been a passenger.
    expect(screen.getByText('As motari')).toBeInTheDocument();
    expect(screen.getByTestId('history-driven-empty')).toBeInTheDocument();
    expect(screen.getByTestId('history-driven-empty')).toHaveTextContent('No rides yet');
    // Not the passenger's instruction: "Request your first ride" is false
    // advice for a motari with no jobs yet.
    expect(screen.getByTestId('history-driven-empty')).not.toHaveTextContent(
      'Request your first ride',
    );

    // Her half is untouched.
    expect(screen.getByTestId('history-row-j-took')).toBeInTheDocument();
  });

  test('the driver call failing leaves her rides on the screen', async () => {
    stubFetchByView({ passenger: [TOOK_COMPLETED, TOOK_SCHEDULED], drivenStatus: 500 });
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-driven-error')).toBeInTheDocument(),
    );

    // The healthy half renders in full — rows AND Upcoming.
    expect(screen.getByTestId('history-row-j-took')).toBeInTheDocument();
    expect(screen.getByTestId('history-upcoming-row-j-booked')).toBeInTheDocument();
    // The failed half says so, in its own section, retryable.
    expect(screen.getByTestId('history-section-motari')).toContainElement(
      screen.getByTestId('history-driven-error'),
    );
    expect(screen.getByText('As motari')).toBeInTheDocument();
    // And never a fake "no rides" for the half that did not arrive.
    expect(screen.queryByTestId('history-driven-empty')).not.toBeInTheDocument();
  });

  test('the passenger call failing leaves his rides on the screen', async () => {
    stubFetchByView({ passengerStatus: 500, driven: [DROVE_COMPLETED] });
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-row-j-drove')).toBeInTheDocument(),
    );

    // The other direction of the same promise: one list erroring must
    // not blank the other.
    expect(screen.getByTestId('history-section-passenger')).toContainElement(
      screen.getByTestId('error-state'),
    );
    expect(screen.getByText('As passenger')).toBeInTheDocument();
    expect(screen.getByText('As motari')).toBeInTheDocument();
    expect(screen.queryByText('No rides yet')).not.toBeInTheDocument();
  });

  test('a driven row still opens its receipt from the motari section', async () => {
    stubFetchByView({ passenger: [], driven: [DROVE_COMPLETED] });
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-row-j-drove')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('history-row-j-drove'));
    fireEvent.click(screen.getByTestId('history-receipt-link-j-drove'));

    await waitFor(() => expect(screen.getByTestId('receipt-stub')).toBeInTheDocument());
  });
});

describe('BOTH-RIDES G1 — the pure roles are byte-identical', () => {
  // THE PIN. D28 is a change for dual-role accounts and for nobody else:
  // one fetch, no header, the same single list as at #208. The
  // second call is not merely ignored for these accounts — it is never
  // issued, and `toHaveBeenCalledTimes(1)` is what says so.
  test('a pure CUSTOMER: one fetch, no section headers', async () => {
    setRole('CUSTOMER');
    const fetchMock = stubFetchByView({
      passenger: [TOOK_COMPLETED, TOOK_SCHEDULED],
      driven: [DROVE_COMPLETED],
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-row-j-took')).toBeInTheDocument(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.map((c) => String((c as any[])[0])).filter(isDriverCall),
    ).toHaveLength(0);

    // No headers, no wrappers, no motari list.
    expect(screen.queryByText('As passenger')).not.toBeInTheDocument();
    expect(screen.queryByText('As motari')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-section-passenger')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-section-motari')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-row-j-drove')).not.toBeInTheDocument();

    // Her screen is the one #205/#206 left her: Upcoming above, past below.
    expect(screen.getByTestId('history-upcoming-section')).toBeInTheDocument();
    expect(screen.getByTestId('history-upcoming-row-j-booked')).toBeInTheDocument();
  });

  test('a pure DRIVER: one fetch, no section headers', async () => {
    setRole('DRIVER');
    const fetchMock = stubFetchByView({
      // His single call carries no viewAs, and the server resolves it to
      // his own arm from his role alone — #208's fix. So the passenger
      // slot of this stub is what his one call is answered with.
      passenger: [DROVE_COMPLETED, DROVE_NEWEST],
      driven: [DROVE_COMPLETED],
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-row-j-drove')).toBeInTheDocument(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.map((c) => String((c as any[])[0])).filter(isDriverCall),
    ).toHaveLength(0);

    expect(screen.queryByText('As motari')).not.toBeInTheDocument();
    expect(screen.queryByText('As passenger')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-section-motari')).not.toBeInTheDocument();

    // #208's screen, unchanged: his rides in the one list, his settlement
    // by shape.
    expect(screen.getByTestId('history-row-j-drove-newest')).toBeInTheDocument();
    expect(screen.getByText(/Platform fee/)).toBeInTheDocument();
  });

  test('a role the store has not yet loaded is treated as pure — one fetch', async () => {
    // Boot restore has not landed. `user` is null, `isBoth` is false, and
    // the screen behaves exactly as it did before D28 rather than issuing
    // a driver query on behalf of an account whose role is unknown.
    useAuthStore.setState({ token: 'tok', user: null } as any);
    const fetchMock = stubFetchByView({ passenger: [TOOK_COMPLETED] });
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('history-row-j-took')).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('history-section-motari')).not.toBeInTheDocument();
  });
});
