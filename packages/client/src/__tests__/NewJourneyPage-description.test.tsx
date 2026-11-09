// LANDMARKS G4 — "describe the place" travels with the request.
//
// The catalog covers the places a public map knows. This is the half that
// covers everything else: a line of the passenger's own words, carried on
// the create body and rendered on the motari's screen. The two things
// worth proving here are that it reaches the wire when written, and that
// the body is untouched when it is not.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
import { PlaceDescription } from '../components/journey/PlaceDescription';
import { useAuthStore } from '../stores/auth.store';
import { _resetGeocodeAvailabilityForTests } from '../hooks/useGeocodeSearch';
import { createJourneySchema } from '@bimoto/shared';

function stubFetch() {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/geocode/search')) {
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'j1' }), { status: 201 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Both fields set by picking verified landmarks — no geocoder involved. */
async function pickLandmarks() {
  fireEvent.change(screen.getByPlaceholderText('pickup'), { target: { value: 'sonatubes' } });
  fireEvent.click(await screen.findByText('Sonatubes'));
  fireEvent.change(screen.getByPlaceholderText('destination'), { target: { value: 'giporoso' } });
  fireEvent.click(await screen.findByText('Giporoso'));
}

async function submitAndReadBody(fetchMock: ReturnType<typeof stubFetch>) {
  fireEvent.click(screen.getByText('Find drivers'));
  const call = await waitFor(() => {
    const c = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/journeys'));
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
        pickupDescriptionShown: 'Pickup notes',
        destinationDescriptionShown: 'Destination notes',
        landmarkNeedsPin: 'Tap the map to show where this is',
      },
      home: { urgentDelivery: 'u', urgentDeliveryHint: 'u', priorityDelivery: 'p', priorityDeliveryHint: 'p' },
      vehicleTypes: { MOTO: 'Moto' },
      child: { travellingToggle: 'child' },
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

describe('NewJourneyPage — describe the place', () => {
  test('the words the passenger types reach the create body', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await pickLandmarks();

    fireEvent.change(screen.getByTestId('pickup-description-input'), {
      target: { value: '  Kuwa Mudugudu  ' },
    });
    fireEvent.change(screen.getByTestId('destination-description-input'), {
      target: { value: 'behind the blue gate' },
    });

    const body = await submitAndReadBody(fetchMock);
    expect(body.pickupDescription).toBe('Kuwa Mudugudu');
    expect(body.destinationDescription).toBe('behind the blue gate');
    const parsed = createJourneySchema.safeParse(body);
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  test('nothing changes when the passenger writes nothing', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await pickLandmarks();

    const body = await submitAndReadBody(fetchMock);
    // Not empty strings — absent. An old server sees the body it always saw.
    expect('pickupDescription' in body).toBe(false);
    expect('destinationDescription' in body).toBe(false);
    expect(createJourneySchema.safeParse(body).success).toBe(true);
  });

  test('whitespace alone is nothing', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await pickLandmarks();

    fireEvent.change(screen.getByTestId('pickup-description-input'), {
      target: { value: '    ' },
    });
    const body = await submitAndReadBody(fetchMock);
    expect('pickupDescription' in body).toBe(false);
  });

  test('the field stops at the 200 characters the column allows', async () => {
    stubFetch();
    renderPage();
    const input = screen.getByTestId('pickup-description-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'x'.repeat(300) } });
    expect(input.value.length).toBe(200);
  });

  test('choosing a landmark with no pin seeds the description with its area', async () => {
    stubFetch();
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('pickup'), { target: { value: 'kwa jules' } });
    fireEvent.click(await screen.findByText('Kwa Jules'));

    await act(async () => {});
    // "Kwa Jules (Gisozi)" — the team's own parenthetical becomes the
    // starting point for the passenger's description rather than a blank.
    expect((screen.getByTestId('pickup-description-input') as HTMLInputElement).value).toBe('Gisozi');
  });
});

describe('PlaceDescription renders only when there is something to say', () => {
  const show = (text?: string | null) =>
    render(<PlaceDescription target="pickup" text={text} />);

  test('renders the words with a label', () => {
    show('Kuwa Mudugudu');
    expect(screen.getByTestId('pickup-description')).toHaveTextContent('Kuwa Mudugudu');
    expect(screen.getByTestId('pickup-description')).toHaveTextContent('Pickup notes');
  });

  test('renders nothing at all for empty, whitespace, null and undefined', () => {
    for (const value of ['', '   ', null, undefined]) {
      const { unmount } = show(value);
      expect(screen.queryByTestId('pickup-description')).toBeNull();
      unmount();
    }
  });
});
