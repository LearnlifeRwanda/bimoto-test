// SERVICES/BID-OUTCOME.TS
//
// LIVE-WIRE G2/G3 — telling the motari what happened to his bid.
//
// WHY THIS EXISTS AT ALL. `bid-accepted` is emitted into the room
// `journey:<id>` (bid.routes.ts:147, scheduled-ride.routes.ts:197).
// Membership of that room is gated by socket/index.ts's
// `loadJourneyParties`, which authorises `journey.customerId` and
// `journey.driverId` — and a REQUESTED journey has no driverId. So a
// driver who has BID is refused the room: measured, 10 refusals in 10
// attempts, in docs/live-wire-measurements.md. The acceptance event has
// therefore never reached a single motari over a socket. His only path
// to "your bid was accepted" was to navigate away and back so
// ActiveJourneyBanner's mount-time restore would run.
//
// WHAT THIS IS NOT. It is not a second source of truth for acceptance.
// The journey-room `bid-accepted` emit stays exactly where it is, owned
// by its existing sites; nothing here changes when or whether a bid is
// accepted. This module only ADDRESSES the drivers — the winner and the
// losers — over the per-user room each already joins at connect
// (`user:${userId}`, registerSocketHandlers), the same envelope the
// discovery cascade has always used for journey:available.
//
// WHERE IT FIRES. Once, at the tail of `bid.service.acceptBid` — the
// MoMo/committed acceptance path, which is also the path
// auto-accept and the scheduled-ride conflict-acknowledge route take.
// Deliberately NOT on `acceptBidForCard`: that leaves the escrow
// PENDING and the card charge unverified, and telling a motari he has
// a ride before the money is confirmed is the exact failure PAY-TRUTH
// spent a dispatch removing. When the card path grows its promised
// post-verification emit (bid.routes.ts:217 names it and it does not
// yet exist anywhere — see the report), this is the function it calls.
//
// FIRE-AND-FORGET. Every leg here is best-effort and non-throwing. A
// dead socket or a flaky push must never fail the accept that already
// committed.

import * as Sentry from '@sentry/node';
import { SOCKET_EVENTS } from '@bimoto/shared';
import { emitToUser } from '../socket';
import { notifyBidAccepted, notifyBidDeclined } from './notification.service';

export interface BidOutcomeArgs {
  journeyId: string;
  /** The bid that won, and the motari who placed it. */
  accepted: { bidId: string; driverId: string };
  /** Every bid this same accept closed out, captured in its transaction. */
  declined: Array<{ id: string; driverId: string }>;
}

/**
 * The single-driver half of the announcement: one socket event on that
 * driver's own room, plus the matching #159 notification so the phone
 * in a pocket buzzes too.
 *
 * TEAM-ANSWERS G4 — split out so a customer's explicit decline of ONE
 * offer (item 16a) reaches its motari through exactly the same two
 * channels an accept's losers already did. A driver cannot tell, and
 * should not be able to tell, whether his offer lost to a rival or was
 * turned down on its own: either way the ride is not his, and the
 * message is the same one he has always received.
 */
function tellOneDriverDeclined(
  journeyId: string,
  bid: { id: string; driverId: string },
): void {
  emitToUser(bid.driverId, SOCKET_EVENTS.BID_DECLINED, {
    journeyId,
    bidId: bid.id,
  });
  notifyBidDeclined(bid.driverId, journeyId, bid.id);
}

/**
 * TEAM-ANSWERS G4 — announce a single explicit decline (item 16a: the
 * passenger says no to one driver's offer without accepting anybody).
 *
 * Same never-throws posture as announceBidOutcome: the decline is
 * already durable by the time this runs, and losing the announcement
 * must not cost the passenger their action. The motari's poll and his
 * mount-time restore still reach him.
 */
export function announceBidDeclined(
  journeyId: string,
  bid: { id: string; driverId: string },
): void {
  try {
    tellOneDriverDeclined(journeyId, bid);
  } catch (err) {
    Sentry.captureException(err, { tags: { src: 'announce-bid-declined' } });
    console.warn(
      '[TEAM-ANSWERS] bid-decline announcement failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Announce an accept's outcome to the drivers it affected: the winner
 * over `bid-accepted`, each loser over `bid-declined`, each on their own
 * per-user socket room, plus the matching #159 notification so the
 * phone in a pocket buzzes too.
 *
 * Never throws, never awaits the caller's critical path.
 */
export function announceBidOutcome(args: BidOutcomeArgs): void {
  try {
    emitToUser(args.accepted.driverId, SOCKET_EVENTS.BID_ACCEPTED, {
      journeyId: args.journeyId,
      bidId: args.accepted.bidId,
    });
    // #159's helpers are already fire-and-forget internally (push-first,
    // driver's own language, failures caught and logged).
    notifyBidAccepted(args.accepted.driverId, args.journeyId, args.accepted.bidId);

    for (const loser of args.declined) {
      // A driver who somehow holds both the winning and a losing bid on
      // one journey is impossible (journeyId_driverId is unique), but
      // the guard costs nothing and keeps the two messages exclusive.
      if (loser.driverId === args.accepted.driverId) continue;
      tellOneDriverDeclined(args.journeyId, loser);
    }
  } catch (err) {
    // The accept is already durable. Losing the announcement costs the
    // motari his live update — the poll and the mount-time restore still
    // reach him — and must not cost the customer their ride.
    Sentry.captureException(err, { tags: { src: 'announce-bid-outcome' } });
    console.warn(
      '[LIVE-WIRE] bid-outcome announcement failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}
