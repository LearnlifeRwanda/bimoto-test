// SOS-FOLLOW G3 — an emergency always ends, and there is one way it does.
//
// Two things can close an alert: an administrator with a written note,
// and the 60-minute valve for the one nobody closed. They must not be
// two implementations, because the thing that matters about the ending
// is not who did it — it is that EVERY consequence fires. A closed alert
// has to:
//
//   1. stop being ACTIVE, so the follow-stream handler starts refusing
//      the frames both participants' phones are still sending;
//   2. tell the 'admins' room, so the ops list stops showing it live;
//   3. tell the JOURNEY room, so the two phones stop streaming at all
//      rather than being silently ignored — a phone that keeps a
//      geolocation watch open for an emergency that ended is spending
//      battery in an emergency's name;
//   4. release the GPS retention hold, which follows from (1) alone.
//
// Miss (3) and the design's promise — "it always ends" — is only true
// on the server. So both callers come through here.
//
// THE ENDED EVENT CARRIES NO POSITIONS. It is the only new event the
// journey room hears from this entire dispatch, and the never-broadcast
// invariant lives or dies on its shape: id, journey, terminal status.
// Not the note (that is ops-only, behind adminOnly), not a last known
// position, not who closed it.

import * as Sentry from '@sentry/node';
import { AdminActionType, EmergencyAlertStatus } from '@prisma/client';
import { SOCKET_EVENTS, type EmergencyEndedEvent } from '@bimoto/shared';
import prisma from '../prisma';
import { emitToAdmins, emitToJourney } from '../socket';
import { appendAdminActionTx } from './admin/admin-action-audit.service';

export interface EndEmergencyAlertArgs {
  alertId: string;
  status: Extract<EmergencyAlertStatus, 'RESOLVED' | 'EXPIRED'>;
  note: string;
  /**
   * The administrator closing it, or null for the valve.
   *
   * Null is not a shrug: it is the durable record of WHICH KIND of
   * ending this was, and it is why the ops history can print "closed by
   * ops" and "timed out" without inferring either. `status` says the
   * same thing; the two are written together deliberately.
   */
  adminId: string | null;
}

export interface EndEmergencyAlertResult {
  alertId: string;
  journeyId: string;
  status: EmergencyAlertStatus;
  /**
   * Whether an entry was appended to the AdminAction hash chain. True
   * for every administrator-driven resolve. For the valve it follows
   * EMERGENCY_EXPIRY_ADMIN_ID — see the job's own comment for why a
   * machine closure cannot invent one.
   */
  audited: boolean;
}

/**
 * Close one ACTIVE alert. Returns null when it was already closed —
 * two admins clicking Resolve at the same moment is an ordinary race,
 * and the second one has nothing to do rather than something to fail at.
 */
export async function endEmergencyAlert(
  args: EndEmergencyAlertArgs,
): Promise<EndEmergencyAlertResult | null> {
  const resolvedAt = new Date();

  const outcome = await prisma.$transaction(async (tx) => {
    // The status filter is the lock: an alert that another request
    // already moved out of ACTIVE matches nothing and updates nothing.
    const updated = await tx.emergencyAlert.updateMany({
      where: { id: args.alertId, status: EmergencyAlertStatus.ACTIVE },
      data: {
        status: args.status,
        resolvedAt,
        resolvedById: args.adminId,
        resolveNote: args.note,
      },
    });
    if (updated.count === 0) return null;

    const row = await tx.emergencyAlert.findUnique({
      where: { id: args.alertId },
      select: { id: true, journeyId: true, status: true, raisedByRole: true },
    });
    if (!row) return null;

    // #61 invariant — every administrative decision is a link in the
    // tamper-evident chain, hashed against its predecessor.
    let audited = false;
    if (args.adminId) {
      await appendAdminActionTx(tx, {
        adminId: args.adminId,
        action: AdminActionType.RESOLVE_EMERGENCY_ALERT,
        targetType: 'EmergencyAlert',
        targetId: row.id,
        reason: args.note,
        payload: {
          journeyId: row.journeyId,
          status: args.status,
          raisedByRole: row.raisedByRole,
        },
      });
      audited = true;
    }

    return { alertId: row.id, journeyId: row.journeyId, status: row.status, audited };
  });

  if (!outcome) return null;

  const ended: EmergencyEndedEvent = {
    alertId: outcome.alertId,
    journeyId: outcome.journeyId,
    status: outcome.status === EmergencyAlertStatus.RESOLVED ? 'RESOLVED' : 'EXPIRED',
  };

  // Both rooms, each individually guarded — the row is already closed
  // and a failed emit must not roll that back. The journey-room emit is
  // the one that stops two phones streaming, so it goes first: if only
  // one of the two can be delivered, that is the one that matters.
  try {
    emitToJourney(outcome.journeyId, SOCKET_EVENTS.EMERGENCY_ENDED, ended);
  } catch (err) {
    Sentry.captureException(err, { tags: { src: 'emergency-ended-journey-emit' } });
  }
  try {
    emitToAdmins(SOCKET_EVENTS.EMERGENCY_ENDED, ended);
  } catch (err) {
    Sentry.captureException(err, { tags: { src: 'emergency-ended-admins-emit' } });
  }

  return outcome;
}

/**
 * Is this journey in an emergency right now?
 *
 * The follow-stream handler's permission check, and the only question
 * the socket path asks of the database on the hot path. Kept here rather
 * than inline so the stream handler and the participant-facing GET
 * cannot drift apart on what "active" means.
 */
export async function findActiveAlert(journeyId: string) {
  return prisma.emergencyAlert.findFirst({
    where: { journeyId, status: EmergencyAlertStatus.ACTIVE },
    select: { id: true, journeyId: true, raisedByRole: true, createdAt: true },
  });
}
