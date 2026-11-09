// THE RULING TEST — "no PIN, full working screen".
//
// Founder ruling D25 has two halves, and the first version of this
// feature shipped only the first. The money PIN goes in front of the
// money surfaces; it goes in front of NOTHING else. The team's ask on the
// Login card was "driver opens app, sees requests, so easy", and a PIN
// pad in front of the feed is the exact thing the ruling forbids.
//
// WHAT WENT WRONG, so the next reader knows what this file defends. The
// prompt was one component at the app root rendering
// `fixed inset-0 z-[60] bg-white`. DriverEarningsCard sits on the driver
// DASHBOARD and fetches the payout summary on mount, so a driver with no
// PIN got that overlay across his whole working screen. The
// cross-locale-chat E2E found it, in Playwright's own words: "subtree
// intercepts pointer events" — on the feed, the online toggle, the
// auto-bid entry, and every navigation.
//
// The unit tests at the time all passed, because every one of them
// rendered the prompt in ISOLATION and never once mounted it beside the
// screen it was covering. That is the gap this file closes: it mounts the
// real Dashboard with a real 428 and asserts the driver can still work.

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
import { useMoneyPinStore } from '../stores/money-pin.store';

let nearbyFetches: number;
let summaryFetches: number;

beforeEach(async () => {
  nearbyFetches = 0;
  summaryFetches = 0;
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
      journey: { geoFailed: 'Could not get GPS', geoNotSupported: 'GPS not supported' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

  useAuthStore.setState({
    token: 'tok',
    user: { id: 'driver-1', role: 'DRIVER' } as never,
    isAuthenticated: true,
    isLoading: false,
  });
  useJourneyStore.setState({ nearbyRequests: [], availableSignal: null } as never);
  useMoneyPinStore.setState({
    prompt: 'closed',
    owner: null,
    lockedUntil: null,
    stepUpOpen: false,
    resolver: null,
    waiters: [],
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;

      // THE CONDITION UNDER TEST: a driver who has never set a money PIN.
      // This is exactly what requireMoneyStepUp answers for him.
      if (url.includes('/api/payout/summary')) {
        summaryFetches++;
        return {
          ok: false,
          status: 428,
          json: async () => ({
            error: { code: 'MONEY_PIN_ENROLLMENT_REQUIRED', message: 'errors.moneyPinEnrollmentRequired' },
          }),
          clone() {
            return this as unknown as Response;
          },
        } as unknown as Response;
      }

      if (url.includes('/api/journeys?viewAs=driver')) {
        nearbyFetches++;
        return { ok: true, status: 200, json: async () => [] } as Response;
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
          json: async () => ({
            id: 'driver-1',
            role: 'DRIVER',
            driverProfile: { isOnline: false },
          }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as never,
  );
});

describe('D25 — no PIN, full working screen', () => {
  test('the enrolment prompt appears, and it is INSIDE the earnings card', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(summaryFetches).toBeGreaterThan(0));
    const pad = await screen.findByTestId('money-pin-gate');
    expect(pad).toHaveAttribute('data-prompt', 'enroll');

    // The card is still on the page — it does not vanish for want of a
    // summary — and the pad is INSIDE it.
    const card = screen.getByTestId('driver-earnings-card');
    expect(card).toContainElement(pad);
  });

  test('the prompt is NOT a full-screen overlay', async () => {
    // The precise regression. `fixed inset-0` is what Playwright reported
    // as intercepting pointer events across the whole dashboard.
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    const pad = await screen.findByTestId('money-pin-gate');
    const cls = pad.className;
    expect(cls).not.toContain('fixed');
    expect(cls).not.toContain('inset-0');
    // And it does not claim to be a modal, which would be the same lie
    // told to a screen reader.
    expect(pad.getAttribute('aria-modal')).toBeNull();
    expect(pad.getAttribute('role')).not.toBe('dialog');
  });

  test('a driver with NO PIN can still go online and load the feed', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    // The pad is up — this is the state that used to cover everything.
    await screen.findByTestId('money-pin-gate');

    // The online toggle is reachable and it works.
    fireEvent.click(screen.getByText("I'm offline"));
    await waitFor(() => expect(nearbyFetches).toBe(1));
    expect(screen.getByText("I'm online")).toBeInTheDocument();
  });

  test('the whole working screen renders around the prompt', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('money-pin-gate');

    // "Driver opens app, sees requests, so easy" — the team's own words.
    // Nothing here is behind the money gate and nothing here may be.
    expect(screen.getByText("I'm offline")).toBeVisible();
    expect(screen.getByText('Go online to receive ride requests')).toBeVisible();
  });

  test('declining enrolment costs the driver nothing but the balance', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('money-pin-gate');

    fireEvent.click(screen.getByTestId('money-pin-dismiss'));

    // The prompt closes, no error toast is raised for having declined,
    // and the screen he came for is still there.
    await waitFor(() =>
      expect(screen.queryByTestId('money-pin-gate')).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
    expect(screen.getByText("I'm offline")).toBeVisible();
  });

  test('one refusal draws exactly ONE pad, not one per hook instance', async () => {
    // AccountPage mounts the earnings card AND the preference section,
    // both on useDriverPayout. Ownership is what stops two pads.
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('money-pin-gate');
    expect(screen.getAllByTestId('money-pin-gate')).toHaveLength(1);
  });
});
