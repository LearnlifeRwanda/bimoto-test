// __TESTS__/NEW-JOURNEY-PAGE-OUTBOX.TEST.TSX
//
// OUTBOX G2 — the write path through the REAL booking page.
//
// The unit suite (outbox-write-path.test.ts) proves the table behaves.
// This proves the PAGE branches correctly, which is where the damage
// would be: a booking that vanishes because a dead zone looked like a
// rejection, or a rejection queued forever because a 422 looked like a
// dead zone.
//
// Also pins the thing §3 calls byte-identical online behaviour: a
// successful create still POSTs a schema-conformant body and still
// navigates to the bid list, with nothing held on the phone.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import 'fake-indexeddb/auto';
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
import { _resetConnectivityForTests } from '../sync/connectivity';
import { createJourneySchema } from '@bimoto/shared';
import { db } from '../db/dexie';
import { listOutbox } from '../lib/outbox';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUGGESTION = { lat: -1.9536, lng: 30.0606, label: 'Kimironko Market, Kigali' };

/**
 * `journeyOutcome` is what the /api/journeys POST does. `undefined`
 * means "throw like a dead network" — which is exactly how the browser
 * fetch behaves with no signal, and what apiFetch turns into an
 * OFFLINE/UNREACHABLE ApiError.
 */
function stubFetch(journeyOutcome?: () => Response) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes('/api/geocode/search')) {
      return new Response(JSON.stringify({ results: [SUGGESTION] }), { status: 200 });
    }
    if (u.includes('/api/journeys')) {
      if (!journeyOutcome) throw new TypeError('Failed to fetch');
      return journeyOutcome();
    }
    // Health probes and anything else: also dead when the journey POST is.
    if (!journeyOutcome) throw new TypeError('Failed to fetch');
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function pickAddress(placeholder: string, text: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: text } });
  const option = await screen.findByText(SUGGESTION.label, {}, { timeout: 2000 });
  fireEvent.click(option);
}

async function fillAndSubmit() {
  await pickAddress('pickup', 'Kimironko');
  await pickAddress('destination', 'Giporoso');
  fireEvent.click(screen.getByRole('button', { name: 'Find drivers' }));
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/customer/new']}>
      <Routes>
        <Route path="/customer/new" element={<NewJourneyPage />} />
        <Route path="/" element={<div data-testid="home" />} />
        <Route path="/journey/:id/bids" element={<div data-testid="bid-list" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The journey POST body the page actually sent, parsed. */
function sentCreateBody(fetchMock: ReturnType<typeof stubFetch>) {
  const call = fetchMock.mock.calls.find(
    ([url, init]: any) => String(url).includes('/api/journeys') && init?.method === 'POST',
  );
  return JSON.parse((call as any)[1].body);
}

beforeEach(async () => {
  await db.outbox.clear();
  _resetConnectivityForTests();
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
      outbox: {
        savedTitle: 'Saved on this phone',
        savedBody: 'We will send it when you are back online.',
        savedRoute: '{{from}} → {{to}}',
        cancel: 'Cancel this booking',
        cancelled: 'Booking cancelled',
        done: 'Done',
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
    user: { id: ALICE, role: 'CUSTOMER' } as any,
  } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetGeocodeAvailabilityForTests();
});

describe('NewJourneyPage — booking with no signal', () => {
  test('a create that never got an answer is held on the phone, and says so', async () => {
    stubFetch(); // dead network
    renderPage();
    await fillAndSubmit();

    // The honest screen, not a red "could not create the ride".
    await screen.findByTestId('saved-offline-notice');
    expect(screen.getByText('Saved on this phone')).toBeInTheDocument();
    // The passenger's own route, so they can see it is the right one.
    expect(screen.getByTestId('saved-offline-route').textContent).toContain(
      'Kimironko Market, Kigali',
    );

    const held = await listOutbox(ALICE);
    expect(held).toHaveLength(1);
    expect(held[0].status).toBe('PENDING');
    expect(held[0].userId).toBe(ALICE);
    expect(held[0].kind).toBe('journey-create');
  });

  test('the held payload is a schema-conformant create body carrying its idempotency key', async () => {
    stubFetch();
    renderPage();
    await fillAndSubmit();
    await screen.findByTestId('saved-offline-notice');

    const [held] = await listOutbox(ALICE);
    // What comes off the phone later must be something the server will
    // accept — validated against the REAL shared schema, not a copy.
    const parsed = createJourneySchema.safeParse(held.payload);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect((held.payload as any).clientRequestId).toBe(held.clientId);
  });

  test('the passenger can take the held booking back', async () => {
    stubFetch();
    renderPage();
    await fillAndSubmit();
    await screen.findByTestId('saved-offline-notice');

    fireEvent.click(screen.getByTestId('saved-offline-cancel'));

    await waitFor(async () => expect(await listOutbox(ALICE)).toEqual([]));
    await screen.findByTestId('home');
  });

  test('a 422 is NOT queued — it is a real answer and stays an error', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({ error: { code: 'ACCOUNT_FLAGGED', message: 'errors.accountFlagged' } }),
          { status: 422 },
        ),
    );
    renderPage();
    await fillAndSubmit();

    // Still on the form; nothing held.
    await waitFor(async () => expect(await listOutbox(ALICE)).toEqual([]));
    expect(screen.queryByTestId('saved-offline-notice')).toBeNull();
  });

  test('a 500 is NOT queued either — the server answered', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: { code: 'BOOM' } }), { status: 500 }));
    renderPage();
    await fillAndSubmit();

    await waitFor(async () => expect(await listOutbox(ALICE)).toEqual([]));
    expect(screen.queryByTestId('saved-offline-notice')).toBeNull();
  });
});

describe('NewJourneyPage — online booking is unchanged', () => {
  test('a successful create still posts a conformant body, navigates, and holds nothing', async () => {
    const fetchMock = stubFetch(
      () => new Response(JSON.stringify({ id: 'j1', status: 'REQUESTED' }), { status: 201 }),
    );
    renderPage();
    await fillAndSubmit();

    await screen.findByTestId('bid-list');
    const body = sentCreateBody(fetchMock);
    const parsed = createJourneySchema.safeParse(body);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(body.pickupName).toBe(SUGGESTION.label);
    expect(body.type).toBe('PASSENGER');
    // Nothing was held: the ride exists on the server.
    expect(await listOutbox(ALICE)).toEqual([]);
    expect(screen.queryByTestId('saved-offline-notice')).toBeNull();
  });
});
