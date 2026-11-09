// FEED-CONTRACT G3 — the driver's online state survives the app
// closing.
//
// Field report (Kigali, 1 Aug): "A driver whose phone is connected to
// the internet is nonetheless shown as offline." The dashboard seeded
// isOnline with useState(false) and nothing ever read the server's
// state back, so every app open showed "go online to see requests"
// regardless of the server's truth.
//
// The restore reads GET /api/users/me → driverProfile.isOnline (the
// column PUT /me/online-status writes) on mount and, when the server
// has the driver online, runs the full go-online chain — GPS fix →
// confirmed location + online-status writes → only then "online".
// BOOK-UNBLOCK G4's discipline is preserved: the UI never claims
// online on anything but server-confirmed truth, and a failed/unknown
// restore degrades to visible-offline plus the existing retry banner.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

// Per-test knobs for the mocked server.
let meOk: boolean;
let serverIsOnline: boolean;
let locationPuts: number;
let onlineStatusPuts: Array<{ isOnline: boolean }>;
let nearbyFetches: number;

beforeEach(async () => {
  meOk = true;
  serverIsOnline = false;
  locationPuts = 0;
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
      account: { viewAccount: 'View account status' },
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
    user: { id: 'both-1', role: 'BOTH' } as any,
    isAuthenticated: true,
    isLoading: false,
  });
  useJourneyStore.setState({ nearbyRequests: [], availableSignal: null });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/users/me/location')) {
        locationPuts++;
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }
      if (url.includes('/api/users/me/online-status')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        onlineStatusPuts.push({ isOnline: body.isOnline });
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }
      if (url.endsWith('/api/users/me')) {
        if (!meOk) {
          return {
            ok: false,
            status: 500,
            json: async () => ({}),
            clone: function () {
              return this;
            },
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'both-1',
            role: 'BOTH',
            driverProfile: { isOnline: serverIsOnline, verificationStatus: 'VERIFIED' },
          }),
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

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe('FEED-CONTRACT G3 — online state restored from the server on mount', () => {
  test('server-online: the dashboard shows online without a tap', async () => {
    serverIsOnline = true;
    renderPage();

    // No interaction at all — the restore runs the go-online chain.
    await waitFor(() =>
      expect(screen.getByText("I'm online")).toBeInTheDocument(),
    );
    // Server-confirmed, not optimistic: the chain wrote location and
    // online-status before the UI flipped, and the feed loaded.
    expect(locationPuts).toBeGreaterThanOrEqual(1);
    expect(onlineStatusPuts.some((p) => p.isOnline === true)).toBe(true);
    await waitFor(() => expect(nearbyFetches).toBeGreaterThanOrEqual(1));
    expect(screen.queryByTestId('location-sync-banner')).toBeNull();
  });

  test('server-offline: the dashboard stays offline with no banner', async () => {
    serverIsOnline = false;
    renderPage();

    // Give the restore a beat to complete, then assert nothing moved.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText("I'm offline")).toBeInTheDocument();
    expect(screen.queryByText("I'm online")).toBeNull();
    expect(onlineStatusPuts).toHaveLength(0);
    expect(nearbyFetches).toBe(0);
    expect(screen.queryByTestId('location-sync-banner')).toBeNull();
  });

  test('restore failure: visibly offline plus the existing retry, no crash', async () => {
    meOk = false;
    renderPage();

    // Unknown server state → offline + the retryable banner.
    await waitFor(() =>
      expect(screen.getByTestId('location-sync-banner')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('location-sync-banner').dataset.issue).toBe('go-online');
    expect(screen.getByText("I'm offline")).toBeInTheDocument();
    expect(screen.queryByText("I'm online")).toBeNull();

    // The retry affordance runs the real go-online chain and recovers.
    fireEvent.click(screen.getByTestId('location-sync-retry'));
    await waitFor(() =>
      expect(screen.getByText("I'm online")).toBeInTheDocument(),
    );
    expect(onlineStatusPuts.some((p) => p.isOnline === true)).toBe(true);
  });
});
