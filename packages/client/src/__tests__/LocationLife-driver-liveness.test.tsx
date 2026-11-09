// __TESTS__/LOCATION-LIFE-DRIVER-LIVENESS.TEST.TSX
//
// LOCATION-LIFE A G6 — the defect test, and the contracts around it.
//
// THE DEFECT (FIELD-TRIAGE C1 #1/#2): "a driver goes online but gets no
// requests; it takes about fifteen minutes, or an app restart."
//
// Liveness for discovery is `driverProfile.lastLocationAt`, and seven
// consumers gate on it — the supply count, the cascade ring test, the
// urgent and supply broadcasts, the auto-bid evaluator, and the request
// feed itself. The only thing refreshing it outside a ride was a 15 s
// setInterval created inside DashboardPage's go-online handler and
// cleared by its unmount effect. So a motari who tapped through to a
// bid, a chat or his account stopped pinging; 300 s later he had
// stopped existing for all seven, while his own screen still said
// "I'm online". Going back to /driver remounted the page and rebuilt
// the interval — the field's "leave the app and get back in".
//
// Test (a) below is the one that names it: the driver goes online, the
// dashboard UNMOUNTS, the clock runs, and the pings must CONTINUE.
// Against the pre-fix tree it fails on exactly that assertion, because
// the unmount took the heartbeat with it.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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

// The GPS double records the options each call site asked for, so the
// per-call relaxations (G2/G3) are assertable without touching
// useGeolocation's shared DEFAULT_OPTIONS.
const geoCalls: Array<Record<string, unknown> | undefined> = [];
let geoBehaviour: (opts?: Record<string, unknown>) => Promise<{ lat: number; lng: number }>;

vi.mock('../hooks/useGeolocation', () => ({
  geolocation: {
    getCurrentPosition: vi.fn(async (opts?: Record<string, unknown>) => {
      geoCalls.push(opts);
      return geoBehaviour(opts);
    }),
  },
}));

import { DashboardPage } from '../pages/driver/DashboardPage';
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';
import { useDriverLivenessStore } from '../stores/driver-liveness.store';
import {
  ensureDriverLivenessRunning,
  setDriverLivenessOnline,
  stopDriverLiveness,
} from '../services/driver-liveness';
import { resetPerUserStores } from '../lib/session-reset';

/** apiFetch clones responses on some paths, so every double must. */
function res(ok: boolean, status: number, body: unknown): Response {
  return {
    ok,
    status,
    json: async () => body,
    clone: function (this: unknown) {
      return this;
    },
  } as unknown as Response;
}

/** Every PUT /api/users/me/location the app made, in order. */
let locationPuts: Array<{ lat: number; lng: number }>;
let locationPutOk: boolean;

beforeEach(async () => {
  vi.useFakeTimers();
  geoCalls.length = 0;
  locationPuts = [];
  locationPutOk = true;
  geoBehaviour = async () => ({ lat: -1.95, lng: 30.06 });

  // Cold module state for every case: the heartbeat is a singleton by
  // design, so each test installs its own.
  stopDriverLiveness();
  useDriverLivenessStore.setState({
    active: false,
    lastPingFailed: false,
    lastCoords: null,
  });

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

  useJourneyStore.setState({ nearbyRequests: [], availableSignal: null });
  useAuthStore.setState({
    user: {
      id: 'driver-1',
      role: 'DRIVER',
      nickname: 'M',
      language: 'en',
      idVerified: true,
      licenseVerified: true,
      completedRides: 0,
      cancellationCount: 0,
      totalRequests: 0,
      driverProfile: {
        vehicleType: 'MOTO',
        vehicleDescription: '',
        avgRating: 5,
        totalRides: 0,
        isOnline: false,
      },
    } as never,
    isAuthenticated: true,
    isLoading: false,
    token: 'jwt',
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/users/me/location')) {
        if (init?.body) locationPuts.push(JSON.parse(String(init.body)));
        return res(locationPutOk, locationPutOk ? 200 : 503, {});
      }
      if (url.endsWith('/api/users/me/online-status')) {
        return res(true, 200, {});
      }
      // The mount-time restore: server has this driver offline, so the
      // page starts cold and only the deliberate tap puts him online.
      if (url.endsWith('/api/users/me')) {
        return res(true, 200, {
          id: 'driver-1',
          role: 'DRIVER',
          driverProfile: { isOnline: false },
        });
      }
      if (url.includes('/api/journeys')) {
        return res(true, 200, []);
      }
      return res(false, 404, {});
    }) as never,
  );
});

afterEach(() => {
  stopDriverLiveness();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

/** Tap "I'm offline" → the go-online chain, settled. */
async function goOnline() {
  fireEvent.click(screen.getByText("I'm offline"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByText("I'm online")).toBeInTheDocument();
}

describe('LOCATION-LIFE A — the heartbeat outlives the screen', () => {
  // ---------------------------------------------------------------- (a)
  test('THE DEFECT: pings continue after the dashboard unmounts', async () => {
    const view = renderDashboard();
    await goOnline();

    const atGoOnline = locationPuts.length;
    expect(atGoOnline).toBeGreaterThan(0);

    // The motari taps through to a bid, a chat, his account — anything
    // that is not this page. Under the pre-fix code this cleared the
    // only interval that kept him alive for discovery.
    view.unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    const afterOneBeat = locationPuts.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    const afterTwoBeats = locationPuts.length;

    // THIS is the assertion the pre-fix tree fails: leaving the screen
    // is not going offline.
    expect(afterOneBeat).toBeGreaterThan(atGoOnline);
    expect(afterTwoBeats).toBeGreaterThan(afterOneBeat);

    // And the beats carry a real position, not a placeholder.
    expect(locationPuts[locationPuts.length - 1]).toEqual({ lat: -1.95, lng: 30.06 });
  });

  // ---------------------------------------------------------------- (b)
  test('pings stop when the driver deliberately goes offline', async () => {
    renderDashboard();
    await goOnline();

    fireEvent.click(screen.getByText("I'm online"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("I'm offline")).toBeInTheDocument();

    const atOffline = locationPuts.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(locationPuts.length).toBe(atOffline);
    expect(useDriverLivenessStore.getState().active).toBe(false);
  });

  test('pings stop on logout, through session-reset', async () => {
    renderDashboard();
    await goOnline();

    const atLogout = locationPuts.length;

    // The seam auth.store.logout() and an identity change both run.
    act(() => {
      resetPerUserStores();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(locationPuts.length).toBe(atLogout);
    expect(useDriverLivenessStore.getState().active).toBe(false);
  });

  // ---------------------------------------------------------------- (c)
  test('a returning tab pings immediately rather than waiting out a beat', async () => {
    ensureDriverLivenessRunning();
    setDriverLivenessOnline(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const atForeground = locationPuts.length;
    expect(atForeground).toBeGreaterThan(0);

    // Backgrounded: a throttled WebView may not have fired its beat.
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(locationPuts.length).toBe(atForeground);

    // Back in hand — re-assert presence now, not in fifteen seconds.
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(locationPuts.length).toBeGreaterThan(atForeground);
  });

  // ---------------------------------------------------------------- (e')
  test('the heartbeat asks for recency, not precision — and never touches the shared defaults', async () => {
    ensureDriverLivenessRunning();
    setDriverLivenessOnline(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(geoCalls[0]).toEqual({
      enableHighAccuracy: false,
      maximumAge: 120_000,
      timeout: 25_000,
    });
  });
});

describe('LOCATION-LIFE A G3 — going online stops fighting the GPS', () => {
  // ---------------------------------------------------------------- (d)
  test('a cached fix is accepted: the first tier no longer refuses one', async () => {
    renderDashboard();
    await goOnline();

    // The go-online fix is the first GPS call of the run, and it asks
    // for a good fix while ACCEPTING a recent cached one — the old call
    // merged DEFAULT_OPTIONS' maximumAge: 0, which refused them.
    expect(geoCalls[0]).toEqual({
      enableHighAccuracy: true,
      maximumAge: 120_000,
      timeout: 25_000,
    });
  });

  test('a timed-out first tier falls back to a coarse fix and still goes online', async () => {
    let call = 0;
    geoBehaviour = async () => {
      call += 1;
      // Tier 1 times out the way a cold or indoor phone does.
      if (call === 1) throw { code: 'timeout', message: 'Timeout expired' };
      return { lat: -1.95, lng: 30.06 };
    };

    renderDashboard();
    await goOnline();

    expect(geoCalls[0]).toEqual({
      enableHighAccuracy: true,
      maximumAge: 120_000,
      timeout: 25_000,
    });
    expect(geoCalls[1]).toEqual({
      enableHighAccuracy: false,
      maximumAge: 300_000,
      timeout: 10_000,
    });
    expect(locationPuts[0]).toEqual({ lat: -1.95, lng: 30.06 });
  });

  test('both tiers failing still fails closed: offline, with the retry banner', async () => {
    geoBehaviour = async () => {
      throw { code: 'timeout', message: 'Timeout expired' };
    };

    renderDashboard();
    fireEvent.click(screen.getByText("I'm offline"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // BOOK-UNBLOCK G4's contract, unchanged by the relaxation.
    const banner = screen.getByTestId('location-sync-banner');
    expect(banner.dataset.issue).toBe('go-online');
    expect(screen.getByText("I'm offline")).toBeInTheDocument();
    expect(screen.queryByText("I'm online")).toBeNull();
    expect(locationPuts.length).toBe(0);
    expect(useDriverLivenessStore.getState().active).toBe(false);
  });
});
