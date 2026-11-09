// CREATE-FIX G2 — GoodsRequestPage submit-body regression net.
//
// The page previously sent pickupAddress/destinationAddress (the schema
// wants pickupName/destinationName — every goods request 400'd against
// the real server) plus goodsSize/isFragile/vehicleType, which the
// server's Zod parse silently stripped. These tests capture the exact
// body the page submits and validate it against the REAL shared
// createJourneySchema so the contract can never drift unnoticed again.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<any>);
  return { ...actual, useNavigate: () => mockNavigate };
});

// PILOT-UX-2 G2 — the page now mounts the background map; react-leaflet
// is not jsdom-friendly, so mock it like the other map-bearing tests.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  Marker: ({ children }: any) => <div data-testid="marker">{children}</div>,
  Polyline: () => null,
  Popup: ({ children }: any) => <div>{children}</div>,
  useMap: () => ({ fitBounds: vi.fn() }),
  useMapEvents: () => ({}),
}));

vi.mock('leaflet', () => ({
  default: { divIcon: () => ({}) },
  divIcon: () => ({}),
}));

import { GoodsRequestPage } from '../pages/customer/GoodsRequestPage';
import { useAuthStore } from '../stores/auth.store';
import { _resetGeocodeAvailabilityForTests } from '../hooks/useGeocodeSearch';
import { createJourneySchema } from '@bimoto/shared';

// The submitted body must parse against the REAL shared schema (the
// server rejects anything else with a 400). Asserting on issues (not
// just success) prints the violations when it fails.
function expectSchemaConformant(body: unknown) {
  const parsed = createJourneySchema.safeParse(body);
  expect(parsed.error?.issues ?? []).toEqual([]);
  expect(parsed.success).toBe(true);
}

const SUGGESTION = { lat: -1.9536, lng: 30.0606, label: 'Kimironko Market, Kigali' };

function stubFetch(journeyResponse: any = { id: 'j1', status: 'REQUESTED' }) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/geocode/search')) {
      return new Response(JSON.stringify({ results: [SUGGESTION] }), { status: 200 });
    }
    return new Response(JSON.stringify(journeyResponse), { status: 201 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function pickAddress(placeholder: string, text: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), {
    target: { value: text },
  });
  // Debounced (350 ms) — wait for the suggestion, then select it.
  const option = await screen.findByText(SUGGESTION.label, {}, { timeout: 2000 });
  fireEvent.click(option);
}

function journeyPostBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.find(
    ([u, init]: any[]) => String(u).endsWith('/api/journeys') && init?.method === 'POST',
  );
  return call ? JSON.parse((call[1] as any).body) : undefined;
}

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      goods: {
        title: 'Send goods',
        details: 'Goods details',
        description: 'Description',
        descriptionPlaceholder: 'What is being sent?',
        descriptionRequired: 'description required',
        size: 'Size',
        size_small: 'Small',
        size_medium: 'Medium',
        size_large: 'Large',
        fragile: 'Fragile',
        recipientName: 'Recipient name',
        recipientNamePlaceholder: 'recipient name',
        recipientNameRequired: 'recipient name required',
        recipientPhone: 'Recipient phone',
        recipientPhonePlaceholder: 'recipient phone',
        recipientPhoneRequired: 'recipient phone required',
        submit: 'Request delivery',
      },
      journey: {
        pickup: 'Pickup',
        pickupPlaceholder: 'pickup',
        useMyLocation: 'Use my location',
        destination: 'Destination',
        destinationPlaceholder: 'destination',
        vehicleType: 'Vehicle type',
        wishPrice: 'Wish price',
        wishPricePlaceholder: 'wish price',
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
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  mockNavigate.mockReset();
  useAuthStore.setState({ token: 'tok', user: { id: 'c1', role: 'CUSTOMER' } as any } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetGeocodeAvailabilityForTests();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/journey/goods']}>
      <Routes>
        <Route path="/journey/goods" element={<GoodsRequestPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillRequiredFields() {
  await pickAddress('pickup', 'Kimironko market');
  await pickAddress('destination', 'Kimironko market');
  fireEvent.change(screen.getByPlaceholderText('What is being sent?'), {
    target: { value: '  Spare parts  ' },
  });
  fireEvent.change(screen.getByPlaceholderText('recipient name'), {
    target: { value: 'Alice' },
  });
  fireEvent.change(screen.getByPlaceholderText('recipient phone'), {
    target: { value: '+250788111111' },
  });
}

describe('GoodsRequestPage — schema-conformant create body', () => {
  test('submit posts a body the shared createJourneySchema accepts (defaults)', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await fillRequiredFields();

    fireEvent.click(screen.getByText('Request delivery'));
    await waitFor(() => expect(journeyPostBody(fetchMock)).toBeDefined());

    const body = journeyPostBody(fetchMock);
    expectSchemaConformant(body);
    expect(body.type).toBe('GOODS');
    expect(body.pickupName).toBe(SUGGESTION.label);
    expect(body.destinationName).toBe(SUGGESTION.label);
    expect(body.pickupAddress).toBeUndefined();
    expect(body.destinationAddress).toBeUndefined();
    expect(body.goodsDescription).toBe('Spare parts');
    expect(body.goodsSizeCategory).toBe('MEDIUM');
    expect(body.goodsFragile).toBe(false);
    expect(body.recipientName).toBe('Alice');
    expect(body.recipientPhone).toBe('+250788111111');
    // Default vehicle (MOTO) maps onto the shared VehicleType enum.
    expect(body.vehiclePreference).toBe('MOTO');
    expect(mockNavigate).toHaveBeenCalledWith('/journey/j1/bids', { replace: true });
  });

  test('size + fragile selections reach the schema fields (LARGE, fragile, wish price)', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await fillRequiredFields();

    fireEvent.click(screen.getByText('Large'));
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.change(screen.getByPlaceholderText('wish price'), {
      target: { value: '2500' },
    });

    fireEvent.click(screen.getByText('Request delivery'));
    await waitFor(() => expect(journeyPostBody(fetchMock)).toBeDefined());

    const body = journeyPostBody(fetchMock);
    expectSchemaConformant(body);
    expect(body.goodsSizeCategory).toBe('LARGE');
    expect(body.goodsFragile).toBe(true);
    expect(body.wishPrice).toBe(2500);
  });

  // PILOT-UX G3 — CAR/BICYCLE/VAN are gone; every offered option is a
  // real VehicleType and is sent as the preference verbatim.
  test('an E_MOTO selection is submitted as a valid VehicleType', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await fillRequiredFields();

    fireEvent.click(screen.getByText('E-Moto Taxi'));
    fireEvent.click(screen.getByText('Request delivery'));
    await waitFor(() => expect(journeyPostBody(fetchMock)).toBeDefined());

    const body = journeyPostBody(fetchMock);
    expectSchemaConformant(body);
    expect(body.vehiclePreference).toBe('E_MOTO');
  });
});
