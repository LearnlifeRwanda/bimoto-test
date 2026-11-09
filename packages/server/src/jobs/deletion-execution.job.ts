// ACCOUNT-RIGHTS-CORE G4 — the clock that runs out, and the states that
// make it wait.
//
// Every ten minutes this sweeps the PENDING deletion requests whose
// 72-hour window has closed and erases those accounts. What makes it more
// than a timer is the second half: a request whose window has closed but
// whose owner is still mid-ride, still holding money in escrow, or has an
// emergency nobody has closed does NOT get erased. It DEFERS — the reason
// is written to the row, the tick moves on, and the next tick tries
// again.
//
// Deferral, never force-execution, and never cancellation. Founder ruling
// D1 puts SOS and the blocking states outside this wave entirely, and a
// deletion that erased a passenger mid-journey would take the driver's
// counterparty out from under a live ride. A deletion that CANCELLED
// itself because something was in the way would silently drop a request
// the user made and the law gives them thirty days to have honoured. So
// the row waits, and says why.
//
// A row can wait a long time. One deferred past seven days keeps
// retrying; nothing here expires it. `deferredReason` stays queryable so
// the admin surface can show what is holding it (AR-SURFACE renders it —
// this dispatch adds no admin UI).

import { BidStatus, DriverPayoutStatus, EscrowStatus, JourneyStatus } from '@prisma/client';
import type { DeferralReason } from '@bimoto/shared';
import prisma from '../prisma';
import { withJobLock } from '../services/job-lock';
import { executeErasure } from '../services/account-deletion.service';

let intervalId: NodeJS.Timeout | null = null;

/** Ten minutes. The window is 72 hours; nothing here needs to be prompt. */
const TICK_MS = 10 * 60 * 1000;

/**
 * The three ways a journey ENDS. Everything else is still in play.
 */
export const TERMINAL_JOURNEY_STATUSES: JourneyStatus[] = [
  JourneyStatus.COMPLETED,
  JourneyStatus.CANCELLED,
  JourneyStatus.EXPIRED,
];

/**
 * Journey statuses that block an erasure: a ride, delivery or dispute
 * still in play, with a counterparty on the other side of it.
 *
 * DERIVED as the complement of the terminal set rather than listed, and
 * that is the point. A status added to the enum later — a new dispute
 * stage, a new scheduling state — lands in this list automatically and
 * therefore BLOCKS. Listing the seven by hand would mean a new status
 * silently let an erasure through mid-journey, which is the failure the
 * ordering of this file exists to prevent. The pairing test pins both
 * halves of the partition and that they cover the enum exactly.
 */
export const NON_TERMINAL_JOURNEY_STATUSES: JourneyStatus[] = Object.values(
  JourneyStatus,
).filter((s) => !TERMINAL_JOURNEY_STATUSES.includes(s));

/** Escrow statuses in which real money is still committed somewhere. */
export const LIVE_ESCROW_STATUSES: EscrowStatus[] = [
  EscrowStatus.PENDING,
  EscrowStatus.HELD,
  EscrowStatus.FROZEN,
];

/**
 * CUTGUARD v2 G5 (B-4) — the bid statuses that are still an OFFER.
 *
 * Derived as the complement of the terminal set, for the same reason
 * NON_TERMINAL_JOURNEY_STATUSES is: a status added to BidStatus later
 * lands here automatically and therefore BLOCKS. Listing PENDING and
 * ACCEPTED by hand is how a sixth status would silently let an erasure
 * through — and a hand-list is precisely what missed bids entirely.
 *
 * ACCEPTED is included even though an accepted bid implies a matched
 * journey (which blocks on its own). Overlapping cover is the safe
 * direction: the two facts are read independently, and the one that
 * survives a data oddity is the one that matters.
 */
export const TERMINAL_BID_STATUSES: BidStatus[] = [
  BidStatus.DECLINED,
  BidStatus.WITHDRAWN,
  BidStatus.EXPIRED,
];

export const LIVE_BID_STATUSES: BidStatus[] = Object.values(BidStatus).filter(
  (s) => !TERMINAL_BID_STATUSES.includes(s),
);

/**
 * CUTGUARD v2 G5 — payout batches whose money has not landed.
 *
 * Same derivation. A PENDING batch is a transfer the processor has been
 * asked to make; erasing now means the settlement webhook
 * (webhook.routes.ts) resolves a batch belonging to "Deleted User".
 */
export const TERMINAL_PAYOUT_BATCH_STATUSES: DriverPayoutStatus[] = [
  DriverPayoutStatus.SUCCESS,
  DriverPayoutStatus.FAILED,
];

export const LIVE_PAYOUT_BATCH_STATUSES: DriverPayoutStatus[] = Object.values(
  DriverPayoutStatus,
).filter((s) => !TERMINAL_PAYOUT_BATCH_STATUSES.includes(s));

/**
 * Machine-readable deferral reasons. These are written to
 * `DeletionRequest.deferredReason` and read by the admin surface; they are
 * codes, not prose, and are not shown to a user without translation.
 *
 * ACCOUNT-RIGHTS-SURFACE G1 — the union itself now lives in
 * `@bimoto/shared` (types/account-deletion.ts) so the CLIENT's
 * reason-to-wording map can be checked against it exhaustively; a sixth
 * reason added there without wording fails the client build. This job is
 * still the only writer, and re-exports the type so every existing
 * importer of `DeferralReason` from this module is unaffected.
 */
export type { DeferralReason };

/**
 * CUTGUARD v2 G5 — THE OBLIGATION AUDIT.
 *
 * Every way a User row is referenced, and what this job decided about it.
 * This table is the reason the blocking set is complete rather than
 * merely long: the accompanying test derives the SAME set from
 * schema.prisma and fails if the two disagree in either direction. Add a
 * relation to `model User`, or a model that references a user by id, and
 * the build tells you to adjudicate it — which is the closest thing to a
 * compiler for "did we forget one", and the exact thing whose absence let
 * `bids` be missed.
 *
 * `blocks` is not a taste question. It is: can this row carry MONEY, a
 * LIVE MATCH, an OUTSTANDING OBLIGATION, or a LIVE COUNTERPARTY that
 * survives the person? Anything historical, administrative, or about
 * somebody else does not block — and says why, because "no" without a
 * reason is how the next one gets missed too.
 */
export interface ObligationAdjudication {
  /** Relation field on `model User`, or `Model.column` for an undeclared FK. */
  relation: string;
  /** The model on the other side. */
  model: string;
  blocks: boolean;
  /** The BlockingFacts key that covers it, when it blocks. */
  fact?: keyof BlockingFacts;
  reason: string;
}

export const OBLIGATION_AUDIT: ObligationAdjudication[] = [
  /* ---- blocks: a live match, with a counterparty on the other side --- */
  {
    relation: 'journeysAsCustomer',
    model: 'Journey',
    blocks: true,
    fact: 'hasNonTerminalJourney',
    reason:
      'A ride in play has a motari on the other side of it. Erasing the passenger takes his counterparty out from under a live journey.',
  },
  {
    relation: 'journeysAsDriver',
    model: 'Journey',
    blocks: true,
    fact: 'hasNonTerminalJourney',
    reason: 'The same ride from the other side: a passenger is waiting for this driver.',
  },
  /* ---- blocks: money committed --------------------------------------- */
  {
    relation: 'escrowsAsCustomer',
    model: 'Escrow',
    blocks: true,
    fact: 'hasLiveEscrow',
    reason: 'PENDING/HELD/FROZEN is real money committed and not yet settled either way.',
  },
  {
    relation: 'escrowsAsDriver',
    model: 'Escrow',
    blocks: true,
    fact: 'hasLiveEscrow',
    reason: 'The same money, owed to this driver rather than by this passenger.',
  },
  {
    relation: 'DriverBalance.driverId',
    model: 'DriverBalance',
    blocks: true,
    fact: 'driverBalance',
    reason:
      'A positive pendingAmount is money we still owe. It holds the erasure rather than paying it out, because paying a driver is a payout job\u2019s decision and not this one\u2019s. NOTE: DriverBalance declares no back-relation on User, so a relation-only audit would have missed it \u2014 and this is one of the five facts that already existed.',
  },
  {
    relation: 'DriverPayoutBatch.driverId',
    model: 'DriverPayoutBatch',
    blocks: true,
    fact: 'hasInFlightPayout',
    reason:
      'A PENDING batch is a transfer the processor has been asked to make. The settlement webhook resolves it by the processor\u2019s own txRef and would land on an anonymised account. Found by the audit; no back-relation on User.',
  },
  {
    relation: 'payoutPreferenceChangeLogs',
    model: 'PayoutPreferenceChangeLog',
    blocks: true,
    fact: 'hasScheduledPayout',
    reason:
      'Not merely a log. A row with payoutFired:false and a payoutDueAt IS the schedule preference-change-payout.job fires from, so erasing books a payout to somebody who no longer exists. An anomaly-blocked row has a null payoutDueAt and is not an obligation.',
  },
  /* ---- blocks: an outstanding offer ----------------------------------- */
  {
    relation: 'bids',
    model: 'Bid',
    blocks: true,
    fact: 'hasOpenBid',
    reason:
      'B-4, proven live. A PENDING bid is an offer a passenger can still accept and pay into, and erasure does not touch Bid rows \u2014 so the offer outlived the person. A passenger accepted from \u201cDeleted User\u201d and her money was HELD against an account she could not text.',
  },
  /* ---- blocks: safety and administrative holds ------------------------ */
  {
    relation: 'emergencyAlertsRaised',
    model: 'EmergencyAlert',
    blocks: true,
    fact: 'hasUnresolvedEmergency',
    reason:
      'An ACTIVE alarm this person raised is an open safety incident. Founder ruling D1 puts SOS outside any automatic action.',
  },
  {
    relation: 'User.frozenAt',
    model: 'User',
    blocks: true,
    fact: 'isFrozen',
    reason:
      'A frozen account is under an administrative hold; erasing it would end the hold by destroying its subject. Not a relation \u2014 a column \u2014 and listed so the audit covers the whole fact set rather than only its relational half.',
  },
  /* ---- does not block: historical, administrative, or somebody else --- */
  {
    relation: 'driverProfile',
    model: 'DriverProfile',
    blocks: false,
    reason:
      'Anonymised in place by executeErasure step 4 (plate, licence, RURA number, cooperative name, photo URLs nulled; isOnline false). Holds no money and no counterparty.',
  },
  {
    relation: 'sentMessages',
    model: 'Message',
    blocks: false,
    reason:
      'Messages already sent. The journey they belong to is what could be live, and that blocks on its own; the text itself is history.',
  },
  {
    relation: 'ratingsGiven',
    model: 'Rating',
    blocks: false,
    reason: 'A rating already given is a completed act about a completed ride.',
  },
  {
    relation: 'ratingsReceived',
    model: 'Rating',
    blocks: false,
    reason:
      'Ratings about this person. They belong to the raters and to the rides, not to an obligation this person still owes.',
  },
  {
    relation: 'rideReportsFiled',
    model: 'RideReport',
    blocks: false,
    reason:
      'Reports this person filed about rides. Historical, and deliberately one-directional \u2014 the schema refuses a reportsReceived back-relation on purpose.',
  },
  {
    relation: 'syncEvents',
    model: 'SyncEvent',
    blocks: false,
    reason: 'Offline-sync bookkeeping. No money, no counterparty.',
  },
  {
    relation: 'syncRejections',
    model: 'SyncRejection',
    blocks: false,
    reason: 'The record of a sync that was refused. Diagnostic only.',
  },
  {
    relation: 'emergencyAlertsResolved',
    model: 'EmergencyAlert',
    blocks: false,
    reason:
      'Alerts this person CLOSED, for other people. Somebody else\u2019s incident, already resolved \u2014 the raiser side is what blocks.',
  },
  {
    relation: 'driverConflictOverrides',
    model: 'DriverConflictOverride',
    blocks: false,
    reason:
      'A record that this driver accepted a scheduling conflict. The scheduled RIDE is the live thing, and it blocks as a non-terminal journey; the override is its footnote.',
  },
  {
    relation: 'reconciliationResponses',
    model: 'JourneyReconciliationResponse',
    blocks: false,
    reason:
      'An answer given to a reconciliation prompt about a journey. The journey blocks while it is in play; the answer is history.',
  },
  {
    relation: 'amlFlags',
    model: 'AmlFlag',
    blocks: false,
    reason:
      'Investigative records ABOUT this person, held for fraud prevention and deliberately outside the export (D20). An open investigation that warrants a hold shows up as frozenAt, which does block.',
  },
  {
    relation: 'smsInbounds',
    model: 'SmsInbound',
    blocks: false,
    reason: 'Inbound SMS already received and triaged. No obligation attaches.',
  },
  {
    relation: 'adminActions',
    model: 'AdminAction',
    blocks: false,
    reason:
      'Actions this person TOOK as an operator, on other accounts. A hash-chained audit trail that must survive them, and an obligation of the record rather than of the person.',
  },
  {
    relation: 'autoBidRules',
    model: 'DriverAutoBidRule',
    blocks: false,
    reason:
      'A standing instruction, not an outstanding offer. Auto-bids are only evaluated for drivers the discovery ring returns (evaluateAutoBidsForRingDrivers), and erasure sets driverProfile.isOnline false \u2014 so an erased driver is out of every ring and the rules cannot fire. Any bid a rule ALREADY created blocks as an open bid.',
  },
  {
    relation: 'cooperative',
    model: 'Cooperative',
    blocks: false,
    reason:
      'Membership of a cooperative. Erasure leaves the membership row; the relation is SetNull on delete and nothing is hard-deleted, so no counterparty is stranded.',
  },
  {
    relation: 'cooperativeLed',
    model: 'Cooperative',
    blocks: false,
    reason:
      'Leadership of a cooperative. It does NOT block, and this is the one \u201cno\u201d worth arguing with: a cooperative whose leader reads \u201cDeleted User\u201d is an operational problem. It is not an OUTSTANDING OBLIGATION though \u2014 no money is owed, no match is live, and the leaderId relation is SetNull \u2014 and blocking a person\u2019s erasure until an operator reassigns a cooperative would hold a legal right hostage to an admin task. Recorded here as a follow-up for the admin surface, not as a deferral.',
  },
  {
    relation: 'bidsDispatchedByLeader',
    model: 'Bid',
    blocks: false,
    reason:
      'Bids this cooperative leader dispatched on behalf of DRIVERS. The offer and the money belong to the bidding driver, whose own `bids` relation blocks his erasure; the leader is not a party to it.',
  },
  {
    relation: 'deviceTokens',
    model: 'DeviceToken',
    blocks: false,
    reason:
      'Push targets, deleted outright by executeErasure step 5 (the Cascade never fires because the User row is never hard-deleted).',
  },
  {
    relation: 'vehicleChangeLogs',
    model: 'VehicleChangeLog',
    blocks: false,
    reason: 'The ledger of vehicle changes. Historical, and the guard it serves is a write-time one.',
  },
  {
    relation: 'feeWaivers',
    model: 'FeeWaiver',
    blocks: false,
    reason:
      'A waiver is a GRANT to the driver \u2014 a benefit he may stop using \u2014 not something he owes or is owed. A waiver attached to money still in play reaches this job through that escrow, which blocks.',
  },
  {
    relation: 'pickupVerifications',
    model: 'PickupVerification',
    blocks: false,
    reason:
      'The record of a pickup check that already happened. PickupOutcome has no pending member (MATCHED/MISMATCH/UNSURE); every row is terminal on creation.',
  },
  {
    relation: 'errorReports',
    model: 'ErrorReport',
    blocks: false,
    reason: 'Diagnostic uploads. No money, no counterparty.',
  },
  {
    relation: 'deletionRequests',
    model: 'DeletionRequest',
    blocks: false,
    reason:
      'The request that authorises this erasure. Blocking on it would deadlock the job against its own instruction; executeErasure step 8 closes it as EXECUTED.',
  },
  {
    relation: 'NameMismatchLog.customerId',
    model: 'NameMismatchLog',
    blocks: false,
    reason:
      'Observe-only fraud telemetry recorded at charge time (D17-WATCH). Nothing reads it to act; it holds no money. No back-relation on User \u2014 found by the audit.',
  },
  {
    relation: 'OtpCode.userId',
    model: 'OtpCode',
    blocks: false,
    reason:
      'Login codes for the original number, deleted outright by executeErasure step 6 \u2014 keyed by phoneHash rather than userId, because it is the NUMBER that must stop being loggable-into. No back-relation on User.',
  },
  {
    relation: 'RefreshToken.userId',
    model: 'RefreshToken',
    blocks: false,
    reason:
      'Live sessions, revoked inside the erasure transaction by executeErasure step 7. No back-relation on User.',
  },
];

/** What the sweep needs to know about one user before erasing them. */
export interface BlockingFacts {
  hasNonTerminalJourney: boolean;
  hasLiveEscrow: boolean;
  /** CUTGUARD v2 G5 (B-4) — an offer this driver has out on someone's ride. */
  hasOpenBid: boolean;
  hasUnresolvedEmergency: boolean;
  isFrozen: boolean;
  driverBalance: number | null;
  /** CUTGUARD v2 G5 — a transfer the processor has not settled yet. */
  hasInFlightPayout: boolean;
  /** CUTGUARD v2 G5 — a preference-change payout the job is about to fire. */
  hasScheduledPayout: boolean;
}

/**
 * The decision, as a pure function of the facts — so every combination is
 * testable without a database, in the shape seed-guards established.
 *
 * Order is deliberate and is the order an operator would want to read:
 * the ride first (a person is waiting), then the money, then safety, then
 * the administrative holds. Only the FIRST reason is recorded; a row with
 * three things wrong reports one, fixes it, and reports the next.
 */
export function firstBlockingReason(facts: BlockingFacts): DeferralReason | null {
  if (facts.hasNonTerminalJourney) return 'NON_TERMINAL_JOURNEY';
  if (facts.hasLiveEscrow) return 'LIVE_ESCROW';
  // Ordered here, third, on the same principle the rest of this list
  // follows: what is most likely to be what the person is actually
  // waiting on. An open bid is common and ends by itself (accept,
  // withdraw, or expiry), so it reads before the rarer holds.
  if (facts.hasOpenBid) return 'OPEN_BID';
  if (facts.hasUnresolvedEmergency) return 'UNRESOLVED_EMERGENCY';
  if (facts.isFrozen) return 'ACCOUNT_FROZEN';
  // A balance row that does not exist is not a debt. A zero one is not
  // either. Only money we still owe this driver holds the erasure — and
  // it holds it rather than paying it out, because paying a driver is a
  // payout job's decision and not this one's.
  if (facts.driverBalance !== null && facts.driverBalance > 0) {
    return 'POSITIVE_DRIVER_BALANCE';
  }
  // Money already moving, or booked to move. Last because both are rare
  // and both end on their own — the transfer settles, or the job fires.
  if (facts.hasInFlightPayout) return 'IN_FLIGHT_PAYOUT';
  if (facts.hasScheduledPayout) return 'SCHEDULED_PAYOUT';
  return null;
}

/**
 * Read the facts. One query each; none of them writes.
 *
 * CUTGUARD v2 G5 — was "the five facts", and the count was the problem.
 * The list was hand-maintained, so it could only ever contain what
 * somebody had thought of, and it did not contain bids: a driver with a
 * PENDING offer was erased, a passenger accepted from "Deleted User", and
 * her money was HELD against an account she could not text.
 *
 * The three additions were not thought of either — they were DERIVED, by
 * walking every relation on `model User` in schema.prisma plus the five
 * models that reference a user by id with no declared back-relation
 * (DriverBalance, DriverPayoutBatch, NameMismatchLog, OtpCode,
 * RefreshToken — a relation-only audit would have missed all five, and
 * one of them is where the existing driver-balance fact comes from), and
 * asking of each: can it carry money, a live match, an outstanding
 * obligation, or a live counterparty?
 *
 * The full adjudication is OBLIGATION_AUDIT below. The test that pins it
 * against the schema is what makes the list complete-by-construction
 * rather than complete-until-somebody-adds-a-model.
 */
export async function collectBlockingFacts(userId: string): Promise<BlockingFacts> {
  const [
    journey,
    escrow,
    openBid,
    emergency,
    user,
    balance,
    inFlightPayout,
    scheduledPayout,
  ] = await Promise.all([
    prisma.journey.findFirst({
      where: {
        status: { in: NON_TERMINAL_JOURNEY_STATUSES },
        OR: [{ customerId: userId }, { driverId: userId }],
      },
      select: { id: true },
    }),
    prisma.escrow.findFirst({
      where: {
        status: { in: LIVE_ESCROW_STATUSES },
        OR: [{ customerId: userId }, { driverId: userId }],
      },
      select: { id: true },
    }),
    // CUTGUARD v2 G5 (B-4) — the fact that was missing. An offer this
    // driver has out is a thing a passenger can still accept and pay
    // into; erasure does not touch Bid rows, so the offer outlives the
    // person.
    prisma.bid.findFirst({
      where: { driverId: userId, status: { in: LIVE_BID_STATUSES } },
      select: { id: true },
    }),
    prisma.emergencyAlert.findFirst({
      where: { raisedById: userId, status: 'ACTIVE' },
      select: { id: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { frozenAt: true },
    }),
    prisma.driverBalance.findUnique({
      where: { driverId: userId },
      select: { pendingAmount: true },
    }),
    // CUTGUARD v2 G5 — money the processor is already moving. The
    // settlement webhook resolves the batch by its own txRef and has no
    // idea the account behind it was anonymised in the meantime.
    prisma.driverPayoutBatch.findFirst({
      where: { driverId: userId, status: { in: LIVE_PAYOUT_BATCH_STATUSES } },
      select: { id: true },
    }),
    // CUTGUARD v2 G5 — money BOOKED to move. The log row IS the
    // schedule: preference-change-payout.job selects
    // `payoutFired:false AND payoutDueAt <= now` and fires it. An
    // anomaly-blocked row has a null payoutDueAt and is never selected,
    // so it is not an obligation and does not block.
    prisma.payoutPreferenceChangeLog.findFirst({
      where: { userId, payoutFired: false, payoutDueAt: { not: null } },
      select: { id: true },
    }),
  ]);

  return {
    hasNonTerminalJourney: journey !== null,
    hasLiveEscrow: escrow !== null,
    hasOpenBid: openBid !== null,
    hasUnresolvedEmergency: emergency !== null,
    isFrozen: user?.frozenAt != null,
    driverBalance: balance ? balance.pendingAmount : null,
    hasInFlightPayout: inFlightPayout !== null,
    hasScheduledPayout: scheduledPayout !== null,
  };
}

/**
 * One sweep. Exported so the tests can drive it without a timer, the
 * auto-confirm shape.
 */
export async function processDeletionExecutions() {
  try {
    const now = new Date();
    const due = await prisma.deletionRequest.findMany({
      where: { status: 'PENDING', executesAt: { lte: now } },
      select: { id: true, userId: true, deferredReason: true },
    });

    let erased = 0;
    let deferred = 0;

    for (const request of due) {
      // Per request, in its own try/catch: one account that cannot be
      // erased must not abandon the sweep for everyone behind it. The row
      // stays PENDING either way, so the next tick retries it — the same
      // retry semantics the journey-expiry and auto-confirm sweeps use.
      try {
        const facts = await collectBlockingFacts(request.userId);
        const reason = firstBlockingReason(facts);

        if (reason) {
          deferred++;
          // Only write when the reason CHANGED. A row blocked on the same
          // thing for a week should not generate a write every ten
          // minutes.
          if (request.deferredReason !== reason) {
            await prisma.deletionRequest.update({
              where: { id: request.id },
              data: { deferredReason: reason },
            });
          }
          console.log(
            `[DELETION-EXECUTION] deferred request ${request.id} (user ${request.userId}): ${reason}`,
          );
          continue;
        }

        // Nothing in the way. Clear a stale reason BEFORE erasing, so a
        // row that was blocked yesterday does not carry the explanation
        // into its executed state.
        if (request.deferredReason !== null) {
          await prisma.deletionRequest.update({
            where: { id: request.id },
            data: { deferredReason: null },
          });
        }

        await executeErasure(request.userId);
        erased++;
      } catch (error) {
        console.error(
          `[DELETION-EXECUTION] request ${request.id} failed — left PENDING for the next tick:`,
          error,
        );
      }
    }

    if (due.length > 0) {
      console.log(
        `[DELETION-EXECUTION] ${due.length} due: ${erased} erased, ${deferred} deferred`,
      );
    }
  } catch (error) {
    console.error('[DELETION-EXECUTION] Error processing deletion executions:', error);
  }
}

export function startDeletionExecutionJob() {
  console.log('[DELETION-EXECUTION] Starting deletion-execution job (every 10 min)');
  // withJobLock: only the advisory-lock leader runs the tick when
  // overlapping server processes race (deploy, scale-out). Two processes
  // erasing the same account concurrently would be two transactions
  // racing on the tombstone upsert; the lock means it cannot come up.
  const tick = () =>
    withJobLock('deletion-execution.job', async () => {
      await processDeletionExecutions();
    }).catch((err) => {
      console.error('[DELETION-EXECUTION] Top-level tick failed:', err);
    });
  intervalId = setInterval(tick, TICK_MS);
  // Run once immediately
  tick();
}

export function stopDeletionExecutionJob() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
