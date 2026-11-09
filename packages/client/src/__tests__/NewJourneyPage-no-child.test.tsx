import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

// react-leaflet is not jsdom-friendly; mock it the same way the
// individual map test files do so the page can mount without canvas.
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
import { createJourneySchema } from '@bimoto/shared';

// PILOT-READY G2 — adults only for the pilot. The child-passenger
// declaration is out of the booking flow (founder decision, 28 Jul):
// no toggle, no age field, no unaccompanied-minor option, no guardian
// phone, no helmet confirmation — and the create body must simply omit
// hasChildPassenger and its companions (the shared schema marks them
// optional). The server validator and child-safety services stay as
// the backstop and are untouched by this removal.

const SUGGESTION = { lat: -1.9536, lng: 30.0606, label: 'Kimironko Market, Kigali' };

function stubFetch() {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/geocode/search')) {
      return new Response(JSON.stringify({ results: [SUGGESTION] }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'j1' }), { status: 201 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function pickAddress(placeholder: string, text: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), {
    target: { value: text },
  });
  const option = await screen.findByText(SUGGESTION.label, {}, { timeout: 2000 });
  fireEvent.click(option);
}

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      journey: {
        newRide: 'New ride',
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
        pickupRequired: 'pickup required',
        destinationRequired: 'destination required',
        createFailed: 'create failed',
      },
      vehicles: {
        bike: 'Bicycle Taxi',
        moto: 'Moto Taxi',
        emoto: 'E-Moto Taxi',
        ebike: 'E-Bike Taxi',
      },
      child: { travellingToggle: 'I am travelling with a child' },
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
    <MemoryRouter initialEntries={['/customer/new']}>
      <Routes>
        <Route path="/customer/new" element={<NewJourneyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('NewJourneyPage — PILOT-READY G2 adults-only booking', () => {
  test('renders no child-passenger control at all', () => {
    renderPage();
    expect(screen.queryByTestId('child-passenger-section')).toBeNull();
    expect(screen.queryByTestId('child-toggle')).toBeNull();
    expect(screen.queryByTestId('child-age-input')).toBeNull();
    expect(screen.queryByTestId('child-unaccompanied-toggle')).toBeNull();
    expect(screen.queryByTestId('child-guardian-phone')).toBeNull();
    expect(screen.queryByTestId('child-helmet-toggle')).toBeNull();
    expect(screen.queryByText('I am travelling with a child')).toBeNull();
  });

  test('submitted body omits hasChildPassenger and every companion field', async () => {
    const fetchMock = stubFetch();

    renderPage();
    await pickAddress('pickup', 'home address');
    await pickAddress('destination', 'office address');
    fireEvent.click(screen.getByText('Find drivers'));

    const journeyCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) =>
        String(u).includes('/api/journeys'),
      );
      expect(call).toBeDefined();
      return call as unknown as [string, RequestInit];
    });
    const body = JSON.parse(journeyCall[1].body as string);

    expect(body.hasChildPassenger).toBeUndefined();
    expect(body.childAgeYears).toBeUndefined();
    expect(body.childIsUnaccompaniedMinor).toBeUndefined();
    expect(body.childGuardianPhone).toBeUndefined();
    expect(body.childPassengerHelmetConfirmed).toBeUndefined();

    // The no-child body must still be valid against the REAL shared
    // schema — the fields are optional there, not required.
    const parsed = createJourneySchema.safeParse(body);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });
});
