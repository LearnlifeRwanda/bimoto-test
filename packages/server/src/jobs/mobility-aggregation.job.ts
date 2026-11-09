// JOBS/MOBILITY-AGGREGATION.JOB.TS
//
// Nightly cron that runs each registered AGGREGATOR_MODULE in sequence.
// Per-module failures are isolated (logged + Sentry-captured) so one
// tier or aggregator failing does not abort the rest. K-anonymity is
// applied inside each aggregator; we double-check here as
// defence-in-depth before any row hits the store.

import cron, { ScheduledTask } from 'node-cron';
import * as Sentry from '@sentry/node';
import prisma from '../prisma';
import { AGGREGATOR_MODULES } from '../services/mobility/aggregator';
import { bulkInsertAggregates } from '../services/mobility/store';
import { applyKAnonymity } from '../services/mobility/k-anonymity';
import { withJobLease } from '../services/job-lock';
import { emitJobRunMetrics } from '../services/job-metrics';
import {
  MOBILITY_AGGREGATION_CRON,
  MOBILITY_AGGREGATION_LOOKBACK_HOURS,
  MOBILITY_AGGREGATION_TIMEOUT_MS,
} from '../services/mobility/config';
import type { Tier } from '../services/mobility/types';

// Generous ceiling on a nightly aggregation run — the lease exists to keep
// the run single-runner across processes, not to police its speed.
export const MOBILITY_LEASE_TTL_MS = 120 * 60 * 1000;

let task: ScheduledTask | null = null;
let running = false;

export interface MobilityTickResult {
  modules: number;
  scannedPoints: number;
  insertedRows: number;
  conflicts: number;
  suppressedByTier: Record<Tier, number>;
  durationMs: number;
}

const ZERO_SUPPRESSED: Record<Tier, number> = {
  DENSE: 0,
  MEDIUM: 0,
  LOW: 0,
  SPARSE: 0,
};

/**
 * LOOSE-ENDS G6 — an explicit window, for the one-off re-run.
 *
 * The nightly cron has never needed one: it fires, computes
 * `now - LOOKBACK_HOURS`, and aggregates what has just happened. But
 * `POST /aggregates/run-now` called this with no arguments too, so an
 * admin who wanted last month's aggregates re-built had to ask a
 * developer to run something by hand.
 *
 * So the window becomes an optional PARAMETER rather than a second
 * computation: absent, both bounds fall back to exactly the arithmetic
 * that has always run here, byte for byte, and the cron call is
 * untouched. Present, it flows to the modules through the same
 * `{ sinceUtc, untilUtc }` they already receive — no module knows this
 * changed.
 */
export interface MobilityWindow {
  sinceUtc?: Date;
  untilUtc?: Date;
}

export async function runMobilityAggregationOnce(
  now: Date = new Date(),
  window: MobilityWindow = {},
): Promise<MobilityTickResult> {
  const startedAt = Date.now();
  const sinceUtc =
    window.sinceUtc ??
    new Date(now.getTime() - MOBILITY_AGGREGATION_LOOKBACK_HOURS * 3600 * 1000);
  const untilUtc = window.untilUtc ?? now;

  let totalScanned = 0;
  let totalInserted = 0;
  let totalConflicts = 0;
  const totalSuppressed: Record<Tier, number> = { ...ZERO_SUPPRESSED };

  for (const mod of AGGREGATOR_MODULES) {
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        mod.aggregate(prisma, { sinceUtc, untilUtc }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('mobility-aggregator-timeout')),
            MOBILITY_AGGREGATION_TIMEOUT_MS,
          );
        }),
      ]);
      if (timer) clearTimeout(timer);
      // Defence-in-depth: re-apply k-anonymity at the cron layer in case
      // a future module forgets to. Should be a no-op normally.
      const safe = applyKAnonymity(result.aggregated);
      const suppressed = result.suppressedByTier ?? { ...ZERO_SUPPRESSED };
      const insert = await bulkInsertAggregates(prisma, safe);
      totalScanned += result.scannedPoints;
      totalInserted += insert.inserted;
      totalConflicts += insert.conflicts;
      for (const t of Object.keys(suppressed) as Tier[]) {
        totalSuppressed[t] += suppressed[t];
      }
      console.log(
        `[MOBILITY] ${mod.name}: scanned=${result.scannedPoints} kept=${safe.length} inserted=${insert.inserted} conflicts=${insert.conflicts} ms=${result.durationMs}`,
      );
    } catch (err) {
      if (timer) clearTimeout(timer);
      console.error(`[MOBILITY] module ${mod.name} failed:`, err);
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, { tags: { mobility_module: mod.name } });
      }
      // Continue with next module — do NOT abort whole cycle.
    }
  }

  const durationMs = Date.now() - startedAt;
  const suppressedTotal = Object.values(totalSuppressed).reduce(
    (a, b) => a + b,
    0,
  );
  emitJobRunMetrics({
    prefix: '[MOBILITY]',
    job: 'mobility-aggregation.job',
    fields: {
      points: totalScanned,
      aggregates: totalInserted,
      suppressed: suppressedTotal,
    },
    durationMs,
    leaseTtlMs: MOBILITY_LEASE_TTL_MS,
  });

  return {
    modules: AGGREGATOR_MODULES.length,
    scannedPoints: totalScanned,
    insertedRows: totalInserted,
    conflicts: totalConflicts,
    suppressedByTier: totalSuppressed,
    durationMs,
  };
}

export function startMobilityAggregationJob(): void {
  if (task) return;
  console.log(
    `[MOBILITY] Starting mobility aggregation cron (${MOBILITY_AGGREGATION_CRON})`,
  );
  task = cron.schedule(
    MOBILITY_AGGREGATION_CRON,
    async () => {
      if (running) return;
      running = true;
      try {
        // withJobLease, not the advisory xact lock: the nightly aggregation
        // runs for minutes, and the xact-lock variant would hold a
        // transaction (and a pooled connection) open for all of it. The
        // lease keeps the run single-runner across processes without an
        // open transaction.
        await withJobLease(
          'mobility-aggregation.job',
          MOBILITY_LEASE_TTL_MS,
          () => runMobilityAggregationOnce(),
        );
      } catch (err) {
        if (process.env.SENTRY_DSN) Sentry.captureException(err);
      } finally {
        running = false;
      }
    },
    { noOverlap: true },
  );
}

export function stopMobilityAggregationJob(): void {
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
