import * as Sentry from '@sentry/node';
import cron, { ScheduledTask } from 'node-cron';
import { withJobLease } from '../services/job-lock';
import { emitJobRunMetrics } from '../services/job-metrics';
import {
  CRON_SCHEDULE,
  RETENTION_YEARS,
  TIMEZONE,
} from '../services/bnr-report/config';
import {
  deleteOlderThan,
  generateReport,
  priorPeriodFromNow,
} from '../services/bnr-report';

// Generous ceiling on a monthly report run — the lease exists to keep the
// run single-runner across processes, not to police its speed.
export const BNR_LEASE_TTL_MS = 60 * 60 * 1000;

let task: ScheduledTask | null = null;
let running = false;

function subYears(date: Date, years: number): Date {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() - years);
  return next;
}

export async function runBnrMonthlyOnce(now: Date = new Date()): Promise<void> {
  if (running) return;
  running = true;
  const startedAt = Date.now();
  try {
    const period = priorPeriodFromNow(now, TIMEZONE);
    console.log(`[BNR-MONTHLY] Tick start period=${period}`);
    const report = await generateReport({ period });
    console.log(`[BNR-MONTHLY] Tick complete period=${period}`);

    const cutoff = subYears(now, RETENTION_YEARS);
    const deleted = await deleteOlderThan(cutoff);
    if (deleted > 0) {
      console.log(`[BNR-MONTHLY] Retention sweep deleted ${deleted} report rows`);
    }

    emitJobRunMetrics({
      prefix: '[BNR-MONTHLY]',
      job: 'bnr-monthly.job',
      // csvRows is undefined when the period's report already existed
      // (idempotent re-run generates nothing) — report 0 written rows.
      fields: { period, rows: report.csvRows ?? 0 },
      durationMs: Date.now() - startedAt,
      leaseTtlMs: BNR_LEASE_TTL_MS,
    });
  } catch (err) {
    console.error('[BNR-MONTHLY] Tick failed:', err);
    if (process.env.SENTRY_DSN) Sentry.captureException(err);
  } finally {
    running = false;
  }
}

export function startBnrMonthlyJob(): void {
  if (task) return;
  console.log(
    `[BNR-MONTHLY] Starting cron "${CRON_SCHEDULE}" tz=${TIMEZONE} (retention=${RETENTION_YEARS}y)`,
  );
  task = cron.schedule(CRON_SCHEDULE, () => {
    // withJobLease, not the advisory xact lock: a monthly report run takes
    // minutes, and the xact-lock variant would hold a transaction (and a
    // pooled connection) open for all of it. The lease keeps the run
    // single-runner across processes without an open transaction.
    withJobLease('bnr-monthly.job', BNR_LEASE_TTL_MS, () => runBnrMonthlyOnce()).catch((err) => {
      console.error('[BNR-MONTHLY] Top-level tick error:', err);
      if (process.env.SENTRY_DSN) Sentry.captureException(err);
    });
  }, { timezone: TIMEZONE, noOverlap: true });
}

export function stopBnrMonthlyJob(): void {
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
