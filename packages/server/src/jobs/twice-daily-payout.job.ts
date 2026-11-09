import * as Sentry from '@sentry/node';
import prisma from '../prisma';
import {
  getPendingForCohort,
  firePreferenceChangeBatch,
  PayoutBatchTrigger,
} from '../services/payout.service';
import { withJobLock } from '../services/job-lock';
import { kigaliDateKey, kigaliHour, kigaliStartOfDay } from '../utils/kigali-time';

const TICK_MS = 60 * 1000;
const WINDOWS: Array<{ hour: number; trigger: PayoutBatchTrigger }> = [
  { hour: 6, trigger: 'SCHEDULED_06' },
  { hour: 18, trigger: 'SCHEDULED_18' },
];

// Track last completion per (date, hour) to avoid double-firing inside the
// same window across ticks.
const lastRunKeys = new Set<string>();

export async function runTwiceDailyPayoutOnce(now: Date = new Date()): Promise<void> {
  const hour = kigaliHour(now);
  const dateKey = kigaliDateKey(now);
  const window = WINDOWS.find((w) => hour >= w.hour && hour < w.hour + 1);
  if (!window) return;

  const runKey = `${dateKey}:${window.hour}`;
  if (lastRunKeys.has(runKey)) return;

  // DB-side idempotency for restart safety. "Today" is the Kigali day,
  // matching the hours we schedule on — a UTC midnight cutoff would misalign
  // by 2h.
  const startOfDay = kigaliStartOfDay(now);
  const existing = await prisma.driverPayoutBatch.findFirst({
    where: { createdAt: { gte: startOfDay }, trigger: window.trigger },
  });
  if (existing) {
    lastRunKeys.add(runKey);
    return;
  }

  const pending = await getPendingForCohort('TWICE_DAILY');
  for (const { driverId } of pending) {
    try {
      await firePreferenceChangeBatch(driverId, window.trigger);
    } catch (err) {
      console.error(`[TWICE-DAILY] Driver ${driverId} payout failed:`, err);
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, { extra: { driverId, window: window.trigger } });
      }
    }
  }

  lastRunKeys.add(runKey);
}

let intervalId: NodeJS.Timeout | null = null;

export function startTwiceDailyPayoutJob(): void {
  console.log('[TWICE-DAILY] Starting twice-daily payout job (06:00 + 18:00 Africa/Kigali)');
  intervalId = setInterval(() => {
    // withJobLock: with overlapping server processes, only the advisory-lock
    // leader runs the tick — the in-memory lastRunKeys dedupe is per-process.
    withJobLock('twice-daily-payout.job', () => runTwiceDailyPayoutOnce()).catch((err) => {
      console.error('[TWICE-DAILY] Top-level tick failed:', err);
      if (process.env.SENTRY_DSN) Sentry.captureException(err);
    });
  }, TICK_MS);
}

export function stopTwiceDailyPayoutJob(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function _resetForTests(): void {
  lastRunKeys.clear();
}
