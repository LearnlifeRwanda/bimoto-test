// PILOT-GUARD Item 9 — the child flag and the parcel declaration are
// mutually exclusive.
//
// They were two independent checkboxes on NewJourneyPage, so a passenger
// could tick both and send a motari a booking that says "a child is
// riding with me AND I am handing you packages to drop on the way" —
// one seat, one child, one pair of hands. The Trello board says the
// exclusion is adopted; the build did not have it.
//
// Deliberately NOT in this dispatch: wiring hasChildPassenger /
// childAgeYears from this screen. See the PR body — the R3-CHILD server
// gate is live and its thresholds are self-described placeholders that
// would 422 an ordinary Kigali booking, and TEAM-SAID G1 made this
// screen a notice rather than a gate on purpose. The last test here pins
// that nothing changed on that front.

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

const CHILD_FLOW_FIELDS = [
  'hasChildPassenger',
  'childAgeYears',
  'childIsUnaccompaniedMinor',
  'childGuardianPhone',
  'childPassengerHelmetConfirmed',
] as const;

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
        landmarkNeedsPin: 'Tap the map to show where this is',
      },
      home: { urgentDelivery: 'u', urgentDeliveryHint: 'u', priorityDelivery: 'p', priorityDeliveryHint: 'p' },
      vehicleTypes: { MOTO: 'Moto' },
      childTravel: {
        toggle: 'Travelling with a child?',
        toggleHelper: 'The motari sees this before he accepts',
        blockedByParcel: 'You are sending a package on this ride',
        noticeToDriver: 'The passenger is travelling with a child.',
      },
      delivery: {
        addStopToggle: 'Drop a package on the way',
        blockedByChild: 'You are travelling with a child on this ride',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  useAuthStore.setState({ token: 'tok', user: { id: 'c1', role: 'CUSTOMER' } as never } as never);
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

const child = () => screen.getByTestId('child-travel-toggle') as HTMLInputElement;
const parcel = () => screen.getByTestId('delivery-toggle') as HTMLInputElement;

describe('NewJourneyPage — child and parcel cannot both be declared', () => {
  test('neither ticked: both are available, as before', () => {
    renderPage();
    expect(child().disabled).toBe(false);
    expect(parcel().disabled).toBe(false);
  });

  test('ticking the child flag closes the parcel declaration', () => {
    renderPage();
    fireEvent.click(child());
    expect(child().checked).toBe(true);
    expect(parcel().disabled).toBe(true);
    expect(screen.getByTestId('delivery-blocked-note').textContent).toContain(
      'travelling with a child',
    );
  });

  test('ticking the parcel declaration closes the child flag', () => {
    renderPage();
    fireEvent.click(parcel());
    expect(parcel().checked).toBe(true);
    expect(child().disabled).toBe(true);
    expect(screen.getByText('You are sending a package on this ride')).toBeTruthy();
  });

  test('unticking either restores the other', () => {
    renderPage();
    fireEvent.click(child());
    expect(parcel().disabled).toBe(true);
    fireEvent.click(child());
    expect(parcel().disabled).toBe(false);
    fireEvent.click(parcel());
    expect(child().disabled).toBe(true);
    fireEvent.click(parcel());
    expect(child().disabled).toBe(false);
  });

  test('a child booking still puts travellingWithChild — and only that — on the wire', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await pickLandmarks();
    fireEvent.click(child());

    const body = await submitAndReadBody(fetchMock);
    expect(body.travellingWithChild).toBe(true);
    // The R3-CHILD declaration flow stays omitted: this dispatch does
    // NOT wake the server gate. See the PR body.
    for (const field of CHILD_FLOW_FIELDS) {
      expect(body).not.toHaveProperty(field);
    }
    expect(body).not.toHaveProperty('legs');
  });
});
