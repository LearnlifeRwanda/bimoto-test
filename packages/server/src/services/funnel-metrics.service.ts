// SERVICES/FUNNEL-METRICS.SERVICE.TS
//
// R3-FUNNEL-METRICS-DASHBOARD — admin-internal operational metrics
// for the 500-driver cooperative-led Q3 2026 pilot.
//
// BOUNDARY: this service is admin-internal and PII-rich by design.
// It queries raw Journey, Bid, User, DriverProfile, Cooperative.
// It is exposed only via /api/admin/funnel/* with authMiddleware +
// adminOnly gates.
//
// For the public/anonymised mobility-intelligence read API, see
// services/mobility/types.ts. That layer is k-anonymity-gated and
// deliberately strips driverId/customerId/cooperativeId — the
// funnel-metrics service is NOT a consumer of that layer and MUST
// NOT become one. The two layers serve different audiences and
// operate under different privacy regimes:
//
//   - mobility-intelligence: regulator-facing, anonymised, k-suppressed
//   - funnel-metrics (this file): admin-internal, PII-rich, operational
//
// City-band classification is shared in shape (services/funnel-metrics/
// city-band.json mirrors services/mobility/tier-classification.json)
// but the two classifiers have DIFFERENT boundaries — mobility tiers
// are aggregation-density tiers (DENSE/MEDIUM/LOW/SPARSE); funnel city
// bands are operational geography for the pilot (kigali_dense,
// kigali_periphery, bugesera_corridor, other).

import prisma from '../prisma';
import {
  ACTIVE_DRIVER_TRIP_THRESHOLD,
  ACTIVE_DRIVER_WINDOW_DAYS,
  FUNNEL_LOOKBACK_WEEKS,
  type CityBand,
  MS_PER_DAY,
} from '@bimoto/shared';
import { classifyCityBand } from './funnel-metrics/city-band';

const TIMEZONE = 'Africa/Kigali';
const MS_PER_WEEK = 7 * MS_PER_DAY;

export interface FunnelMetricsParams {
  weekOf: string; // ISO week, e.g. "2026-W30"
  cityBand?: CityBand;
  cooperativeId?: string;
}

export interface FunnelMetricsResult {
  weekOf: string;
  filters: { cityBand?: CityBand; cooperativeId?: string };
  funnel: {
    registered: number[];
    // R3-DRIVER-SCREENER — real count of ELIGIBLE DriverScreener rows.
    screenerQualified: number[];
    onboarded: number[];
    active: number[];
  };
  operational: {
    timeToFirstBidMedianMinutes: number[];
    bidsPerRideMean: number[];
    acceptanceRate: number[];
    cancellationRate: number[];
    parcelRecipientConfirmationRate: number[];
    offlineSyncSuccessRate: number[];
  };
  meta: {
    computedAt: string;
  };
}

// ---------------------------------------------------------------------------
// ISO-week helpers (Africa/Kigali, Monday-anchored).
//
// ISO week-date follows the rules:
//  - week 1 of a year contains the first Thursday of that year
//  - weeks start on Monday
// We compute in UTC after shifting by Africa/Kigali's fixed +02:00 offset.
// Rwanda does not observe DST and is +02:00 year-round, so a fixed offset
// is exact; we do NOT consult Intl.DateTimeFormat per call.
// ---------------------------------------------------------------------------

const KIGALI_OFFSET_MS = 2 * 60 * 60 * 1000;

function startOfIsoWeekUtc(weekOf: string): Date {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekOf);
  if (!m) throw new Error(`Invalid weekOf "${weekOf}"; expected "YYYY-Www"`);
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  if (week < 1 || week > 53) {
    throw new Error(`Invalid week number in "${weekOf}"`);
  }
  // Jan 4 is always in week 1 (ISO rule).
  const jan4LocalMs = Date.UTC(year, 0, 4);
  const jan4Dow = new Date(jan4LocalMs).getUTCDay() || 7; // Sunday -> 7
  const week1MondayLocalMs = jan4LocalMs - (jan4Dow - 1) * MS_PER_DAY;
  const targetMondayLocalMs = week1MondayLocalMs + (week - 1) * MS_PER_WEEK;
  // Subtract the Kigali offset to get the equivalent UTC instant for
  // "Monday 00:00 local time".
  return new Date(targetMondayLocalMs - KIGALI_OFFSET_MS);
}

function isoWeekOf(date: Date): string {
  // Convert UTC instant to Kigali local time, then derive ISO week.
  const localMs = date.getTime() + KIGALI_OFFSET_MS;
  const local = new Date(localMs);
  const dow = local.getUTCDay() || 7;
  // Thursday of the same ISO week is the canonical week-anchor.
  const thursdayMs = localMs + (4 - dow) * MS_PER_DAY;
  const thursday = new Date(thursdayMs);
  const year = thursday.getUTCFullYear();
  const jan1Ms = Date.UTC(year, 0, 1);
  const weekNumber = Math.ceil(
    (thursdayMs - jan1Ms) / MS_PER_WEEK + (new Date(jan1Ms).getUTCDay() || 7) / 7,
  );
  return `${year}-W${String(weekNumber).padStart(2, '0')}`;
}

export function currentIsoWeek(now: Date = new Date()): string {
  return isoWeekOf(now);
}

// ---------------------------------------------------------------------------
// Aggregation core.
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function safeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

async function driverIdsForCooperative(
  cooperativeId: string | undefined,
): Promise<string[] | null> {
  if (!cooperativeId) return null;
  const drivers = await prisma.driverProfile.findMany({
    where: { cooperativeId },
    select: { userId: true },
  });
  return drivers.map((d) => d.userId);
}

interface WeekBucket {
  weekOf: string;
  startUtc: Date;
  endUtc: Date;
}

function bucketsFor(weekOf: string): WeekBucket[] {
  const buckets: WeekBucket[] = [];
  const startOfRequested = startOfIsoWeekUtc(weekOf);
  for (let i = FUNNEL_LOOKBACK_WEEKS - 1; i >= 0; i--) {
    const start = new Date(startOfRequested.getTime() - i * MS_PER_WEEK);
    const end = new Date(start.getTime() + MS_PER_WEEK);
    buckets.push({ weekOf: isoWeekOf(start), startUtc: start, endUtc: end });
  }
  return buckets;
}

async function computeWeek(
  bucket: WeekBucket,
  cityBand: CityBand | undefined,
  driverIdScope: string[] | null,
): Promise<{
  registered: number;
  onboarded: number;
  screenerQualified: number;
  active: number;
  timeToFirstBidMedianMinutes: number;
  bidsPerRideMean: number;
  acceptanceRate: number;
  cancellationRate: number;
  parcelRecipientConfirmationRate: number;
  offlineSyncSuccessRate: number;
}> {
  const { startUtc, endUtc } = bucket;

  const cooperativeFilter =
    driverIdScope !== null ? { in: driverIdScope } : undefined;

  // --- Funnel: Registered (cumulative-through-end-of-week) ---
  const registered = await prisma.user.count({
    where: {
      role: { in: ['DRIVER', 'BOTH'] },
      createdAt: { lt: endUtc },
      ...(cooperativeFilter ? { id: cooperativeFilter } : {}),
    },
  });

  // --- Funnel: Onboarded (verified + cooperative-attributed, cumulative) ---
  const onboarded = await prisma.driverProfile.count({
    where: {
      verificationStatus: 'VERIFIED',
      cooperativeId: { not: null },
      ...(driverIdScope !== null ? { userId: { in: driverIdScope } } : {}),
      ...(driverIdScope === null ? {} : {}),
      verifiedAt: { lt: endUtc },
    },
  });

  // --- Funnel: Screener-qualified (R3-DRIVER-SCREENER) ---
  //
  // Cumulative count of drivers who submitted the in-app screener AND
  // came out ELIGIBLE, through the end of this bucket. Mirrors the
  // onboarded scoping (cooperative driver-id list when present) so the
  // §5 invariant — screenerQualified >= onboarded for any cohort with
  // at least one onboarded driver — holds under fixtures where every
  // onboarded driver has also been screened.
  const screenerQualified = await prisma.driverScreener.count({
    where: {
      eligibilityResult: 'ELIGIBLE',
      completedAt: { lt: endUtc },
      ...(driverIdScope !== null
        ? { driverProfile: { userId: { in: driverIdScope } } }
        : {}),
    },
  });

  // --- Funnel: Active (>= threshold completed trips in the trailing
  //     ACTIVE_DRIVER_WINDOW_DAYS, ending at this week's end) ---
  const activeWindowStart = new Date(
    endUtc.getTime() - ACTIVE_DRIVER_WINDOW_DAYS * MS_PER_DAY,
  );
  const activeCandidates = await prisma.journey.findMany({
    where: {
      status: 'COMPLETED',
      confirmedAt: { gte: activeWindowStart, lt: endUtc },
      driverId: { not: null },
      ...(cooperativeFilter ? { driverId: cooperativeFilter } : {}),
    },
    select: { driverId: true, pickupLat: true, pickupLng: true },
  });
  const tripsPerDriver = new Map<string, number>();
  for (const j of activeCandidates) {
    if (!j.driverId) continue;
    if (cityBand && classifyCityBand(j.pickupLat, j.pickupLng) !== cityBand) {
      continue;
    }
    tripsPerDriver.set(j.driverId, (tripsPerDriver.get(j.driverId) ?? 0) + 1);
  }
  let active = 0;
  for (const count of tripsPerDriver.values()) {
    if (count >= ACTIVE_DRIVER_TRIP_THRESHOLD) active += 1;
  }

  // --- Operational: per-week journey scope ---
  const journeys = await prisma.journey.findMany({
    where: {
      createdAt: { gte: startUtc, lt: endUtc },
      ...(cooperativeFilter ? { driverId: cooperativeFilter } : {}),
    },
    select: {
      id: true,
      status: true,
      discoveryStartedAt: true,
      pickupLat: true,
      pickupLng: true,
      recipientPhone: true,
      bids: {
        select: { createdAt: true, status: true },
      },
      legs: {
        select: { recipientConfirmStatus: true, recipientConfirmedAt: true },
      },
    },
  });
  const scoped = cityBand
    ? journeys.filter(
        (j) => classifyCityBand(j.pickupLat, j.pickupLng) === cityBand,
      )
    : journeys;

  // Time to first bid (minutes).
  const ttfbMinutes: number[] = [];
  for (const j of scoped) {
    if (!j.discoveryStartedAt || j.bids.length === 0) continue;
    const earliest = j.bids.reduce(
      (acc, b) => (b.createdAt < acc ? b.createdAt : acc),
      j.bids[0].createdAt,
    );
    const deltaMs = earliest.getTime() - j.discoveryStartedAt.getTime();
    if (deltaMs < 0) continue;
    ttfbMinutes.push(deltaMs / 60_000);
  }
  const timeToFirstBidMedianMinutes = median(ttfbMinutes);

  // Bids per ride mean.
  const bidCounts = scoped.map((j) => j.bids.length);
  const bidsPerRideMean = bidCounts.length === 0
    ? 0
    : bidCounts.reduce((a, b) => a + b, 0) / bidCounts.length;

  // Acceptance rate.
  const accepted = scoped.filter((j) =>
    j.bids.some((b) => b.status === 'ACCEPTED'),
  ).length;
  const acceptanceRate = safeRate(accepted, scoped.length);

  // Cancellation rate.
  const cancelled = scoped.filter((j) => j.status === 'CANCELLED').length;
  const cancellationRate = safeRate(cancelled, scoped.length);

  // Parcel-recipient SMS confirmation rate.
  const parcelJourneys = scoped.filter((j) => j.recipientPhone != null);
  const confirmedParcels = parcelJourneys.filter((j) =>
    j.legs.some(
      (l) =>
        l.recipientConfirmStatus === 'EXPLICIT_REPLY' ||
        (l.recipientConfirmStatus == null && l.recipientConfirmedAt != null),
    ),
  ).length;
  const parcelRecipientConfirmationRate = safeRate(
    confirmedParcels,
    parcelJourneys.length,
  );

  // Offline-sync success rate.
  //
  // R3-SYNC-REJECTION-MODEL — rejections are persisted to the
  // SyncRejection table by sync.service.ts in the processEvents catch
  // block. The ratio is therefore the proportion of upload attempts
  // that succeeded:
  //
  //   acceptedCount / (acceptedCount + rejectedCount)
  //
  // Both counts use serverTimestamp to fall into the metric window.
  // When the window contains zero upload attempts, the ratio is 0
  // (rendered as "no data" in the dashboard tile).
  //
  // Out of scope: client-side failures that never reached the server.
  // Those are not represented in either count.
  const [acceptedCount, rejectedCount] = await Promise.all([
    prisma.syncEvent.count({
      where: {
        serverTimestamp: { gte: startUtc, lt: endUtc },
        ...(driverIdScope !== null ? { userId: { in: driverIdScope } } : {}),
      },
    }),
    prisma.syncRejection.count({
      where: {
        serverTimestamp: { gte: startUtc, lt: endUtc },
        ...(driverIdScope !== null ? { userId: { in: driverIdScope } } : {}),
      },
    }),
  ]);
  const totalSyncAttempts = acceptedCount + rejectedCount;
  const offlineSyncSuccessRate =
    totalSyncAttempts > 0 ? acceptedCount / totalSyncAttempts : 0;

  return {
    registered,
    onboarded,
    screenerQualified,
    active,
    timeToFirstBidMedianMinutes,
    bidsPerRideMean,
    acceptanceRate,
    cancellationRate,
    parcelRecipientConfirmationRate,
    offlineSyncSuccessRate,
  };
}

export async function getFunnelMetrics(
  params: FunnelMetricsParams,
): Promise<FunnelMetricsResult> {
  const buckets = bucketsFor(params.weekOf);
  const driverIdScope = await driverIdsForCooperative(params.cooperativeId);

  const perWeek = await Promise.all(
    buckets.map((b) => computeWeek(b, params.cityBand, driverIdScope)),
  );

  const registered = perWeek.map((w) => w.registered);
  const onboarded = perWeek.map((w) => w.onboarded);
  return {
    weekOf: params.weekOf,
    filters: {
      cityBand: params.cityBand,
      cooperativeId: params.cooperativeId,
    },
    funnel: {
      registered,
      // R3-DRIVER-SCREENER — real count of ELIGIBLE DriverScreener rows
      // (was stubbed-equal-to-onboarded until this dispatch).
      screenerQualified: perWeek.map((w) => w.screenerQualified),
      onboarded,
      active: perWeek.map((w) => w.active),
    },
    operational: {
      timeToFirstBidMedianMinutes: perWeek.map(
        (w) => w.timeToFirstBidMedianMinutes,
      ),
      bidsPerRideMean: perWeek.map((w) => w.bidsPerRideMean),
      acceptanceRate: perWeek.map((w) => w.acceptanceRate),
      cancellationRate: perWeek.map((w) => w.cancellationRate),
      parcelRecipientConfirmationRate: perWeek.map(
        (w) => w.parcelRecipientConfirmationRate,
      ),
      offlineSyncSuccessRate: perWeek.map((w) => w.offlineSyncSuccessRate),
    },
    meta: {
      computedAt: new Date().toISOString(),
    },
  };
}

const CSV_COLUMNS = [
  'weekOf',
  'registered',
  'screenerQualified',
  'onboarded',
  'active',
  'timeToFirstBidMedianMinutes',
  'bidsPerRideMean',
  'acceptanceRate',
  'cancellationRate',
  'parcelRecipientConfirmationRate',
  'offlineSyncSuccessRate',
  'cityBand',
] as const;

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? n.toString() : n.toFixed(4);
}

export async function getFunnelMetricsCsv(
  params: FunnelMetricsParams,
): Promise<string> {
  const result = await getFunnelMetrics(params);
  const buckets = bucketsFor(params.weekOf);
  const cityBandLabel = params.cityBand ?? 'all';
  const lines: string[] = [];
  lines.push(CSV_COLUMNS.join(','));
  for (let i = 0; i < buckets.length; i++) {
    lines.push(
      [
        buckets[i].weekOf,
        fmtNum(result.funnel.registered[i]),
        fmtNum(result.funnel.screenerQualified[i]),
        fmtNum(result.funnel.onboarded[i]),
        fmtNum(result.funnel.active[i]),
        fmtNum(result.operational.timeToFirstBidMedianMinutes[i]),
        fmtNum(result.operational.bidsPerRideMean[i]),
        fmtNum(result.operational.acceptanceRate[i]),
        fmtNum(result.operational.cancellationRate[i]),
        fmtNum(result.operational.parcelRecipientConfirmationRate[i]),
        fmtNum(result.operational.offlineSyncSuccessRate[i]),
        cityBandLabel,
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

export const _internal = {
  startOfIsoWeekUtc,
  isoWeekOf,
  bucketsFor,
  median,
  TIMEZONE,
  CSV_COLUMNS,
};
