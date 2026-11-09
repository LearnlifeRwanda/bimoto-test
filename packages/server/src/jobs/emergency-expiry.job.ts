/**
 * SOS-FOLLOW G3 — the valve.
 *
 * An emergency alert grants two things nothing else in this system
 * grants: permission for both participants' phones to stream their live
 * position, and permission for ops to watch. Those permissions are
 * defensible only because they end. An administrator ending one with a
 * written note is the intended path; this job is what happens when
 * nobody does — a night shift that missed it, a panel that was
 * unstaffed, an alert raised at 03:00 in a pilot with six people in it.
 *
 * Without this file "ops-only, emergency-only" quietly degrades into
 * "ops-only", because an alert that is never closed follows a rider
 * forever. So: ACTIVE and older than EMERGENCY_AUTO_EXPIRE_MIN becomes
 * EXPIRED, through the same endEmergencyAlert path an administrator
 * uses, firing the same two events — the journey room's ended-event is
 * what actually stops the two phones streaming, and it matters more here
 * than anywhere, because here there is nobody watching to notice.
 *
 * EXPIRED IS NOT RESOLVED, and the two statuses stay distinct in the
 * history for exactly that reason: "an administrator looked at this and
 * closed it" and "this timed out with nobody looking" are different
 * facts about how a pilot is being run, and collapsing them would hide
 * the second one.
 *
 * ON THE AUDIT CHAIN. AdminAction.adminId is a non-nullable foreign key
 * to User (onDelete: Restrict) and this codebase has no system-user
 * convention — every AdminAction ever written came from an
 * authenticated administrator. A machine closure therefore cannot
 * invent an author: writing one would either break the FK or, worse,
 * attribute a machine's decision to a real person inside a
 * tamper-evident hash chain, which is the one thing that chain exists
 * to make impossible. So the valve's durable record is the alert row
 * itself — EXPIRED, resolvedById NULL, the system note — and the chain
 * entry is written only when an operator has deliberately created an
 * ops service account and named it in EMERGENCY_EXPIRY_ADMIN_ID. Unset
 * (the default) is honest rather than silent: the skip is logged.
 */

import { EmergencyAlertStatus } from '@prisma/client';
import prisma from '../prisma';
import { withJobLock } from '../services/job-lock';
import { endEmergencyAlert } from '../services/emergency-alert.service';

/**
 * How long an alert may stay open with nobody closing it. Sixty minutes
 * is the founder-decided valve, and the client mirrors it locally
 * (EMERGENCY_FOLLOW_CAP_MS) so a phone that loses its socket stops
 * streaming on its own schedule rather than waiting for a message it
 * cannot receive.
 */
export const EMERGENCY_AUTO_EXPIRE_MIN = parseInt(
  process.env.EMERGENCY_AUTO_EXPIRE_MIN ?? '60',
  10,
);

const TICK_MS = 60 * 1000;

/**
 * The note written on an alert the valve closed. Deliberately says what
 * happened rather than dressing it up: nobody closed this.
 */
export const EMERGENCY_EXPIRY_NOTE =
  `Auto-expired by the system after ${EMERGENCY_AUTO_EXPIRE_MIN} minutes with no administrator resolution.`;

let intervalId: NodeJS.Timeout | null = null;
let warnedNoAuditAdmin = false;

export async function processEmergencyExpiry(): Promise<{ expired: number }> {
  const cutoff = new Date(Date.now() - EMERGENCY_AUTO_EXPIRE_MIN * 60 * 1000);

  const stale = await prisma.emergencyAlert.findMany({
    where: { status: EmergencyAlertStatus.ACTIVE, createdAt: { lt: cutoff } },
    select: { id: true },
  });
  if (stale.length === 0) return { expired: 0 };

  const auditAdminId = process.env.EMERGENCY_EXPIRY_ADMIN_ID?.trim() || null;
  if (!auditAdminId && !warnedNoAuditAdmin) {
    warnedNoAuditAdmin = true;
    console.warn(
      '[EMERGENCY-EXPIRY] EMERGENCY_EXPIRY_ADMIN_ID is unset — expiries close the ' +
        'alert row (EXPIRED, resolvedById NULL, system note) but append no AdminAction ' +
        'chain entry. Set it to an ops service account to audit the valve.',
    );
  }

  let expired = 0;
  for (const alert of stale) {
    try {
      // One at a time, each individually guarded. A single alert whose
      // close fails must not strand the rest of the sweep — every one of
      // them is a phone still streaming.
      const outcome = await endEmergencyAlert({
        alertId: alert.id,
        status: EmergencyAlertStatus.EXPIRED,
        note: EMERGENCY_EXPIRY_NOTE,
        adminId: auditAdminId,
      });
      if (outcome) expired += 1;
    } catch (err) {
      console.error(`[EMERGENCY-EXPIRY] Failed to expire alert ${alert.id}:`, err);
    }
  }

  if (expired > 0) {
    console.log(`[EMERGENCY-EXPIRY] Expired ${expired} alert(s) older than ${EMERGENCY_AUTO_EXPIRE_MIN}m`);
  }
  return { expired };
}

export function startEmergencyExpiryJob(): void {
  if (intervalId) return;
  console.log(`[EMERGENCY-EXPIRY] Starting (every 60s, valve=${EMERGENCY_AUTO_EXPIRE_MIN}m)`);
  const tick = () =>
    withJobLock('emergency-expiry.job', processEmergencyExpiry).catch((err) => {
      console.error('[EMERGENCY-EXPIRY] Top-level tick failed:', err);
    });
  intervalId = setInterval(tick, TICK_MS);
  void tick();
}

export function stopEmergencyExpiryJob(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
