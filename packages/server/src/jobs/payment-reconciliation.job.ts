import * as Sentry from '@sentry/node';
import prisma from '../prisma';
import { reconcileSinglePending } from './payment-reconciliation/reconcile-pending';
import { withJobLock } from '../services/job-lock';

const TICK_MS = 30 * 1000;
const MIN_AGE_MS = 30 * 1000;

async function runOnce(): Promise<void> {
  const cutoff = new Date(Date.now() - MIN_AGE_MS);
  const pending = await prisma.escrow.findMany({
    where: {
      status: 'PENDING',
      createdAt: { lt: cutoff },
    },
    select: { id: true, txRef: true, lastChargeAttemptAt: true },
  });

  for (const row of pending) {
    try {
      await reconcileSinglePending(row);
    } catch (err) {
      console.error(`[RECONCILE] Failed for escrow ${row.id}:`, err);
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, { extra: { escrowId: row.id } });
      }
      // Continue iterating — one row's failure must not block siblings.
    }
  }
}

let intervalId: NodeJS.Timeout | null = null;

export function startPaymentReconciliationJob(): void {
  console.log('[PAYMENT-RECONCILE] Starting payment reconciliation job (30s)');
  intervalId = setInterval(() => {
    // withJobLock: only the advisory-lock leader runs the tick when
    // overlapping server processes race (deploy, scale-out).
    withJobLock('payment-reconciliation.job', () => runOnce()).catch((err) => {
      console.error('[PAYMENT-RECONCILE] Top-level tick failed:', err);
      if (process.env.SENTRY_DSN) Sentry.captureException(err);
    });
  }, TICK_MS);
}

export function stopPaymentReconciliationJob(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export { runOnce as runPaymentReconciliationOnce };
