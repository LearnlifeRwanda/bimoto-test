// RATE-DISPLAY G4 — the driver's own standing tile on DriverStatsCard:
// all-time average + completed rides from the authed driverProfile
// (the stats endpoint carries only windowed aggregates + histogram).
//
// The stub i18n in setup.ts doesn't register driver.stats/reliability
// keys, so untranslated keys render as the key string itself.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import './setup';

import { DriverStatsCard } from '../components/driver/DriverStatsCard';
import { useAuthStore } from '../stores/auth.store';

const baseStats = {
  windowDays: 30,
  acceptanceRate: 0.62,
  totalBids: 50,
  avgAcceptanceTimeMinutes: 4.2,
  completionRate: 0.94,
  totalTerminalJourneys: 18,
  weeklyEarningsRwf: 18500,
  cohortMedianEarningsRwf: null,
  vehicleType: 'MOTO' as const,
};

function mockFetch(body: any) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
    })) as any,
  );
}

function setUser(driverProfile: any) {
  useAuthStore.setState({
    token: 'tok',
    user: { id: 'driver-1', role: 'DRIVER', nickname: 'Joe', driverProfile } as any,
    isAuthenticated: true,
    isLoading: false,
  });
}

beforeEach(() => {
  mockFetch(baseStats);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DriverStatsCard — own standing (RATE-DISPLAY)', () => {
  test('rated driver: stars + average + completed rides render', async () => {
    setUser({ avgRating: 4.6, totalRides: 23, vehicleType: 'MOTO' });
    render(<DriverStatsCard />);

    expect(await screen.findByTestId('driver-stats-my-rating')).toBeInTheDocument();
    expect(screen.getByTestId('driver-stats-my-rating-value').textContent).toBe('4.6');
    expect(screen.getByTestId('driver-stats-my-rides')).toBeInTheDocument();
  });

  test('raw-profile Decimal-as-string avgRating is normalized, not NaN', async () => {
    setUser({ avgRating: '4.50', totalRides: 12, vehicleType: 'MOTO' });
    const { container } = render(<DriverStatsCard />);

    expect(await screen.findByTestId('driver-stats-my-rating')).toBeInTheDocument();
    expect(screen.getByTestId('driver-stats-my-rating-value').textContent).toBe('4.5');
    expect(container.textContent).not.toMatch(/NaN/);
  });

  test('unrated driver: calm no-ratings-yet line instead of 0.0 stars', async () => {
    setUser({ avgRating: 0, totalRides: 2, vehicleType: 'MOTO' });
    render(<DriverStatsCard />);

    expect(
      await screen.findByTestId('driver-stats-my-rating-empty'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('driver-stats-my-rating-value'),
    ).not.toBeInTheDocument();
  });

  test('no driverProfile (defensive): tile is omitted entirely', async () => {
    useAuthStore.setState({
      token: 'tok',
      user: { id: 'driver-1', role: 'DRIVER' } as any,
      isAuthenticated: true,
      isLoading: false,
    });
    render(<DriverStatsCard />);

    expect(await screen.findByTestId('driver-stats-card')).toBeInTheDocument();
    expect(screen.queryByTestId('driver-stats-my-rating')).not.toBeInTheDocument();
  });
});
