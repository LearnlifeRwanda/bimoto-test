// SERVICES/SESSION-ACTOR.TS
//
// CUTGUARD v2 G4 — who is acting, as a type the compiler can check.
//
// THE DEFECT THIS EXISTS FOR, and it was live on the pilot.
//
//     POST /api/scheduled-rides/:id/conflict-acknowledge
//       (authMiddleware, driverOnly)
//       → acceptBid(journeyId, journey.customerId, bidId, …)
//
// `acceptBidCore` then checks `journey.customerId !== customerId` — the
// row against itself. The check could not fail. A stranger motari with an
// ordinary session matched a passenger he had no relationship with, at a
// price she never accepted, and her money was HELD.
//
// WHY IT COULD BE WRITTEN. The parameter was `customerId: string`. A
// string is a string: `req.user.userId` and `journey.customerId` are
// equally assignable, and one of them makes the check a tautology. The
// type system had no opinion because there was nothing to have an opinion
// about.
//
// WHAT THIS MODULE CHANGES. `SessionUserId` is a branded string that can
// only come from `req.user`. `journey.customerId` is a plain `string` and
// does not typecheck where one is required. The tautology stops being a
// thing a person has to notice in review and becomes a thing the build
// refuses.
//
// AND WHY THE ACTOR IS A UNION, not just a branded id. Threading a
// branded customer id everywhere would have been a lie at two real call
// sites, and a lie the compiler would have forced somebody to cast their
// way out of:
//
//   - `respondToCounter` — the motari accepting the passenger's OWN
//     counter-offer. The actor is the DRIVER. He is already authorised,
//     correctly, by `bid.driverId !== driverId` → 403 NOT_BID_OWNER, and
//     by the counter existing at all (only the passenger can create one).
//     The customer-ownership check is not the applicable check here; it
//     was simply passing vacuously.
//   - auto-accept — a cron. There is no session and no actor.
//
// Those two were tautologies too, and harmless ones, because a DIFFERENT
// and real check stood in front of each. Writing them as `'counter-accept'`
// and `'system'` says so out loud instead of letting them look like an
// ownership check that works. A future reader can see which sites are
// protected by the customer check and which are protected by something
// else — which is precisely what nobody could see before.

import type { Request } from 'express';
import { AppError } from '../middleware/error-handler';

/**
 * The brand. Declared, never assigned; `unique symbol` makes it
 * unforgeable outside this module, because no other file can name it.
 */
declare const SESSION_USER_ID: unique symbol;

/**
 * A user id that came from the authenticated SESSION.
 *
 * Structurally a string at runtime — it IS the id, and every comparison,
 * query and log that used one still works — but not assignable FROM a
 * plain string, which is the whole point: `journey.customerId` is a
 * plain string.
 */
export type SessionUserId = string & { readonly [SESSION_USER_ID]: true };

/**
 * The only way to make one. Reads `req.user`, which only `authMiddleware`
 * writes.
 *
 * Throws rather than returning null: every caller is behind
 * `authMiddleware`, so a missing `req.user` is a routing mistake, and the
 * honest answer to a routing mistake is not to quietly act as nobody.
 */
export function sessionUserId(req: Request): SessionUserId {
  const id = req.user?.userId;
  if (!id) {
    throw new AppError(401, 'UNAUTHORIZED', 'errors.unauthorized');
  }
  return id as SessionUserId;
}

/**
 * WHO IS ACCEPTING A BID.
 *
 * Three kinds, because there are three, and the previous code had one
 * parameter for all of them.
 */
export type BidAcceptActor =
  /**
   * The passenger, acting on her own journey. This is the ONLY kind the
   * customer-ownership check applies to, and it is checked.
   */
  | { readonly kind: 'customer'; readonly customerId: SessionUserId }
  /**
   * The motari accepting the passenger's own counter-offer.
   *
   * Authorised UPSTREAM and independently: `respondToCounter` verifies
   * `bid.driverId === driverId` (403 NOT_BID_OWNER) and that a counter
   * exists, unanswered, on a PENDING bid — and only the passenger can
   * create a counter. The customer-ownership check does not apply and is
   * skipped explicitly rather than passed vacuously.
   */
  | { readonly kind: 'counter-accept'; readonly driverId: SessionUserId }
  /**
   * No session at all — the auto-accept sweep. `reason` is recorded so a
   * log line can say which machinery acted.
   */
  | { readonly kind: 'system'; readonly reason: string };

/** The passenger acting on her own journey. */
export function customerActor(customerId: SessionUserId): BidAcceptActor {
  return { kind: 'customer', customerId };
}

/** The motari answering a counter he owns the bid for. */
export function counterAcceptActor(driverId: SessionUserId): BidAcceptActor {
  return { kind: 'counter-accept', driverId };
}

/**
 * Server-initiated, no session.
 *
 * A function rather than a constant so the reason is mandatory: a
 * system actor with no stated machinery behind it is the shape a future
 * bypass would take.
 */
export function systemActor(reason: string): BidAcceptActor {
  return { kind: 'system', reason };
}
