import * as Sentry from '@sentry/node';
import prisma from '../prisma';
import { firePreferenceChangeBatch } from '../services/payout.service';
import { withJobLock } from '../services/job-lock';

const TICK_MS = 60 * 1000;

// Pluggable for tests. Default fires the batch via the payout service.
type FireFn = (driverId: string) => Promise<void>;
let _fireImpl: FireFn | null = null;
export function _setFireImplForTests(fn: FireFn | null): void {
  _fireImpl = fn;
}

async function fireDeferredBatch(driverId: string): Promise<void> {
  if (_fireImpl) return _fireImpl(driverId);
  await firePreferenceChangeBatch(driverId, 'PREFERENCE_CHANGE');
}

/**
 * Durable replacement for the in-process setTimeout that used to schedule
 * post-cooldown preference-change payouts (a restart inside the 30-min
 * window lost the timer). The PayoutPreferenceChangeLog row itself is the
 * schedule: applyPreferenceChange writes payoutDueAt, and this scan fires
 * every due, not-yet-fired row. Anomaly-blocked rows have payoutDueAt null
 * and are never selected.
 */
export async function runPreferenceChangePayoutOnce(now: Date = new Date()): Promise<number> {
  const due = await prisma.payoutPreferenceChangeLog.findMany({
    where: {
      payoutFired: false,
      payoutDueAt: { not: null, lte: now },
    },
  });

  let fired = 0;
  for (const row of due) {
    try {
      await fireDeferredBatch(row.userId);
      await prisma.payoutPreferenceChangeLog.update({
        where: { id: row.id },
        data: { payoutFired: true },
      });
      fired++;
    } catch (err) {
      // Row stays payoutFired:false — the next tick retries it.
      console.error('[PREF-CHANGE-PAYOUT] Deferred payout failed for log', row.id, err);
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, { extra: { logId: row.id, userId: row.userId } });
      }
    }
  }
  return fired;
}

let intervalId: NodeJS.Timeout | null = null;

export function startPreferenceChangePayoutJob(): void {
  console.log('[PREF-CHANGE-PAYOUT] Starting deferred preference-change payout job (60s)');
  intervalId = setInterval(() => {
    // withJobLock: two processes scanning the same due rows would both fire
    // the batch before payoutFired flips — only the advisory-lock leader runs.
    withJobLock('preference-change-payout.job', () => runPreferenceChangePayoutOnce()).catch((err) => {
      console.error('[PREF-CHANGE-PAYOUT] Top-level tick failed:', err);
      if (process.env.SENTRY_DSN) Sentry.captureException(err);
    });
  }, TICK_MS);
}

export function stopPreferenceChangePayoutJob(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
