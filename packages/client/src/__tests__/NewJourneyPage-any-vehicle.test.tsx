// ANY-VEHICLE G1 — "Any vehicle" is an OMISSION, not a value.
//
// The server side of any-vehicle already existed before this dispatch:
// vehiclePreference is optional in the shared schema, and the feed's
// vehicle prefilter passes every motari on a journey that has none
// (journey.service.ts:658-661). The only thing missing was a way for
// the customer to ask for it. So what has to be proved here is small
// and exact:
//
//   1. the option exists, and is offered FIRST;
//   2. choosing it OMITS the key — an explicit null would fail the
//      shared schema, which marks the field optional, not nullable;
//   3. every explicit choice still puts the same value on the wire it
//      always did, and the untouched default is still MOTO.
//
// (3) is the both-ways half: this option is only safe if it changes
// nothing for the customer who never taps it.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  Marker: ({ position, children }: any) => (
    <div data-testid="marker" data-pos={`${position[0]},${position[1]}`}>{children}</div>
  ),
  Polyline: ({ positions }: any) => <div data-testid="polyline" data-count={positions.length} />,
  Popup: ({ children }: any) => <div>{children}</div>,
  useMap: () => ({ fitBounds: vi.fn() }),
  useMapEvents: () => ({}),
}));

vi.mock('leaflet', () => ({ default: { divIcon: () => ({}) }, divIcon: () => ({}) }));

import { NewJourneyPage } from '../pages/customer/NewJourneyPage';
import { useAuthStore } from '../stores/auth.store';
import { _resetGeocodeAvailabilityForTests } from '../hooks/useGeocodeSearch';
import { createJourneySchema } from '@bimoto/shared';

function stubFetch() {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    void init;
    if (String(url).includes('/api/geocode/search')) {
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }
    if (String(url).includes('/api/journeys/fair-price')) {
      return new Response(JSON.stringify({ range: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'j1' }), { status: 201 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function pickLandmarks() {
  fireEvent.change(screen.getByPlaceholderText('pickup'), { target: { value: 'sonatubes' } });
  fireEvent.click(await screen.findByText('Sonatubes'));
  fireEvent.change(screen.getByPlaceholderText('destination'), { target: { value: 'giporoso' } });
  fireEvent.click(await screen.findByText('Giporoso'));
}

async function submitAndReadBody(fetchMock: ReturnType<typeof stubFetch>) {
  fireEvent.click(screen.getByText('Find drivers'));
  const call = await waitFor(() => {
    const c = fetchMock.mock.calls.find(
      ([u, init]) => String(u).includes('/api/journeys') && init?.method === 'POST',
    );
    expect(c).toBeDefined();
    return c as unknown as [string, RequestInit];
  });
  return JSON.parse(call[1].body as string);
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
        any_vehicle: 'Any vehicle',
        wishPrice: 'Wish price',
        wishPricePlaceholder: 'wish price',
        wishPriceHelper: 'helper',
        findDrivers: 'Find drivers',
        offlineWarning: 'offline',
        createFailed: 'create failed',
        addressSuggestions: 'Address suggestions',
        addressNoResults: 'none',
        addressSearching: 'searching',
        describePlaceLabel: 'Describe the place (optional)',
        describePlacePlaceholder: 'e.g. Kuwa Mudugudu',
        describePlaceHelp: 'Anything that helps the motari',
        landmarkNeedsPin: 'Tap the map to show where this is',
      },
      home: { urgentDelivery: 'u', urgentDeliveryHint: 'u', priorityDelivery: 'p', priorityDeliveryHint: 'p' },
      vehicles: { bike: 'Bicycle', ebike: 'E-bike', moto: 'Moto', emoto: 'E-moto' },
      vehicleTypeInfo: {
        any: {
          label: 'Any vehicle',
          whoCanOffer: 'Offers may come from bicycles, motos and e-motos.',
          youChoose: 'You choose from the offers that arrive.',
        },
      },
      childTravel: { toggle: 'Travelling with a child?', toggleHelper: 'h' },
      delivery: { addStopToggle: 'stop' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  useAuthStore.setState({ token: 'tok', user: { id: 'c1', role: 'CUSTOMER' } as any } as any);
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

describe('ANY-VEHICLE G1 — the option', () => {
  test('is offered, and offered first', () => {
    stubFetch();
    renderPage();

    const any = screen.getByTestId('journey-vehicle-ANY');
    const moto = screen.getByTestId('journey-vehicle-MOTO');
    expect(any).toBeInTheDocument();

    // Widest choice first: Any precedes every concrete vehicle button
    // in document order.
    expect(any.compareDocumentPosition(moto) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('is not the default — MOTO still is', () => {
    stubFetch();
    renderPage();
    expect(screen.getByTestId('journey-vehicle-MOTO')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('journey-vehicle-ANY')).toHaveAttribute('aria-pressed', 'false');
  });

  test('selecting it swaps the pressed state', () => {
    stubFetch();
    renderPage();
    fireEvent.click(screen.getByTestId('journey-vehicle-ANY'));
    expect(screen.getByTestId('journey-vehicle-ANY')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('journey-vehicle-MOTO')).toHaveAttribute('aria-pressed', 'false');
  });

  test('shows the any-vehicle info card, and only then', () => {
    stubFetch();
    renderPage();
    expect(screen.queryByTestId('vehicle-type-info-card-any')).toBeNull();
    expect(screen.getByTestId('vehicle-type-info-card')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('journey-vehicle-ANY'));
    expect(screen.getByTestId('vehicle-type-info-card-any')).toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-type-info-card')).toBeNull();
    expect(
      screen.getByText('Offers may come from bicycles, motos and e-motos.'),
    ).toBeInTheDocument();
  });
});

describe('ANY-VEHICLE G1 — what reaches the wire', () => {
  test('choosing Any OMITS vehiclePreference entirely', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await pickLandmarks();
    fireEvent.click(screen.getByTestId('journey-vehicle-ANY'));

    const body = await submitAndReadBody(fetchMock);

    // Absent, not null: the shared field is `.optional()`, so an
    // explicit null is a validation error, and an absent key cannot be
    // read later as "the customer was never asked".
    expect('vehiclePreference' in body).toBe(false);
    expect(body.vehiclePreference).toBeUndefined();
    const parsed = createJourneySchema.safeParse(body);
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  test('the untouched default still sends MOTO', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await pickLandmarks();

    const body = await submitAndReadBody(fetchMock);
    expect(body.vehiclePreference).toBe('MOTO');
    expect(createJourneySchema.safeParse(body).success).toBe(true);
  });

  test('an explicit choice still sends that choice', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await pickLandmarks();
    fireEvent.click(screen.getByTestId('journey-vehicle-BIKE'));

    const body = await submitAndReadBody(fetchMock);
    expect(body.vehiclePreference).toBe('BIKE');
    expect(createJourneySchema.safeParse(body).success).toBe(true);
  });

  test('Any then back to a vehicle re-attaches the key', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await pickLandmarks();
    fireEvent.click(screen.getByTestId('journey-vehicle-ANY'));
    fireEvent.click(screen.getByTestId('journey-vehicle-E_MOTO'));

    const body = await submitAndReadBody(fetchMock);
    expect(body.vehiclePreference).toBe('E_MOTO');
  });
});
