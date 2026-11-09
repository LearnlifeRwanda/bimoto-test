// __TESTS__/BOOK-UNBLOCK-DRIVER-ONLINE.TEST.TSX
//
// BOOK-UNBLOCK G4 — the driver's "I'm online" is server-confirmed:
//   - a failed PUT /api/users/me/location keeps the toggle offline and
//     shows a retryable banner (no silent lie)
//   - retry after the server recovers actually goes online
//   - a failed periodic update degrades visibly ("position not being
//     sent") instead of leaving a stale "I'm online"
//   - a failed offline write says the driver may still appear online

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
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

vi.mock('../hooks/useGeolocation', () => ({
  geolocation: {
    getCurrentPosition: vi.fn(async () => ({ lat: -1.95, lng: 30.06 })),
  },
}));

import { DashboardPage } from '../pages/driver/DashboardPage';
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';

// Mutable per-test behaviour for the location + online-status endpoints.
let locationPutOk: boolean;
let locationPuts: Array<{ body: any }>;
// FEED-CONTRACT G3 — online state now has its own writer
// (PUT /me/online-status, the only endpoint that writes the
// driverProfile.isOnline column).
let onlineStatusPutOk: boolean;
let onlineStatusPuts: Array<{ body: any }>;
let nearbyFetches: number;

beforeEach(async () => {
  locationPutOk = true;
  locationPuts = [];
  onlineStatusPutOk = true;
  onlineStatusPuts = [];
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
        goOnlineFailed: "We couldn't put you online",
        locationSyncLost: 'Your position is not being sent',
        goOfflineFailed: 'You may still appear online',
      },
      account: {
        viewAccount: 'View account status',
      },
      journey: {
        geoFailed: 'Could not get GPS',
        geoNotSupported: 'GPS not supported',
      },
      common: { retry: 'Retry' },
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
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/users/me/location')) {
        locationPuts.push({ body: JSON.parse(String(init?.body ?? '{}')) });
        return {
          ok: locationPutOk,
          status: locationPutOk ? 200 : 500,
          json: async () => ({}),
          clone: function () {
            return this;
          },
        } as unknown as Response;
      }
      if (url.includes('/api/users/me/online-status')) {
        onlineStatusPuts.push({ body: JSON.parse(String(init?.body ?? '{}')) });
        return {
          ok: onlineStatusPutOk,
          status: onlineStatusPutOk ? 200 : 500,
          json: async () => ({}),
          clone: function () {
            return this;
          },
        } as unknown as Response;
      }
      // G3 mount restore reads the server's online truth; this driver
      // starts server-offline so each test begins from a cold state.
      if (url.endsWith('/api/users/me')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'driver-1', role: 'DRIVER', driverProfile: { isOnline: false } }),
        } as Response;
      }
      if (url.includes('/api/journeys?viewAs=driver')) {
        nearbyFetches++;
        return { ok: true, status: 200, json: async () => [] } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as any,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe('BOOK-UNBLOCK G4 — server-confirmed driver online state', () => {
  test('a failed location write keeps the driver offline with a retryable banner', async () => {
    locationPutOk = false;
    renderPage();

    fireEvent.click(screen.getByText("I'm offline"));

    await waitFor(() =>
      expect(screen.getByTestId('location-sync-banner')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('location-sync-banner').dataset.issue).toBe(
      'go-online',
    );
    expect(screen.getByText("We couldn't put you online")).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
    // Still visibly offline, and no nearby feed was started.
    expect(screen.getByText("I'm offline")).toBeInTheDocument();
    expect(screen.queryByText("I'm online")).toBeNull();
    expect(nearbyFetches).toBe(0);
  });

  test('retry goes online once the server confirms the write', async () => {
    locationPutOk = false;
    renderPage();

    fireEvent.click(screen.getByText("I'm offline"));
    await waitFor(() =>
      expect(screen.getByTestId('location-sync-banner')).toBeInTheDocument(),
    );

    locationPutOk = true;
    fireEvent.click(screen.getByTestId('location-sync-retry'));

    await waitFor(() => expect(screen.getByText("I'm online")).toBeInTheDocument());
    expect(screen.queryByTestId('location-sync-banner')).toBeNull();
    expect(nearbyFetches).toBe(1);
    // The confirmed writes carried the position (location endpoint)
    // and the online flip (online-status endpoint — G3 split the two).
    const lastLocationPut = locationPuts[locationPuts.length - 1].body;
    expect(lastLocationPut.lat).toBeCloseTo(-1.95);
    const lastStatusPut = onlineStatusPuts[onlineStatusPuts.length - 1].body;
    expect(lastStatusPut.isOnline).toBe(true);
  });

  test('a failing periodic update degrades visibly instead of a stale "I\'m online"', async () => {
    // Fake timers from the start so the 15 s tracking interval is
    // registered on the fake clock.
    vi.useFakeTimers();
    renderPage();

    fireEvent.click(screen.getByText("I'm offline"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("I'm online")).toBeInTheDocument();
    expect(screen.queryByTestId('location-sync-banner')).toBeNull();

    // The server starts rejecting the periodic write.
    locationPutOk = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    const banner = screen.getByTestId('location-sync-banner');
    expect(banner.dataset.issue).toBe('tracking');
    expect(screen.getByText('Your position is not being sent')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();

    // Retry with the server recovered clears the banner.
    locationPutOk = true;
    fireEvent.click(screen.getByTestId('location-sync-retry'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByTestId('location-sync-banner')).toBeNull();
  });

  test('a failed offline write warns the driver may still appear online', async () => {
    renderPage();

    fireEvent.click(screen.getByText("I'm offline"));
    await waitFor(() => expect(screen.getByText("I'm online")).toBeInTheDocument());

    // Going offline writes through the online-status endpoint (G3).
    onlineStatusPutOk = false;
    fireEvent.click(screen.getByText("I'm online"));

    await waitFor(() =>
      expect(screen.getByTestId('location-sync-banner')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('location-sync-banner').dataset.issue).toBe(
      'go-offline',
    );
    // The UI honours the driver's intent (offline) while saying the
    // server may disagree.
    expect(screen.getByText("I'm offline")).toBeInTheDocument();

    // Retry re-sends the offline write and clears the banner.
    onlineStatusPutOk = true;
    fireEvent.click(screen.getByTestId('location-sync-retry'));
    await waitFor(() =>
      expect(screen.queryByTestId('location-sync-banner')).toBeNull(),
    );
    const lastStatusPut = onlineStatusPuts[onlineStatusPuts.length - 1].body;
    expect(lastStatusPut.isOnline).toBe(false);
  });
});
