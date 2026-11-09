// Dispatch M — cooperative-leader dashboard read service. Three
// public surfaces:
//   1. computeCooperativeDashboard  — aggregate metrics (counts +
//      ratings + flagged drivers).
//   2. listCooperativeDrivers       — paginated driver rows with
//      operational fields (online / flagged / frozen).
//   3. getDriverDetail              — per-driver journey + earnings
//      + AML history. Throws AuthorizationError if the driver isn't
//      in the requested cooperative (route maps to 404).
//   4. computeFinancialSummary      — totals + per-driver breakdown,
//      applies cooperative.commissionRate.
//
// Every function takes cooperativeId as the first scoping argument
// even though the route layer also enforces it — defence-in-depth.
// Cooperative-internal joins use DriverProfile.userId to find the
// User (driver) and journeysAsDriver to count rides.

import type { PrismaClient } from '@prisma/client';
import { decryptedPhoneOrNull } from '../user-phone';
import type {
  CooperativeDashboardSummary,
  CooperativeDriverRow,
  CooperativeDriverDetail,
  CooperativeFinancialSummary,
} from './types';
import { AuthorizationError } from './scope';
import { DASHBOARD_DEFAULT_PERIOD_DAYS } from './config';

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function daysAgo(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 24 * 60 * 60 * 1000);
}

function toDriverRow(profile: any, user: any): CooperativeDriverRow {
  const ratingNum = profile.avgRating == null
    ? null
    : typeof profile.avgRating === 'object' && 'toNumber' in profile.avgRating
      ? profile.avgRating.toNumber()
      : Number(profile.avgRating);
  return {
    driverId: user.id,
    driverProfileId: profile.id,
    userId: user.id,
    name: user.nickname ?? '',
    phone: decryptedPhoneOrNull(user) ?? '',
    vehicleType: profile.vehicleType ?? 'MOTO',
    active: profile.active !== false,
    isOnline: profile.isOnline === true,
    totalRides: profile.totalRides ?? 0,
    avgRating: ratingNum,
    isFlagged: user.isFlagged === true,
    isFrozen: !!user.frozenAt,
    cooperativeName: profile.cooperativeName ?? '',
    verificationStatus: profile.verificationStatus ?? 'PENDING',
  };
}

export async function computeCooperativeDashboard(
  prisma: PrismaClient,
  cooperativeId: string,
  periodDays: number = DASHBOARD_DEFAULT_PERIOD_DAYS,
  now: Date = new Date(),
): Promise<CooperativeDashboardSummary> {
  const cooperative = await prisma.cooperative.findUnique({
    where: { id: cooperativeId },
  });
  if (!cooperative) {
    throw new AuthorizationError('cooperative-not-found');
  }

  const profiles = await prisma.driverProfile.findMany({
    where: { cooperativeId },
  });
  const userIds = profiles.map((p: any) => p.userId);
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } } })
    : [];
  const usersById = new Map<string, any>(users.map((u: any) => [u.id, u]));

  const driverCount = profiles.length;
  const activeDriverCount = profiles.filter((p: any) => p.active !== false).length;
  const onlineDriverCount = profiles.filter((p: any) => p.isOnline === true).length;
  const flaggedDriverCount = users.filter(
    (u: any) => u.isFlagged === true || !!u.frozenAt,
  ).length;

  const todayStart = startOfDay(now);
  const weekStart = daysAgo(now, 7);
  const monthStart = daysAgo(now, 30);

  const todayJourneys = userIds.length
    ? await prisma.journey.findMany({
        where: {
          driverId: { in: userIds },
          status: 'COMPLETED',
          confirmedAt: { gte: todayStart },
        },
        select: { agreedPrice: true },
      })
    : [];
  const todayRideCount = todayJourneys.length;
  const todayEarningsRwf = todayJourneys.reduce(
    (acc: number, j: any) => acc + (j.agreedPrice ?? 0),
    0,
  );

  const weekRideCount = userIds.length
    ? await prisma.journey.count({
        where: {
          driverId: { in: userIds },
          status: 'COMPLETED',
          confirmedAt: { gte: weekStart },
        },
      })
    : 0;
  const monthRideCount = userIds.length
    ? await prisma.journey.count({
        where: {
          driverId: { in: userIds },
          status: 'COMPLETED',
          confirmedAt: { gte: monthStart },
        },
      })
    : 0;

  const ratings = profiles
    .map((p: any) =>
      p.avgRating == null
        ? null
        : typeof p.avgRating === 'object' && 'toNumber' in p.avgRating
          ? p.avgRating.toNumber()
          : Number(p.avgRating),
    )
    .filter((r: number | null): r is number => r !== null && !Number.isNaN(r) && r > 0);
  const averageRating = ratings.length
    ? Number((ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length).toFixed(2))
    : null;

  return {
    cooperativeId,
    name: cooperative.name,
    driverCount,
    activeDriverCount,
    onlineDriverCount,
    todayRideCount,
    todayEarningsRwf,
    weekRideCount,
    monthRideCount,
    averageRating,
    flaggedDriverCount,
    periodDays,
  };
}

export async function listCooperativeDrivers(
  prisma: PrismaClient,
  cooperativeId: string,
  opts: { limit: number; offset: number; onlineOnly?: boolean; flaggedOnly?: boolean },
): Promise<CooperativeDriverRow[]> {
  const where: any = { cooperativeId };
  if (opts.onlineOnly) where.isOnline = true;

  const profiles = await prisma.driverProfile.findMany({
    where,
    orderBy: { id: 'asc' },
    take: opts.limit,
    skip: opts.offset,
  });
  const userIds = profiles.map((p: any) => p.userId);
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } } })
    : [];
  const usersById = new Map<string, any>(users.map((u: any) => [u.id, u]));

  const rows: CooperativeDriverRow[] = profiles
    .map((p: any) => {
      const u = usersById.get(p.userId);
      if (!u) return null;
      return toDriverRow(p, u);
    })
    .filter((r: CooperativeDriverRow | null): r is CooperativeDriverRow => r !== null);

  if (opts.flaggedOnly) {
    return rows.filter((r) => r.isFlagged || r.isFrozen);
  }
  return rows;
}

export async function getDriverDetail(
  prisma: PrismaClient,
  cooperativeId: string,
  driverProfileId: string,
  periodDays: number = DASHBOARD_DEFAULT_PERIOD_DAYS,
  now: Date = new Date(),
): Promise<CooperativeDriverDetail> {
  const profile = await prisma.driverProfile.findUnique({
    where: { id: driverProfileId },
  });
  if (!profile || profile.cooperativeId !== cooperativeId) {
    throw new AuthorizationError('driver-not-in-cooperative');
  }
  const user = await prisma.user.findUnique({
    where: { id: profile.userId },
  });
  if (!user) {
    throw new AuthorizationError('driver-user-not-found');
  }

  const since = daysAgo(now, periodDays);
  const recentJourneys = await prisma.journey.findMany({
    where: { driverId: user.id, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      pickupName: true,
      destinationName: true,
      status: true,
      agreedPrice: true,
      createdAt: true,
      confirmedAt: true,
    },
  });

  const completed = await prisma.journey.findMany({
    where: {
      driverId: user.id,
      status: 'COMPLETED',
      confirmedAt: { gte: since },
    },
    select: { agreedPrice: true },
  });
  const totalRwf = completed.reduce(
    (acc: number, j: any) => acc + (j.agreedPrice ?? 0),
    0,
  );

  const amlFlags = await prisma.amlFlag.findMany({
    where: { userId: user.id },
    orderBy: { detectedAt: 'desc' },
    take: 20,
    select: {
      id: true,
      type: true,
      severity: true,
      status: true,
      detectedAt: true,
    },
  });

  return {
    driver: toDriverRow(profile, user),
    recentJourneys,
    recentEarnings: { totalRwf, periodDays },
    amlFlags,
  };
}

export async function computeFinancialSummary(
  prisma: PrismaClient,
  cooperativeId: string,
  periodDays: number,
  now: Date = new Date(),
): Promise<CooperativeFinancialSummary> {
  const cooperative = await prisma.cooperative.findUnique({
    where: { id: cooperativeId },
  });
  if (!cooperative) {
    throw new AuthorizationError('cooperative-not-found');
  }
  const commissionRate: number = cooperative.commissionRate ?? 0;

  const profiles = await prisma.driverProfile.findMany({
    where: { cooperativeId },
  });
  const userIds = profiles.map((p: any) => p.userId);

  const since = daysAgo(now, periodDays);
  const journeys = userIds.length
    ? await prisma.journey.findMany({
        where: {
          driverId: { in: userIds },
          status: 'COMPLETED',
          confirmedAt: { gte: since },
        },
        select: { driverId: true, agreedPrice: true, commissionAmount: true },
      })
    : [];

  let totalRideRwf = 0;
  let totalEarningsRwf = 0;
  const perDriverMap = new Map<
    string,
    { rideCount: number; earningsRwf: number }
  >();

  for (const j of journeys) {
    const price = j.agreedPrice ?? 0;
    const platformCommission = j.commissionAmount ?? 0;
    const driverShare = Math.max(0, price - platformCommission);
    totalRideRwf += price;
    totalEarningsRwf += driverShare;
    const did = j.driverId as string;
    const cur = perDriverMap.get(did) ?? { rideCount: 0, earningsRwf: 0 };
    cur.rideCount += 1;
    cur.earningsRwf += driverShare;
    perDriverMap.set(did, cur);
  }

  const totalCommissionRwf = Math.round(totalEarningsRwf * commissionRate);

  const perDriver = Array.from(perDriverMap.entries()).map(
    ([driverId, agg]) => ({
      driverId,
      rideCount: agg.rideCount,
      earningsRwf: agg.earningsRwf,
      commissionRwf: Math.round(agg.earningsRwf * commissionRate),
    }),
  );

  return {
    cooperativeId,
    periodDays,
    totalRideRwf,
    totalEarningsRwf,
    totalCommissionRwf,
    perDriver,
  };
}
