// FIELD-CLOSE G1 — the suggested-fare hint on the ride form.
//
// The fair-price endpoint existed since R3-T but NewJourneyPage never
// showed it. These tests pin the surfaced behaviour: once pickup and
// destination are both set the hint appears with the band's median and
// a one-tap fill of the wish-price field — and every failure path
// (5xx, sparse data) hides the hint without ever blocking the form.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

// react-leaflet is not jsdom-friendly; same mock as the sibling
// NewJourneyPage test files.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  Marker: ({ position, children }: any) => (
    <div data-testid="marker" data-pos={`${position[0]},${position[1]}`}>
      {children}
    </div>
  ),
  Polyline: ({ positions }: any) => (
    <div data-testid="polyline" data-count={positions.length} />
  ),
  Popup: ({ children }: any) => <div>{children}</div>,
  useMap: () => ({ fitBounds: vi.fn() }),
  useMapEvents: () => ({}),
}));

vi.mock('leaflet', () => ({
  default: { divIcon: () => ({}) },
  divIcon: () => ({}),
}));

import { NewJourneyPage } from '../pages/customer/NewJourneyPage';
import { useAuthStore } from '../stores/auth.store';
import { _resetGeocodeAvailabilityForTests } from '../hooks/useGeocodeSearch';

const SUGGESTION = { lat: -1.9536, lng: 30.0606, label: 'Kimironko Market, Kigali' };
const FAR_SUGGESTION = { lat: -1.9986, lng: 30.1044, label: 'Kicukiro Centre, Kigali' };

// Stub fetch: geocode search returns one suggestion per query text so
// pickup and destination land on DIFFERENT coordinates (distance > 0),
// and /fair-price answers per the configurable response.
function stubFetch(fairPriceResponse: () => Response) {
  let searchCount = 0;
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const s = String(url);
    if (s.includes('/api/geocode/search')) {
      searchCount += 1;
      const result = searchCount === 1 ? SUGGESTION : FAR_SUGGESTION;
      return new Response(JSON.stringify({ results: [result] }), { status: 200 });
    }
    if (s.includes('/api/journeys/fair-price')) {
      return fairPriceResponse();
    }
    return new Response(JSON.stringify({ id: 'j1' }), { status: 201 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function pickAddress(placeholder: string, text: string, label: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), {
    target: { value: text },
  });
  const option = await screen.findByText(label, {}, { timeout: 2000 });
  fireEvent.click(option);
}

async function setBothPoints() {
  await pickAddress('pickup', 'Kimironko', SUGGESTION.label);
  await pickAddress('destination', 'Kicukiro', FAR_SUGGESTION.label);
}

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      journey: {
        newRide: 'New passenger ride',
        pickup: 'Pickup',
        pickupPlaceholder: 'pickup',
        useMyLocation: 'Use my location',
        destination: 'Destination',
        destinationPlaceholder: 'destination',
        vehicleType: 'Vehicle type',
        wishPrice: 'Wish price',
        wishPricePlaceholder: 'wish price',
        wishPriceHelper: 'helper',
        findDrivers: 'Find drivers',
        offlineWarning: 'offline',
        fair_price: 'Fair price for this route: {{price}} RWF',
        useSuggestedPrice: 'Use this price',
      },
      vehicles: {
        bike: 'Bicycle Taxi',
        moto: 'Moto Taxi',
        emoto: 'E-Moto Taxi',
        ebike: 'E-Bike Taxi',
      },
      child: { travellingToggle: 'I am travelling with a child' },
      delivery: { addStopToggle: 'Drop a package on the way' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

  useAuthStore.setState({
    token: 'tok',
    user: { id: 'c1', role: 'CUSTOMER' } as any,
  } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetGeocodeAvailabilityForTests();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/journey/new']}>
      <Routes>
        <Route path="/journey/new" element={<NewJourneyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('FIELD-CLOSE G1 — suggested fare on the ride form', () => {
  test('hint appears once both points are set and one tap fills the wish price', async () => {
    const fetchMock = stubFetch(
      () =>
        new Response(
          JSON.stringify({ range: { min: 800, median: 1000, max: 1300 } }),
          { status: 200 },
        ),
    );
    renderPage();

    // No hint before a route exists.
    expect(screen.queryByTestId('fair-price-hint')).not.toBeInTheDocument();

    await setBothPoints();

    const hint = await screen.findByTestId('fair-price-hint', {}, { timeout: 3000 });
    expect(hint.textContent).toContain('1,000');

    // The debounced fetch went to the real endpoint with the ride params.
    const fairPriceCall = fetchMock.mock.calls
      .map(([u]) => String(u))
      .find((u) => u.includes('/api/journeys/fair-price'));
    expect(fairPriceCall).toBeDefined();
    expect(fairPriceCall).toContain('journeyType=PASSENGER');
    expect(fairPriceCall).toMatch(/distance=\d+(\.\d+)?/);

    fireEvent.click(screen.getByTestId('use-fair-price'));
    expect(screen.getByPlaceholderText('wish price')).toHaveValue(1000);
  });

  test('sparse data (range: null) leaves the form without a hint and submittable', async () => {
    stubFetch(() => new Response(JSON.stringify({ range: null }), { status: 200 }));
    renderPage();
    await setBothPoints();

    // Give the debounce + fetch time to settle, then assert absence.
    await new Promise((r) => setTimeout(r, 800));
    expect(screen.queryByTestId('fair-price-hint')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find drivers' })).toBeEnabled();
  });

  test('a failing endpoint (500) hides the hint silently and never blocks', async () => {
    stubFetch(() => new Response('{}', { status: 500 }));
    renderPage();
    await setBothPoints();

    await new Promise((r) => setTimeout(r, 800));
    expect(screen.queryByTestId('fair-price-hint')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find drivers' })).toBeEnabled();
  });
});
