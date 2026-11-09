// Service-level tests for driver-stats aggregator (Dispatch
// R3-DRIVER-TIER-STATS). Uses a mocked prisma client so the cases
// stay deterministic across machines / DB seeding.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    driverProfile: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    bid: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    journey: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    driverPayoutBatch: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    rating: {
      findMany: jest.fn(),
    },
  },
}));

import prisma from '../prisma';
import { getDriverStats } from '../services/driver-stats.service';

const m = prisma as unknown as {
  driverProfile: { findUnique: jest.Mock; findMany: jest.Mock };
  bid: { findMany: jest.Mock; groupBy: jest.Mock };
  journey: { findMany: jest.Mock; groupBy: jest.Mock };
  driverPayoutBatch: { findMany: jest.Mock; groupBy: jest.Mock };
  rating: { findMany: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
  m.driverProfile.findUnique.mockResolvedValue({ vehicleType: 'BIKE' });
  m.driverProfile.findMany.mockResolvedValue([]);
  m.bid.findMany.mockResolvedValue([]);
  m.bid.groupBy.mockResolvedValue([]);
  m.journey.findMany.mockResolvedValue([]);
  m.journey.groupBy.mockResolvedValue([]);
  m.driverPayoutBatch.findMany.mockResolvedValue([]);
  m.driverPayoutBatch.groupBy.mockResolvedValue([]);
  m.rating.findMany.mockResolvedValue([]);
});

describe('getDriverStats', () => {
  test('returns null ratio fields when driver has no bids/journeys/payouts', async () => {
    const stats = await getDriverStats('d1');
    expect(stats.acceptanceRate).toBeNull();
    expect(stats.avgAcceptanceTimeMinutes).toBeNull();
    expect(stats.completionRate).toBeNull();
    expect(stats.totalBids).toBe(0);
    expect(stats.totalTerminalJourneys).toBe(0);
    expect(stats.weeklyEarningsRwf).toBe(0);
    expect(stats.windowDays).toBe(30);
    expect(stats.vehicleType).toBe('BIKE');
  });

  test('acceptanceRate = 0.5 with 2 ACCEPTED + 2 DECLINED bids', async () => {
    const t = new Date('2026-05-01T10:00:00Z');
    m.bid.findMany.mockResolvedValue([
      { status: 'ACCEPTED', createdAt: t, updatedAt: t },
      { status: 'ACCEPTED', createdAt: t, updatedAt: t },
      { status: 'DECLINED', createdAt: t, updatedAt: t },
      { status: 'DECLINED', createdAt: t, updatedAt: t },
    ]);
    const stats = await getDriverStats('d1');
    expect(stats.totalBids).toBe(4);
    expect(stats.acceptanceRate).toBeCloseTo(0.5);
  });

  test('avgAcceptanceTimeMinutes computed across multiple ACCEPTED bids', async () => {
    const c = new Date('2026-05-01T10:00:00Z');
    m.bid.findMany.mockResolvedValue([
      { status: 'ACCEPTED', createdAt: c, updatedAt: new Date(c.getTime() + 2 * 60_000) },
      { status: 'ACCEPTED', createdAt: c, updatedAt: new Date(c.getTime() + 6 * 60_000) },
    ]);
    const stats = await getDriverStats('d1');
    expect(stats.avgAcceptanceTimeMinutes).toBeCloseTo(4.0);
  });

  test('completionRate = 0.75 with 3 COMPLETED + 1 CANCELLED journeys', async () => {
    m.journey.findMany.mockResolvedValue([
      { status: 'COMPLETED' },
      { status: 'COMPLETED' },
      { status: 'COMPLETED' },
      { status: 'CANCELLED' },
    ]);
    const stats = await getDriverStats('d1');
    expect(stats.totalTerminalJourneys).toBe(4);
    expect(stats.completionRate).toBeCloseTo(0.75);
  });

  test('weeklyEarningsRwf sums only payouts returned by the SUCCESS+window query', async () => {
    m.driverPayoutBatch.findMany.mockResolvedValue([
      { amount: 5000 },
      { amount: 12500 },
      { amount: 1000 },
    ]);
    const stats = await getDriverStats('d1');
    expect(stats.weeklyEarningsRwf).toBe(18500);
    // Verify the where clause filters status + paidOutAt window.
    const call = m.driverPayoutBatch.findMany.mock.calls[0][0];
    expect(call.where.status).toBe('SUCCESS');
    expect(call.where.driverId).toBe('d1');
    expect(call.where.paidOutAt.gte).toBeInstanceOf(Date);
  });

  test('cohortMedianEarningsRwf = null when cohort has fewer than 3 drivers', async () => {
    m.driverProfile.findMany.mockResolvedValue([
      { userId: 'd1' },
      { userId: 'd2' },
    ]);
    const stats = await getDriverStats('d1');
    expect(stats.cohortMedianEarningsRwf).toBeNull();
  });

  test('cohortMedianEarningsRwf computed across 5 cohort drivers (odd count)', async () => {
    m.driverProfile.findMany.mockResolvedValue([
      { userId: 'd1' },
      { userId: 'd2' },
      { userId: 'd3' },
      { userId: 'd4' },
      { userId: 'd5' },
    ]);
    m.driverPayoutBatch.groupBy.mockResolvedValue([
      { driverId: 'd1', _sum: { amount: 10_000 } },
      { driverId: 'd2', _sum: { amount: 20_000 } },
      { driverId: 'd3', _sum: { amount: 15_000 } },
      { driverId: 'd4', _sum: { amount: 5_000 } },
      { driverId: 'd5', _sum: { amount: 25_000 } },
    ]);
    const stats = await getDriverStats('d1');
    // sorted: 5000, 10000, 15000, 20000, 25000 → median 15000
    expect(stats.cohortMedianEarningsRwf).toBe(15_000);
  });

  test('cohortMedianEarningsRwf includes zeros for cohort drivers with no payouts in window', async () => {
    // 5 cohort drivers; only 2 earned anything this week. groupBy
    // returns only the 2 earners; service must re-add the 3 zero
    // earners before taking the median, otherwise the median is
    // wildly inflated.
    m.driverProfile.findMany.mockResolvedValue([
      { userId: 'd1' },
      { userId: 'd2' },
      { userId: 'd3' },
      { userId: 'd4' },
      { userId: 'd5' },
    ]);
    m.driverPayoutBatch.groupBy.mockResolvedValue([
      { driverId: 'd1', _sum: { amount: 10_000 } },
      { driverId: 'd2', _sum: { amount: 20_000 } },
    ]);
    const stats = await getDriverStats('d1');
    // sorted: 0, 0, 0, 10000, 20000 → median 0
    expect(stats.cohortMedianEarningsRwf).toBe(0);
  });

  test('cohortMedianEarningsRwf with even cohort count averages two middle values', async () => {
    m.driverProfile.findMany.mockResolvedValue([
      { userId: 'd1' },
      { userId: 'd2' },
      { userId: 'd3' },
      { userId: 'd4' },
    ]);
    m.driverPayoutBatch.groupBy.mockResolvedValue([
      { driverId: 'd1', _sum: { amount: 10_000 } },
      { driverId: 'd2', _sum: { amount: 20_000 } },
      { driverId: 'd3', _sum: { amount: 30_000 } },
      { driverId: 'd4', _sum: { amount: 40_000 } },
    ]);
    const stats = await getDriverStats('d1');
    // sorted: 10000, 20000, 30000, 40000 → median (20000+30000)/2
    expect(stats.cohortMedianEarningsRwf).toBe(25_000);
  });

  test('vehicleType=null when driver has no DriverProfile (cohort calc skipped)', async () => {
    m.driverProfile.findUnique.mockResolvedValue(null);
    const stats = await getDriverStats('d1');
    expect(stats.vehicleType).toBeNull();
    expect(stats.cohortMedianEarningsRwf).toBeNull();
    // groupBy must not be called when there's no cohort to query.
    expect(m.driverPayoutBatch.groupBy).not.toHaveBeenCalled();
  });

  test('windowDays parameter scales the query window', async () => {
    await getDriverStats('d1', 60);
    const bidCall = m.bid.findMany.mock.calls[0][0];
    const journeyCall = m.journey.findMany.mock.calls[0][0];
    const expectedWindow = Date.now() - 60 * 24 * 60 * 60 * 1000;
    // Allow a few ms slop for the time the test takes to execute.
    expect(bidCall.where.createdAt.gte.getTime()).toBeGreaterThan(expectedWindow - 5_000);
    expect(bidCall.where.createdAt.gte.getTime()).toBeLessThan(expectedWindow + 5_000);
    expect(journeyCall.where.createdAt.gte.getTime()).toBeGreaterThan(expectedWindow - 5_000);
  });
});

// R3-DRIVER-TIER-STATS-2 — explanatory visualizations
describe('getDriverStats — R3-DRIVER-TIER-STATS-2 extensions', () => {
  test('weeklyEarningsTrend returns exactly 4 entries even when most weeks have no payouts', async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    // The first findMany call answers the weekly-earnings sum; the
    // second call (inside computeWeeklyEarningsTrend) answers the
    // 4-week trend. Stub them in order.
    m.driverPayoutBatch.findMany
      .mockResolvedValueOnce([{ amount: 18500 }])
      .mockResolvedValueOnce([
        { amount: 18500, paidOutAt: new Date(now - 1 * day) },
      ]);
    const stats = await getDriverStats('d1');
    expect(stats.weeklyEarningsTrend).toHaveLength(4);
    expect(stats.weeklyEarningsTrend[0].earningsRwf).toBe(0);
    expect(stats.weeklyEarningsTrend[1].earningsRwf).toBe(0);
    expect(stats.weeklyEarningsTrend[2].earningsRwf).toBe(0);
    expect(stats.weeklyEarningsTrend[3].earningsRwf).toBe(18500);
  });

  test('weeklyEarningsTrend buckets are ordered oldest-first', async () => {
    const now = Date.now();
    const week = 7 * 24 * 60 * 60 * 1000;
    // Place each payout deep inside a distinct bucket.
    // Bucket layout (i=3 oldest → i=0 newest):
    //   [now-4w, now-3w), [now-3w, now-2w), [now-2w, now-1w), [now-1w, now)
    m.driverPayoutBatch.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { amount: 5000, paidOutAt: new Date(now - 4 * week + 1000) }, // oldest bucket
        { amount: 7000, paidOutAt: new Date(now - 3 * week + 1000) },
        { amount: 9000, paidOutAt: new Date(now - 2 * week + 1000) },
        { amount: 11000, paidOutAt: new Date(now - 1 * week + 1000) }, // newest bucket
      ]);
    const stats = await getDriverStats('d1');
    expect(stats.weeklyEarningsTrend.map((t) => t.earningsRwf)).toEqual([
      5000,
      7000,
      9000,
      11000,
    ]);
    // weekStart ISO strings increase monotonically (oldest → newest).
    const starts = stats.weeklyEarningsTrend.map((t) => t.weekStart);
    expect(starts[0] < starts[1]).toBe(true);
    expect(starts[1] < starts[2]).toBe(true);
    expect(starts[2] < starts[3]).toBe(true);
  });

  test('customerRatingDistribution is null when there are no ratings', async () => {
    m.rating.findMany.mockResolvedValue([]);
    const stats = await getDriverStats('d1');
    expect(stats.customerRatingDistribution).toBeNull();
    expect(stats.totalRatings).toBe(0);
  });

  test('customerRatingDistribution buckets ratings 1-5 and totalRatings sums them', async () => {
    m.rating.findMany.mockResolvedValue([
      { stars: 5 },
      { stars: 5 },
      { stars: 5 },
      { stars: 4 },
      { stars: 4 },
      { stars: 3 },
      { stars: 2 },
    ]);
    const stats = await getDriverStats('d1');
    expect(stats.customerRatingDistribution).toEqual({ 1: 0, 2: 1, 3: 1, 4: 2, 5: 3 });
    expect(stats.totalRatings).toBe(7);
    const sum = Object.values(stats.customerRatingDistribution!).reduce(
      (a, b) => a + b,
      0,
    );
    expect(sum).toBe(stats.totalRatings);
  });

  test('customerRatingDistribution includes all 5 buckets even when most are 0', async () => {
    m.rating.findMany.mockResolvedValue([{ stars: 5 }]);
    const stats = await getDriverStats('d1');
    expect(stats.customerRatingDistribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 });
  });

  test('cancellationReasonsBreakdown is null when there are no cancelled journeys', async () => {
    // journey.findMany is called twice: once for terminal journeys
    // (the existing v1 query, all statuses), once for cancelled
    // journeys with a reason (the v2 breakdown). Both default to [].
    const stats = await getDriverStats('d1');
    expect(stats.cancellationReasonsBreakdown).toBeNull();
    expect(stats.totalCancelledJourneys).toBe(0);
  });

  test('cancellationReasonsBreakdown only includes reasons with count > 0', async () => {
    // First call (terminal journeys): empty so completion rate is null.
    // Second call (cancelled journeys with reason): the v2 query.
    m.journey.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { cancelReason: 'CUSTOMER_CHANGED_MIND' },
        { cancelReason: 'CUSTOMER_CHANGED_MIND' },
        { cancelReason: 'CUSTOMER_CHANGED_MIND' },
        { cancelReason: 'DRIVER_LATE' },
        { cancelReason: 'DRIVER_NO_SHOW' },
      ]);
    const stats = await getDriverStats('d1');
    expect(stats.cancellationReasonsBreakdown).toEqual({
      CUSTOMER_CHANGED_MIND: 3,
      DRIVER_LATE: 1,
      DRIVER_NO_SHOW: 1,
    });
    expect(stats.totalCancelledJourneys).toBe(5);
    // Reasons with zero occurrences must NOT appear as keys.
    expect(Object.keys(stats.cancellationReasonsBreakdown!)).not.toContain('SAFETY_CONCERN');
  });

  test('cancellation breakdown query filters on driverId + CANCELLED + non-null reason + window', async () => {
    await getDriverStats('d1', 30);
    // Second findMany on journey is the v2 cancellation query.
    const call = m.journey.findMany.mock.calls[1][0];
    expect(call.where.driverId).toBe('d1');
    expect(call.where.status).toBe('CANCELLED');
    expect(call.where.cancelReason).toEqual({ not: null });
    expect(call.where.createdAt.gte).toBeInstanceOf(Date);
  });

  test('cohortBreakdownByVehicleType is empty when driver has no vehicleType', async () => {
    m.driverProfile.findUnique.mockResolvedValue(null);
    const stats = await getDriverStats('d1');
    expect(stats.cohortBreakdownByVehicleType).toEqual([]);
  });

  test('cohortBreakdownByVehicleType returns null medians when cohort < 3', async () => {
    m.driverProfile.findMany.mockResolvedValue([
      { userId: 'd1' },
      { userId: 'd2' },
    ]);
    const stats = await getDriverStats('d1');
    expect(stats.cohortBreakdownByVehicleType).toHaveLength(1);
    const row = stats.cohortBreakdownByVehicleType[0];
    expect(row.vehicleType).toBe('BIKE');
    expect(row.isDriverOwnVehicleType).toBe(true);
    expect(row.cohortDriverCount).toBe(2);
    expect(row.cohortMedianAcceptanceRate).toBeNull();
    expect(row.cohortMedianCompletionRate).toBeNull();
    expect(row.cohortMedianWeeklyEarningsRwf).toBeNull();
  });

  test('cohortBreakdownByVehicleType computes medians from per-driver groupBy results', async () => {
    m.driverProfile.findMany.mockResolvedValue([
      { userId: 'd1' },
      { userId: 'd2' },
      { userId: 'd3' },
    ]);
    // Bids groupBy: 3 drivers, each with ACCEPTED + DECLINED so they
    // have a real acceptance rate to median.
    m.bid.groupBy.mockResolvedValue([
      { driverId: 'd1', status: 'ACCEPTED', _count: { _all: 4 } },
      { driverId: 'd1', status: 'DECLINED', _count: { _all: 6 } },
      { driverId: 'd2', status: 'ACCEPTED', _count: { _all: 5 } },
      { driverId: 'd2', status: 'DECLINED', _count: { _all: 5 } },
      { driverId: 'd3', status: 'ACCEPTED', _count: { _all: 8 } },
      { driverId: 'd3', status: 'DECLINED', _count: { _all: 2 } },
    ]);
    // Journey groupBy: 3 drivers with COMPLETED/CANCELLED counts.
    m.journey.groupBy.mockResolvedValue([
      { driverId: 'd1', status: 'COMPLETED', _count: { _all: 9 } },
      { driverId: 'd1', status: 'CANCELLED', _count: { _all: 1 } },
      { driverId: 'd2', status: 'COMPLETED', _count: { _all: 8 } },
      { driverId: 'd2', status: 'CANCELLED', _count: { _all: 2 } },
      { driverId: 'd3', status: 'COMPLETED', _count: { _all: 7 } },
      { driverId: 'd3', status: 'CANCELLED', _count: { _all: 3 } },
    ]);
    m.driverPayoutBatch.groupBy.mockResolvedValue([
      { driverId: 'd1', _sum: { amount: 10_000 } },
      { driverId: 'd2', _sum: { amount: 20_000 } },
      { driverId: 'd3', _sum: { amount: 30_000 } },
    ]);
    const stats = await getDriverStats('d1');
    const row = stats.cohortBreakdownByVehicleType[0];
    // d1=0.4, d2=0.5, d3=0.8 → sorted 0.4, 0.5, 0.8 → median 0.5
    expect(row.cohortMedianAcceptanceRate).toBeCloseTo(0.5);
    // d1=0.9, d2=0.8, d3=0.7 → sorted 0.7, 0.8, 0.9 → median 0.8
    expect(row.cohortMedianCompletionRate).toBeCloseTo(0.8);
    // sorted 10k, 20k, 30k → median 20k
    expect(row.cohortMedianWeeklyEarningsRwf).toBe(20_000);
    expect(row.cohortDriverCount).toBe(3);
  });

  test('cohortBreakdownByVehicleType weekly-earnings median includes zero-earners (cohort drivers absent from groupBy)', async () => {
    m.driverProfile.findMany.mockResolvedValue([
      { userId: 'd1' },
      { userId: 'd2' },
      { userId: 'd3' },
      { userId: 'd4' },
      { userId: 'd5' },
    ]);
    m.driverPayoutBatch.groupBy.mockResolvedValue([
      { driverId: 'd1', _sum: { amount: 10_000 } },
      { driverId: 'd2', _sum: { amount: 20_000 } },
    ]);
    const stats = await getDriverStats('d1');
    const row = stats.cohortBreakdownByVehicleType[0];
    // sorted: 0, 0, 0, 10000, 20000 → median 0
    expect(row.cohortMedianWeeklyEarningsRwf).toBe(0);
  });
});
