import * as Sentry from '@sentry/node';
import {
  getPendingPastFallback,
  firePreferenceChangeBatch,
} from '../services/payout.service';
import { withJobLock } from '../services/job-lock';

const TICK_MS = 60 * 60 * 1000; // hourly
const MAX_AGE_HOURS = 24;

export async function runFallbackPayoutOnce(now: Date = new Date()): Promise<void> {
  void now;
  const stale = await getPendingPastFallback(MAX_AGE_HOURS);
  if (stale.length === 0) return;

  for (const { driverId } of stale) {
    if (process.env.SENTRY_DSN) {
      Sentry.addBreadcrumb({
        category: 'payout-fallback',
        message: `firing FALLBACK_24H for ${driverId}`,
        level: 'warning',
      });
    }
    try {
      await firePreferenceChangeBatch(driverId, 'FALLBACK_24H');
    } catch (err) {
      console.error(`[FALLBACK] Driver ${driverId} payout failed:`, err);
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, { extra: { driverId, trigger: 'FALLBACK_24H' } });
      }
    }
  }
}

let intervalId: NodeJS.Timeout | null = null;

export function startPayoutFallbackJob(): void {
  console.log('[FALLBACK] Starting hourly payout fallback job (24h universal safety net)');
  intervalId = setInterval(() => {
    // withJobLock: this job has no DB idempotency row at all, so with
    // overlapping server processes only the advisory-lock leader may run.
    withJobLock('payout-fallback.job', () => runFallbackPayoutOnce()).catch((err) => {
      console.error('[FALLBACK] Top-level tick failed:', err);
      if (process.env.SENTRY_DSN) Sentry.captureException(err);
    });
  }, TICK_MS);
}

export function stopPayoutFallbackJob(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function _resetForTests(): void {
  // No internal state — provided for symmetry with other jobs.
}
