// COUNTER-READY G5 — the motari's side of the counter, on his own bid
// screen.
//
// Both flag arms, and the disabled one first: with counterBidEnabled
// false he sees nothing AND the client does not even go looking — no
// bid-list fetch is made to find a counter that cannot exist. That
// matters beyond tidiness: during the baseline weeks every phone in
// Kigali is running this code against a dormant server, and a feature
// that quietly polls is a feature that is not asleep.
//
// The card is mounted BESIDE the screen it lives on (#203's standing
// rule) — every case renders BidPage and drives the real buttons.
//
// Asserts on the SHIPPED English strings.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
import enTranslation from '../../public/locales/en/translation.json';
import { BidPage } from '../pages/driver/BidPage';
import { useAuthStore } from '../stores/auth.store';
import { useUIStore } from '../stores/ui.store';
import { useSimulationStore } from '../stores/simulation.store';

const JOURNEY = {
  id: 'j1',
  type: 'PASSENGER',
  status: 'REQUESTED',
  pickupName: 'Nyabugogo',
  destinationName: 'Remera',
  estimatedDistance: 3.4,
  vehiclePreference: 'MOTO',
  wishPrice: 1200,
  customer: { id: 'c1', nickname: 'Passenger', completedRides: 3 },
};

/** His own bid, carrying an unanswered counter. */
const MY_COUNTERED_BID = {
  id: 'b1',
  journeyId: 'j1',
  driverId: 'd1',
  status: 'PENDING',
  price: 2000,
  etaMinutes: 7,
  counterAmountRwf: 1500,
  counterAt: '2026-08-25T09:00:00.000Z',
  counterOutcome: null,
};

function stubApi(bids: any[] = [MY_COUNTERED_BID], respondOk = true) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/counter/respond')) {
      return new Response(
        JSON.stringify(respondOk ? { matched: true, outcome: 'ACCEPTED' } : { error: { code: 'COUNTER_ALREADY_ANSWERED' } }),
        { status: respondOk ? 200 : 409 },
      );
    }
    if (u.endsWith('/api/journeys/j1/bids')) {
      return new Response(JSON.stringify(bids), { status: 200 });
    }
    if (u.endsWith('/api/journeys/j1')) {
      return new Response(JSON.stringify(JOURNEY), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/driver/bid/j1']}>
      <Routes>
        <Route path="/driver/bid/:id" element={<BidPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  i18n.addResourceBundle('en', 'translation', enTranslation, true, true);
  await i18n.changeLanguage('en');
  useAuthStore.setState({
    token: 'tok-1',
    user: { id: 'd1', nickname: 'Bosco', driverProfile: { totalRides: 10 } } as any,
  });
  useUIStore.setState({ toasts: [], toastMessage: null, toastType: null } as any);
  useSimulationStore.setState({ counterBidEnabled: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useSimulationStore.setState({ counterBidEnabled: false });
});

describe('flag OFF — the counter does not exist on his screen', () => {
  test('no card, even with a countered bid sitting in the response', async () => {
    stubApi();
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-distance')).toBeInTheDocument());
    expect(screen.queryByTestId('driver-counter-card')).not.toBeInTheDocument();
    expect(screen.queryByText('A different price was suggested')).not.toBeInTheDocument();
  });

  test('and the client does not even go looking — no bid-list fetch', async () => {
    const fetchMock = stubApi();
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-distance')).toBeInTheDocument());
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/journeys/j1/bids')),
    ).toBe(false);
  });
});

describe('flag ON — he answers the counter on his own bid', () => {
  beforeEach(() => {
    useSimulationStore.setState({ counterBidEnabled: true });
  });

  test('the card shows both numbers, and says his offer survives a decline', async () => {
    stubApi();
    renderPage();

    await waitFor(() => expect(screen.getByTestId('driver-counter-card')).toBeInTheDocument());
    expect(screen.getByText('Your offer: 2,000 RWF')).toBeInTheDocument();
    expect(screen.getByText('They suggest 1,500 RWF')).toBeInTheDocument();
    // The sentence that stops "Keep my price" reading as "give up the ride".
    expect(
      screen.getByText('If you decline, your offer of 2,000 RWF stays on their screen.'),
    ).toBeInTheDocument();
  });

  test('accept posts the respond endpoint with accept', async () => {
    const fetchMock = stubApi();
    renderPage();

    await waitFor(() => expect(screen.getByTestId('counter-accept')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('counter-accept'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/counter/respond'));
      expect(call).toBeDefined();
      expect(String(call![0])).toContain('/api/journeys/j1/bids/b1/counter/respond');
      expect(call![1]?.method).toBe('POST');
      expect(JSON.parse(call![1]!.body as string)).toEqual({ action: 'accept' });
    });
    expect(useUIStore.getState().toastMessage).toBe('Price accepted — the ride is yours');
  });

  test('decline posts decline, and says his own price stands', async () => {
    const fetchMock = stubApi();
    renderPage();

    await waitFor(() => expect(screen.getByTestId('counter-decline')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('counter-decline'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/counter/respond'));
      expect(JSON.parse(call![1]!.body as string)).toEqual({ action: 'decline' });
    });
    expect(useUIStore.getState().toastMessage).toBe('Your offer stands at your own price');
  });

  test('the card leaves the screen once he has answered', async () => {
    stubApi();
    renderPage();

    await waitFor(() => expect(screen.getByTestId('driver-counter-card')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('counter-decline'));

    await waitFor(() =>
      expect(screen.queryByTestId('driver-counter-card')).not.toBeInTheDocument(),
    );
  });

  test('no card when his bid carries no counter', async () => {
    stubApi([{ ...MY_COUNTERED_BID, counterAmountRwf: null, counterAt: null }]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-distance')).toBeInTheDocument());
    expect(screen.queryByTestId('driver-counter-card')).not.toBeInTheDocument();
  });

  test('no card when the counter is already answered', async () => {
    stubApi([{ ...MY_COUNTERED_BID, counterOutcome: 'DECLINED' }]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-distance')).toBeInTheDocument());
    expect(screen.queryByTestId('driver-counter-card')).not.toBeInTheDocument();
  });

  test('no card for a RIVAL\'s countered bid — a counter is between two people', async () => {
    stubApi([{ ...MY_COUNTERED_BID, id: 'b9', driverId: 'd7' }]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('bid-distance')).toBeInTheDocument());
    expect(screen.queryByTestId('driver-counter-card')).not.toBeInTheDocument();
  });
});
