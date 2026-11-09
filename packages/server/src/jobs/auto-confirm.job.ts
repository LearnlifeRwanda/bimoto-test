import prisma from '../prisma';
import { decryptedPhoneOrNull } from '../services/user-phone';
import { notifyEscrowReleased } from '../services/notification.service';
import {
  AUTO_CONFIRM_MINUTES,
  DISPUTE_WINDOW_HOURS,
  JourneyStatus,
  JourneyAction,
  transitionJourney,
  EscrowStatus,
  SOCKET_EVENTS,
} from '@bimoto/shared';
import { emitToJourney } from '../socket';
import { appendAuditEntry, appendAuditEntryTx } from '../services/escrow-audit.service';
import { releaseEscrowTx } from '../services/escrow.service';
import { validateJourneyPlausibility } from '../services/journey-validation.service';
import { withJobLock } from '../services/job-lock';
import * as smsService from '../services/sms.service';

let intervalId: NodeJS.Timeout | null = null;

const REMINDER_THRESHOLD_MS = 12 * 60 * 60 * 1000;

export async function processAutoConfirm() {
  try {
    const now = new Date();
    const confirmThreshold = new Date(now.getTime() - AUTO_CONFIRM_MINUTES * 60 * 1000);

    // Three branches:
    //   - Normal rows (no flags): existing 2h auto-confirm path.
    //   - customerInitiatedCompletion=true rows: auto-confirm at dueAt.
    //   - lateCompletion=true rows: auto-confirm at dueAt.
    // Silence is treated as consent across all three branches; admin
    // queue is reached only via the existing /dispute endpoint.
    const journeys = await prisma.journey.findMany({
      where: {
        status: JourneyStatus.AWAITING_CONFIRMATION,
        OR: [
          {
            customerInitiatedCompletion: false,
            lateCompletion: false,
            endedAt: { lt: confirmThreshold },
          },
          {
            customerInitiatedCompletion: true,
            dueAt: { lt: now },
          },
          {
            lateCompletion: true,
            dueAt: { lt: now },
          },
        ],
      },
      include: { escrow: true },
    });

    for (const journey of journeys) {
      try {
        const nextStatus = transitionJourney(
          journey.status as JourneyStatus,
          JourneyAction.AUTO_CONFIRM,
        );

        const autoConfirmedSource = journey.customerInitiatedCompletion
          ? 'customerInitiated'
          : journey.lateCompletion
          ? 'lateCompletion'
          : 'normal';

        // Run plausibility check before releasing escrow
        //
        // MONEY-ATOMIC-2 — this diagnostic stays OUTSIDE the settlement
        // transaction below, and now runs before it opens. It is
        // best-effort by design (the swallow is the point: a diagnostic
        // failure may not roll back a settlement), and running it ahead of
        // the transaction means a RELEASED_WITH_FLAGS entry is never
        // recorded for a settlement that then rolled back. Same treatment
        // as the identical check in confirmJourney.
        if (journey.escrow) {
          try {
            const validation = await validateJourneyPlausibility(journey.id);
            if (!validation.valid) {
              await appendAuditEntry(journey.escrow.id, 'RELEASED_WITH_FLAGS', journey.escrow.amount, 'SYSTEM', {
                flags: validation.flags,
                rawDistanceKm: validation.rawDistanceKm,
                cleanedDistanceKm: validation.cleanedDistanceKm,
                expectedDistanceKm: validation.expectedDistanceKm,
                gpsPointCount: validation.gpsPointCount,
                outlierCount: validation.outlierCount,
              });
            }
          } catch {
            // Don't block auto-confirm if plausibility check fails
          }
        }

        // MONEY-ATOMIC-2 — one transaction PER JOURNEY, spanning everything
        // that settles this one: the CONFIRMED stamp, the AUTO_CONFIRM
        // audit entry, the escrow release (MONEY MOVES) and both
        // completedRides counters.
        //
        // The release was already transactional here, but the transaction
        // was too NARROW: it covered the release alone. The status stamp
        // committed before it and the counters after it, so a failure
        // anywhere in between left a terminally CONFIRMED journey with the
        // escrow still HELD or the counters unmoved — and because the sweep
        // above filters `status: AWAITING_CONFIRMATION`, no later tick ever
        // revisits that journey. On the silence-is-consent path, which is
        // how most journeys settle, that is a driver who is simply never
        // paid.
        //
        // Per journey, NOT per batch: one bad journey must roll back only
        // itself. Its status stays AWAITING_CONFIRMATION so the next tick
        // retries it, and the loop continues to the next journey — the same
        // retry semantics as the journey-expiry sweep.
        //
        // Composed, not re-implemented: releaseEscrowTx (already used here)
        // and appendAuditEntryTx are the tx-accepting variants, so the
        // audit entry joins the settlement rather than preceding it
        // unprotected.
        // NOTIFY G3 — the release info comes OUT of the transaction
        // rather than being captured in a closure variable, so it is
        // typed and so it can only be read once the unit has committed.
        const releasedTo = await prisma.$transaction(async (tx: any) => {
          let released: { driverId: string; driverPayout: number } | null = null;
          await tx.journey.update({
            where: { id: journey.id },
            data: {
              status: nextStatus,
              confirmedAt: new Date(),
            },
          });

          if (journey.escrow && autoConfirmedSource !== 'normal') {
            await appendAuditEntryTx(tx, journey.escrow.id, 'AUTO_CONFIRM', journey.escrow.amount, 'SYSTEM', {
              autoConfirmedSource,
              ...(autoConfirmedSource === 'customerInitiated'
                ? { driverDidNotDispute: true }
                : { customerDidNotDispute: true }),
            });
          }

          // Release escrow through the canonical settlement path — the same
          // releaseEscrowTx the manual confirm runs, so silence-is-consent
          // settles identically by construction: escrow → RELEASED, audit
          // entry, totalRides, completedShifts, and the driver balance credit.
          // settledVia marks the audit entry as fully settled, distinguishing
          // it from pre-G1 inline releases that skipped the credit.
          // The HELD guard stays: an escrow settled by some other path is
          // not released twice (releaseEscrowTx's own status predicate is
          // the second line of that defence).
          if (journey.escrow && journey.escrow.status === EscrowStatus.HELD) {
            const claimed = await releaseEscrowTx(tx, journey.escrow, 'SYSTEM', {
              settledVia: 'releaseEscrowTx',
              autoConfirmedSource,
            });
            // NOTIFY G3 — captured for the post-commit announcement. Null
            // means another path already claimed this release; one payment
            // must not produce two "you were paid" messages.
            if (claimed) {
              released = {
                driverId: journey.escrow.driverId,
                driverPayout: journey.escrow.driverPayout,
              };
            }
          }

          // Increment completedRides for both users
          await tx.user.update({
            where: { id: journey.customerId },
            data: { completedRides: { increment: 1 } },
          });

          if (journey.driverId) {
            await tx.user.update({
              where: { id: journey.driverId },
              data: { completedRides: { increment: 1 } },
            });
          }

          return released;
        });

        // Only once the unit has committed: nothing announces a settlement
        // that rolled back.
        emitToJourney(journey.id, SOCKET_EVENTS.JOURNEY_AUTO_CONFIRMED, {
          journeyId: journey.id,
          status: nextStatus,
        });

        // NOTIFY G3 — silence-is-consent pays a motari exactly like a
        // manual confirm does, so it has to TELL him exactly like one.
        // This is the path most pilot payments actually take: a passenger
        // who walks away without tapping Confirm still owes the money, and
        // until now the driver learned it had arrived by checking his
        // balance.
        if (releasedTo) {
          notifyEscrowReleased(releasedTo.driverId, journey.id, releasedTo.driverPayout);
        }
      } catch (error) {
        // The whole unit rolled back, so this journey is still
        // AWAITING_CONFIRMATION and the next tick will try it again. The
        // loop continues to the next journey rather than abandoning the
        // sweep.
        console.error(
          `[AUTO-CONFIRM] Error auto-confirming journey ${journey.id} — rolled back, left AWAITING_CONFIRMATION for retry:`,
          error,
        );
      }
    }

    if (journeys.length > 0) {
      console.log(`[AUTO-CONFIRM] Auto-confirmed ${journeys.length} journeys`);
    }

    await processFlaggedRowReminders(now);
  } catch (error) {
    console.error('[AUTO-CONFIRM] Error processing auto-confirm:', error);
  }
}

/**
 * 12-hour SMS reminder for flagged AWAITING_CONFIRMATION rows. Sends one
 * SMS to the silent party (customerInitiated -> driver SMS, lateCompletion
 * -> customer SMS), then sets lastReminderSentAt for idempotency.
 */
async function processFlaggedRowReminders(now: Date) {
  const reminderCutoff = new Date(now.getTime() - REMINDER_THRESHOLD_MS);
  const candidates = await prisma.journey.findMany({
    where: {
      status: JourneyStatus.AWAITING_CONFIRMATION,
      endedAt: { lt: reminderCutoff },
      lastReminderSentAt: null,
      OR: [{ customerInitiatedCompletion: true }, { lateCompletion: true }],
    },
    include: {
      customer: { select: { phoneEncrypted: true } },
      driver: { select: { phoneEncrypted: true } },
    },
  });

  for (const j of candidates) {
    try {
      // GROUNDSKEEPER G5 — was `24 * 60 * 60 * 1000` inline. The value
      // agrees with DISPUTE_WINDOW_HOURS, which is what this fallback
      // means; two places holding the same number is how they stop
      // agreeing.
      const dueAtMs = j.dueAt
        ? j.dueAt.getTime()
        : (j.endedAt?.getTime() ?? now.getTime()) + DISPUTE_WINDOW_HOURS * 60 * 60 * 1000;
      const hoursLeft = Math.max(0, Math.round((dueAtMs - now.getTime()) / (60 * 60 * 1000)));
      const targetPhone = decryptedPhoneOrNull(
        j.customerInitiatedCompletion ? j.driver : j.customer,
      );
      if (!targetPhone) continue;
      const text = `Your ride to ${j.destinationName} is awaiting your action. Tap Confirm or Dispute in the app, or it will auto-settle in ${hoursLeft}h. Reply 1 to confirm complete, 2 to dispute.`;
      await smsService.sendSms(targetPhone, text);
      await prisma.journey.update({
        where: { id: j.id },
        data: { lastReminderSentAt: now },
      });
    } catch (error) {
      console.error(`[AUTO-CONFIRM] reminder send failed for ${j.id}:`, error);
    }
  }
}

async function processEscrowEscalation() {
  try {
    const frozenThreshold = new Date(Date.now() - 72 * 60 * 60 * 1000);

    const frozenEscrows = await prisma.escrow.findMany({
      where: { status: 'FROZEN' },
      include: {
        auditLog: {
          where: { action: 'FROZEN' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    for (const escrow of frozenEscrows) {
      const frozenEntry = escrow.auditLog[0];
      if (!frozenEntry) continue;

      if (frozenEntry.createdAt < frozenThreshold) {
        const alreadyEscalated = await prisma.escrowAuditLog.findFirst({
          where: { escrowId: escrow.id, action: 'ESCALATED' },
        });
        if (alreadyEscalated) continue;

        console.warn(`[ESCALATION] Escrow ${escrow.id} frozen since ${frozenEntry.createdAt.toISOString()}. Needs manual resolution.`);
        await appendAuditEntry(escrow.id, 'ESCALATED', escrow.amount, 'SYSTEM', {
          reason: 'frozen_72h_timeout',
          frozenSince: frozenEntry.createdAt.toISOString(),
        });
      }
    }
  } catch (error) {
    console.error('[ESCALATION] Error processing escrow escalation:', error);
  }
}

export function startAutoConfirmJob() {
  console.log('[AUTO-CONFIRM] Starting auto-confirm job (every 60s)');
  // withJobLock: only the advisory-lock leader runs the tick when
  // overlapping server processes race (deploy, scale-out). One lock covers
  // both phases so they stay sequential on a single leader.
  const tick = () =>
    withJobLock('auto-confirm.job', async () => {
      await processAutoConfirm();
      await processEscrowEscalation();
    }).catch((err) => {
      console.error('[AUTO-CONFIRM] Top-level tick failed:', err);
    });
  intervalId = setInterval(tick, 60 * 1000);
  // Run once immediately
  tick();
}

export function stopAutoConfirmJob() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
