// R3-RECIPIENT-CONFIRM-2 — auto-confirm timeout for recipient acknowledgements.
//
// R3-RECIPIENT-CONFIRM wires the SMS-reply confirmation loop: when a parcel
// recipient SMS-replies a confirmation keyword, the leg's
// recipientConfirmedAt is stamped and the customer sees the green badge.
// What that dispatch did NOT solve: recipients who simply don't reply.
// The customer would be left in indefinite "no confirmation" state — the
// exact burden R3-RECIPIENT-CONFIRM was supposed to remove.
//
// This cron closes that gap. Every hour it scans for GOODS_DROPOFF legs
// that completed more than 24 hours ago without a recipient reply, and
// stamps recipientConfirmedAt = NOW(), recipientConfirmStatus = AUTO_TIMEOUT.
// The customer-side UI renders an amber badge so the state is visually
// distinct from an explicit confirmation.
//
// Pairs with the recipient-dispute SMS handler (R3-RECIPIENT-CONFIRM-2)
// for the third state (DISPUTED). Together the three states give the
// customer guaranteed feedback within 24h.

import * as Sentry from '@sentry/node';
import prisma from '../prisma';
import { withJobLock } from '../services/job-lock';

const TIMEOUT_HOURS = 24;
const POLL_INTERVAL_MS = 60 * 60 * 1000;

let intervalId: NodeJS.Timeout | null = null;

/**
 * Find GOODS_DROPOFF legs that completed more than TIMEOUT_HOURS ago,
 * had a contactPhone (so the recipient was actually SMS-notified by
 * R3-DELIVERY-NOTIFICATIONS), and have no recipient acknowledgement yet.
 * Stamp recipientConfirmedAt + recipientConfirmStatus=AUTO_TIMEOUT on
 * each match in a single batched updateMany. Returns the number of legs
 * auto-confirmed.
 */
export async function processAutoConfirmRecipient(
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - TIMEOUT_HOURS * 60 * 60 * 1000);
  const candidates = await prisma.leg.findMany({
    where: {
      type: 'GOODS_DROPOFF',
      status: 'COMPLETED',
      recipientConfirmedAt: null,
      contactPhone: { not: null },
      completedAt: { lt: cutoff, not: null },
    },
    select: { id: true },
  });
  if (candidates.length === 0) return 0;

  await prisma.leg.updateMany({
    where: { id: { in: candidates.map((c) => c.id) } },
    data: {
      recipientConfirmedAt: now,
      recipientConfirmStatus: 'AUTO_TIMEOUT',
    },
  });

  console.log(
    `[AUTO-CONFIRM-RECIPIENT] Auto-confirmed ${candidates.length} GOODS_DROPOFF legs after ${TIMEOUT_HOURS}h timeout`,
  );
  return candidates.length;
}

export function startAutoConfirmRecipientJob() {
  if (intervalId) return;
  console.log(
    `[AUTO-CONFIRM-RECIPIENT] Starting auto-confirm-recipient job (every ${POLL_INTERVAL_MS / 1000}s, ${TIMEOUT_HOURS}h timeout)`,
  );
  // withJobLock: only the advisory-lock leader runs the tick when
  // overlapping server processes race (deploy, scale-out).
  intervalId = setInterval(async () => {
    try {
      await withJobLock('auto-confirm-recipient.job', () => processAutoConfirmRecipient());
    } catch (err) {
      Sentry.captureException(err, { tags: { job: 'auto-confirm-recipient' } });
      console.error('[AUTO-CONFIRM-RECIPIENT] iteration failed', err);
    }
  }, POLL_INTERVAL_MS);
  // Run once at boot.
  withJobLock('auto-confirm-recipient.job', () => processAutoConfirmRecipient()).catch((err) => {
    Sentry.captureException(err, { tags: { job: 'auto-confirm-recipient' } });
    console.error('[AUTO-CONFIRM-RECIPIENT] initial run failed', err);
  });
}

export function stopAutoConfirmRecipientJob() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
