// SOCKET-FIX G6 — the G2 delivery: a journey:available signal makes the
// online driver dashboard refetch its nearby list and show the subtle
// 'new request' cue. Modeled on DashboardPage-stats-card.test.tsx:
// every dependency stubbed, socket.io mocked (the page mounts useSocket).

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
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

// Geolocation resolves immediately so the dashboard gets a position and
// its first nearby fetch.
vi.mock('../hooks/useGeolocation', () => ({
  geolocation: {
    getCurrentPosition: vi.fn(async () => ({ lat: -1.95, lng: 30.06 })),
  },
}));

import { DashboardPage } from '../pages/driver/DashboardPage';
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';

let nearbyFetches: number;

beforeEach(async () => {
  nearbyFetches = 0;
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
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

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
        nearbyFetches++;
        return { ok: true, status: 200, json: async () => [] } as Response;
      }
      // BOOK-UNBLOCK G4 — going online now requires the server to
      // confirm the location write; answer it so the toggle succeeds.
      // (FEED-CONTRACT G3 added the online-status write + the mount
      // restore read; answer both so tests start server-offline.)
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
      // DriverStatsCard/DriverEarningsCard render null on !ok — keep the
      // dashboard shell minimal instead of feeding them fake shapes.
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as any,
  );
});

describe('DashboardPage live discovery feed (SOCKET-FIX G2)', () => {
  test('journey:available signal → nearby refetch + subtle cue', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    // Go online: position resolves, first nearby fetch fires.
    fireEvent.click(screen.getByText("I'm offline"));
    await waitFor(() => expect(nearbyFetches).toBe(1));
    expect(screen.queryByTestId('new-request-cue')).toBeNull();

    // The store signal is exactly what useSocket's journey:available
    // handler raises.
    act(() => {
      useJourneyStore.getState().signalJourneyAvailable('j-new', true);
    });

    await waitFor(() => expect(nearbyFetches).toBe(2));
    expect(screen.getByTestId('new-request-cue')).toHaveTextContent('New request nearby');

    // Same signal seq must not refire on unrelated rerenders.
    await new Promise((r) => setTimeout(r, 50));
    expect(nearbyFetches).toBe(2);
  });

  test('an offline dashboard ignores the signal', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    act(() => {
      useJourneyStore.getState().signalJourneyAvailable('j-new');
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(nearbyFetches).toBe(0);
    expect(screen.queryByTestId('new-request-cue')).toBeNull();
  });
});
