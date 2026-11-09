// __TESTS__/BID-LIST-PAGE-DEAD-READS.TEST.TSX
//
// ANY-VEHICLE G6(a) — the bid row reads what the server actually sends.
//
// THE CLASS, not the line. LIVE-WIRE G2 found `bid.driverName` — a flat
// property the server has never sent — and fixed it, and every motari
// stopped showing up as "Anonymous". The identical bug sat two elements
// below it on `bid.vehicleDescription`, and the row simply rendered
// nothing where the machine's description belongs.
//
// So this dispatch did not fix the named line. It reconciled EVERY
// property BidListPage reads off a bid object against the shape
// bid.service.getBidsForJourney actually returns — its `select` and its
// mapper are the oracle — and the fixtures below are written in that
// shape and only that shape: nested `driver`, no flat conveniences. A
// row that only renders because a test fixture invented a field it will
// never receive is exactly how both of these survived.
//
// THE DEBT THIS FILE RECORDED IS NOW PAID (MONEY-VIEW v2 G3).
//
// ANY-VEHICLE G6(a) reported `confirmBid.commissionBreakdown` as dead for
// this screen and deliberately did not mend it, because the only mend
// available then was to make the FULL block render — which would have
// disclosed the motari's net to the passenger and broken
// live-wire-role-scoped-payload. That reasoning was right, and it framed
// the choice as binary: leak, or leave the block dead.
//
// It was never binary. The passenger has a side of that sum which is
// entirely hers — her tier and what it saved her — and `customerSavings`
// is a function of the CUSTOMER rate alone, so nothing in it narrows to
// his payout. bid.service now attaches the customer-safe FOUR to her bid
// rows, computed at the `calculateCommission` call already on that path,
// and the dialog renders the savings preview instead of the three lines
// (rate, amount, "driver receives") that never rendered and should not
// have if they had — rate x price IS the commission, and price minus
// commission IS his net.
//
// So the tests below no longer RECORD a dead read. They pin a live one.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

const { mockSocket, ioMock } = vi.hoisted(() => {
  const mockSocket = {
    on: () => mockSocket,
    emit: () => mockSocket,
    disconnect: () => {},
    connected: false,
  };
  return { mockSocket, ioMock: { io: () => mockSocket } };
});
vi.mock('socket.io-client', () => ioMock);

import { BidListPage } from '../pages/customer/BidListPage';
import { useAuthStore } from '../stores/auth.store';
import { useBidStore } from '../stores/bid.store';
import { useJourneyStore } from '../stores/journey.store';
import { _resetConnectivityForTests } from '../sync/connectivity';

/**
 * One bid in the EXACT shape bid.service.getBidsForJourney returns for a
 * customer: everything about the driver nested under `driver`, no flat
 * `driverName`, no flat `vehicleDescription`, and — for this scope — the
 * customer-safe FOUR under `commissionBreakdown` and nothing else.
 * Written in that shape and only that shape: a row that renders only
 * because a fixture invented a field it will never receive is exactly how
 * `driverName` and `vehicleDescription` both survived.
 */
function serviceShapedBid(over: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    journeyId: 'j1',
    driverId: 'd1',
    price: 1800,
    etaMinutes: 5,
    status: 'PENDING',
    createdAt: '2026-08-24T09:00:00.000Z',
    updatedAt: '2026-08-24T09:00:00.000Z',
    commissionBreakdown: {
      bidPrice: 1800,
      customerTier: 'FREQUENT',
      customerSavings: 27,
      feeWaiverApplied: false,
    },
    driver: {
      nickname: 'Jean',
      avgRating: 4.5,
      totalRides: 20,
      vehicleType: 'MOTO',
      vehicleDescription: 'Red Boxer, blue helmet',
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
    const url =
      typeof input === 'string' ? input : String((input as Request).url ?? input);
    for (const [suffix, body] of Object.entries(routes)) {
      if (url.includes(suffix)) {
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function renderBidList() {
  return render(
    <MemoryRouter initialEntries={['/journey/j1/bids']}>
      <Routes>
        <Route path="/journey/:id/bids" element={<BidListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const JOURNEY = {
  id: 'j1',
  pickupName: 'Nyabugogo',
  destinationName: 'Kacyiru',
  status: 'REQUESTED',
  vehiclePreference: 'MOTO',
};

beforeEach(async () => {
  _resetConnectivityForTests();
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      bids: {
        accept: 'Accept',
        decline: 'Decline',
        eta: '{{min}} min',
        anonymousDriver: 'Anonymous',
        waitingForDrivers: 'Waiting for offers',
      },
      bidList: { state: { liveHint: 'This page fills itself in' } },
      transparency: {
        totalPaid: 'Total paid',
        customerTierLine: 'Your tier: {{tier}}',
        tierSavings: 'Your {{tier}} tier saves you {{amount}} RWF',
        customerFeeWaived: 'Platform fee waived during the pilot.',
        paymentHeldInEscrow: 'Held safely until the ride is done',
        platformFee: 'Platform fee',
        driverReceives: 'Driver receives: {{amount}} RWF',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  useAuthStore.setState({ token: 'tok', user: { id: 'c1', role: 'CUSTOMER' } as any });
  useJourneyStore.setState({
    activeJourney: null,
    nearbyRequests: [],
    availableSignal: null,
  });
  useBidStore.setState({ bids: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetConnectivityForTests();
});

describe('the row renders from the shape the service actually sends', () => {
  beforeEach(() => {
    stubFetchRouter({
      '/api/journeys/j1/bids': [serviceShapedBid()],
      '/api/journeys/j1': JOURNEY,
    });
  });

  test('the vehicle description renders — nested, with no flat field anywhere', async () => {
    renderBidList();

    await waitFor(() =>
      expect(screen.getByTestId('bid-b1-accept')).toBeInTheDocument(),
    );
    // The line that rendered for nobody until G6(a).
    expect(screen.getByText('Red Boxer, blue helmet')).toBeInTheDocument();
  });

  test('the driver name still renders nested — the G2 fix, held', async () => {
    renderBidList();

    await waitFor(() =>
      expect(screen.getByTestId('bid-b1-accept')).toBeInTheDocument(),
    );
    expect(screen.getByText('Jean')).toBeInTheDocument();
    expect(screen.queryByText('Anonymous')).not.toBeInTheDocument();
  });

  test('price and ETA render', async () => {
    renderBidList();

    await waitFor(() =>
      expect(screen.getByTestId('bid-b1-accept')).toBeInTheDocument(),
    );
    expect(screen.getByText(/1,800/)).toBeInTheDocument();
    expect(screen.getByText(/5 min/)).toBeInTheDocument();
  });

  test('a driver with no description stated shows no empty line', async () => {
    // The mapper sends '' rather than omitting the key, so the guard has
    // to survive an empty string as well as an absent field.
    stubFetchRouter({
      '/api/journeys/j1/bids': [
        serviceShapedBid({
          driver: { ...serviceShapedBid().driver, vehicleDescription: '' },
        }),
      ],
      '/api/journeys/j1': JOURNEY,
    });
    renderBidList();

    await waitFor(() =>
      expect(screen.getByTestId('bid-b1-accept')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Red Boxer, blue helmet')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// MONEY-VIEW v2 G3 — the savings preview, LIVE.
// ---------------------------------------------------------------------------

describe('the confirm dialog shows the passenger her own side of the sum', () => {
  async function openConfirm(bid = serviceShapedBid()) {
    stubFetchRouter({
      '/api/journeys/j1/bids': [bid],
      '/api/journeys/j1': JOURNEY,
    });
    renderBidList();
    await waitFor(() =>
      expect(screen.getByTestId('bid-b1-accept')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('bid-b1-accept'));
    await waitFor(() =>
      expect(screen.getByTestId('bid-confirm-savings')).toBeInTheDocument(),
    );
  }

  test('her tier and what it saved her render', async () => {
    await openConfirm();
    expect(screen.getByText('Your tier: FREQUENT')).toBeInTheDocument();
    expect(
      screen.getByText('Your FREQUENT tier saves you 27 RWF'),
    ).toBeInTheDocument();
  });

  test('and none of the three lines that reconstructed the motari’s net', async () => {
    await openConfirm();
    // `platformFee` x price IS the commission; price − commission IS his
    // net. The old block rendered both, for nobody.
    expect(screen.queryByText(/Platform fee/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Driver receives/)).not.toBeInTheDocument();
    // The price she pays is hers and stays on the dialog — it appears on
    // the row as well, hence getAllByText.
    expect(screen.getAllByText(/1,800/).length).toBeGreaterThan(0);
  });

  test('a waived fee is named as a fact, with no amount', async () => {
    await openConfirm(
      serviceShapedBid({
        commissionBreakdown: {
          bidPrice: 1800,
          customerTier: 'REGULAR',
          customerSavings: 0,
          feeWaiverApplied: true,
        },
      }),
    );
    expect(screen.getByTestId('bid-confirm-fee-waived')).toBeInTheDocument();
    // The amount IS totalCommissionAmount — the field the redaction
    // exists to withhold — so the waiver line must never quote one.
    expect(screen.queryByText(/normally/)).not.toBeInTheDocument();
  });

  test('a zero saving prints no savings line rather than "saves you 0"', async () => {
    await openConfirm(
      serviceShapedBid({
        commissionBreakdown: {
          bidPrice: 1800,
          customerTier: 'REGULAR',
          customerSavings: 0,
          feeWaiverApplied: false,
        },
      }),
    );
    expect(screen.getByText('Your tier: REGULAR')).toBeInTheDocument();
    expect(screen.queryByText(/saves you/)).not.toBeInTheDocument();
  });

  test('a payload with no breakdown at all still opens the dialog', async () => {
    // Shape 3 in commission-view's taxonomy — an older server, a cached
    // response. The dialog is how a passenger accepts a bid; it must not
    // depend on the money block being there.
    const { commissionBreakdown: _omit, ...withoutBreakdown } = serviceShapedBid();
    stubFetchRouter({
      '/api/journeys/j1/bids': [withoutBreakdown],
      '/api/journeys/j1': JOURNEY,
    });
    renderBidList();
    await waitFor(() =>
      expect(screen.getByTestId('bid-b1-accept')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('bid-b1-accept'));
    // The escrow reassurance line is on the dialog and nowhere else, so it
    // is the honest proof that the dialog opened.
    await waitFor(() =>
      expect(
        screen.getByText('Held safely until the ride is done'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('bid-confirm-savings')).not.toBeInTheDocument();
  });
});
