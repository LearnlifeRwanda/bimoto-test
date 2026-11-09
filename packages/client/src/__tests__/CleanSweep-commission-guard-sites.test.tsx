// CLEAN-SWEEP G1 — the class, pinned at every site that pays it.
//
// MatchedPage's four fixtures live in MatchedPage.test.tsx (it is the one
// screen with a customer VARIANT). This file is the other half: every
// remaining screen that dereferences a money field off a
// `commissionBreakdown`, each proved to survive the ABSENT shape and to
// still render the FULL one.
//
// PAGE-mounted (MONEY-PIN #203's placement rule): these blocks are not
// components, they are JSX inside a screen, so a component test cannot
// reach them. The crash they are guarded against took the whole route
// down — the page rendering at all is the assertion that matters.
//
// WHY FIVE SITES AND NOT FOUR. The dispatch named MatchedPage, HistoryPage,
// BidListPage and ActiveRidePage. Grepping `commissionBreakdown` across
// the client at this head returns a fifth file, RideReceiptPage, and it
// was the only one still CRASHING: it reads `GET /api/journeys/:id` — the
// route that redacts for a customer — and is a customer surface (its
// rating gate requires journey.customer.id === currentUserId). See the
// RideReceiptPage block below for the exact line.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

const { mockSocket, ioMock } = vi.hoisted(() => {
  const mockSocket = {
    on: () => mockSocket,
    off: () => mockSocket,
    emit: () => mockSocket,
    disconnect: () => {},
    connected: false,
  };
  return { mockSocket, ioMock: { io: () => mockSocket } };
});
vi.mock('socket.io-client', () => ioMock);

import { HistoryPage } from '../pages/shared/HistoryPage';
import { BidListPage } from '../pages/customer/BidListPage';
import { ActiveRidePage } from '../pages/driver/ActiveRidePage';
import { useBidStore } from '../stores/bid.store';
import { useJourneyStore } from '../stores/journey.store';
import RideReceiptPage from '../pages/shared/RideReceiptPage';
import { useAuthStore } from '../stores/auth.store';
import { _resetConnectivityForTests } from '../sync/connectivity';

const FULL_BREAKDOWN = {
  bidPrice: 3000,
  driverTier: 'SILVER',
  driverCommissionRate: 0.1,
  customerTier: 'GOLD',
  customerCommissionRate: 0.05,
  totalCommissionRate: 0.15,
  totalCommissionAmount: 450,
  driverPayout: 2550,
  customerSavings: 150,
  driverSavings: 0,
  feeWaiverApplied: false,
};

// Verbatim what toCustomerSafeCommission (server/services/journey.service.ts)
// hands a customer. Every screen below must survive it.
const CUSTOMER_SAFE_BREAKDOWN = {
  bidPrice: 3000,
  customerTier: 'GOLD',
  customerSavings: 150,
  feeWaiverApplied: false,
};

beforeEach(async () => {
  _resetConnectivityForTests();
  useAuthStore.setState({ token: 'tok', isAuthenticated: true } as any);
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      common: { goBack: 'Go back', retry: 'Retry' },
      states: { loadFailed: "This couldn't load", loadFailedHint: 'Try again.' },
      history: {
        title: 'My rides',
        empty: 'No rides yet',
        emptyHint: 'Request your first ride and it will appear here.',
      },
      scheduled: { upcomingTitle: 'Upcoming rides' },
      status: { COMPLETED: 'Completed', SCHEDULED: 'Scheduled' },
      receipt: {
        viewReceipt: 'View receipt',
        vehicle: 'Vehicle',
        paymentStatus: 'Payment status',
        missingMoneyData: 'Some payment details are not available for this ride.',
      },
      payments: { status: { RELEASED: 'Paid to the driver', HELD: 'Paid — held safely' } },
      transparency: {
        platformFee: 'Platform fee',
        rideReceipt: 'Ride Receipt',
        totalPaid: 'Total paid',
        netReceived: 'Net received',
        commissionBreakdown: 'Commission breakdown',
        driverCommission: 'Driver commission ({{tier}} {{rate}}%)',
        customerCommission: 'Customer commission ({{tier}} {{rate}}%)',
        feeWaivedChip: 'fee waived',
        feeWaivedAmount: '0 RWF — waived (normally {{amount}} RWF)',
        feeWaivedNote: 'Pilot fee waiver — the driver keeps 100% of this fare.',
        confirmRide: 'Confirm ride',
        driverReceives: 'Driver receives: {{amount}} RWF',
        youWillReceiveExact: 'You will receive: {{amount}} RWF',
        rideInProgress: 'Ride in progress — You will receive {{amount}} RWF',
      },
      bids: {
        accept: 'Accept',
        decline: 'Decline',
        eta: '{{min}} min',
        anonymousDriver: 'Anonymous',
        waitingForDrivers: 'Waiting for offers',
      },
      bidList: { state: { liveHint: 'This page fills itself in' } },
      errors: { serverProblem: 'Bimoto has a problem, not your phone' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  useAuthStore.setState({ user: { id: 'c1', role: 'CUSTOMER' } as any });
  useJourneyStore.setState({ activeJourney: null, nearbyRequests: [], availableSignal: null } as any);
  useBidStore.setState({ bids: [] } as any);
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

// ─────────────────────────────────────────────────────────────────────────
// SITE 2 — HistoryPage (customer's ride list).
//
// Two blocks read the breakdown: the fee chip on the collapsed row
// (`totalCommissionRate * 100`) and the expanded money panel
// (`driverPayout`, `driverCommissionRate`, …). Nothing attaches a
// breakdown to GET /api/journeys today — the list route returns raw rows
// and Journey has no such column — so ABSENT is the LIVE shape here and
// FULL is the guard's other arm.
// ─────────────────────────────────────────────────────────────────────────
describe('HistoryPage — the commission guard', () => {
  const ROW = {
    id: 'j-1',
    pickupName: 'Kimironko Market',
    destinationName: 'Kigali Heights',
    status: 'COMPLETED',
    agreedPrice: 3000,
    createdAt: '2026-07-20T10:00:00Z',
  };

  function renderHistory() {
    return render(
      <MemoryRouter initialEntries={['/rides']}>
        <Routes>
          <Route path="/rides" element={<HistoryPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  test('ABSENT breakdown: the list renders and no money block appears', async () => {
    stubFetchOk([ROW]);
    renderHistory();

    await waitFor(() => expect(screen.getByText('Kigali Heights')).toBeInTheDocument());
    expect(screen.getByText(/3,000/)).toBeInTheDocument();
    expect(screen.queryByTestId('fee-waived-chip')).not.toBeInTheDocument();
    expect(screen.queryByText(/Platform fee/)).not.toBeInTheDocument();
  });

  test('CUSTOMER-SAFE breakdown: the list renders and the driver-side chip stays off', async () => {
    stubFetchOk([{ ...ROW, commissionBreakdown: CUSTOMER_SAFE_BREAKDOWN }]);
    renderHistory();

    await waitFor(() => expect(screen.getByText('Kigali Heights')).toBeInTheDocument());
    // `totalCommissionRate * 100` is what this chip renders; the shape
    // does not carry it, so the chip is absent rather than "NaN%".
    expect(screen.queryByText(/Platform fee/)).not.toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain('NaN');
  });

  test('FULL breakdown: the fee chip renders with the real rate', async () => {
    stubFetchOk([{ ...ROW, commissionBreakdown: FULL_BREAKDOWN }]);
    renderHistory();

    await waitFor(() => expect(screen.getByText(/Platform fee/)).toBeInTheDocument());
    expect(screen.getByText(/15\.0%/)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// SITE 5 — RideReceiptPage. THE ONE THAT WAS STILL CRASHING.
//
//   const feeAmount = breakdown ? breakdown.totalCommissionAmount : …
//   {feeAmount !== null && ( … feeAmount.toLocaleString() … )}
//
// A redacted breakdown made `feeAmount` UNDEFINED; `undefined !== null` is
// true, so the render guard passed and `.toLocaleString()` threw. Same
// crash as MatchedPage:376, on the customer's own receipt, live at this
// head. The fix reads money off the breakdown only when it is the full
// shape and otherwise falls back to the escrow row, which is what the page
// already did when no breakdown existed at all.
// ─────────────────────────────────────────────────────────────────────────
describe('RideReceiptPage — the commission guard', () => {
  const BASE = {
    id: 'j1',
    status: 'COMPLETED',
    pickupName: 'Kimironko',
    destinationName: 'Kigali Heights',
    vehiclePreference: 'MOTO',
    agreedPrice: 3000,
    createdAt: '2026-07-20T10:00:00Z',
    confirmedAt: '2026-07-20T10:30:00Z',
    escrow: { id: 'e1', amount: 3000, commission: 450, driverPayout: 2550, status: 'RELEASED' },
  };

  function renderReceipt(journey: unknown) {
    stubFetchOk(journey);
    return render(
      <MemoryRouter initialEntries={['/journey/j1/receipt']}>
        <Routes>
          <Route path="/journey/:id/receipt" element={<RideReceiptPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  test('CUSTOMER-SAFE breakdown: the receipt renders instead of crashing', async () => {
    renderReceipt({ ...BASE, commissionBreakdown: CUSTOMER_SAFE_BREAKDOWN });

    // The page being up at all is the assertion: the crash took the route
    // down and the customer saw nothing.
    await waitFor(() => expect(screen.getByTestId('ride-receipt')).toBeInTheDocument());
    expect(screen.getByText('Total paid')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain('NaN');
    expect(document.body.textContent ?? '').not.toContain('undefined');
  });

  test('ABSENT breakdown: the escrow row still answers every money line', async () => {
    renderReceipt(BASE);

    await waitFor(() => expect(screen.getByTestId('ride-receipt')).toBeInTheDocument());
    expect(screen.getByText('Total paid')).toBeInTheDocument();
    expect(screen.getByText('Net received')).toBeInTheDocument();
  });

  test('FULL breakdown: the money lines come off the breakdown, unchanged', async () => {
    renderReceipt({ ...BASE, commissionBreakdown: FULL_BREAKDOWN });

    await waitFor(() => expect(screen.getByTestId('ride-receipt')).toBeInTheDocument());
    const receipt = screen.getByTestId('ride-receipt');
    expect(receipt.textContent).toContain('3,000');
    expect(receipt.textContent).toContain('450');
    expect(receipt.textContent).toContain('2,550');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// SITE 3 — BidListPage's accept-confirmation modal.
//
// CLEAN-SWEEP recorded this block as DEAD and guarded it anyway: the modal
// read totalCommissionRate, totalCommissionAmount and driverPayout off
// `confirmBid.commissionBreakdown`, and bid.service OMITTED that key for
// the customer scope. Its FULL arm was written to prove "the guard did not
// break the block for the scopes that do carry it" — but this screen is
// customer-only (route /journey/:id/bids, BidListPage), so there is no
// such scope here and never was.
//
// MONEY-VIEW v2 G3 pays that debt. The driver-side lines are GONE — rate x
// price IS the commission and price − commission IS his net, so they
// reconstructed exactly what #202 withholds — and bid.service now attaches
// the customer-safe FOUR to her rows, so the modal shows her tier and what
// it saved her.
//
// The three arms below are therefore: ABSENT (an older server, a cached
// row) opens the modal with no money block; CUSTOMER-SAFE renders the
// preview; and FULL — which satisfies `hasCustomerSafeCommission` too,
// being a superset — renders the SAME preview and still not one
// driver-side line. That last arm is the one that matters: it proves the
// screen cannot be talked into the old block by a payload that happens to
// carry the full shape.
// ─────────────────────────────────────────────────────────────────────────
describe('BidListPage confirm modal — the commission guard', () => {
  const JOURNEY = {
    id: 'j1',
    pickupName: 'Nyabugogo',
    destinationName: 'Kacyiru',
    status: 'REQUESTED',
    vehiclePreference: 'MOTO',
  };

  function serviceShapedBid(over: Record<string, unknown> = {}) {
    return {
      id: 'b1',
      journeyId: 'j1',
      driverId: 'd1',
      price: 3000,
      etaMinutes: 5,
      status: 'PENDING',
      createdAt: '2026-08-24T09:00:00.000Z',
      updatedAt: '2026-08-24T09:00:00.000Z',
      driver: {
        nickname: 'Jean',
        avgRating: 4.5,
        totalRides: 20,
        vehicleType: 'MOTO',
        vehicleDescription: 'Red Boxer',
        registrationPlate: 'RAB 123 C',
        verificationStatus: 'APPROVED',
        ruraAuthorizationNumber: null,
        insuranceConfirmed: true,
        cooperativeName: null,
        vehicleUpdatedRecently: false,
      },
      ...over,
    };
  }

  function stubFetchRouter(routes: Record<string, unknown>) {
    const mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String((input as Request).url ?? input);
      for (const [suffix, body] of Object.entries(routes)) {
        if (url.includes(suffix)) return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', mock);
    return mock;
  }

  async function openConfirmModal(bid: Record<string, unknown>) {
    stubFetchRouter({ '/api/journeys/j1/bids': [bid], '/api/journeys/j1': JOURNEY });
    render(
      <MemoryRouter initialEntries={['/journey/j1/bids']}>
        <Routes>
          <Route path="/journey/:id/bids" element={<BidListPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const accept = await screen.findByTestId('bid-b1-accept');
    fireEvent.click(accept);
    await waitFor(() => expect(screen.getByText('Confirm ride')).toBeInTheDocument());
  }

  test('ABSENT breakdown (the customer scope, live): the modal opens, no money block', async () => {
    await openConfirmModal(serviceShapedBid());

    // The fare the passenger will pay is on the modal; the driver's side
    // of it is not.
    expect(screen.getByText(/3,000 RWF/)).toBeInTheDocument();
    expect(screen.queryByText(/Driver receives/)).not.toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain('NaN');
  });

  test('CUSTOMER-SAFE breakdown: her savings preview renders, his side stays off', async () => {
    await openConfirmModal(
      serviceShapedBid({ commissionBreakdown: CUSTOMER_SAFE_BREAKDOWN }),
    );

    expect(screen.getByText(/3,000 RWF/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('bid-confirm-savings')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Driver receives/)).not.toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain('NaN');
  });

  test('FULL breakdown: still her preview, and NOT one driver-side line', async () => {
    // The full shape is a superset of the customer-safe four, so a payload
    // carrying it satisfies the guard. What must NOT follow is the old
    // block: this screen is the passenger's, whatever arrives on it.
    await openConfirmModal(serviceShapedBid({ commissionBreakdown: FULL_BREAKDOWN }));

    await waitFor(() =>
      expect(screen.getByTestId('bid-confirm-savings')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Driver receives/)).not.toBeInTheDocument();
    // 2,550 is driverPayout and 15.0 is totalCommissionRate x 100 — the
    // two numbers the removed lines printed.
    expect(document.body.textContent ?? '').not.toContain('2,550');
    expect(document.body.textContent ?? '').not.toContain('15.0');
    expect(document.body.textContent ?? '').not.toContain('NaN');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// SITE 4 — ActiveRidePage (the motari's screen).
//
// Three reads of `driverPayout` / the whole settlement panel. A driver
// gets the FULL shape from GET /api/journeys/:id — `requestingUserId !==
// customerId` takes the un-redacted arm in journey.service.ts:1131 — so
// this screen is not crashing and never was. It is guarded because it
// dereferences nine money fields off the same interface that carries
// three different shapes, and one guard with five consumers is what makes
// the next field report impossible rather than unlikely.
// ─────────────────────────────────────────────────────────────────────────
describe('ActiveRidePage — the commission guard', () => {
  const RIDE = {
    id: 'j1',
    status: 'MATCHED',
    pickupName: 'Nyabugogo',
    destinationName: 'Kacyiru',
    pickupLat: -1.95,
    pickupLng: 30.06,
    destinationLat: -1.97,
    destinationLng: 30.1,
    agreedPrice: 3000,
    customer: { id: 'c1', nickname: 'Aline' },
  };

  function renderRide(journey: unknown) {
    stubFetchOk(journey);
    return render(
      <MemoryRouter initialEntries={['/driver/ride/j1']}>
        <Routes>
          <Route path="/driver/ride/:id" element={<ActiveRidePage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  test('ABSENT breakdown: the ride screen renders and no payout line appears', async () => {
    renderRide(RIDE);

    await waitFor(() => expect(screen.getByText('Kacyiru')).toBeInTheDocument());
    expect(screen.queryByText(/You will receive/)).not.toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain('NaN');
  });

  test('CUSTOMER-SAFE breakdown: the screen renders and no payout is invented', async () => {
    // Not a shape this screen receives today — the point is that if the
    // scoping ever changes, the motari sees no line rather than a crash
    // or a fabricated zero.
    renderRide({ ...RIDE, commissionBreakdown: CUSTOMER_SAFE_BREAKDOWN });

    await waitFor(() => expect(screen.getByText('Kacyiru')).toBeInTheDocument());
    expect(screen.queryByText(/You will receive/)).not.toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain('NaN');
  });

  test('FULL breakdown: the exact payout line renders, unchanged', async () => {
    renderRide({ ...RIDE, commissionBreakdown: FULL_BREAKDOWN });

    await waitFor(() =>
      expect(screen.getByText('You will receive: 2,550 RWF')).toBeInTheDocument(),
    );
  });
});
