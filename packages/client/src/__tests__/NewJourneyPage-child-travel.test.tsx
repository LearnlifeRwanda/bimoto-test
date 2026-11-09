// TEAM-SAID G1 — "Travelling with a child?" is a flag, not a flow.
//
// The team confirmed the child-passenger declaration stays off for the
// pilot (item 9, 6 of 7) and asked instead for one honest signal whose
// only job is to tell the motari before he arrives. Two things are
// worth proving here, and the second matters more than the first:
//
//   1. the flag reaches the wire when ticked, and adds nothing when not;
//   2. it never touches the omitted child-passenger flow — no
//      hasChildPassenger, no age/guardian/helmet companions, nothing
//      the child 422 taxonomy or the fare premium could read.

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
import { ChildTravelNotice } from '../components/journey/ChildTravelNotice';
import { useAuthStore } from '../stores/auth.store';
import { _resetGeocodeAvailabilityForTests } from '../hooks/useGeocodeSearch';
import { createJourneySchema } from '@bimoto/shared';

/** Every field the omitted R3-CHILD declaration flow puts on the wire. */
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
        noticeToDriver: 'The passenger is travelling with a child.',
      },
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

describe('NewJourneyPage — the child-travel flag travels', () => {
  test('ticking the box puts travellingWithChild on the create body', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await pickLandmarks();

    fireEvent.click(screen.getByTestId('child-travel-toggle'));

    const body = await submitAndReadBody(fetchMock);
    expect(body.travellingWithChild).toBe(true);
    const parsed = createJourneySchema.safeParse(body);
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  test('leaving the box alone adds no key at all', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await pickLandmarks();

    const body = await submitAndReadBody(fetchMock);
    // Absent, not false: the body is byte-identical to what a client
    // that had never heard of this field would send.
    expect('travellingWithChild' in body).toBe(false);
    expect(createJourneySchema.safeParse(body).success).toBe(true);
  });
});

describe('the flag never enters the omitted child-passenger flow', () => {
  test('a ticked box sends none of the child-flow fields', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await pickLandmarks();

    fireEvent.click(screen.getByTestId('child-travel-toggle'));
    const body = await submitAndReadBody(fetchMock);

    const present = CHILD_FLOW_FIELDS.filter((f) => f in body);
    expect(present).toEqual([]);
  });

  test('the page renders no part of the child declaration flow', () => {
    stubFetch();
    renderPage();

    // The R3-CHILD block's own controls: age, guardian phone, helmet.
    // If any of these come back, the flag has become the flow again.
    expect(screen.queryByTestId('child-age-input')).toBeNull();
    expect(screen.queryByTestId('child-guardian-phone-input')).toBeNull();
    expect(screen.queryByTestId('child-helmet-toggle')).toBeNull();
    expect(screen.queryByTestId('child-passenger-section')).toBeNull();
    // ...while the advisory itself is present.
    expect(screen.getByTestId('child-travel-toggle')).toBeInTheDocument();
  });

  test('the advisory carries no price: the two bodies differ by the flag alone', async () => {
    // A successful submit navigates away, so the two bookings are two
    // separate renders of the same form.
    const fetchMock = stubFetch();
    const first = renderPage();
    await pickLandmarks();
    const plain = await submitAndReadBody(fetchMock);
    first.unmount();

    fetchMock.mockClear();
    renderPage();
    await pickLandmarks();
    fireEvent.click(screen.getByTestId('child-travel-toggle'));
    const flagged = await submitAndReadBody(fetchMock);

    // The only difference between the two bodies is the advisory
    // itself — no premium, no multiplier, no extra fare field.
    //
    // OUTBOX G2 — clientRequestId names the booking ATTEMPT, not the
    // booking: it is a fresh uuid on every submit, so any two sends
    // differ by it by design. It is transport identity (the offline
    // outbox's idempotency key), never a fare input, so it is dropped
    // from both sides here. What this test guards — that the advisory
    // buys no pricing field — is unchanged.
    const { travellingWithChild, clientRequestId: _flaggedId, ...withoutFlag } = flagged;
    const { clientRequestId: _plainId, ...plainFields } = plain;
    expect(travellingWithChild).toBe(true);
    expect(withoutFlag).toEqual(plainFields);
  });
});

describe('ChildTravelNotice — what the motari reads', () => {
  test('renders the advisory when the passenger warned him', () => {
    render(<ChildTravelNotice travellingWithChild />);
    expect(screen.getByTestId('child-travel-notice')).toHaveTextContent(
      'The passenger is travelling with a child.',
    );
  });

  test('renders nothing for false, null and undefined', () => {
    for (const value of [false, null, undefined]) {
      const { unmount } = render(<ChildTravelNotice travellingWithChild={value} />);
      expect(screen.queryByTestId('child-travel-notice')).toBeNull();
      unmount();
    }
  });
});
