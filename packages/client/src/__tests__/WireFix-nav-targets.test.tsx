// WIRE-FIX G1 — regression tests for the two broken navigation wires
// found by the wiring audit (docs/wiring-report.md §1.1 and §3.2):
//
//   1. DashboardPage:474 navigated to `/driver/journey/:id/bid`, a path
//      no route declares — every driver tap on a nearby request landed
//      on NotFoundPage. The declared route is `/driver/bid/:id`.
//   2. MatchedPage:230 navigated to `/journey/:id/waiting` after a
//      redispatch — also undeclared. A fresh REQUESTED journey's home
//      is `/journey/:id/bids` (the target every creation flow uses).
//
// Each test mounts the page inside a router that declares the REAL
// route paths from App.tsx plus the same `*` catch-all, taps the
// trigger, and asserts the navigation lands on the declared route —
// not the 404. The route table is the contract; these tests pin the
// call sites to it.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';
import { i18n } from './setup';

const { mockSocket, ioMock } = vi.hoisted(() => {
  const mockSocket = {
    on: () => mockSocket,
    emit: () => mockSocket,
    disconnect: () => {},
    connected: false,
  };
  return { mockSocket, ioMock: { io: () => mockSocket } };
});
vi.mock('socket.io-client', () => ioMock);

vi.mock('../hooks/useGeolocation', () => ({
  geolocation: {
    getCurrentPosition: vi.fn(async () => ({ lat: -1.95, lng: 30.06 })),
  },
}));

// MatchedPage renders the approach map; stub leaflet for jsdom.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  Marker: () => <div data-testid="marker" />,
  Polyline: () => null,
  useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn(), panTo: vi.fn() }),
}));
vi.mock('leaflet', () => ({
  default: { divIcon: () => ({}) },
  divIcon: () => ({}),
}));
vi.mock('../hooks/useDriverLocationStream', () => ({
  useDriverLocationStream: () => ({
    driverLocation: null,
    etaMinutes: null,
    etaConfidence: 'unknown',
    etaAsOf: null,
    isLive: false,
    approachStatus: null,
    distanceMeters: null,
  }),
}));

import { DashboardPage } from '../pages/driver/DashboardPage';
import { MatchedPage } from '../pages/customer/MatchedPage';
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';
import { useChatStore } from '../stores/chat.store';

function RouteEcho({ label }: { label: string }) {
  const params = useParams();
  return <div data-testid="route-echo">{`${label}:${params.id}`}</div>;
}

const NotFoundMarker = () => <div data-testid="not-found">404</div>;

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      dashboard: {
        imOnline: "I'm online",
        imOffline: "I'm offline",
        onlineSubtitle: 'Available for rides',
        goOnline: 'Go online to receive ride requests',
        noRequests: 'No requests',
        noRequestsSubtitle: 'Hang tight',
        nearbyRequests: '{{count}} nearby',
        newRequestNearby: 'New request nearby',
        fetchFailed: 'Could not load nearby requests',
        justNow: 'just now',
        minutesAgo: '{{n}}m ago',
        hoursAgo: '{{n}}h ago',
      },
      account: {
        viewAccount: 'View account status',
        statusFlagged: 'Flagged',
        statusSuspended: 'Suspended until {{until}}',
      },
      journey: {
        geoFailed: 'Could not get GPS',
        geoNotSupported: 'GPS not supported',
      },
      matched: {
        driver: 'Driver',
        driverOnTheWay: 'Driver on the way',
        chat: 'Chat',
        cancelRide: 'Cancel ride',
        driverDidntShow: "Your driver didn't show up.",
        findAnotherDriver: 'Find another driver',
      },
      driverApproach: {
        etaUnknown: 'Locating driver…',
        mapLabel: 'Driver approach map',
      },
      common: { yes: 'Yes', no: 'No', dismiss: 'Dismiss' },
      chat: { noMessages: 'No messages yet' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

describe('WIRE-FIX G1.1 — driver nearby-request tap reaches the declared bid route', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: 'tok',
      user: { id: 'driver-1', role: 'DRIVER' } as any,
      isAuthenticated: true,
      isLoading: false,
    });
    useJourneyStore.setState({ nearbyRequests: [], availableSignal: null });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.includes('/api/journeys?viewAs=driver')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: 'req-77',
                type: 'RIDE',
                pickupName: 'Kimironko',
                destinationName: 'Nyabugogo',
                createdAt: new Date().toISOString(),
              },
            ],
          } as Response;
        }
        if (
          url.includes('/api/users/me/location') ||
          url.includes('/api/users/me/online-status')
        ) {
          return { ok: true, status: 200, json: async () => ({}) } as Response;
        }
        if (url.endsWith('/api/users/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'driver-1', role: 'DRIVER', driverProfile: { isOnline: false } }),
          } as Response;
        }
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }) as any,
    );
  });

  test('tap lands on /driver/bid/:id, not the 404 catch-all', async () => {
    render(
      <MemoryRouter initialEntries={['/driver']}>
        <Routes>
          {/* Declared route paths mirrored from App.tsx — the contract. */}
          <Route path="/driver" element={<DashboardPage />} />
          <Route path="/driver/bid/:id" element={<RouteEcho label="bid" />} />
          <Route path="*" element={<NotFoundMarker />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("I'm offline"));
    await waitFor(() => expect(screen.getByText('Kimironko')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Kimironko'));

    await waitFor(() =>
      expect(screen.getByTestId('route-echo')).toHaveTextContent('bid:req-77'),
    );
    expect(screen.queryByTestId('not-found')).toBeNull();
  });
});

describe('WIRE-FIX G1.2 — customer redispatch reaches the declared bids route', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: 'tok',
      user: { id: 'cust', nickname: 'C', role: 'CUSTOMER' } as any,
      isAuthenticated: true,
      isLoading: false,
    });
    useChatStore.setState({ messages: [], isLoading: false });
  });

  test('Find another driver lands on /journey/:id/bids for the fresh journey, not the 404', async () => {
    const cancelled = {
      id: 'j-1',
      status: 'CANCELLED',
      cancelReason: 'DRIVER_NO_SHOW',
      pickupLat: -1.95,
      pickupLng: 30.06,
      driver: { nickname: 'Driver Bob' },
    };
    useJourneyStore.setState({ activeJourney: cancelled as any });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.includes('/messages')) {
          return { ok: true, json: async () => [] } as any;
        }
        if (url.includes('/redispatch')) {
          return {
            ok: true,
            json: async () => ({ id: 'j-2', status: 'REQUESTED' }),
          } as any;
        }
        return { ok: true, json: async () => cancelled } as any;
      }) as any,
    );

    render(
      <MemoryRouter initialEntries={['/journey/j-1/matched']}>
        <Routes>
          {/* Declared route paths mirrored from App.tsx — the contract. */}
          <Route path="/journey/:id/matched" element={<MatchedPage />} />
          <Route path="/journey/:id/bids" element={<RouteEcho label="bids" />} />
          <Route path="*" element={<NotFoundMarker />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByText('Find another driver')).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Find another driver'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('route-echo')).toHaveTextContent('bids:j-2'),
    );
    expect(screen.queryByTestId('not-found')).toBeNull();
  });
});
