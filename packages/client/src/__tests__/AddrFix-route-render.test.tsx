// ADDR-FIX G4 — the route text actually renders.
//
// Fixtures use the server's REAL journey shape
// (pickupName/destinationName, per prisma Journey + journey.service).
// Before ADDR-FIX these screens read the wrong *Address field names —
// fields no payload contains — so every route line rendered empty
// (see addr-field-guard.test.ts). These tests pin the binding: a journey
// with real place names must show those names, not a blank node.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
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

import { HistoryPage } from '../pages/shared/HistoryPage';
import { BidListPage } from '../pages/customer/BidListPage';
import { DashboardPage } from '../pages/driver/DashboardPage';
import { useAuthStore } from '../stores/auth.store';
import { useBidStore } from '../stores/bid.store';
import { useJourneyStore } from '../stores/journey.store';
import { _resetConnectivityForTests } from '../sync/connectivity';

beforeEach(async () => {
  _resetConnectivityForTests();
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      history: { title: 'My rides', empty: 'No rides yet', emptyHint: 'hint' },
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
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  useAuthStore.setState({ token: 'tok', user: { id: 'u1' } as any });
  useJourneyStore.setState({ activeJourney: null, nearbyRequests: [], availableSignal: null });
  useBidStore.setState({ bids: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetConnectivityForTests();
});

function stubFetchRouter(routes: Record<string, unknown>) {
  const mock = vi.fn(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    for (const [suffix, body] of Object.entries(routes)) {
      if (url.includes(suffix)) {
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('ADDR-FIX G4 — HistoryPage renders real place names', () => {
  test('a ride with pickupName/destinationName shows both texts', async () => {
    stubFetchRouter({
      '/api/journeys?history=true': [
        {
          id: 'j1',
          pickupName: 'Kimironko Market',
          destinationName: 'Kigali Heights',
          status: 'COMPLETED',
          agreedPrice: 2500,
          createdAt: '2026-07-20T10:00:00Z',
        },
      ],
    });
    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Kimironko Market')).toBeInTheDocument();
    expect(screen.getByText('Kigali Heights')).toBeInTheDocument();
  });
});

describe('ADDR-FIX G4 — BidListPage journey summary renders real place names', () => {
  test('the fetched journey shows pickup and destination', async () => {
    stubFetchRouter({
      '/api/journeys/j1/bids': [],
      '/api/journeys/j1': {
        id: 'j1',
        pickupName: 'Nyabugogo',
        destinationName: 'Kacyiru',
        status: 'REQUESTED',
      },
    });
    render(
      <MemoryRouter initialEntries={['/journey/j1/bids']}>
        <Routes>
          <Route path="/journey/:id/bids" element={<BidListPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Nyabugogo')).toBeInTheDocument();
    expect(screen.getByText('Kacyiru')).toBeInTheDocument();
  });
});

describe('ADDR-FIX G4 — driver DashboardPage request cards render real place names', () => {
  test('a nearby request shows pickup and destination', async () => {
    useAuthStore.setState({
      token: 'tok',
      user: { id: 'driver-1', role: 'DRIVER' } as any,
      isAuthenticated: true,
      isLoading: false,
    });
    stubFetchRouter({
      // BOOK-UNBLOCK G4 — going online now requires the server to
      // confirm the location write; answer it so the toggle succeeds.
      // FEED-CONTRACT G3 added the online-status write to the same
      // chain.
      '/api/users/me/location': {},
      '/api/users/me/online-status': {},
      '/api/journeys?viewAs=driver': [
        {
          id: 'j-near-1',
          type: 'PASSENGER',
          pickupName: 'Remera',
          destinationName: 'Nyamirambo',
          createdAt: '2026-07-28T08:00:00Z',
        },
      ],
    });
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("I'm offline"));
    await waitFor(() => expect(screen.getByText('Remera')).toBeInTheDocument());
    expect(screen.getByText('Nyamirambo')).toBeInTheDocument();
  });
});
