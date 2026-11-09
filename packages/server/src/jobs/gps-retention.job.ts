// JOBS/GPS-RETENTION.JOB.TS
//
// PAYOUT-F — enforce the declared GPS retention promise. GpsPoint rows
// older than GPS_TRACE_RETENTION_DAYS (the single source of truth in
// @bimoto/shared — retention exists for dispute resolution) are deleted
// nightly, EXCEPT points whose journey is still in a non-terminal or
// disputed status: those may be needed to resolve the dispute, so they
// are held regardless of age and swept once the journey reaches a
// terminal state.
//
// Ordering: this job runs at 05:00, one hour AFTER the mobility
// aggregation cron (04:00) — the aggregator must see yesterday's points
// before any deletion. That ordering is belt; the margin guard below is
// suspenders.
//
// Deletion is batched raw SQL (Prisma deleteMany has no LIMIT): delete
// rows whose id is in a LIMITed subquery, loop until a batch comes back
// short, pause briefly between batches so the sweep never monopolises
// the database.

import cron, { ScheduledTask } from 'node-cron';
import * as Sentry from '@sentry/node';
import { GPS_TRACE_RETENTION_DAYS } from '@bimoto/shared';
import prisma from '../prisma';
import { withJobLease } from '../services/job-lock';
import { emitJobRunMetrics } from '../services/job-metrics';
import { MOBILITY_AGGREGATION_LOOKBACK_HOURS } from '../services/mobility/config';

export const GPS_RETENTION_CRON =
  process.env.GPS_RETENTION_CRON ?? '0 5 * * *';

// Generous ceiling on a nightly sweep — the lease exists to keep the run
// single-runner across processes, not to police its speed. The very first
// production run deletes the whole backlog and may run long.
export const GPS_RETENTION_LEASE_TTL_MS = 60 * 60 * 1000;

export const GPS_RETENTION_BATCH_SIZE = 10_000;
const BATCH_PAUSE_MS = 250;

// Aggregate-before-delete margin (guard #1). Raw GPS points are distilled
// nightly into k-anonymized MobilityAggregate rows — the platform's
// long-term insights store — and raw points only need to outlive that
// distillation. The sweep's cutoff must therefore stay at least this many
// days OLDER than the mobility aggregation window's lower bound, so the
// sweep can never outrun the aggregator — not today (14d retention vs a
// 1-day window: dormant, with 13 days of slack) and not under any future
// edit to GPS_TRACE_RETENTION_DAYS. If the margin is ever violated the sweep
// refuses to run and raises a Sentry error instead of silently starving
// the insights pipeline.
export const AGGREGATE_MARGIN_DAYS = 3;

// Expired-OTP purge (guard-free hygiene, same job): OtpCode rows whose
// expiresAt passed more than this long ago are dead weight — codes expire
// after 5 minutes and nothing purges the rows.
export const OTP_PURGE_GRACE_HOURS = 24;

let task: ScheduledTask | null = null;
let running = false;

export interface GpsRetentionResult {
  deleted: number;
  batches: number;
  otpDeleted: number;
  durationMs: number;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns null (and deletes nothing) when the aggregate-before-delete
 * margin is violated; otherwise sweeps and returns the run's counts.
 */
export async function runGpsRetentionOnce(
  now: Date = new Date(),
  retentionDays: number = GPS_TRACE_RETENTION_DAYS,
): Promise<GpsRetentionResult | null> {
  const startedAt = Date.now();
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 3600 * 1000);

  // Guard #1 — the cutoff must be at least AGGREGATE_MARGIN_DAYS older
  // than the aggregation window's lower bound (now - lookback).
  const aggregationLowerBound = new Date(
    now.getTime() - MOBILITY_AGGREGATION_LOOKBACK_HOURS * 3600 * 1000,
  );
  const requiredCutoffCeiling = new Date(
    aggregationLowerBound.getTime() - AGGREGATE_MARGIN_DAYS * 24 * 3600 * 1000,
  );
  if (cutoff > requiredCutoffCeiling) {
    const msg =
      `[GPS-RETENTION] REFUSING to run: cutoff ${cutoff.toISOString()} is ` +
      `within ${AGGREGATE_MARGIN_DAYS}d of the aggregation window's lower ` +
      `bound ${aggregationLowerBound.toISOString()} — deleting would starve ` +
      `the mobility insights pipeline. Raise GPS_TRACE_RETENTION_DAYS ` +
      `(currently ${retentionDays}d) or lower the aggregation lookback.`;
    console.error(msg);
    if (process.env.SENTRY_DSN) {
      Sentry.captureMessage('gps-retention.job margin guard tripped', {
        level: 'error',
        extra: {
          retentionDays,
          lookbackHours: MOBILITY_AGGREGATION_LOOKBACK_HOURS,
          marginDays: AGGREGATE_MARGIN_DAYS,
        },
      });
    }
    return null;
  }

  // Batched sweep. Only points on journeys in a TERMINAL status are
  // deletable; every other status — including DISPUTED and INTERRUPTED
  // (reconciliation pending) — holds its points regardless of age, because
  // retention exists for dispute resolution (§ the constant's own comment).
  //
  // SOS-FOLLOW G3 — and a journey with an ACTIVE emergency alert holds
  // too, whatever its status.
  //
  // The two holds are the same idea reaching a different fact. The
  // status hold says "this journey's story is not finished". The alert
  // hold says "this journey's EMERGENCY is not finished" — and an
  // emergency outlives its ride on purpose (journey completion does not
  // close an alert; only ops or the valve does), so a ride that ended
  // while somebody was still in trouble would otherwise become sweepable
  // in the middle of the thing the trace exists for. The follow's own
  // frames are GpsPoints like any other, so this is also the only reason
  // the ops trail survives long enough to be read afterwards.
  //
  // The hold RELEASES the moment the alert stops being ACTIVE: a
  // resolved or expired alert matches nothing here, and the journey
  // returns to being governed by its status and its age alone.
  let deleted = 0;
  let batches = 0;
  for (;;) {
    const count = await prisma.$executeRaw`
      DELETE FROM "GpsPoint"
      WHERE "id" IN (
        SELECT gp."id"
        FROM "GpsPoint" gp
        JOIN "Journey" j ON j."id" = gp."journeyId"
        WHERE gp."timestamp" < ${cutoff}
          AND j."status" = ANY(
            ARRAY['COMPLETED', 'CANCELLED', 'EXPIRED']::"JourneyStatus"[]
          )
          AND NOT EXISTS (
            SELECT 1 FROM "EmergencyAlert" ea
            WHERE ea."journeyId" = j."id" AND ea."status" = 'ACTIVE'
          )
        LIMIT ${GPS_RETENTION_BATCH_SIZE}
      )
    `;
    batches += 1;
    deleted += count;
    if (count < GPS_RETENTION_BATCH_SIZE) break;
    await pause(BATCH_PAUSE_MS);
  }

  // Expired-OTP purge: rows whose expiry passed more than the grace
  // period ago (small table; plain deleteMany is fine).
  const otpCutoff = new Date(
    now.getTime() - OTP_PURGE_GRACE_HOURS * 3600 * 1000,
  );
  const otpResult = await prisma.otpCode.deleteMany({
    where: { expiresAt: { lt: otpCutoff } },
  });
  const otpDeleted = otpResult.count;

  const durationMs = Date.now() - startedAt;
  emitJobRunMetrics({
    prefix: '[GPS-RETENTION]',
    job: 'gps-retention.job',
    fields: { deleted, batches, otpDeleted },
    durationMs,
    leaseTtlMs: GPS_RETENTION_LEASE_TTL_MS,
  });

  return { deleted, batches, otpDeleted, durationMs };
}

export function startGpsRetentionJob(): void {
  if (task) return;
  console.log(
    `[GPS-RETENTION] Starting cron "${GPS_RETENTION_CRON}" (retention=${GPS_TRACE_RETENTION_DAYS}d, batch=${GPS_RETENTION_BATCH_SIZE})`,
  );
  task = cron.schedule(
    GPS_RETENTION_CRON,
    async () => {
      if (running) return;
      running = true;
      try {
        // withJobLease, not the advisory xact lock: the sweep can run for
        // minutes on a big backlog, and the xact-lock variant would hold a
        // transaction open for all of it.
        await withJobLease(
          'gps-retention.job',
          GPS_RETENTION_LEASE_TTL_MS,
          () => runGpsRetentionOnce(),
        );
      } catch (err) {
        console.error('[GPS-RETENTION] Tick failed:', err);
        if (process.env.SENTRY_DSN) Sentry.captureException(err);
      } finally {
        running = false;
      }
    },
    { noOverlap: true },
  );
}

export function stopGpsRetentionJob(): void {
  if (task) {
    task.stop();
    task = null;
  }
}

export function _resetForTests(): void {
  if (task) {
    task.stop();
    task = null;
  }
  running = false;
}
