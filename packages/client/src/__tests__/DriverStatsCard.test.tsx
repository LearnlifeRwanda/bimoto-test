// Tests for the DriverStatsCard widget
// (Dispatch R3-DRIVER-TIER-STATS).
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { i18n } from './setup';

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
  cohortMedianEarningsRwf: 15000,
  vehicleType: 'BIKE' as const,
  weeklyEarningsTrend: [
    { weekStart: '2026-04-13', earningsRwf: 12000 },
    { weekStart: '2026-04-20', earningsRwf: 15500 },
    { weekStart: '2026-04-27', earningsRwf: 18200 },
    { weekStart: '2026-05-04', earningsRwf: 18500 },
  ],
  customerRatingDistribution: { 1: 0, 2: 1, 3: 3, 4: 12, 5: 28 },
  totalRatings: 44,
  cancellationReasonsBreakdown: {
    CUSTOMER_CHANGED_MIND: 3,
    DRIVER_LATE: 1,
  },
  totalCancelledJourneys: 4,
  cohortBreakdownByVehicleType: [
    {
      vehicleType: 'BIKE',
      isDriverOwnVehicleType: true,
      cohortMedianAcceptanceRate: 0.58,
      cohortMedianCompletionRate: 0.92,
      cohortMedianWeeklyEarningsRwf: 15000,
      cohortDriverCount: 12,
    },
  ],
};

function mockFetch(body: any, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      statusText: ok ? 'OK' : 'fail',
      status: ok ? 200 : 500,
      json: async () => body,
    })) as any,
  );
}

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
          showMore: '▼ Show more stats',
          hideMore: '▲ Hide',
          earningsTrendTitle: '4-week earnings trend',
          earningsTrendAria: '4-week earnings trend chart',
          ratingDistTitle: 'Customer ratings ({{n}} total)',
          ratingDistAria: 'Customer rating distribution',
          cancellationTitle: 'Cancellation reasons ({{n}} cancelled)',
          cancellationAria: 'Cancellation reasons breakdown',
          cohortBreakdownTitle: 'How you compare in your vehicle type',
          cohortSize: '{{n}} drivers',
        },
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
});

describe('DriverStatsCard — R3-DRIVER-TIER-STATS', () => {
  test('renders a loading spinner before the fetch resolves', async () => {
    let resolve: (v: any) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      ) as any,
    );
    render(<DriverStatsCard />);
    expect(screen.getByTestId('driver-stats-card-loading')).toBeInTheDocument();
    resolve({ ok: true, json: async () => baseStats });
    await waitFor(() => screen.getByTestId('driver-stats-card'));
  });

  test('renders nothing on a fetch error', async () => {
    mockFetch({ error: 'oops' }, false);
    const { container } = render(<DriverStatsCard />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="driver-stats-card-loading"]')).toBeNull();
    });
    expect(container.querySelector('[data-testid="driver-stats-card"]')).toBeNull();
  });

  test('renders all four stat tiles when the API returns data', async () => {
    mockFetch(baseStats);
    render(<DriverStatsCard />);
    await screen.findByTestId('driver-stats-card');
    expect(screen.getByTestId('driver-stats-acceptance')).toBeInTheDocument();
    expect(screen.getByTestId('driver-stats-acceptance-time')).toBeInTheDocument();
    expect(screen.getByTestId('driver-stats-completion')).toBeInTheDocument();
    expect(screen.getByTestId('driver-stats-earnings')).toBeInTheDocument();
  });

  test('displays "No data yet" for null ratio fields', async () => {
    mockFetch({
      ...baseStats,
      acceptanceRate: null,
      totalBids: 0,
      avgAcceptanceTimeMinutes: null,
      completionRate: null,
      totalTerminalJourneys: 0,
    });
    render(<DriverStatsCard />);
    await screen.findByTestId('driver-stats-card');
    expect(screen.getByTestId('driver-stats-acceptance').textContent).toContain('No data yet');
    expect(screen.getByTestId('driver-stats-acceptance-time').textContent).toContain('No data yet');
    expect(screen.getByTestId('driver-stats-completion').textContent).toContain('No data yet');
  });

  test('formats acceptanceRate as a percentage', async () => {
    mockFetch(baseStats);
    render(<DriverStatsCard />);
    const tile = await screen.findByTestId('driver-stats-acceptance');
    expect(tile.textContent).toContain('62%');
    expect(tile.textContent).toContain('50 bids');
  });

  test('formats avgAcceptanceTimeMinutes with one decimal', async () => {
    mockFetch(baseStats);
    render(<DriverStatsCard />);
    const tile = await screen.findByTestId('driver-stats-acceptance-time');
    expect(tile.textContent).toContain('4.2 min');
  });

  test('renders earnings delta as "X% above cohort median" when positive', async () => {
    mockFetch(baseStats); // 18500 vs 15000 → +23%
    render(<DriverStatsCard />);
    const tile = await screen.findByTestId('driver-stats-earnings');
    expect(tile.textContent).toContain('RWF 18,500');
    expect(tile.textContent).toContain('23% above cohort median');
    expect(tile.querySelector('[data-delta-direction="up"]')).not.toBeNull();
  });

  test('renders earnings delta as "X% below cohort median" when negative', async () => {
    mockFetch({ ...baseStats, weeklyEarningsRwf: 12000 }); // (12000-15000)/15000 = -20%
    render(<DriverStatsCard />);
    const tile = await screen.findByTestId('driver-stats-earnings');
    expect(tile.textContent).toContain('20% below cohort median');
    expect(tile.querySelector('[data-delta-direction="down"]')).not.toBeNull();
  });

  test('omits earnings delta when cohortMedianEarningsRwf is null', async () => {
    mockFetch({ ...baseStats, cohortMedianEarningsRwf: null });
    render(<DriverStatsCard />);
    const tile = await screen.findByTestId('driver-stats-earnings');
    expect(tile.textContent).not.toContain('cohort median');
  });

  test('omits earnings delta when cohortMedianEarningsRwf is zero (avoid divide-by-zero)', async () => {
    mockFetch({ ...baseStats, cohortMedianEarningsRwf: 0 });
    render(<DriverStatsCard />);
    const tile = await screen.findByTestId('driver-stats-earnings');
    expect(tile.textContent).not.toContain('cohort median');
  });

  test('window-days title interpolates the configured window', async () => {
    mockFetch({ ...baseStats, windowDays: 14 });
    render(<DriverStatsCard />);
    const card = await screen.findByTestId('driver-stats-card');
    expect(card.textContent).toContain('last 14 days');
  });
});

describe('DriverStatsCard — R3-DRIVER-TIER-STATS-2 extensions', () => {
  test('toggle is collapsed by default — extended panel not rendered', async () => {
    mockFetch(baseStats);
    render(<DriverStatsCard />);
    await screen.findByTestId('driver-stats-card');
    expect(screen.getByTestId('driver-stats-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('driver-stats-extended')).toBeNull();
  });

  test('clicking the toggle reveals the 4 extended sections', async () => {
    mockFetch(baseStats);
    render(<DriverStatsCard />);
    const toggle = await screen.findByTestId('driver-stats-toggle');
    fireEvent.click(toggle);
    expect(screen.getByTestId('driver-stats-extended')).toBeInTheDocument();
    expect(screen.getByTestId('driver-stats-extended-trend')).toBeInTheDocument();
    expect(screen.getByTestId('driver-stats-extended-ratings')).toBeInTheDocument();
    expect(screen.getByTestId('driver-stats-extended-cancellations')).toBeInTheDocument();
    expect(screen.getByTestId('driver-stats-extended-cohort')).toBeInTheDocument();
    // Toggle text flips to "hide".
    expect(toggle.textContent).toContain('Hide');
  });

  test('sparkline section is omitted when weeklyEarningsTrend has < 2 entries', async () => {
    mockFetch({
      ...baseStats,
      weeklyEarningsTrend: [{ weekStart: '2026-05-04', earningsRwf: 18500 }],
    });
    render(<DriverStatsCard />);
    const toggle = await screen.findByTestId('driver-stats-toggle');
    fireEvent.click(toggle);
    expect(screen.queryByTestId('driver-stats-extended-trend')).toBeNull();
    // Other sections still rendered.
    expect(screen.getByTestId('driver-stats-extended-ratings')).toBeInTheDocument();
  });

  test('rating section is omitted when customerRatingDistribution is null', async () => {
    mockFetch({
      ...baseStats,
      customerRatingDistribution: null,
      totalRatings: 0,
    });
    render(<DriverStatsCard />);
    const toggle = await screen.findByTestId('driver-stats-toggle');
    fireEvent.click(toggle);
    expect(screen.queryByTestId('driver-stats-extended-ratings')).toBeNull();
    expect(screen.getByTestId('driver-stats-extended-trend')).toBeInTheDocument();
  });

  test('cancellation section is omitted when cancellationReasonsBreakdown is null', async () => {
    mockFetch({
      ...baseStats,
      cancellationReasonsBreakdown: null,
      totalCancelledJourneys: 0,
    });
    render(<DriverStatsCard />);
    const toggle = await screen.findByTestId('driver-stats-toggle');
    fireEvent.click(toggle);
    expect(screen.queryByTestId('driver-stats-extended-cancellations')).toBeNull();
  });

  test('cohort section is omitted when cohortBreakdownByVehicleType is empty', async () => {
    mockFetch({ ...baseStats, cohortBreakdownByVehicleType: [] });
    render(<DriverStatsCard />);
    const toggle = await screen.findByTestId('driver-stats-toggle');
    fireEvent.click(toggle);
    expect(screen.queryByTestId('driver-stats-extended-cohort')).toBeNull();
  });

  test('toggle button is omitted entirely when no extended data is available', async () => {
    mockFetch({
      ...baseStats,
      weeklyEarningsTrend: [],
      customerRatingDistribution: null,
      totalRatings: 0,
      cancellationReasonsBreakdown: null,
      totalCancelledJourneys: 0,
      cohortBreakdownByVehicleType: [],
    });
    render(<DriverStatsCard />);
    await screen.findByTestId('driver-stats-card');
    expect(screen.queryByTestId('driver-stats-toggle')).toBeNull();
  });

  test('rating-distribution title interpolates totalRatings', async () => {
    mockFetch(baseStats);
    render(<DriverStatsCard />);
    const toggle = await screen.findByTestId('driver-stats-toggle');
    fireEvent.click(toggle);
    const section = screen.getByTestId('driver-stats-extended-ratings');
    expect(section.textContent).toContain('44 total');
  });

  test('clicking toggle a second time collapses the extended panel', async () => {
    mockFetch(baseStats);
    render(<DriverStatsCard />);
    const toggle = await screen.findByTestId('driver-stats-toggle');
    fireEvent.click(toggle);
    expect(screen.getByTestId('driver-stats-extended')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByTestId('driver-stats-extended')).toBeNull();
    expect(toggle.textContent).toContain('Show more');
  });

  test('back-compat: stats payload without v2 fields renders v1 grid only', async () => {
    // Older API response shape — none of the v2 fields. Toggle must
    // be absent (no extended data) and the 4 v1 tiles still render.
    mockFetch({
      windowDays: 30,
      acceptanceRate: 0.5,
      totalBids: 10,
      avgAcceptanceTimeMinutes: 3.5,
      completionRate: 0.9,
      totalTerminalJourneys: 5,
      weeklyEarningsRwf: 5000,
      cohortMedianEarningsRwf: 4000,
      vehicleType: 'BIKE',
    });
    render(<DriverStatsCard />);
    await screen.findByTestId('driver-stats-card');
    expect(screen.getByTestId('driver-stats-acceptance')).toBeInTheDocument();
    expect(screen.queryByTestId('driver-stats-toggle')).toBeNull();
  });
});
