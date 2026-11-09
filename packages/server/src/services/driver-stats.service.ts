// SERVICES/DRIVER-STATS.SERVICE.TS
//
// Dispatch R3-DRIVER-TIER-STATS — per-driver self-assessment aggregator.
// Powers GET /api/driver/stats and the DriverStatsCard widget on the
// driver Dashboard. Read-only on the data layer; introduces no schema
// changes.
//
// Returns four signals over a configurable window (default 30 days):
//   1. acceptanceRate          ACCEPTED / (ACCEPTED + DECLINED + EXPIRED) bids
//   2. avgAcceptanceTimeMinutes mean(updatedAt - createdAt) over ACCEPTED bids
//   3. completionRate          COMPLETED / terminal-status journeys
//   4. weeklyEarningsRwf vs cohortMedianEarningsRwf (same VehicleType)
//
// All ratio fields return null when the underlying sample size is zero
// (no bids, no terminal journeys); the UI shows "No data yet" rather
// than "0%". Cohort median requires ≥3 drivers in the same VehicleType
// cohort to avoid leaking a single peer's earnings via the median.
//
// Dispatch R3-DRIVER-TIER-STATS-2 — v2 explanatory visualizations
// extend this response shape with four additional aggregations
// (sparkline data, customer rating distribution, cancellation reasons
// breakdown, and per-vehicle cohort breakdown). Existing fields are
// untouched; the additions are purely additive so v1 callers keep
// working.

import prisma from '../prisma';
import {
  BidStatus,
  DriverPayoutStatus,
  JourneyStatus,
  VehicleType,
} from '@prisma/client';
import { MS_PER_DAY } from '@bimoto/shared';

export interface WeeklyEarningsTrendEntry {
  weekStart: string;
  earningsRwf: number;
}

export interface RatingDistribution {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

export interface CohortBreakdownEntry {
  vehicleType: VehicleType;
  isDriverOwnVehicleType: boolean;
  cohortMedianAcceptanceRate: number | null;
  cohortMedianCompletionRate: number | null;
  cohortMedianWeeklyEarningsRwf: number | null;
  cohortDriverCount: number;
}

export interface DriverStats {
  windowDays: number;
  acceptanceRate: number | null;
  totalBids: number;
  avgAcceptanceTimeMinutes: number | null;
  completionRate: number | null;
  totalTerminalJourneys: number;
  weeklyEarningsRwf: number;
  cohortMedianEarningsRwf: number | null;
  vehicleType: VehicleType | null;
  // R3-DRIVER-TIER-STATS-2 — explanatory visualizations
  weeklyEarningsTrend: WeeklyEarningsTrendEntry[];
  customerRatingDistribution: RatingDistribution | null;
  totalRatings: number;
  cancellationReasonsBreakdown: { [reason: string]: number } | null;
  totalCancelledJourneys: number;
  cohortBreakdownByVehicleType: CohortBreakdownEntry[];
}

const MS_PER_WEEK = 7 * MS_PER_DAY;
const COHORT_MIN_SIZE = 3;
const EARNINGS_TREND_WEEKS = 4;

export async function getDriverStats(
  driverId: string,
  windowDays: number = 30,
): Promise<DriverStats> {
  const now = Date.now();
  const windowStart = new Date(now - windowDays * MS_PER_DAY);
  const weekStart = new Date(now - 7 * MS_PER_DAY);

  const driverProfile = await prisma.driverProfile.findUnique({
    where: { userId: driverId },
    select: { vehicleType: true },
  });
  const vehicleType: VehicleType | null = driverProfile?.vehicleType ?? null;

  const bids = await prisma.bid.findMany({
    where: {
      driverId,
      createdAt: { gte: windowStart },
      status: { in: [BidStatus.ACCEPTED, BidStatus.DECLINED, BidStatus.EXPIRED] },
    },
    select: { status: true, createdAt: true, updatedAt: true },
  });
  const totalBids = bids.length;
  const acceptedBids = bids.filter((b) => b.status === BidStatus.ACCEPTED);
  const acceptanceRate = totalBids === 0 ? null : acceptedBids.length / totalBids;
  const avgAcceptanceTimeMinutes =
    acceptedBids.length === 0
      ? null
      : acceptedBids.reduce(
          (sum, b) => sum + (b.updatedAt.getTime() - b.createdAt.getTime()),
          0,
        ) /
        acceptedBids.length /
        60_000;

  const terminalJourneys = await prisma.journey.findMany({
    where: {
      driverId,
      createdAt: { gte: windowStart },
      status: {
        in: [
          JourneyStatus.COMPLETED,
          JourneyStatus.CANCELLED,
          JourneyStatus.INTERRUPTED,
          JourneyStatus.DISPUTED,
        ],
      },
    },
    select: { status: true },
  });
  const totalTerminalJourneys = terminalJourneys.length;
  const completedCount = terminalJourneys.filter(
    (j) => j.status === JourneyStatus.COMPLETED,
  ).length;
  const completionRate =
    totalTerminalJourneys === 0 ? null : completedCount / totalTerminalJourneys;

  const weeklyPayouts = await prisma.driverPayoutBatch.findMany({
    where: {
      driverId,
      status: DriverPayoutStatus.SUCCESS,
      paidOutAt: { gte: weekStart },
    },
    select: { amount: true },
  });
  const weeklyEarningsRwf = weeklyPayouts.reduce((sum, p) => sum + p.amount, 0);

  let cohortMedianEarningsRwf: number | null = null;
  if (vehicleType) {
    const cohortDrivers = await prisma.driverProfile.findMany({
      where: { vehicleType },
      select: { userId: true },
    });
    if (cohortDrivers.length >= COHORT_MIN_SIZE) {
      const cohortPayouts = await prisma.driverPayoutBatch.groupBy({
        by: ['driverId'],
        where: {
          driverId: { in: cohortDrivers.map((d) => d.userId) },
          status: DriverPayoutStatus.SUCCESS,
          paidOutAt: { gte: weekStart },
        },
        _sum: { amount: true },
      });
      // Drivers with no payouts in the window are absent from groupBy
      // results — re-add them as zero so the median reflects the full
      // cohort (otherwise the median is biased high by excluding
      // zero-earners).
      const sumsByDriver = new Map<string, number>(
        cohortPayouts.map((p) => [p.driverId, p._sum.amount ?? 0]),
      );
      const weeklyByDriver = cohortDrivers.map(
        (d) => sumsByDriver.get(d.userId) ?? 0,
      );
      cohortMedianEarningsRwf = median(weeklyByDriver);
    }
  }

  // R3-DRIVER-TIER-STATS-2 — 4 new aggregations
  const weeklyEarningsTrend = await computeWeeklyEarningsTrend(
    driverId,
    EARNINGS_TREND_WEEKS,
    now,
  );

  const ratings = await prisma.rating.findMany({
    where: {
      ratedId: driverId,
      createdAt: { gte: windowStart },
    },
    select: { stars: true },
  });
  const totalRatings = ratings.length;
  const customerRatingDistribution: RatingDistribution | null =
    totalRatings === 0
      ? null
      : ratings.reduce<RatingDistribution>(
          (acc, r) => {
            const bucket = Math.max(1, Math.min(5, Math.round(r.stars))) as 1 | 2 | 3 | 4 | 5;
            acc[bucket] += 1;
            return acc;
          },
          { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        );

  const cancelledJourneys = await prisma.journey.findMany({
    where: {
      driverId,
      status: JourneyStatus.CANCELLED,
      cancelReason: { not: null },
      createdAt: { gte: windowStart },
    },
    select: { cancelReason: true },
  });
  const totalCancelledJourneys = cancelledJourneys.length;
  const cancellationReasonsBreakdown: { [reason: string]: number } | null =
    totalCancelledJourneys === 0
      ? null
      : cancelledJourneys.reduce<{ [reason: string]: number }>((acc, j) => {
          if (j.cancelReason) {
            acc[j.cancelReason] = (acc[j.cancelReason] ?? 0) + 1;
          }
          return acc;
        }, {});

  const cohortBreakdownByVehicleType: CohortBreakdownEntry[] = vehicleType
    ? [
        await computeCohortBreakdownForVehicleType(
          vehicleType,
          windowDays,
          windowStart,
          weekStart,
        ),
      ]
    : [];

  return {
    windowDays,
    acceptanceRate,
    totalBids,
    avgAcceptanceTimeMinutes,
    completionRate,
    totalTerminalJourneys,
    weeklyEarningsRwf,
    cohortMedianEarningsRwf,
    vehicleType,
    weeklyEarningsTrend,
    customerRatingDistribution,
    totalRatings,
    cancellationReasonsBreakdown,
    totalCancelledJourneys,
    cohortBreakdownByVehicleType,
  };
}

// Returns exactly `weeks` entries, oldest → newest. Weeks with no
// SUCCESS payouts are 0-padded so the sparkline renders all 4 data
// points (a sparse array would draw a misleading line across missing
// weeks). The most recent bucket is the [now-7d, now] window — matches
// the weeklyEarningsRwf field's window.
async function computeWeeklyEarningsTrend(
  driverId: string,
  weeks: number,
  now: number,
): Promise<WeeklyEarningsTrendEntry[]> {
  const trendStart = new Date(now - weeks * MS_PER_WEEK);
  const payouts = await prisma.driverPayoutBatch.findMany({
    where: {
      driverId,
      status: DriverPayoutStatus.SUCCESS,
      paidOutAt: { gte: trendStart },
    },
    select: { amount: true, paidOutAt: true },
  });

  const buckets: WeeklyEarningsTrendEntry[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const bucketStart = new Date(now - (i + 1) * MS_PER_WEEK);
    const bucketEnd = new Date(now - i * MS_PER_WEEK);
    const earningsRwf = payouts
      .filter(
        (p) =>
          p.paidOutAt != null &&
          p.paidOutAt.getTime() >= bucketStart.getTime() &&
          p.paidOutAt.getTime() < bucketEnd.getTime(),
      )
      .reduce((sum, p) => sum + p.amount, 0);
    buckets.push({ weekStart: bucketStart.toISOString(), earningsRwf });
  }
  return buckets;
}

async function computeCohortBreakdownForVehicleType(
  vehicleType: VehicleType,
  windowDays: number,
  windowStart: Date,
  weekStart: Date,
): Promise<CohortBreakdownEntry> {
  const cohortDrivers = await prisma.driverProfile.findMany({
    where: { vehicleType },
    select: { userId: true },
  });
  const cohortDriverCount = cohortDrivers.length;

  if (cohortDriverCount < COHORT_MIN_SIZE) {
    return {
      vehicleType,
      isDriverOwnVehicleType: true,
      cohortMedianAcceptanceRate: null,
      cohortMedianCompletionRate: null,
      cohortMedianWeeklyEarningsRwf: null,
      cohortDriverCount,
    };
  }

  const driverIds = cohortDrivers.map((d) => d.userId);

  // Acceptance rate per driver via groupBy. Drivers absent from a
  // status bucket are absent from results — treat as zero for that
  // bucket. Drivers with zero bids overall are excluded from the
  // acceptance-rate median (they have no rate to median over).
  const bidGroups = await prisma.bid.groupBy({
    by: ['driverId', 'status'],
    where: {
      driverId: { in: driverIds },
      createdAt: { gte: windowStart },
      status: { in: [BidStatus.ACCEPTED, BidStatus.DECLINED, BidStatus.EXPIRED] },
    },
    _count: { _all: true },
  });
  const acceptedByDriver = new Map<string, number>();
  const totalBidsByDriver = new Map<string, number>();
  for (const g of bidGroups) {
    const did = g.driverId as string;
    const count = g._count._all;
    totalBidsByDriver.set(did, (totalBidsByDriver.get(did) ?? 0) + count);
    if (g.status === BidStatus.ACCEPTED) {
      acceptedByDriver.set(did, (acceptedByDriver.get(did) ?? 0) + count);
    }
  }
  const acceptanceRates: number[] = [];
  for (const did of driverIds) {
    const total = totalBidsByDriver.get(did) ?? 0;
    if (total > 0) {
      acceptanceRates.push((acceptedByDriver.get(did) ?? 0) / total);
    }
  }
  const cohortMedianAcceptanceRate =
    acceptanceRates.length === 0 ? null : median(acceptanceRates);

  // Completion rate per driver via groupBy over terminal statuses.
  const journeyGroups = await prisma.journey.groupBy({
    by: ['driverId', 'status'],
    where: {
      driverId: { in: driverIds },
      createdAt: { gte: windowStart },
      status: {
        in: [
          JourneyStatus.COMPLETED,
          JourneyStatus.CANCELLED,
          JourneyStatus.INTERRUPTED,
          JourneyStatus.DISPUTED,
        ],
      },
    },
    _count: { _all: true },
  });
  const completedByDriver = new Map<string, number>();
  const terminalByDriver = new Map<string, number>();
  for (const g of journeyGroups) {
    const did = g.driverId as string | null;
    if (!did) continue;
    const count = g._count._all;
    terminalByDriver.set(did, (terminalByDriver.get(did) ?? 0) + count);
    if (g.status === JourneyStatus.COMPLETED) {
      completedByDriver.set(did, (completedByDriver.get(did) ?? 0) + count);
    }
  }
  const completionRates: number[] = [];
  for (const did of driverIds) {
    const total = terminalByDriver.get(did) ?? 0;
    if (total > 0) {
      completionRates.push((completedByDriver.get(did) ?? 0) / total);
    }
  }
  const cohortMedianCompletionRate =
    completionRates.length === 0 ? null : median(completionRates);

  // Weekly earnings per driver (same window as weeklyEarningsRwf).
  // Zero-earners INCLUDED so the median reflects the full cohort —
  // same rule as the existing cohortMedianEarningsRwf field.
  const cohortPayouts = await prisma.driverPayoutBatch.groupBy({
    by: ['driverId'],
    where: {
      driverId: { in: driverIds },
      status: DriverPayoutStatus.SUCCESS,
      paidOutAt: { gte: weekStart },
    },
    _sum: { amount: true },
  });
  const sumsByDriver = new Map<string, number>(
    cohortPayouts.map((p) => [p.driverId as string, p._sum.amount ?? 0]),
  );
  const weeklyByDriver = driverIds.map((d) => sumsByDriver.get(d) ?? 0);
  const cohortMedianWeeklyEarningsRwf = median(weeklyByDriver);

  return {
    vehicleType,
    isDriverOwnVehicleType: true,
    cohortMedianAcceptanceRate,
    cohortMedianCompletionRate,
    cohortMedianWeeklyEarningsRwf,
    cohortDriverCount,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
