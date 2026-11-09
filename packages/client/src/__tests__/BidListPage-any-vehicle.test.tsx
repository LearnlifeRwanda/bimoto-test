// ANY-VEHICLE G3 — the comparison view.
//
// A journey opened to every kind of machine collects offers that are
// not comparable as one flat list: a bicycle at 900 RWF and a moto at
// 1,800 RWF are not undercutting each other, they are two different
// trips. Grouping by the bidding motari's own vehicle type is what
// turns the list back into a choice the customer can actually make.
//
// The load-bearing half of this file is the OTHER direction. Grouping
// is only safe if a journey that DID state a preference renders exactly
// as it did before — one flat list, no headers, no markers — so every
// grouping assertion here has a both-ways twin.
//
// No new endpoint is involved: driver.vehicleType, price and etaMinutes
// have been on every bid row since DRIVER-ID v3 (bid.service.ts:169).

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

/** A bid in the exact shape bid.service.getBidsForJourney returns. */
function bid(id: string, price: number, vehicleType: string, etaMinutes = 5) {
  return {
    id,
    journeyId: 'j1',
    driverId: `d-${id}`,
    price,
    etaMinutes,
    status: 'PENDING',
    driver: {
      nickname: `Driver ${id}`,
      avgRating: 4.5,
      totalRides: 20,
      vehicleType,
      vehicleDescription: '',
      verificationStatus: 'APPROVED',
    },
  };
}

// Deliberately interleaved so grouping cannot be mistaken for the
// arrival order, and so the cheapest section is NOT the first one to
// appear in the raw list.
const MIXED_BIDS = [
  bid('moto-a', 1800, 'MOTO'),
  bid('bike-a', 1200, 'BIKE'),
  bid('emoto-a', 2400, 'E_MOTO'),
  bid('moto-b', 1500, 'MOTO'),
  bid('bike-b', 900, 'BIKE'),
];

function stubFetchRouter(routes: Record<string, unknown>) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : String((input as Request).url ?? input);
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

function journey(vehiclePreference: string | null) {
  return {
    id: 'j1',
    pickupName: 'Nyabugogo',
    destinationName: 'Kacyiru',
    status: 'REQUESTED',
    ...(vehiclePreference ? { vehiclePreference } : {}),
  };
}

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
        sectionHeader: '{{vehicle}} · {{count}} offer',
        sectionHeader_other: '{{vehicle}} · {{count}} offers',
        cheapestOfKind: 'Cheapest here',
        anyVehicleWaiting: 'Offers can come from bicycles, motos and e-motos.',
      },
      bidList: { state: { liveHint: 'This page fills itself in' } },
      vehicles: { bike: 'Bicycle', ebike: 'E-bike', moto: 'Moto', emoto: 'E-moto' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  useAuthStore.setState({ token: 'tok', user: { id: 'c1', role: 'CUSTOMER' } as any });
  useJourneyStore.setState({ activeJourney: null, nearbyRequests: [], availableSignal: null });
  useBidStore.setState({ bids: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetConnectivityForTests();
});

describe('an any-vehicle journey groups its offers', () => {
  beforeEach(() => {
    stubFetchRouter({ '/api/journeys/j1/bids': MIXED_BIDS, '/api/journeys/j1': journey(null) });
  });

  test('one section per vehicle kind that actually bid', async () => {
    renderBidList();
    await waitFor(() => expect(screen.getByTestId('bid-list-grouped')).toBeInTheDocument());

    expect(screen.getByTestId('bid-section-BIKE')).toBeInTheDocument();
    expect(screen.getByTestId('bid-section-MOTO')).toBeInTheDocument();
    expect(screen.getByTestId('bid-section-E_MOTO')).toBeInTheDocument();
    // No section for a kind that sent no offer.
    expect(screen.queryByTestId('bid-section-E_BIKE')).toBeNull();
  });

  test('sections are ordered cheapest-first by their own lowest price', async () => {
    renderBidList();
    await waitFor(() => expect(screen.getByTestId('bid-list-grouped')).toBeInTheDocument());

    const order = [...screen.getByTestId('bid-list-grouped').children].map((el) =>
      el.getAttribute('data-testid'),
    );
    // BIKE's lowest is 900, MOTO's 1500, E_MOTO's 2400 — and this is
    // NOT the order they arrived in.
    expect(order).toEqual(['bid-section-BIKE', 'bid-section-MOTO', 'bid-section-E_MOTO']);
  });

  test('every offer lands in exactly one section, none is lost', async () => {
    renderBidList();
    await waitFor(() => expect(screen.getByTestId('bid-list-grouped')).toBeInTheDocument());

    for (const b of MIXED_BIDS) {
      expect(screen.getByTestId(`bid-${b.id}-accept`)).toBeInTheDocument();
    }
    expect(screen.getAllByText('Accept')).toHaveLength(MIXED_BIDS.length);
  });

  test('each section headers its own kind and count', async () => {
    renderBidList();
    await waitFor(() => expect(screen.getByTestId('bid-section-BIKE')).toBeInTheDocument());

    expect(within(screen.getByTestId('bid-section-BIKE')).getByText('Bicycle · 2 offers')).toBeInTheDocument();
    expect(within(screen.getByTestId('bid-section-E_MOTO')).getByText('E-moto · 1 offer')).toBeInTheDocument();
  });

  test('rows keep their price and the driver ETA', async () => {
    renderBidList();
    await waitFor(() => expect(screen.getByTestId('bid-list-grouped')).toBeInTheDocument());

    const bikeSection = screen.getByTestId('bid-section-BIKE');
    expect(within(bikeSection).getByText('900')).toBeInTheDocument();
    expect(within(bikeSection).getAllByText('5 min').length).toBeGreaterThan(0);
  });
});

describe('the per-section cheapest marker', () => {
  test('marks exactly one row per section — the cheapest in it', async () => {
    stubFetchRouter({ '/api/journeys/j1/bids': MIXED_BIDS, '/api/journeys/j1': journey(null) });
    renderBidList();
    await waitFor(() => expect(screen.getByTestId('bid-list-grouped')).toBeInTheDocument());

    // One marker per section, and on the right row each time.
    expect(screen.getAllByText('Cheapest here')).toHaveLength(3);
    expect(screen.getByTestId('bid-bike-b-cheapest')).toBeInTheDocument(); // 900 < 1200
    expect(screen.getByTestId('bid-moto-b-cheapest')).toBeInTheDocument(); // 1500 < 1800
    expect(screen.getByTestId('bid-emoto-a-cheapest')).toBeInTheDocument(); // sole offer
    expect(screen.queryByTestId('bid-bike-a-cheapest')).toBeNull();
    expect(screen.queryByTestId('bid-moto-a-cheapest')).toBeNull();
  });

  test('it is cheapest-in-section, not cheapest-overall', async () => {
    stubFetchRouter({ '/api/journeys/j1/bids': MIXED_BIDS, '/api/journeys/j1': journey(null) });
    renderBidList();
    await waitFor(() => expect(screen.getByTestId('bid-list-grouped')).toBeInTheDocument());

    // The 1500 moto is marked even though two bicycles undercut it:
    // the customer comparing motos needs the cheapest moto.
    expect(screen.getByTestId('bid-moto-b-cheapest')).toBeInTheDocument();
  });
});

describe('a journey WITH a stated preference is unchanged', () => {
  const MOTO_ONLY = [bid('m1', 1800, 'MOTO'), bid('m2', 1500, 'MOTO')];

  beforeEach(() => {
    stubFetchRouter({ '/api/journeys/j1/bids': MOTO_ONLY, '/api/journeys/j1': journey('MOTO') });
  });

  test('renders one flat list — no grouping container, no sections', async () => {
    renderBidList();
    await waitFor(() => expect(screen.getAllByText('Accept')).toHaveLength(2));

    expect(screen.queryByTestId('bid-list-grouped')).toBeNull();
    expect(screen.queryByTestId('bid-section-MOTO')).toBeNull();
  });

  test('no cheapest marker anywhere', async () => {
    renderBidList();
    await waitFor(() => expect(screen.getAllByText('Accept')).toHaveLength(2));

    expect(screen.queryByText('Cheapest here')).toBeNull();
    expect(screen.queryByTestId('bid-m2-cheapest')).toBeNull();
  });

  test('the rows themselves are the same rows', async () => {
    renderBidList();
    await waitFor(() => expect(screen.getAllByText('Accept')).toHaveLength(2));

    for (const b of MOTO_ONLY) {
      expect(screen.getByTestId(`bid-${b.id}-accept`)).toBeInTheDocument();
      expect(screen.getByTestId(`bid-${b.id}-decline`)).toBeInTheDocument();
    }
    expect(screen.getByText('1,800')).toBeInTheDocument();
  });
});

describe('the empty state says who may still answer', () => {
  test('an any-vehicle request names the kinds that can offer', async () => {
    stubFetchRouter({ '/api/journeys/j1/bids': [], '/api/journeys/j1': journey(null) });
    renderBidList();

    expect(await screen.findByTestId('bid-list-any-vehicle-hint')).toBeInTheDocument();
    expect(
      screen.getByText('Offers can come from bicycles, motos and e-motos.'),
    ).toBeInTheDocument();
  });

  test('a stated-preference request does not — its answer is already narrowed', async () => {
    stubFetchRouter({ '/api/journeys/j1/bids': [], '/api/journeys/j1': journey('MOTO') });
    renderBidList();

    await waitFor(() => expect(screen.getByText('Waiting for offers')).toBeInTheDocument());
    expect(screen.queryByTestId('bid-list-any-vehicle-hint')).toBeNull();
  });
});
