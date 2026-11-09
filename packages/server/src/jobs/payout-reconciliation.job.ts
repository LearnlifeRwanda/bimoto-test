import * as Sentry from '@sentry/node';
import prisma from '../prisma';
import { markBatchPaidOut, markBatchFailed } from '../services/payout.service';
import { withJobLock } from '../services/job-lock';

const TICK_MS = 60 * 1000;
// Only act on rows the webhook has had a fair chance to settle.
const MIN_AGE_MS = 30 * 60 * 1000;
// A PENDING batch with no gateway transfer id after this long is lost —
// fail it so the funds stay visible in the driver balance (mirrors the
// escrow reconciler's gateway_lost_or_timeout handling).
const NO_TRANSFER_ID_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export interface TransferStatusLike {
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
}

// Pluggable for tests. Default fetches via the Flutterwave client.
type FetchStatusFn = (flwTransferId: string) => Promise<TransferStatusLike>;
let _fetchImpl: FetchStatusFn | null = null;
export function _setFetchTransferStatusForTests(fn: FetchStatusFn | null): void {
  _fetchImpl = fn;
}

async function fetchStatus(flwTransferId: string): Promise<TransferStatusLike> {
  if (_fetchImpl) return _fetchImpl(flwTransferId);
  // Lazy import so the job module stays safe to load without FLW keys.
  const { fetchTransferStatus } = await import('../services/payment');
  return fetchTransferStatus(flwTransferId);
}

async function reconcileSingleBatch(batch: any, now: Date): Promise<void> {
  if (!batch.flwTransferId) {
    const ageMs = now.getTime() - new Date(batch.createdAt).getTime();
    if (ageMs >= NO_TRANSFER_ID_TIMEOUT_MS) {
      await markBatchFailed(batch.id, 'gateway_lost_or_timeout');
      console.warn(
        `[PAYOUT-RECONCILE] Batch ${batch.id} had no transfer id for >24h; marked FAILED`,
      );
    }
    return;
  }

  let result: TransferStatusLike;
  try {
    result = await fetchStatus(batch.flwTransferId);
  } catch (err) {
    const { FlutterwaveError } = await import('../services/payment');
    if (err instanceof FlutterwaveError && err.code === 'NO_KEYS_CONFIGURED') {
      // Dev/test environment with no keys — nothing to reconcile.
      return;
    }
    throw err;
  }

  if (result.status === 'SUCCESS') {
    await markBatchPaidOut(batch.driverId, batch.id, batch.flwTransferId);
    console.log(`[PAYOUT-RECONCILE] Batch ${batch.id} settled as SUCCESS`);
    return;
  }

  if (result.status === 'FAILED') {
    await markBatchFailed(batch.id, 'gateway_reported_failure');
    console.warn(`[PAYOUT-RECONCILE] Batch ${batch.id} settled as FAILED`);
    return;
  }

  // PENDING — keep waiting; next tick will check again.
}

export async function runPayoutReconciliationOnce(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - MIN_AGE_MS);
  const pending = await prisma.driverPayoutBatch.findMany({
    where: {
      status: 'PENDING',
      held: false,
      createdAt: { lt: cutoff },
    },
  });

  for (const batch of pending) {
    try {
      await reconcileSingleBatch(batch, now);
    } catch (err) {
      console.error(`[PAYOUT-RECONCILE] Failed for batch ${batch.id}:`, err);
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, { extra: { batchId: batch.id } });
      }
      // Continue iterating — one row's failure must not block siblings.
    }
  }
}

let intervalId: NodeJS.Timeout | null = null;

export function startPayoutReconciliationJob(): void {
  console.log('[PAYOUT-RECONCILE] Starting payout reconciliation job (60s, rows >30min old)');
  intervalId = setInterval(() => {
    // withJobLock: only the advisory-lock leader runs the tick when
    // overlapping server processes race (deploy, scale-out).
    withJobLock('payout-reconciliation.job', () => runPayoutReconciliationOnce()).catch((err) => {
      console.error('[PAYOUT-RECONCILE] Top-level tick failed:', err);
      if (process.env.SENTRY_DSN) Sentry.captureException(err);
    });
  }, TICK_MS);
}

export function stopPayoutReconciliationJob(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
