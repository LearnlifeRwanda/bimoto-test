import * as Sentry from '@sentry/node';
import { decryptedPhone } from '../services/user-phone';
import prisma from '../prisma';
import {
  getPendingDriverPayouts,
  getPendingForCohort,
  createPendingBatch,
  markBatchPaidOut,
  markBatchFailed,
  PayoutPreference,
  PayoutBatchTrigger,
} from '../services/payout.service';
import { transferToWallet, FlutterwaveError } from '../services/payment';
import { assertAmlCheck, AmlError } from '../services/aml';
import { withJobLock } from '../services/job-lock';
import { kigaliDateKey, kigaliHour, kigaliStartOfDay } from '../utils/kigali-time';

const TICK_MS = 60 * 1000;
const PAYOUT_HOUR = 22;

let lastRunDate: string | null = null;

export async function runPayoutOnce(
  now: Date = new Date(),
  cohort?: PayoutPreference,
): Promise<void> {
  const todayKey = kigaliDateKey(now);
  const hour = kigaliHour(now);

  if (hour < PAYOUT_HOUR) return;
  if (lastRunDate === todayKey) return;

  // Check the DB for an already-completed run today (handles server restart
  // mid-day after a partial run earlier). "Today" is the Kigali day, matching
  // the hour we schedule on — a UTC midnight cutoff would misalign by 2h.
  const startOfDay = kigaliStartOfDay(now);
  const existingTodayRun = await prisma.driverPayoutBatch.findFirst({
    where: {
      createdAt: { gte: startOfDay },
      trigger: 'SCHEDULED_22H',
    },
  });
  if (existingTodayRun && lastRunDate !== todayKey) {
    // Another run already wrote a batch today — mark today done locally and
    // exit. Avoids double-paying after a process restart.
    lastRunDate = todayKey;
    return;
  }

  const pending = cohort
    ? await getPendingForCohort(cohort)
    : await getPendingDriverPayouts();
  if (pending.length === 0) {
    lastRunDate = todayKey;
    return;
  }

  const trigger: PayoutBatchTrigger = 'SCHEDULED_22H';

  for (const { driverId, amount } of pending) {
    // Pre-payout AML hard-cap: a breach skips this driver and writes a
    // CRITICAL flag for admin review; sibling payouts continue.
    try {
      await assertAmlCheck({
        userId: driverId,
        amount,
        action: 'PAYOUT',
        metadata: { trigger, source: 'daily-job' },
      });
    } catch (err) {
      if (err instanceof AmlError) {
        console.warn(`[PAYOUT] AML hard-cap on driver ${driverId}; skipping`);
        continue;
      }
      throw err;
    }

    const txRef = `bimoto-payout-${driverId.slice(0, 8)}-${todayKey}`;
    let batchId: string | null = null;
    try {
      const batch = await createPendingBatch(driverId, amount, txRef, trigger);
      batchId = batch.id;

      const driver = await prisma.user.findUnique({ where: { id: driverId } });
      if (!driver) {
        await markBatchFailed(batchId, 'driver_not_found');
        continue;
      }

      const transfer = await transferToWallet({
        // The MoMo account_number IS this number — ciphertext here is a
        // payout that can never land.
        phone: decryptedPhone(driver),
        amount,
        narration: `Bimoto driver payout ${todayKey}`,
        reference: txRef,
      });

      if (transfer.flwTransferId) {
        await markBatchPaidOut(driverId, batchId, transfer.flwTransferId);
      }
      // PENDING transfers stay as PENDING DriverPayoutBatch rows; the
      // transfer.completed webhook or payout-reconciliation.job resolves them.
    } catch (err) {
      const code = err instanceof FlutterwaveError ? err.code : 'UNKNOWN';
      console.error(`[PAYOUT] Driver ${driverId} failed:`, err);
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, { extra: { driverId } });
      }
      if (batchId) {
        await markBatchFailed(batchId, code);
      }
      // Continue iterating — one driver's failure must not block siblings.
    }
  }

  lastRunDate = todayKey;
}

let intervalId: NodeJS.Timeout | null = null;

export function startPayoutJob(): void {
  console.log(
    '[PAYOUT] Starting daily payout job (60s tick, 22:00 Africa/Kigali, cohort=DAILY_22H)',
  );
  intervalId = setInterval(() => {
    // 22:00 job only handles drivers who explicitly chose DAILY_22H.
    // AT_SHIFT_END / TWICE_DAILY drivers are paid by twice-daily-payout.job
    // and via the /api/payout/end-shift endpoint. payout-fallback.job catches
    // anyone unpaid past 24h regardless of preference.
    // withJobLock: with overlapping server processes, only the advisory-lock
    // leader runs the tick — the in-memory lastRunDate dedupe is per-process.
    withJobLock('payout.job', () => runPayoutOnce(new Date(), 'DAILY_22H')).catch((err) => {
      console.error('[PAYOUT] Top-level tick failed:', err);
      if (process.env.SENTRY_DSN) Sentry.captureException(err);
    });
  }, TICK_MS);
}

export function stopPayoutJob(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function _resetForTests(): void {
  lastRunDate = null;
}
