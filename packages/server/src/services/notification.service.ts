/**
 * Notification service - dispatch layer for outbound notifications.
 *
 * Each notify-X helper retains its console.log so dev/test visibility
 * is unchanged. Push delivery is layered ADDITIVELY: each helper fires
 * a fire-and-forget push to the recipient's registered devices via
 * services/push/. Push failures never propagate out of these helpers
 * — they are caught and logged so the calling business path (bid,
 * journey, escrow, etc.) cannot be broken by a flaky FCM / APNS leg.
 *
 * Real-time socket fan-out shipped with LIVE-WIRE; the note that used to
 * sit here calling it "still TODO" outlived the work by several dispatches.
 *
 * ── NOTIFY G3 — the in-app half ───────────────────────────────────
 *
 * Push was the ONLY channel every helper below had, and push has no
 * APNS/FCM credentials (Barack, 24 Aug): sendPushToUser composes a
 * payload, finds no registered device, and returns. So "a driver is
 * told his money was released" was, in the field, a console.log on a
 * server he will never read.
 *
 * The helpers that carry news a signed-in user must SEE now also emit
 * to that user's own socket room, composed here rather than at each
 * call site, so one call announces on both channels and a future caller
 * cannot forget the half that currently works. This is the bid-outcome
 * pattern (services/bid-outcome.ts) moved inside: same emitToUser, same
 * per-user room, same fire-and-forget posture.
 *
 * DELIVERY IS THE PRIVACY BOUNDARY. Every emit here is emitToUser and
 * only emitToUser — the named recipient's room, never a journey room
 * (which holds two people), never a broadcast. Payload shapes and what
 * each deliberately omits are in shared/constants/socket-events.ts.
 *
 * NEVER THROWS, unchanged. `emitToRecipient` swallows everything: a
 * dead socket must not fail a release that has already committed.
 *
 * TWO HELPERS DELIBERATELY HAVE NO EMIT — notifyDriverAccountFlagged
 * and notifyDriverAccountSuspended. See the note above each; #194
 * Item 2 and the D19/AML no-tipping-off posture own that ground and
 * this dispatch does not touch it.
 */

import * as Sentry from '@sentry/node';
import { SOCKET_EVENTS } from '@bimoto/shared';
import { emitToUser } from '../socket';
import { buildPushPayload, getUserLanguage, sendPushToUser } from './push';
import type { NotificationEventKey } from '@bimoto/shared';
import type { PushPayloadData } from './push';
import prisma from '../prisma';
import { decryptedPhoneOrNull } from './user-phone';
import { sendSms } from './sms.service';

async function dispatchPush(
  userId: string,
  event: NotificationEventKey,
  data: PushPayloadData,
  vars?: Record<string, string | number>,
): Promise<void> {
  try {
    const language = await getUserLanguage(userId);
    const payload = buildPushPayload(event, { language, data, vars });
    await sendPushToUser(userId, payload);
  } catch (err) {
    // Defensive: notification helpers must never throw.
    Sentry.captureException(err);
    console.warn(`[NOTIFICATION] push dispatch failed for ${event}:`, (err as Error).message);
  }
}

function fireAndForget(p: Promise<void>): void {
  void p.catch((err) => {
    Sentry.captureException(err);
  });
}

/**
 * NOTIFY G3 — the in-app leg, on the recipient's own socket room.
 *
 * Synchronous and total: emitToUser is a no-op when socket.io is not
 * initialised (test runs, jobs booted without a server), and anything
 * that does go wrong is captured and swallowed here. A notification
 * helper's contract is that it never throws, and that contract is what
 * lets an escrow release call it without a try/catch of its own.
 *
 * NAMED emitTo* ON PURPOSE. SOCKET-HYGIENE G4's orphan guard resolves
 * server emit sites by matching `emitTo\w+(..., SOCKET_EVENTS.X)`, so a
 * wrapper called anything else would hide every emit below from the
 * guard — and the client listeners for them would then fail CI as dead
 * wires. It is also simply what this is: an emitTo helper, in a file
 * that owns which room the recipient's news goes to.
 */
function emitToRecipient(userId: string, event: string, data: Record<string, unknown>): void {
  try {
    emitToUser(userId, event, data);
  } catch (err) {
    Sentry.captureException(err);
    console.warn(`[NOTIFICATION] socket emit failed for ${event}:`, (err as Error).message);
  }
}

export function notifyBidReceived(customerId: string, journeyId: string, bidId: string) {
  console.log(`[NOTIFICATION] New bid ${bidId} on journey ${journeyId} for customer ${customerId}`);
  fireAndForget(
    dispatchPush(customerId, 'bidReceived', { type: 'bid', journeyId, bidId }),
  );
}

export function notifyBidAccepted(driverId: string, journeyId: string, bidId: string) {
  console.log(`[NOTIFICATION] Bid ${bidId} accepted on journey ${journeyId} for driver ${driverId}`);
  fireAndForget(
    dispatchPush(driverId, 'bidAccepted', { type: 'bid', journeyId, bidId }),
  );
}

export function notifyBidDeclined(driverId: string, journeyId: string, bidId: string) {
  console.log(`[NOTIFICATION] Bid ${bidId} declined on journey ${journeyId} for driver ${driverId}`);
  fireAndForget(
    dispatchPush(driverId, 'bidDeclined', { type: 'bid', journeyId, bidId }),
  );
}

// EXPORT-AND-LEDGER-style census, COUNTER-READY G4 — SEVEN HELPERS
// DELETED HERE: notifyJourney{Started,Ended,Confirmed,Cancelled,
// Disputed,Interrupted} and notifyNewMessage.
//
// All seven were exported, all seven had ZERO callers anywhere in the
// repo (the #200 census found it; a symbol grep across every .ts/.tsx at
// this head confirmed it again — the only hit for each name was its own
// declaration). Each composed a push and only a push, so even a future
// caller would have reached a channel with no APNS/FCM credentials.
//
// Git remembers them. Deleting an UNCALLED helper decides nothing about
// the surface it was written for: the D27 disputed/interrupted posture
// stays exactly as open as it was, and the day a journey-lifecycle
// notification is actually wanted, it will want the emitToRecipient
// composition the live helpers below have and these never had.
//
// Their NotificationEventKey entries and push strings are deliberately
// KEPT (shared/translations/notifications.ts): that catalogue is the
// vocabulary of things this system can say, and it is not this
// dispatch's to prune.

export function notifyBidCountered(
  driverId: string,
  journeyId: string,
  bidId: string,
  counterAmountRwf: number,
  originalPrice: number,
) {
  console.log(
    `[NOTIFICATION] Bid ${bidId} countered at ${counterAmountRwf} RWF (was ${originalPrice}) for driver ${driverId}`,
  );
  emitToRecipient(driverId, SOCKET_EVENTS.BID_COUNTERED, {
    journeyId,
    bidId,
    counterAmountRwf,
    originalPrice,
  });
  fireAndForget(
    dispatchPush(
      driverId,
      'bidCountered',
      { type: 'bid', journeyId, bidId },
      { amount: counterAmountRwf, original: originalPrice },
    ),
  );
}

/**
 * COUNTER-READY G2 — the motari took the countered price. To the
 * CUSTOMER who made the counter.
 *
 * `agreedPrice` is what escrow will charge, because by the time this
 * fires the accept path has already committed the match at that number.
 */
export function notifyCounterAccepted(
  customerId: string,
  journeyId: string,
  bidId: string,
  agreedPrice: number,
) {
  console.log(
    `[NOTIFICATION] Counter on bid ${bidId} accepted at ${agreedPrice} RWF for customer ${customerId}`,
  );
  emitToRecipient(customerId, SOCKET_EVENTS.COUNTER_ACCEPTED, {
    journeyId,
    bidId,
    agreedPrice,
  });
  fireAndForget(
    dispatchPush(
      customerId,
      'counterAccepted',
      { type: 'bid', journeyId, bidId },
      { amount: agreedPrice },
    ),
  );
}

/**
 * COUNTER-READY G2 — the motari said no. To the CUSTOMER who countered.
 *
 * `originalPrice` is the whole point: his offer is STILL LIVE at the
 * price he first named and she can still accept it. A decline that did
 * not carry that number would read as "the offer is gone", which is
 * false — the bid never left PENDING.
 */
export function notifyCounterDeclined(
  customerId: string,
  journeyId: string,
  bidId: string,
  originalPrice: number,
) {
  console.log(
    `[NOTIFICATION] Counter on bid ${bidId} declined; offer stands at ${originalPrice} RWF for customer ${customerId}`,
  );
  emitToRecipient(customerId, SOCKET_EVENTS.COUNTER_DECLINED, {
    journeyId,
    bidId,
    originalPrice,
  });
  fireAndForget(
    dispatchPush(
      customerId,
      'counterDeclined',
      { type: 'bid', journeyId, bidId },
      { original: originalPrice },
    ),
  );
}

export function notifyEscrowReleased(driverId: string, journeyId: string, amount: number) {
  console.log(`[NOTIFICATION] Escrow released for journey ${journeyId}: ${amount} RWF to driver ${driverId}`);
  // NOTIFY G3 — the one the field asked for first. A motari has never
  // been told, inside the app, that he was paid. `amount` is his payout,
  // not the passenger's fare: see the caller.
  emitToRecipient(driverId, SOCKET_EVENTS.ESCROW_RELEASED, { journeyId, amount });
  fireAndForget(
    dispatchPush(
      driverId,
      'escrowReleased',
      { type: 'escrow', journeyId },
      { amount },
    ),
  );
}

export function notifyEscrowRefunded(customerId: string, journeyId: string, amount: number) {
  console.log(`[NOTIFICATION] Escrow refunded for journey ${journeyId}: ${amount} RWF to customer ${customerId}`);
  emitToRecipient(customerId, SOCKET_EVENTS.ESCROW_REFUNDED, { journeyId, amount });
  fireAndForget(
    dispatchPush(
      customerId,
      'escrowRefunded',
      { type: 'escrow', journeyId },
      { amount },
    ),
  );
}

export function notifyRatingReceived(userId: string, journeyId: string, stars: number) {
  console.log(`[NOTIFICATION] New ${stars}-star rating on journey ${journeyId} for user ${userId}`);
  // Stars only. The comment and the reason are on the row for an admin
  // conflict view; a toast says how many stars, not what was written.
  emitToRecipient(userId, SOCKET_EVENTS.RATING_RECEIVED, { journeyId, stars });
  fireAndForget(
    dispatchPush(
      userId,
      'ratingReceived',
      { type: 'rating', journeyId },
      { stars },
    ),
  );
}

// K1 — fired when the bid-discovery cascade ring expands and a driver
// becomes newly eligible to bid on a posted journey. The cascade
// de-dupes per (journeyId, driverId) so no driver receives this twice
// for the same journey.
export function notifyDriverOfNewlyAvailableJourney(driverId: string, journeyId: string) {
  console.log(`[NOTIFICATION] Journey ${journeyId} now in driver ${driverId}'s cascade ring — invite to bid`);
  fireAndForget(
    dispatchPush(driverId, 'driverNewlyAvailable', { type: 'journey', journeyId }),
  );
}

// R3-N-2 — 20-minute reminder when a MATCHED journey has not started
// (startedAt:null). Sent to BOTH parties (customer and driver) by the
// no-show-timeout cron. Idempotency is enforced at the job level via
// journey.noShowReminderSentAt; this helper does not de-dup.
export function notifyRideNotStarted(userId: string, journeyId: string) {
  console.log(`[NOTIFICATION] Ride not started reminder for user ${userId} on journey ${journeyId}`);
  fireAndForget(
    dispatchPush(userId, 'rideNotStarted', { type: 'journey', journeyId }),
  );
}

// R3-N-4 — graduated driver penalty notifications. Fired AFTER the
// applyCancelAttribution transaction commits, from cancelJourney /
// no-show-timeout cron. Caller passes the journeyId for deep-linking.
export function notifyDriverNoShowWarning(
  driverId: string,
  journeyId: string,
  count: number,
) {
  console.log(
    `[NOTIFICATION] No-show warning for driver ${driverId} (count=${count})`,
  );
  emitToRecipient(driverId, SOCKET_EVENTS.NO_SHOW_WARNING, { journeyId, count });
  fireAndForget(
    dispatchPush(
      driverId,
      'noShowWarning',
      { type: 'journey', journeyId },
      { count },
    ),
  );
}

// NOTIFY G3 — DELIBERATELY NO SOCKET EMIT.
//
// The census run for this dispatch found this helper push-composing,
// like every other, and it stays that way. Suspension neighbours the
// account-flag posture directly below: both are enforcement states an
// account holder is told about through the existing 3-language push
// path, and neither is ground a notification dispatch may re-open. See
// the note on notifyDriverAccountFlagged.
export function notifyDriverAccountSuspended(
  driverId: string,
  journeyId: string,
  until: Date,
) {
  console.log(
    `[NOTIFICATION] Driver ${driverId} suspended until ${until.toISOString()}`,
  );
  fireAndForget(
    dispatchPush(
      driverId,
      'accountSuspended',
      { type: 'journey', journeyId },
      { until: until.toISOString() },
    ),
  );
}

// NOTIFY G3 — DELIBERATELY NO SOCKET EMIT, and this one is a rule, not
// a judgement call.
//
// #194 Item 2 dropped `errors.accountFlagged` on purpose: the state is
// already carried by `account.statusFlagged` and the existing
// 3-language push path, and a new "you were flagged" event interacts
// with the D19/AML no-tipping-off posture — telling a person under
// review that they are under review is the thing that posture exists to
// prevent. Wiring an in-app announcement here is out of bounds for this
// dispatch and for any dispatch that has not first reopened #194.
export function notifyDriverAccountFlagged(
  driverId: string,
  journeyId: string,
) {
  console.log(`[NOTIFICATION] Driver ${driverId} flagged for admin review`);
  fireAndForget(
    dispatchPush(driverId, 'accountFlagged', { type: 'journey', journeyId }),
  );
}

// R3-N-5 — admin dispute-resolution notifications. Fired AFTER the
// driverNoShowDisputeModule.decide transaction commits. Caller passes
// the journeyId for deep-linking.
export function notifyDriverDisputeUpheld(driverId: string, journeyId: string) {
  console.log(
    `[NOTIFICATION] Dispute upheld (OVERTURN_FLAG) for driver ${driverId} on journey ${journeyId}`,
  );
  emitToRecipient(driverId, SOCKET_EVENTS.DISPUTE_RESOLVED, { journeyId, outcome: 'UPHELD' });
  fireAndForget(
    dispatchPush(driverId, 'disputeUpheld', { type: 'journey', journeyId }),
  );
}

export function notifyDriverDisputeRejected(driverId: string, journeyId: string) {
  console.log(
    `[NOTIFICATION] Dispute rejected (UPHOLD_FLAG) for driver ${driverId} on journey ${journeyId}`,
  );
  emitToRecipient(driverId, SOCKET_EVENTS.DISPUTE_RESOLVED, { journeyId, outcome: 'REJECTED' });
  fireAndForget(
    dispatchPush(driverId, 'disputeRejected', { type: 'journey', journeyId }),
  );
}

export function notifyDriverDisputeClosedNoAction(driverId: string, journeyId: string) {
  console.log(
    `[NOTIFICATION] Dispute closed (NO_ACTION) for driver ${driverId} on journey ${journeyId}`,
  );
  emitToRecipient(driverId, SOCKET_EVENTS.DISPUTE_RESOLVED, { journeyId, outcome: 'NO_ACTION' });
  fireAndForget(
    dispatchPush(driverId, 'disputeClosedNoAction', { type: 'journey', journeyId }),
  );
}

// FIELD-FIT G4 — the admin's verification decision, delivered.
//
// Approve and reject wrote the driverProfile row and returned it, and
// that was the whole of it: the motari waiting to be allowed to work
// found out by opening the app and looking. These two helpers close
// that, on the same fire-and-forget contract as everything above — a
// failed notification must never fail the admin's decision.
//
// Push is the primary channel. Unlike the ride events above, this one
// also falls back to SMS: a driver waiting for approval frequently has
// no device token yet (he has not been able to work, so he may not have
// opened the app since installing), and the decision is worth a
// message he will actually receive. sendSms respects SMS_MODE, so in
// pilot/simulated mode it lands in the guarded in-app inbox instead of
// costing a real message.
async function dispatchVerificationDecision(
  driverId: string,
  event: 'verificationApproved' | 'verificationRejected',
  vars?: Record<string, string | number>,
): Promise<void> {
  const language = await getUserLanguage(driverId);
  const payload = buildPushPayload(event, {
    language,
    data: { type: 'verification' },
    vars,
  });

  const results = await sendPushToUser(driverId, payload).catch((err) => {
    Sentry.captureException(err);
    return [];
  });

  // A device took it — done. (No registered device, or every send
  // failed, both fall through to SMS.)
  if (results.some((r) => r.success)) return;

  // No device took the push — reach for the phone number instead.
  const user = await prisma.user.findUnique({
    where: { id: driverId },
    select: { phoneEncrypted: true },
  });
  const phone = decryptedPhoneOrNull(user);
  if (!phone) return;
  await sendSms(phone, `${payload.title}. ${payload.body}`);
}

export function notifyDriverVerificationApproved(driverId: string) {
  console.log(`[NOTIFICATION] Driver ${driverId} verification APPROVED`);
  emitToRecipient(driverId, SOCKET_EVENTS.VERIFICATION_DECIDED, { decision: 'APPROVED' });
  fireAndForget(dispatchVerificationDecision(driverId, 'verificationApproved'));
}

export function notifyDriverVerificationRejected(driverId: string, reason: string) {
  console.log(`[NOTIFICATION] Driver ${driverId} verification REJECTED: ${reason}`);
  // No `reason` on the wire. It is admin free text — it can name a
  // document, a person, a suspicion — and it belongs in the SMS and push
  // body addressed to him, not in a toast rendering on whatever screen
  // he happens to be standing on.
  emitToRecipient(driverId, SOCKET_EVENTS.VERIFICATION_DECIDED, { decision: 'REJECTED' });
  fireAndForget(
    dispatchVerificationDecision(driverId, 'verificationRejected', { reason }),
  );
}
