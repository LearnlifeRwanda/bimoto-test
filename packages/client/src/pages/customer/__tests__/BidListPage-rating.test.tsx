// RATE-DISPLAY G4 — bid cards render the driver's reputation from the
// REAL server payload shape (bid.driver.avgRating / totalRides,
// bid.service.ts), and an unrated driver gets the calm New-driver
// label instead of NaN stars or '-'.
//
// The stub i18n in setup.ts doesn't register the rating/reliability
// namespaces, so untranslated keys render as the key string itself.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import '../../../__tests__/setup';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<any>);
  return { ...actual, useNavigate: () => mockNavigate };
});

import { BidListPage } from '../BidListPage';
import { useAuthStore } from '../../../stores/auth.store';
import { useBidStore } from '../../../stores/bid.store';
import { useJourneyStore } from '../../../stores/journey.store';

const JID = 'j1';

// The exact shape GET /journeys/:id/bids returns (bid.service.ts):
// rating data nested under driver, avgRating 0 = never rated.
const ratedBid = {
  id: 'b-rated',
  journeyId: JID,
  price: 2000,
  etaMinutes: 8,
  driverName: 'Rated Joe',
  driver: { nickname: 'Rated Joe', avgRating: 4.8, totalRides: 30 },
};

const freshBid = {
  id: 'b-fresh',
  journeyId: JID,
  price: 1800,
  etaMinutes: 5,
  driverName: 'Fresh Sam',
  driver: { nickname: 'Fresh Sam', avgRating: 0, totalRides: 0 },
};

function resp(data: any, ok = true) {
  return { ok, statusText: 'err', json: async () => data };
}

function installFetch(bids: any[]) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith(`/journeys/${JID}/bids`)) return resp(bids);
    if (url.endsWith(`/journeys/${JID}`)) {
      return resp({ id: JID, pickupName: 'A', destinationName: 'B' });
    }
    return resp({});
  });
  vi.stubGlobal('fetch', fetchMock as any);
  return fetchMock;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/journey/${JID}/bids`]}>
      <Routes>
        <Route path="/journey/:id/bids" element={<BidListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockNavigate.mockReset();
  useAuthStore.setState({
    token: 'tok-1',
    user: { nickname: 'Aljo', phone: '+250788111111' } as any,
  });
  useBidStore.setState({ bids: [] });
  useJourneyStore.setState({ activeJourney: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BidListPage — driver rating on bid cards (RATE-DISPLAY)', () => {
  test('rated driver with ≥5 rides shows stars + average + reliability pill', async () => {
    installFetch([ratedBid]);
    renderPage();

    expect(await screen.findByTestId('driver-rating-summary')).toBeInTheDocument();
    expect(screen.getByTestId('driver-rating-average').textContent).toBe('4.8');
    // ReliabilityBadge rated variant: "4.8 · {{count}} rides"
    expect(screen.getByText(/4\.8 ·/)).toBeInTheDocument();
  });

  test('rated driver under 5 rides shows stars but no rated pill', async () => {
    installFetch([
      {
        ...ratedBid,
        driver: { nickname: 'Rated Joe', avgRating: 4.2, totalRides: 3 },
      },
    ]);
    renderPage();

    expect(await screen.findByTestId('driver-rating-summary')).toBeInTheDocument();
    expect(screen.getByTestId('driver-rating-average').textContent).toBe('4.2');
    expect(screen.queryByText(/4\.2 ·/)).not.toBeInTheDocument();
    expect(screen.getByText('reliability.newDriver')).toBeInTheDocument();
  });

  test('unrated driver renders the calm New-driver label, never NaN or a dash', async () => {
    installFetch([freshBid]);
    const { container } = renderPage();

    expect(
      await screen.findByTestId('driver-rating-new-driver'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('driver-rating-summary')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN/);
  });

  test('rated and unrated bids coexist on one list', async () => {
    installFetch([ratedBid, freshBid]);
    renderPage();

    expect(await screen.findByTestId('driver-rating-summary')).toBeInTheDocument();
    expect(screen.getByTestId('driver-rating-new-driver')).toBeInTheDocument();
  });
});
