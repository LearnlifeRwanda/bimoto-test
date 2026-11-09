import * as Sentry from '@sentry/node';

// PAYOUT-F — one stable, parseable completion line per calendar-job run.
//
// The long calendar jobs (BNR monthly, mobility aggregation, GPS retention)
// answer "when do we outgrow this window" with data, not guesses: every run
// emits `<prefix> run complete: k=v ... durationMs=<n>`, mirrors the same
// fields onto a Sentry breadcrumb, and — the early tripwire that replaces
// the old hard 10-minute transaction cliff — raises a Sentry warning when
// the run took more than half its lease TTL.

/** Duration fraction of the lease TTL past which a run is flagged as slow. */
export const LEASE_TTL_WARN_FRACTION = 0.5;

export function emitJobRunMetrics(opts: {
  /** Log prefix, e.g. '[MOBILITY]'. */
  prefix: string;
  /** Lease name, e.g. 'mobility-aggregation.job' (tags the Sentry events). */
  job: string;
  /** Counter fields in display order; durationMs is appended last. */
  fields: Record<string, number | string>;
  durationMs: number;
  leaseTtlMs: number;
}): void {
  const { prefix, job, fields, durationMs, leaseTtlMs } = opts;
  const pairs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  console.log(`${prefix} run complete: ${pairs} durationMs=${durationMs}`);

  if (process.env.SENTRY_DSN) {
    Sentry.addBreadcrumb({
      category: 'job',
      message: `${job} run complete`,
      level: 'info',
      data: { ...fields, durationMs },
    });
  }

  if (durationMs > leaseTtlMs * LEASE_TTL_WARN_FRACTION) {
    console.warn(
      `${prefix} run took ${durationMs}ms — more than half the ${leaseTtlMs}ms lease TTL`,
    );
    if (process.env.SENTRY_DSN) {
      Sentry.captureMessage(`${job} run exceeded half its lease TTL`, {
        level: 'warning',
        tags: { job },
        extra: { ...fields, durationMs, leaseTtlMs },
      });
    }
  }
}
