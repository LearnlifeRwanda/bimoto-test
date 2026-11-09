import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

// CREATE-FIX G2 — the submitted body must parse against the REAL shared
// schema (the server rejects anything else with a 400). Asserting on
// issues (not just success) prints the violations when it fails.
function expectSchemaConformant(body: unknown) {
  const parsed = createJourneySchema.safeParse(body);
  expect(parsed.error?.issues ?? []).toEqual([]);
  expect(parsed.success).toBe(true);
}

// GEOCODE — typing no longer sets a location; pickup/destination are
// chosen from live suggestions. Stub fetch so /api/geocode/search
// returns one suggestion and everything else behaves as the journey
// POST used to.
const SUGGESTION = { lat: -1.9536, lng: 30.0606, label: 'Kimironko Market, Kigali' };

function stubFetch(
  journeyResponse: () => Response = () =>
    new Response(JSON.stringify({ id: 'j1' }), { status: 201 }),
) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/geocode/search')) {
      return new Response(JSON.stringify({ results: [SUGGESTION] }), { status: 200 });
    }
    return journeyResponse();
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

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      delivery: {
        addStopToggle: 'Drop a package on the way',
        addStopButton: '+ Add a goods stop',
        stopOrderLabel: 'Stop {{n}}',
        stopTypeLabel: 'Stop type',
        stopTypeGoodsDropoff: 'Drop off a parcel',
        stopTypeGoodsPickup: 'Pick up a parcel',
        stopNameLabel: 'Address or landmark',
        stopNamePlaceholder: 'e.g., Post office',
        parcelSizeLabel: 'Parcel size',
        parcelSizeSmall: 'Small (≤ 5 kg)',
        parcelSizeMedium: 'Medium (5–15 kg)',
        parcelSizeLarge: 'Large (15–30 kg)',
        contactNameLabel: 'Recipient name (optional)',
        contactPhoneLabel: 'Recipient phone (optional)',
        removeStop: 'Remove stop',
        saveStop: 'Save stop',
        cancelStop: 'Cancel',
        infoCardTitle: 'Delivery on the way',
        infoCardLine1: 'Driver will drop your parcel between pickup and destination',
        infoCardLine2: 'Fare includes parcel-size premium',
        driverStopList: 'Stops on the way',
        driverCompleteStop: 'Complete this stop',
      },
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
      home: {
        urgentDelivery: 'Urgent delivery',
        urgentDeliveryHint: 'urgent hint',
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

describe('NewJourneyPage — R3-DELIVERY multi-stop', () => {
  test('delivery toggle hidden until checked; toggle reveals add-stop button', () => {
    renderPage();
    expect(screen.queryByTestId('add-stop-button')).toBeNull();
    fireEvent.click(screen.getByTestId('delivery-toggle'));
    expect(screen.getByTestId('add-stop-button')).toBeInTheDocument();
  });

  test('adding a goods stop populates the legs preview list', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('delivery-toggle'));
    fireEvent.click(screen.getByTestId('add-stop-button'));
    fireEvent.change(screen.getByTestId('stop-name-input'), {
      target: { value: 'Post office' },
    });
    fireEvent.click(screen.getByTestId('parcel-size-LARGE'));
    fireEvent.click(screen.getByTestId('stop-save'));
    expect(screen.getByTestId('journey-legs-display')).toBeInTheDocument();
    expect(screen.getByTestId('parcel-size-badge-0').textContent).toBe('LARGE');
  });

  test('removing a stop drops it from the preview list', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('delivery-toggle'));
    fireEvent.click(screen.getByTestId('add-stop-button'));
    fireEvent.change(screen.getByTestId('stop-name-input'), {
      target: { value: 'Post office' },
    });
    fireEvent.click(screen.getByTestId('stop-save'));
    expect(screen.getByTestId('journey-legs-display')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('remove-stop-0'));
    expect(screen.queryByTestId('journey-legs-display')).toBeNull();
  });

  test('submit body includes legs[] with parcelSize when stops are present', async () => {
    const fetchMock = stubFetch();

    renderPage();
    // Set pickup + destination via suggestion select so submit is enabled.
    await pickAddress('pickup', 'home address');
    await pickAddress('destination', 'office address');
    // Add 1 LARGE goods stop.
    fireEvent.click(screen.getByTestId('delivery-toggle'));
    fireEvent.click(screen.getByTestId('add-stop-button'));
    fireEvent.change(screen.getByTestId('stop-name-input'), {
      target: { value: 'Post office' },
    });
    fireEvent.click(screen.getByTestId('parcel-size-LARGE'));
    fireEvent.click(screen.getByTestId('stop-save'));
    // Submit.
    fireEvent.click(screen.getByText('Find drivers'));
    const journeyCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/journeys'));
      expect(call).toBeDefined();
      return call as unknown as [string, RequestInit];
    });
    const body = JSON.parse(journeyCall[1].body as string);
    expect(Array.isArray(body.legs)).toBe(true);
    expect(body.legs).toHaveLength(1);
    expect(body.legs[0].type).toBe('GOODS_DROPOFF');
    expect(body.legs[0].parcelSize).toBe('LARGE');
    expect(body.legs[0].name).toBe('Post office');
    expectSchemaConformant(body);
  });

  // R3-DELIVERY-V2 — RoutePreviewMap integration.
  test('RoutePreviewMap is hidden until both pickup and destination are selected', async () => {
    stubFetch();
    renderPage();
    expect(screen.queryByTestId('route-preview-map')).toBeNull();
    await pickAddress('pickup', 'home address');
    expect(screen.queryByTestId('route-preview-map')).toBeNull();
    await pickAddress('destination', 'office address');
    expect(screen.getByTestId('route-preview-map')).toBeInTheDocument();
  });

  test('RoutePreviewMap gains a segment polyline when goods stops are added', async () => {
    // TRUE-ROUTES G1 — the preview draws one polyline per stop-to-stop
    // segment (road route when the directions proxy answers, dashed
    // fallback otherwise), so a new stop adds a segment.
    stubFetch();
    renderPage();
    await pickAddress('pickup', 'home address');
    await pickAddress('destination', 'office address');
    expect(
      within(screen.getByTestId('route-preview-map')).getAllByTestId('polyline'),
    ).toHaveLength(1);

    fireEvent.click(screen.getByTestId('delivery-toggle'));
    fireEvent.click(screen.getByTestId('add-stop-button'));
    fireEvent.change(screen.getByTestId('stop-name-input'), {
      target: { value: 'Post office' },
    });
    fireEvent.click(screen.getByTestId('stop-save'));
    expect(
      within(screen.getByTestId('route-preview-map')).getAllByTestId('polyline'),
    ).toHaveLength(2);
  });

  test('omitting the toggle leaves legs[] off the request body', async () => {
    const fetchMock = stubFetch();

    renderPage();
    await pickAddress('pickup', 'home address');
    await pickAddress('destination', 'office address');
    fireEvent.click(screen.getByText('Find drivers'));
    const journeyCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/journeys'));
      expect(call).toBeDefined();
      return call as unknown as [string, RequestInit];
    });
    const body = JSON.parse(journeyCall[1].body as string);
    expect(body.legs).toBeUndefined();
    expectSchemaConformant(body);
  });

  // PILOT-UX G3 — every offered vehicle option is a real VehicleType
  // and reaches the body verbatim (the old list's CAR/VAN had to be
  // silently dropped because the server rejects them).
  test('an E_BIKE selection is submitted as a valid vehiclePreference', async () => {
    const fetchMock = stubFetch();

    renderPage();
    await pickAddress('pickup', 'home address');
    await pickAddress('destination', 'office address');
    fireEvent.click(screen.getByText('E-Bike Taxi'));
    fireEvent.click(screen.getByText('Find drivers'));
    const journeyCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/journeys'));
      expect(call).toBeDefined();
      return call as unknown as [string, RequestInit];
    });
    const body = JSON.parse(journeyCall[1].body as string);
    expect(body.vehiclePreference).toBe('E_BIKE');
    expectSchemaConformant(body);
  });
});
