/**
 * R3-N-2 — auto-timeout cron for stranded MATCHED journeys.
 *
 * Runs every 60 s. Two passes per tick:
 *
 *   1. Reminder pass — find MATCHED journeys with startedAt:null whose
 *      matchedAt is older than NO_SHOW_REMINDER_THRESHOLD_MIN (default
 *      20 min) and noShowReminderSentAt:null. Send the rideNotStarted
 *      push to both customer and driver, then set
 *      noShowReminderSentAt so the next tick does not re-push.
 *
 *   2. Auto-cancel pass — find MATCHED journeys with startedAt:null
 *      whose matchedAt is older than NO_SHOW_AUTO_CANCEL_THRESHOLD_MIN
 *      (default 30 min). For each, derive the CancelReason from GPS
 *      evidence (see deriveAttribution), refund escrow, transition the
 *      journey to CANCELLED with the derived reason, run
 *      applyCancelAttribution inside a transaction, and emit
 *      journey-cancelled to both parties' sockets.
 *
 * Why not call cancelJourney(id, userId, reason)? Because that
 * function rejects BOTH_NO_SHOW (R3-N-1's BOTH_NO_SHOW_IS_SYSTEM_ONLY
 * guard) and requires the caller to be customer or driver. The system
 * is neither, so the cron implements the cancel path inline — same
 * pattern as auto-confirm.job.ts.
 */

import prisma from '../prisma';
import { CancelReason } from '@prisma/client';
import {
  JourneyStatus,
  JourneyAction,
  transitionJourney,
  SOCKET_EVENTS,
} from '@bimoto/shared';
import {
  applyCancelAttribution,
  dispatchDriverPenaltyPush,
} from '../services/journey.service';
import type { DriverPenaltyOutcome } from '../services/driver-penalty';
import * as escrowService from '../services/escrow.service';
import { notifyRideNotStarted } from '../services/notification.service';
import { emitToJourney } from '../socket';
import { haversineDistance } from '../utils/geo';
import { withJobLock } from '../services/job-lock';

const NO_SHOW_REMINDER_THRESHOLD_MIN = parseInt(
  process.env.NO_SHOW_REMINDER_THRESHOLD_MIN ?? '20',
  10,
);
const NO_SHOW_AUTO_CANCEL_THRESHOLD_MIN = parseInt(
  process.env.NO_SHOW_AUTO_CANCEL_THRESHOLD_MIN ?? '30',
  10,
);

// GPS thresholds for the auto-cancel attribution derivation. These
// match §B.3 of the dispatch and the design spec §1.5; the helper
// itself is single-use here so the constants live next to it.
const GPS_PICKUP_PROXIMITY_M = 50;
const GPS_NEVER_NEAR_PICKUP_M = 500;
const GPS_RECENT_BROADCAST_MIN = 10;

let intervalId: NodeJS.Timeout | null = null;

/**
 * Pass 1: 20-min reminder for journeys in MATCHED with no Start tap.
 * Idempotency enforced via noShowReminderSentAt.
 */
async function processNoShowReminders(now: Date) {
  const reminderCutoff = new Date(
    now.getTime() - NO_SHOW_REMINDER_THRESHOLD_MIN * 60 * 1000,
  );
  const journeys = await prisma.journey.findMany({
    where: {
      status: JourneyStatus.MATCHED,
      startedAt: null,
      matchedAt: { lt: reminderCutoff },
      noShowReminderSentAt: null,
    },
    select: {
      id: true,
      customerId: true,
      driverId: true,
    },
  });

  for (const j of journeys) {
    try {
      notifyRideNotStarted(j.customerId, j.id);
      if (j.driverId) {
        notifyRideNotStarted(j.driverId, j.id);
      }
      await prisma.journey.update({
        where: { id: j.id },
        data: { noShowReminderSentAt: now },
      });
    } catch (err) {
      console.error(`[NO-SHOW-TIMEOUT] reminder for ${j.id} failed:`, err);
    }
  }

  if (journeys.length > 0) {
    console.log(`[NO-SHOW-TIMEOUT] Sent ${journeys.length} reminders`);
  }
}

/**
 * Derive the attribution reason from GPS evidence.
 *
 * Decision logic (per design spec §1.5):
 *   - No GPS broadcast at all → DRIVER_NO_SHOW (silence is strongest signal)
 *   - GPS within 50 m of pickup AND broadcast in last 10 min →
 *     CUSTOMER_NO_SHOW (driver was at pickup, customer absent)
 *   - GPS never within 500 m of pickup AND broadcast > 10 min ago →
 *     DRIVER_NO_SHOW (driver was nowhere near, then went silent)
 *   - Otherwise → BOTH_NO_SHOW (mixed/insufficient signals)
 */
async function deriveAttribution(
  journeyId: string,
  pickupLat: number,
  pickupLng: number,
  now: Date,
): Promise<CancelReason> {
  const latestPoint = await prisma.gpsPoint.findFirst({
    where: { journeyId },
    orderBy: { timestamp: 'desc' },
  });

  if (!latestPoint) {
    return CancelReason.DRIVER_NO_SHOW;
  }

  const distMeters =
    haversineDistance(latestPoint.lat, latestPoint.lng, pickupLat, pickupLng) *
    1000;
  const recentCutoff = new Date(
    now.getTime() - GPS_RECENT_BROADCAST_MIN * 60 * 1000,
  );
  const broadcastIsRecent = latestPoint.timestamp > recentCutoff;

  if (distMeters < GPS_PICKUP_PROXIMITY_M && broadcastIsRecent) {
    return CancelReason.CUSTOMER_NO_SHOW;
  }
  if (distMeters > GPS_NEVER_NEAR_PICKUP_M && !broadcastIsRecent) {
    return CancelReason.DRIVER_NO_SHOW;
  }
  return CancelReason.BOTH_NO_SHOW;
}

/**
 * Pass 2: 30-min system-derived auto-cancel.
 */
async function processNoShowAutoCancel(now: Date) {
  const cancelCutoff = new Date(
    now.getTime() - NO_SHOW_AUTO_CANCEL_THRESHOLD_MIN * 60 * 1000,
  );
  const journeys = await prisma.journey.findMany({
    where: {
      status: JourneyStatus.MATCHED,
      startedAt: null,
      matchedAt: { lt: cancelCutoff },
    },
    include: { escrow: true },
  });

  for (const journey of journeys) {
    try {
      const reason = await deriveAttribution(
        journey.id,
        journey.pickupLat,
        journey.pickupLng,
        now,
      );

      // Refund escrow first. refundEscrow runs its own internal
      // $transaction (escrow row + audit log); calling it before the
      // attribution tx mirrors R3-N-1's documented deviation and avoids
      // nested Prisma transactions.
      if (journey.escrow) {
        await escrowService
          .refundEscrow(journey.id, 'SYSTEM')
          .catch((err) => {
            console.error(
              `[NO-SHOW-TIMEOUT] refund failed for ${journey.id}:`,
              err,
            );
          });
      }

      // Atomic state transition + cancelReason + attribution. Reuses
      // the same state-machine transition cancelJourney uses.
      const nextStatus = transitionJourney(
        journey.status as JourneyStatus,
        JourneyAction.CANCEL,
      );

      let penaltyOutcome: DriverPenaltyOutcome | null = null;
      await prisma.$transaction(async (tx: any) => {
        await tx.journey.update({
          where: { id: journey.id },
          data: {
            status: nextStatus,
            cancelledAt: now,
            cancelReason: reason,
          },
        });
        penaltyOutcome = await applyCancelAttribution(
          tx,
          { customerId: journey.customerId, driverId: journey.driverId },
          reason,
          'SYSTEM',
        );
      });

      // R3-N-4 — graduated penalty push fires post-commit.
      dispatchDriverPenaltyPush(penaltyOutcome, journey.id);

      emitToJourney(journey.id, SOCKET_EVENTS.JOURNEY_CANCELLED, {
        journeyId: journey.id,
        status: nextStatus,
        cancelReason: reason,
        cancelledAt: now.toISOString(),
        triggeredBy: 'system',
      });

      console.log(
        `[NO-SHOW-TIMEOUT] Auto-cancelled ${journey.id} with reason ${reason}`,
      );
    } catch (err) {
      console.error(
        `[NO-SHOW-TIMEOUT] Error auto-cancelling journey ${journey.id}:`,
        err,
      );
    }
  }

  if (journeys.length > 0) {
    console.log(`[NO-SHOW-TIMEOUT] Auto-cancelled ${journeys.length} journeys`);
  }
}

export async function processNoShowTimeout() {
  try {
    const now = new Date();
    await processNoShowReminders(now);
    await processNoShowAutoCancel(now);
  } catch (err) {
    console.error('[NO-SHOW-TIMEOUT] Error in processNoShowTimeout:', err);
  }
}

export function startNoShowTimeoutJob() {
  console.log('[NO-SHOW-TIMEOUT] Starting (every 60s)');
  // withJobLock: only the advisory-lock leader runs the tick when
  // overlapping server processes race (deploy, scale-out).
  intervalId = setInterval(() => {
    withJobLock('no-show-timeout.job', processNoShowTimeout).catch((err) => {
      console.error('[NO-SHOW-TIMEOUT] Top-level tick failed:', err);
    });
  }, 60 * 1000);
  // Run once immediately on boot.
  withJobLock('no-show-timeout.job', processNoShowTimeout).catch((err) => {
    console.error('[NO-SHOW-TIMEOUT] Top-level tick failed:', err);
  });
}

export function stopNoShowTimeoutJob() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
