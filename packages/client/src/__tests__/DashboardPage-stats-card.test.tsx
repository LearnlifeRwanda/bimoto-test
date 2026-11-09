// Smoke / integration test for the DashboardPage <-> DriverStatsCard
// wiring (Dispatch R3-DRIVER-TIER-STATS, group 4/4).
//
// Full DashboardPage tests don't exist yet — the page depends on
// geolocation, multiple stores and several fetch endpoints. This
// suite stays narrow on purpose: it stubs every dependency to a
// no-op and asserts that
//   1. the new DriverStatsCard mounts on the dashboard
//   2. the existing journey-feed scaffolding still renders below it
// so a future refactor that drops the import gets caught.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { i18n } from './setup';

import { DashboardPage } from '../pages/driver/DashboardPage';
import { useAuthStore } from '../stores/auth.store';

// Geolocation: never resolves so the dashboard's tick() is harmless.
vi.mock('../hooks/useGeolocation', () => ({
  geolocation: {
    getCurrentPosition: vi.fn(() => new Promise(() => {})),
  },
}));

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      driver: {
        stats: {
          title: 'Your stats — last {{windowDays}} days',
          acceptanceRate: 'Acceptance rate',
          acceptanceDenominator: '({{n}} bids)',
          avgAcceptanceTime: 'Avg acceptance time',
          minutesValue: '{{n}} min',
          completionRate: 'Completion rate',
          completionDenominator: '({{n}} journeys)',
          weeklyEarnings: 'Weekly earnings',
          aboveCohortMedian: '{{pct}}% above cohort median',
          belowCohortMedian: '{{pct}}% below cohort median',
          noData: 'No data yet',
        },
      },
      dashboard: {
        imOnline: "I'm online",
        imOffline: "I'm offline",
        onlineSubtitle: 'Available for rides',
        goOnline: 'Go online to receive ride requests',
        noRequests: 'No requests',
        noRequestsSubtitle: 'Hang tight',
        nearbyRequests: '{{count}} nearby',
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
      transparency: {
        yourTier: 'Tier {{tier}} — {{rate}}%',
        ridesUntilNextTier: '{{count}} rides until {{tier}} ({{rate}}%)',
        atMaxTier: 'At max tier',
        tierSavingsPerRide: 'Saving {{rate}}% per ride',
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

  const driverStats = {
    windowDays: 30,
    acceptanceRate: 0.5,
    totalBids: 4,
    avgAcceptanceTimeMinutes: 4.0,
    completionRate: 0.75,
    totalTerminalJourneys: 4,
    weeklyEarningsRwf: 18500,
    cohortMedianEarningsRwf: 15000,
    vehicleType: 'BIKE',
  };

  // Stub every fetch the dashboard makes. The driver-stats endpoint
  // returns realistic data; everything else returns an empty object
  // so the dashboard stays idle.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/driver/stats')) {
        return {
          ok: true,
          status: 200,
          json: async () => driverStats,
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response;
    }) as any,
  );
});

describe('DashboardPage — DriverStatsCard wiring (R3-DRIVER-TIER-STATS)', () => {
  test('mounts the DriverStatsCard at the top of the dashboard', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('driver-stats-card')).toBeInTheDocument();
    });
    expect(screen.getByTestId('driver-stats-acceptance').textContent).toContain('50%');
  });

  test('keeps the existing online/offline toggle on the dashboard', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("I'm offline")).toBeInTheDocument();
  });
});
