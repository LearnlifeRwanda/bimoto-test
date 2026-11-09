import prisma from '../prisma';
// CUTGUARD v2 G3 — the customer money-projection boundary. `acceptBid`
// used to build its own thirteen-key breakdown and hand it to the
// passenger; the type this module exports cannot be built that way.
import {
  toCustomerSafeCommission,
  toFullCommissionBreakdown,
  type CustomerSafeCommission,
  type FullCommissionBreakdown,
} from './commission-view';
// CUTGUARD v2 G4 — who is acting, as a type. See services/session-actor.ts
// for the tautology this closes.
import {
  counterAcceptActor,
  type BidAcceptActor,
  type SessionUserId,
} from './session-actor';
import { decryptedPhone } from './user-phone';
import { AppError } from '../middleware/error-handler';
import {
  JourneyStatus,
  JourneyAction,
  BidStatus,
  BidAction,
  BookingMode,
  transitionJourney,
  transitionBid,
  calculateCommission,
  getVehicleCompliance,
  checkDriverCompliance,
  AML_SINGLE_TRANSACTION_LIMIT,
  AML_SAME_PAIR_DAILY_LIMIT,
  MIN_PRICE_RWF,
  MAX_PRICE_RWF,
} from '@bimoto/shared';
import { config } from '../config';
import * as escrowService from './escrow.service';
import { chargeMomo, FlutterwaveError } from './payment';
import { recordNameMismatchIfDifferent } from './payment/name-match';
import {
  assertBidWindowOpen,
  assertNoBlockingConflict,
  recordConflictOverride,
} from './scheduled-rides';
import { tryAutoAcceptBid } from './customer-modes/auto-accept';
import { VEHICLE_UPDATED_RECENTLY_WINDOW_DAYS } from './user.service';
import { onJourneyExitsRequested } from './journey-state-transitions';
import { notifyRecipientDriverEnRoute } from './recipient-sms-notification.service';
import { getActiveWaiversForDrivers } from './fee-waiver';
import { CURATED_BIDDER_PROFILE_SELECT } from './bidder-view';
import { applyWaiver, resolveWaiverCommission } from './fee-waiver/apply';
import { announceBidOutcome } from './bid-outcome';
import {
  notifyBidCountered,
  notifyCounterAccepted,
  notifyCounterDeclined,
} from './notification.service';

// R3-T — URGENT_MESSENGER target completion window. Stamped at
// acceptBid as matchedAt + 30 min; surfaces in UI and (future
// dispatch) gates an automatic "your urgent journey missed its
// target" notification.
const URGENT_TARGET_DURATION_MS = 30 * 60 * 1000;

/**
 * Driver-scoped bid history with auto-bid rule attribution.
 * Used by GET /api/bids/my-history so a driver can review which
 * rule fired which bid. When `onlyAutoBids` is true, manual bids
 * are excluded and only rows with autoBidRuleId IS NOT NULL come back.
 */
export async function getDriverBidHistory(
  driverId: string,
  opts: { onlyAutoBids?: boolean; limit?: number } = {},
) {
  const limit = opts.limit ?? 50;
  return prisma.bid.findMany({
    where: {
      driverId,
      ...(opts.onlyAutoBids ? { autoBidRuleId: { not: null } } : {}),
    },
    include: { autoBidRule: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * LIVE-WIRE G4 — who is allowed to see the money.
 *
 * A bid's commission breakdown is the DRIVER's wallet: the customer pays
 * `price`, and every field in the breakdown describes what is taken out
 * of that price before the motari is credited. The Kigali team's report
 * was exact — "the passenger can see the amount the driver receives
 * after commission — too much information."
 *
 * So the breakdown is attached per viewer, at the serializer, never
 * stripped in CSS:
 *   - the journey's customer      → no breakdown at all;
 *   - a driver                    → the breakdown on HIS OWN bid only
 *                                   (a rival's payout is no more his
 *                                   business than it is the customer's);
 *   - anyone else (admin tooling) → the full breakdown, unchanged.
 *
 * `requestingUserId` has been on this signature since it was written and
 * was never read; this is what it was for.
 */
export type BidViewerScope = 'customer' | 'driver' | 'privileged';

export function bidViewerScope(
  requestingUserId: string | undefined,
  customerId: string | undefined,
): BidViewerScope {
  if (!requestingUserId) return 'privileged';
  if (customerId && requestingUserId === customerId) return 'customer';
  return 'driver';
}

/**
 * CLEAN-SWEEP G4 — the ROWS, not just the columns.
 *
 * `bidViewerScope` above decided which COLUMNS each viewer got, and
 * COUNTER-READY did the same for the counter columns — both reasoning
 * from "this list is readable by any authenticated caller (the GET route
 * has always been)". That sentence describes the defect it was working
 * around, and this pays it: the rows were never scoped at all.
 *
 * `GET /api/journeys/:id/bids` answered ANY authenticated account with
 * every bid on any journey whose UUID it knew — each rival motari's
 * PRICE, his ETA, his nickname and his plate. Bimoto is a sealed-bid
 * marketplace: a motari who can read what his rivals asked does not bid
 * the same way, and neither does one who knows he is being read. The
 * money columns being scoped did not save it — `price` is the bid.
 *
 * WHO MAY READ, and why:
 *
 *   - the journey's CUSTOMER — every row. She is choosing between them;
 *     the whole list is the decision. Unchanged.
 *   - a driver HOLDING A BID on the journey — his OWN rows, not the
 *     rivals'. The census settled this rather than assuming it: the only
 *     driver surface that reads this route is BidPage's `loadMyCounter`
 *     (BidPage.tsx:112-131), which immediately filters
 *     `b.driverId === user.id` and renders nothing else. No client
 *     surface renders a rival row, so own-bid scope breaks no screen and
 *     is the narrower choice.
 *   - a privileged/no-viewer caller (admin tooling, and
 *     `getBidViewForCustomer`'s internal re-read) — every row, unchanged.
 *   - EVERYONE ELSE — another customer, a driver who has not bid — is
 *     refused with the same 404 the journey family gives an outsider
 *     (INCLUDE-REACH). Not an empty array: `[]` is a claim that this
 *     journey has no bids, which is a different lie and one a rival could
 *     read as intelligence.
 *
 * The matched driver needs no special case: he holds the accepted bid, so
 * own-bid scope already reaches him.
 *
 * READ SCOPE ONLY. Placing, accepting, countering and withdrawing a bid
 * are untouched — this function is not on any of those paths.
 *
 * CENSUS (§0.5), recorded because a privacy narrowing against a pinned
 * decision would not have been this dispatch's call:
 *   - client consumers: BidListPage (the customer, both reads) and
 *     BidPage's own-bid counter read. Nothing else fetches the route.
 *   - e2e: journey-read-authorization.spec never calls this route at all
 *     — its "wider door" language is about the driver FEED
 *     (`GET /api/journeys?viewAs=driver`), exactly as it says. No spec
 *     pins the bids READ.
 *   - server callers: the route, and `getBidViewForCustomer`, which
 *     passes the journey's own customerId and is unaffected.
 * No deliberate pin, and no legitimate consumer the narrowing breaks.
 */
export async function getBidsForJourney(
  journeyId: string,
  requestingUserId?: string,
  options: {
    /**
     * CUTGUARD v2 G6 (B-2) — whether the CALLER can render the customer
     * savings preview. Defaults to false, which is the pre-window shape:
     * a caller that does not say gets the payload v13 handles.
     */
    customerSavingsPreview?: boolean;
  } = {},
) {
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });
  const customer = journey ? await prisma.user.findUnique({ where: { id: journey.customerId } }) : null;
  const scope = bidViewerScope(requestingUserId, journey?.customerId);

  const bids = await prisma.bid.findMany({
    where: {
      journeyId,
      // A driver reads his own bids and nothing else. The customer and
      // privileged callers read the whole list, as before.
      ...(scope === 'driver' ? { driverId: requestingUserId } : {}),
    },
    include: {
      driver: {
        select: {
          nickname: true,
          // MONEY-VIEW v2 G2 — the same field set now applies at the two
          // journey reads that also carry bidders. Lifted out of this
          // query rather than copied into theirs, so there is one answer
          // to "what does a passenger see of a motari who has bid?".
          driverProfile: { select: CURATED_BIDDER_PROFILE_SELECT },
        },
      },
    },
    orderBy: { price: 'asc' },
  });

  // DRIVER-ID v3 G4 — neutral vehicle-change signal: true when the
  // driver's latest VehicleChangeLog row is within the last 7 days.
  // A fact, not an accusation — switching motos is normal life for
  // renters; the client renders it as a plain chip.
  const recentCutoff = new Date(
    Date.now() - VEHICLE_UPDATED_RECENTLY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const driverIds = [...new Set(bids.map((b: any) => b.driverId))];
  const recentChanges = driverIds.length
    ? await prisma.vehicleChangeLog.findMany({
        where: { driverId: { in: driverIds }, changedAt: { gte: recentCutoff } },
        select: { driverId: true },
      })
    : [];
  const recentlyChangedDrivers = new Set<string>(
    recentChanges.map((c: any) => c.driverId),
  );

  // LAUNCH-TRUTH G3 — one batch waiver lookup for all bidding drivers,
  // resolved per bid with the same pure rule the settlement path uses,
  // so the payout a driver (or customer) sees on a bid is the payout
  // that escrow will credit.
  const waiverMap = await getActiveWaiversForDrivers(driverIds);

  // CLEAN-SWEEP G4 — the stranger's refusal.
  //
  // A driver-scoped read that matched no row is either somebody with no
  // bid on this journey or somebody reading a journey that does not
  // exist; neither is entitled to an answer about it. The refusal is the
  // 404 the journey family gives an outsider, NOT an empty array — `[]`
  // asserts "this journey has no bids", which is both false and, to a
  // rival motari, useful.
  //
  // A driver who withdrew or lost his bid lands here too, and that is
  // correct: he is no longer party to the list. The one client that
  // reads this route as a driver treats a non-ok response as "no counter
  // to answer" and renders nothing (BidPage.tsx:115).
  if (scope === 'driver' && bids.length === 0) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }

  return bids.map((bid: any) => {
    const driverRides = bid.driver.driverProfile?.totalRides ?? 0;
    const customerRides = customer?.completedRides ?? 0;
    const commission = calculateCommission(bid.price, driverRides, customerRides);
    const waiverRes = resolveWaiverCommission(
      waiverMap.get(bid.driverId) ?? null,
      commission,
    );

    return {
      id: bid.id,
      journeyId: bid.journeyId,
      driverId: bid.driverId,
      price: bid.price,
      etaMinutes: bid.etaMinutes,
      status: bid.status,
      createdAt: bid.createdAt,
      updatedAt: bid.updatedAt,
      driver: {
        nickname: bid.driver.nickname,
        avgRating: bid.driver.driverProfile ? Number(bid.driver.driverProfile.avgRating) : 0,
        totalRides: bid.driver.driverProfile?.totalRides ?? 0,
        vehicleType: bid.driver.driverProfile?.vehicleType ?? 'MOTO',
        vehicleDescription: bid.driver.driverProfile?.vehicleDescription ?? '',
        registrationPlate: bid.driver.driverProfile?.registrationPlate ?? undefined,
        verificationStatus: bid.driver.driverProfile?.verificationStatus ?? 'PENDING',
        ruraAuthorizationNumber: bid.driver.driverProfile?.ruraAuthorizationNumber ?? null,
        insuranceConfirmed: bid.driver.driverProfile?.insuranceConfirmed ?? false,
        cooperativeName: bid.driver.driverProfile?.cooperativeName ?? null,
        vehicleUpdatedRecently: recentlyChangedDrivers.has(bid.driverId),
      },
      // COUNTER-READY G2 — the counter, scoped to the two people it is
      // between.
      //
      // This list is readable by any authenticated caller (the GET route
      // has always been), so attaching a counter unconditionally would
      // show every bidding motari what the passenger offered a RIVAL —
      // a number that is none of his business and would change how he
      // bids. Same scoping rule commissionBreakdown keeps directly
      // below, and the keys are OMITTED rather than nulled for the same
      // reason it gives.
      //
      // Present in both flag arms: with COUNTER_BID_ENABLED off no row
      // can ever have a counter, so these are null on every bid and the
      // client renders nothing either way.
      ...(scope === 'privileged' ||
      scope === 'customer' ||
      (scope === 'driver' && bid.driverId === requestingUserId)
        ? {
            counterAmountRwf: bid.counterAmountRwf ?? null,
            counterAt: bid.counterAt ?? null,
            counterOutcome: bid.counterOutcome ?? null,
          }
        : {}),
      // MONEY-VIEW v2 G3 — the passenger's OWN side of the same sum.
      //
      // LIVE-WIRE G4 scoped this key off for a customer entirely, which
      // was right about the motari's net and left her confirm dialog
      // reading three fields that were never sent: BidListPage:1414-1423
      // rendered `totalCommissionRate` and `totalCommissionAmount` — dead,
      // and mis-aimed, since rate and amount together reconstruct exactly
      // what the redaction withholds.
      //
      // She gets the customer-safe FOUR instead — the same shape
      // `toCustomerSafeCommission` produces on the journey read, so the
      // screen renders it through the guard it already has. Her tier and
      // what it saved her are HER money, computed from the ladder she is
      // actually on, and nothing here narrows to the driver's payout:
      // `customerSavings` is a function of the CUSTOMER rate alone.
      //
      // No new query. `commission` on the line above is the existing
      // `calculateCommission(bid.price, driverRides, customerRides)` at
      // this same site, with `driverProfile.totalRides` already selected.
      //
      // CUTGUARD v2 G3 — through the projector. The four fields were
      // already the right four; what changes is that they are now MINTED
      // by the only function allowed to mint them, so this arm and the
      // accept arm below cannot drift apart the way they did after #207.
      //
      // CUTGUARD v2 G6 (B-2) — and scoped to a client that can RENDER it.
      //
      // A v13 BidListPage reads `totalCommissionAmount.toLocaleString()`
      // off this object. MONEY-VIEW's customer-safe shape does not carry
      // that key, so handing it to a v13 phone is a crash on the confirm
      // dialog — during a rollout, on the screen where she is about to
      // pay. The key is OMITTED for a legacy caller rather than nulled,
      // which is exactly the shape v13 has always coped with (before #207
      // a customer got no breakdown at all), and the omission is the
      // whole payload difference.
      ...(scope === 'customer' && options.customerSavingsPreview
        ? {
            commissionBreakdown: toCustomerSafeCommission({
              bidPrice: bid.price,
              customerTier: commission.customerTier.tier,
              customerSavings: commission.customerSavings,
              feeWaiverApplied: waiverRes.waiverId !== null,
            }),
          }
        : {}),
      // G4 — attached only for the eyes it belongs to. The key is
      // OMITTED, not zeroed: a customer response that carried
      // `commissionBreakdown: null` would still be a place for the next
      // change to leak into.
      ...(scope === 'privileged' ||
      (scope === 'driver' && bid.driverId === requestingUserId)
        ? {
            // CUTGUARD v2 G3 — through the DRIVER projector. Same
            // thirteen values, same nominal-vs-charged rule; what
            // changes is that the ladder's shape is now built in one
            // place, so this arm and the accept path cannot drift.
            commissionBreakdown: toFullCommissionBreakdown({
              bidPrice: bid.price,
              commission,
              waiver: waiverRes,
            }),
          }
        : {}),
    };
  });
}

/**
 * LIVE-WIRE G2 — one bid, in the shape the passenger's list renders.
 *
 * `POST /journeys/:id/bids` used to emit the raw Prisma row over the
 * socket, which carries no `driver {}`. The row therefore appeared on
 * the passenger's screen in ~15 ms with no name and no rating, and only
 * became a real offer when the poll replaced it up to ten seconds later
 * — the whole of the field's "bids are too slow to appear" on this side
 * (docs/live-wire-measurements.md §1).
 *
 * Reuses `getBidsForJourney` rather than duplicating the mapper, so the
 * socket payload and the polled payload can never drift — including the
 * G4 role scoping: the `journey:<id>` room contains only the customer
 * while a journey is REQUESTED, so this is serialized for the customer
 * and carries no commission data.
 */
export async function getJourneyCustomerId(journeyId: string): Promise<string | null> {
  const journey = await prisma.journey.findUnique({
    where: { id: journeyId },
    select: { customerId: true },
  });
  return journey?.customerId ?? null;
}

export async function getBidViewForCustomer(journeyId: string, bidId: string) {
  const journey = await prisma.journey.findUnique({
    where: { id: journeyId },
    select: { customerId: true },
  });
  // CUTGUARD v2 G6 (B-2) — the SOCKET payload takes the legacy shape, and
  // this is a deliberate choice with a stated cost.
  //
  // A socket push has no request and therefore no `X-App-Version`: the
  // connection was made once and this function is called from a broadcast,
  // not from a caller who said what they are. With no signal, the safe
  // direction is the only direction — a v13 passenger who received a
  // savings preview here would crash on her confirm dialog exactly as she
  // would on the polled read (B-2), and a socket crash is worse because
  // she did not do anything to cause it.
  //
  // THE COST, stated rather than discovered: during the rollout window a
  // v14 passenger sees the savings line when the list is FETCHED and not
  // on the live push, so it appears on her next refresh rather than the
  // instant the bid lands. A missing line is a smaller failure than a
  // white screen.
  //
  // THE FOLLOW-UP: carry the app version through the socket handshake
  // (where the client already sends its token) and pass it here. That is
  // real plumbing and it is not this dispatch's; docs/rollout-window.md
  // records it. Once every client is >= 14 the gate can simply go.
  const bids = await getBidsForJourney(journeyId, journey?.customerId);
  return bids.find((b: any) => b.id === bidId) ?? null;
}

export async function createBid(
  journeyId: string,
  driverId: string,
  price: number,
  etaMinutes: number,
) {
  // Validate journey is REQUESTED
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });

  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }

  if (journey.status !== JourneyStatus.REQUESTED) {
    throw new AppError(400, 'JOURNEY_NOT_ACCEPTING_BIDS', 'errors.journeyNotAcceptingBids');
  }

  // Scheduled-ride bid-window enforcement: refuse out-of-window bids.
  if (journey.bookingMode === BookingMode.SCHEDULED) {
    assertBidWindowOpen({
      status: journey.status,
      bookingMode: journey.bookingMode,
      bidWindowOpensAt: journey.bidWindowOpensAt,
      autoFallbackAt: journey.autoFallbackAt,
    });
  }

  // Check driver hasn't already bid
  const existingBid = await prisma.bid.findUnique({
    where: { journeyId_driverId: { journeyId, driverId } },
  });

  if (existingBid) {
    throw new AppError(409, 'ALREADY_BID', 'errors.alreadyBid');
  }

  // R3-N-4 — graduated penalty suspension gate. A driver whose
  // noShowCount crossed SUSPENSION_24H_THRESHOLD has User.suspendedUntil
  // set to a future timestamp; reject all bids until that time.
  const driver = await prisma.user.findUnique({
    where: { id: driverId },
    select: { suspendedUntil: true },
  });
  if (driver?.suspendedUntil && driver.suspendedUntil.getTime() > Date.now()) {
    throw new AppError(403, 'DRIVER_SUSPENDED', 'errors.driverSuspended', {
      suspendedUntil: driver.suspendedUntil.toISOString(),
    });
  }

  // Validate driver has a profile and vehicle matches
  const driverProfile = await prisma.driverProfile.findUnique({
    where: { userId: driverId },
  });

  if (!driverProfile) {
    throw new AppError(404, 'DRIVER_PROFILE_NOT_FOUND', 'errors.driverProfileNotFound');
  }

  // DRIVER-ID v3 — REVOKED is absolute: it blocks bidding even for
  // vehicle types with no regulatory requirements (which skip the
  // compliance-aware gate below) and even under SKIP_DRIVER_VERIFICATION.
  if (driverProfile.verificationStatus === 'REVOKED') {
    throw new AppError(403, 'DRIVER_NOT_VERIFIED', 'errors.driverNotVerified');
  }

  // Driver verification gate — compliance-aware
  if (!config.SKIP_DRIVER_VERIFICATION) {
    const compliance = getVehicleCompliance(driverProfile.vehicleType);
    const missing = checkDriverCompliance(driverProfile.vehicleType, driverProfile);

    // For vehicle types that have ANY regulatory requirements, check verification status
    const hasAnyRequirement = compliance.licenseRequired || compliance.ruraRequired ||
      compliance.insuranceRequired || compliance.cooperativeRequired;

    if (hasAnyRequirement && driverProfile.verificationStatus !== 'VERIFIED') {
      throw new AppError(403, 'DRIVER_NOT_VERIFIED', 'errors.driverNotVerified');
    }

    // Even for regulated vehicle types, check specific missing items
    if (missing.length > 0 && hasAnyRequirement) {
      throw new AppError(403, 'DRIVER_INCOMPLETE_COMPLIANCE', 'errors.driverIncompleteCompliance', {
        missing,
      });
    }
  }

  if (journey.vehiclePreference && journey.vehiclePreference !== driverProfile.vehicleType) {
    throw new AppError(400, 'VEHICLE_MISMATCH', 'errors.vehicleMismatch');
  }

  const bid = await prisma.bid.create({
    data: {
      journeyId,
      driverId,
      price,
      etaMinutes,
      status: BidStatus.PENDING,
    },
  });

  // Dispatch K3 — fire-and-forget auto-accept evaluator. Runs in
  // setImmediate so createBid returns to the driver immediately;
  // auto-accept happens asynchronously and reuses the existing
  // acceptBid path (vehicle / ownership / commission / escrow checks
  // all run identically). Errors never block the driver — they are
  // logged but the bid still sits in the pool for manual accept.
  setImmediate(() => {
    tryAutoAcceptBid(prisma, journeyId, bid.id, new Date()).catch((err) => {
      console.warn('[K3] auto-accept-hook-failed', {
        journeyId,
        bidId: bid.id,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  });

  return bid;
}

/**
 * Pre-charge core shared by the MoMo (`acceptBid`) and card
 * (`acceptBidForCard`) acceptance flows. Performs everything up to and
 * including escrow creation (PENDING) and the recipient en-route SMS,
 * but deliberately does NOT charge any payment gateway. The two public
 * wrappers add their payment-method-specific tail:
 *   - `acceptBid`        → chargeMomo, then return the original shape.
 *   - `acceptBidForCard` → return the escrow's txRef/amount so the
 *                          client can drive the Flutterwave widget.
 *
 * On the scheduled-ride conflict-warning branch this returns
 * `{ matched: false, conflictWarning }` — identical for both flows, so
 * the conflict gate behaves the same regardless of payment method.
 */
async function acceptBidCore(
  journeyId: string,
  actor: BidAcceptActor,
  bidId: string,
  options: { acknowledgeConflict?: boolean; autoFallback?: boolean } = {},
) {
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });

  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }

  // CUTGUARD v2 G4 — the ownership check, now against the SESSION.
  //
  // This read `journey.customerId !== customerId` with `customerId` a
  // bare string, and POST /scheduled-rides/:id/conflict-acknowledge
  // passed `journey.customerId` into it — the row against itself. It
  // could not fail. A stranger motari matched a passenger at a price she
  // never accepted, with her money HELD.
  //
  // Three actor kinds are spelled out because there ARE three, and the
  // old single parameter hid two of them. Only a customer actor is
  // checked here; the other two are authorised by a different and real
  // check (named in session-actor.ts), and skipping it explicitly is the
  // difference between "not applicable" and "passed vacuously".
  if (actor.kind === 'customer' && journey.customerId !== actor.customerId) {
    throw new AppError(403, 'NOT_JOURNEY_CUSTOMER', 'errors.notJourneyCustomer');
  }

  // WHOSE RIDE IT IS, as opposed to who is acting. Everything below this
  // line — the escrow's customer, the AML same-pair count, the MoMo
  // charge, the name-mismatch watch — is about the PASSENGER who owns
  // this journey, and always was. The old parameter conflated the two
  // only because in the legitimate paths they were the same value; the
  // check above is what makes them the same value, and this line is what
  // says so. Every statement below reads this name exactly as before, so
  // the transaction body is byte-for-byte unchanged.
  const customerId = journey.customerId;

  const bid = await prisma.bid.findUnique({ where: { id: bidId } });

  if (!bid) {
    throw new AppError(404, 'BID_NOT_FOUND', 'errors.bidNotFound');
  }

  if (bid.journeyId !== journeyId) {
    throw new AppError(400, 'BID_JOURNEY_MISMATCH', 'errors.bidJourneyMismatch');
  }

  if (bid.status !== BidStatus.PENDING) {
    throw new AppError(400, 'BID_NOT_PENDING', 'errors.bidNotPending');
  }

  // Scheduled-ride: soft-block warning when the matched driver has a
  // conflicting commitment within ±30min. Auto-fallback bypasses the gate
  // (system-initiated, not a user action).
  if (
    journey.bookingMode === BookingMode.SCHEDULED &&
    journey.scheduledFor &&
    !options.autoFallback
  ) {
    const conflictResult = await assertNoBlockingConflict(
      bid.driverId,
      { scheduledFor: journey.scheduledFor },
      { allowOverride: true },
    );
    const realConflicts = conflictResult.conflictingRides.filter((r: any) => r.id !== journeyId);
    if (realConflicts.length > 0 && !options.acknowledgeConflict) {
      return {
        matched: false as const,
        conflictWarning: {
          conflictingRides: realConflicts.map((r: any) => ({
            id: r.id,
            scheduledFor: r.scheduledFor,
            pickupName: r.pickupName,
            destinationName: r.destinationName,
          })),
        },
      };
    }
    if (realConflicts.length > 0 && options.acknowledgeConflict) {
      for (const r of realConflicts) {
        await recordConflictOverride(bid.driverId, journeyId, r.id);
      }
    }
  }

  // Transition journey REQUESTED -> MATCHED
  const nextJourneyStatus = transitionJourney(
    journey.status as JourneyStatus,
    JourneyAction.ACCEPT_BID,
  );

  // Transition this bid PENDING -> ACCEPTED
  const nextBidStatus = transitionBid(bid.status as BidStatus, BidAction.ACCEPT);

  // Calculate tiered commission
  const driverProfile = await prisma.driverProfile.findUnique({
    where: { userId: bid.driverId },
  });

  const customer = await prisma.user.findUnique({ where: { id: customerId } });

  const commission = calculateCommission(
    bid.price,
    driverProfile?.totalRides ?? 0,
    customer?.completedRides ?? 0,
  );

  // LAUNCH-TRUTH G3 — compute-then-zero. The nominal tier commission
  // above is always computed; an active fee waiver zeroes the CHARGED
  // amount and the driver keeps the whole fare. Same resolver as the
  // preview paths, so the payout shown before bidding is the payout
  // credited at settlement.
  const waiverRes = await applyWaiver(bid.driverId, commission);
  const commissionAmount = waiverRes.charged;

  // AML check: single transaction limit
  if (bid.price > AML_SINGLE_TRANSACTION_LIMIT) {
    console.warn(`[AML] Large transaction: ${bid.price} RWF on journey ${journeyId}`);
    // Flag but don't block for MVP — log for BNR reporting
  }

  // AML check: same pair frequency
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const pairCount = await prisma.journey.count({
    where: {
      customerId,
      driverId: bid.driverId,
      status: 'COMPLETED',
      confirmedAt: { gte: todayStart },
    },
  });
  if (pairCount >= AML_SAME_PAIR_DAILY_LIMIT) {
    console.warn(`[AML] Same pair ${customerId}/${bid.driverId}: ${pairCount + 1} rides today`);
  }

  // BID-ATOMICITY G1 — the decision and every consequence are ONE atomic
  // unit. Everything read above (journey, bid, guards) is a stale
  // eligibility pre-check; the transaction below re-asserts it as update
  // predicates and lets the affected-row count decide who won. Two accepts
  // racing on the same journey both pass the stale guards, but only one
  // claim matches — the loser throws BID_NOT_PENDING (the same 400 a
  // sequential second accept gets), the transaction rolls back, and the
  // losing caller leaves NO trace: no bid flip, no journey re-point, no
  // declined rivals, no escrow.
  //
  // Claim order is journey first, then the bid, then the rival bids.
  // Every accept path (manual MoMo, card, auto-accept) takes row locks in
  // that same order, so racing accepts serialize on the journey row
  // instead of deadlocking on each other's bid rows.
  const { result, escrow, losingBids } = await prisma.$transaction(async (tx: any) => {
    // Claim the journey: predicated on the pre-transition status the
    // guards validated (REQUESTED). R3-N-1: matchedAt is stamped in the
    // same statement as the REQUESTED→MATCHED flip so cancel-flow
    // elapsed-time gates (DRIVER_NO_SHOW ≥ 8min, DRIVER_LATE ≥ 12min,
    // etc.) have an authoritative timestamp. R3-T: URGENT_MESSENGER also
    // stamps targetCompletionAt = matchedAt + 30 min here.
    const matchedAt = new Date();
    const targetCompletionAt =
      journey.type === 'URGENT_MESSENGER'
        ? new Date(matchedAt.getTime() + URGENT_TARGET_DURATION_MS)
        : null;
    const journeyClaim = await tx.journey.updateMany({
      where: { id: journeyId, status: journey.status },
      data: {
        status: nextJourneyStatus,
        driverId: bid.driverId,
        agreedPrice: bid.price,
        commissionAmount,
        matchedAt,
        targetCompletionAt,
      },
    });
    if (journeyClaim.count === 0) {
      throw new AppError(400, 'BID_NOT_PENDING', 'errors.bidNotPending');
    }

    // Claim the bid: PENDING → ACCEPTED, predicated on PENDING. A rival
    // accept that already declined this bid makes this count 0.
    const bidClaim = await tx.bid.updateMany({
      where: { id: bidId, status: BidStatus.PENDING },
      data: { status: nextBidStatus },
    });
    if (bidClaim.count === 0) {
      throw new AppError(400, 'BID_NOT_PENDING', 'errors.bidNotPending');
    }

    // Decline all other pending bids for this journey.
    //
    // LIVE-WIRE G2/G3 — read the losers BEFORE the flip, inside the same
    // transaction, so the set announced to those drivers is exactly the
    // set this accept declined. Reading afterwards would also sweep up
    // bids a concurrent path declined, and reading outside the
    // transaction could miss one entirely.
    const losingBids = await tx.bid.findMany({
      where: { journeyId, id: { not: bidId }, status: BidStatus.PENDING },
      select: { id: true, driverId: true },
    });
    await tx.bid.updateMany({
      where: {
        journeyId,
        id: { not: bidId },
        status: BidStatus.PENDING,
      },
      data: { status: BidStatus.DECLINED },
    });

    const updatedJourney = await tx.journey.findUnique({ where: { id: journeyId } });
    const acceptedBid = await tx.bid.findUnique({ where: { id: bidId } });

    // Create escrow (PENDING) inside the same boundary as the claim, so
    // the escrow row can only ever belong to the accept that committed.
    // totalCommissionAmount carries the CHARGED amount (0 under a
    // waiver); the nominal amount lives in waivedCommissionAmount so the
    // record of what was forgiven survives on the escrow row.
    const escrowAmounts = {
      totalCommissionAmount: waiverRes.charged,
      driverPayout: waiverRes.effectiveDriverPayout,
      driverTier: commission.driverTier,
      customerTier: commission.customerTier,
      waivedCommissionAmount: waiverRes.waived,
      feeWaiverId: waiverRes.waiverId,
    };

    // SETTLE-UP G2 — adopt, don't create.
    //
    // A journey released by a MACHINE (webhook, reconciler, unpaid-match
    // reaper) comes back to REQUESTED still owning its FAILED escrow, so
    // this create used to die on the journeyId unique and answer 500 —
    // the customer stranded by the tidy-up that was supposed to free
    // them. The surviving row is the only escrow this journey may ever
    // have, so the accept adopts it: revived through the state machine's
    // single edge out of FAILED, carrying THIS bid's amounts, with the
    // supersession appended to its chain (escrow.service.adoptEscrowTx).
    //
    // Read inside the transaction, after the journey claim: only the
    // accept that won the journey ever reaches this line, and the adopt
    // re-asserts the FAILED status as its own update predicate.
    const survivingEscrow = await tx.escrow.findUnique({ where: { journeyId } });

    const createdEscrow = survivingEscrow
      ? await escrowService.adoptEscrowTx(
          tx,
          survivingEscrow,
          customerId,
          bid.driverId,
          bid.price,
          escrowAmounts,
        )
      : await escrowService.createEscrowTx(
          tx,
          journeyId,
          customerId,
          bid.driverId,
          bid.price,
          escrowAmounts,
        );

    return {
      result: { journey: updatedJourney, bid: acceptedBid },
      escrow: createdEscrow,
      losingBids,
    };
  });

  // Dispatch Q — journey just exited REQUESTED. Centralised cleanup
  // (cancels K3 suggest-up timers; future per-journey timers attach
  // here too). Post-commit: the claim above is already durable.
  onJourneyExitsRequested(journeyId, 'bid-accepted');

  // R3-DELIVERY-NOTIFICATIONS / R3-DELIVERY-NOTIFICATIONS-2 —
  // fire-and-forget recipient SMS when a goods journey has been matched.
  // Post-commit: SMS failure must not unwind the bid acceptance. Filters
  // to GOODS_DROPOFF only (the pickup leg's contactPhone is the sender,
  // not the recipient — sending an "en-route" SMS to the sender doesn't
  // make sense). Iterates per-recipient so multi-stop journeys notify
  // every recipient independently. Per-leg recipientLanguage wins; falls
  // back to the customer's language. Payment-method-agnostic: the driver
  // is matched once the bid is accepted, before either gateway confirms.
  if (customer) {
    const legs = await prisma.leg.findMany({ where: { journeyId } });
    const recipientLegs = legs.filter(
      (leg: any) => leg.contactPhone && leg.type === 'GOODS_DROPOFF',
    );
    const eta =
      legs
        .filter((l: any) => l.status === 'PENDING')
        .reduce(
          (sum: number, l: any) => sum + (l.expectedDurationMinutes ?? 0),
          0,
        ) || bid.etaMinutes || 15;
    recipientLegs.forEach((leg: any) => {
      notifyRecipientDriverEnRoute({
        recipientPhone: leg.contactPhone!,
        language: leg.recipientLanguage ?? customer.language,
        customerName: customer.nickname,
        estimatedMinutes: eta,
      });
    });
  }

  // CUTGUARD v2 G3 — the full ladder, explicitly DRIVER-typed.
  //
  // acceptBidCore must compute all of it: the escrow row is written from
  // these numbers inside the transaction above. What changed is that it
  // is no longer handed onward untyped, so a caller answering a CUSTOMER
  // cannot forward it by accident — `FullCommissionBreakdown` is not
  // assignable to `CustomerSafeCommission`, and tsc says so at the call
  // site rather than a passenger finding out on her receipt.
  const commissionBreakdown: FullCommissionBreakdown = toFullCommissionBreakdown({
    bidPrice: bid.price,
    commission,
    waiver: waiverRes,
  });

  return {
    matched: true as const,
    result,
    escrow,
    customer,
    customerId,
    bid,
    commissionBreakdown,
    // LIVE-WIRE G2/G3 — the drivers this accept closed out, captured
    // inside the winning transaction (see above). Consumed by the
    // MoMo wrapper's outcome announcement.
    losingBids: losingBids as Array<{ id: string; driverId: string }>,
  };
}

export async function acceptBid(
  journeyId: string,
  actor: BidAcceptActor,
  bidId: string,
  options: {
    acknowledgeConflict?: boolean;
    autoFallback?: boolean;
    /**
     * CUTGUARD v2 amendment 2 — B-2's fourth surface. See the note above
     * this return's `commissionBreakdown`. Defaults to false: absent, the
     * key is OMITTED, which is the shape every generation has coped with.
     */
    customerSavingsPreview?: boolean;
  } = {},
) {
  const core = await acceptBidCore(journeyId, actor, bidId, options);
  if (!core.matched) {
    // Scheduled-ride conflict-warning path — same shape as before.
    return core;
  }

  const { result, escrow, customer, customerId, bid, commissionBreakdown } = core;

  // CUTGUARD v2 G3 (U-4) — the passenger's view of the same sum.
  //
  // This return is customer-facing on every one of its exits: the route
  // is `customerOnly` and answers her directly, and the journey-room
  // `bid-accepted` fan-out reaches her too (the winning motari's
  // join is refused while the journey is REQUESTED — he learns on his
  // own user room, from bid-outcome.ts, with `{journeyId, bidId}`, and
  // reads his settlement from `GET /journeys/:id`, which projects per
  // viewer). So it carried `driverPayout` — the motari's net — plus
  // `totalCommissionAmount` and `totalCommissionRate`, either of which
  // reconstructs it from the price. #207 removed exactly these from the
  // bid LIST and this exit kept them.
  //
  // The full ladder is still computed and still writes the escrow; only
  // what is ANSWERED narrows.
  const customerCommission: CustomerSafeCommission =
    toCustomerSafeCommission(commissionBreakdown);

  // LIVE-WIRE G2/G3 — tell the motaris, BEFORE the gateway leg.
  //
  // The match is already durable here: acceptBidCore's transaction has
  // committed, the journey is MATCHED and points at this driver, the
  // rivals are DECLINED. Waiting for chargeMomo would put a whole
  // gateway round-trip between the customer's tap and the motari's
  // phone for no gain — and would not even protect him, because a hard
  // decline takes the 'keep-match' disposition (PAY-TRUTH G2): the
  // journey stays MATCHED and the motari stays assigned while the
  // customer retries. He has the ride either way, so he is told either
  // way, as early as it is true.
  //
  // Fire-and-forget, and deliberately not on the card path: an
  // acceptBidForCard escrow is unverified until the widget succeeds, so
  // a customer who closes it leaves a match the reaper reclaims — a
  // motari told about that would have been told a lie.
  announceBidOutcome({
    journeyId,
    accepted: { bidId, driverId: bid.driverId },
    declined: core.losingBids,
  });

  // Initiate the MoMo charge against the customer. MoMo flow is almost always
  // PENDING (USSD push to the customer's phone); the webhook (Dispatch B) or
  // the polling reconciliation job confirms it. We surface the current escrow
  // status so the client can render "Awaiting MoMo confirmation".
  let escrowStatus: string = escrow.status;
  // PAY-TRUTH G2 — the gateway's own reason for a declined charge, so the
  // client can name what went wrong in passenger words instead of showing
  // one generic "payment failed" for insufficient funds, a wrong wallet
  // and a validation error alike.
  let paymentFailureCode: string | null = null;
  if (customer && escrow.txRef) {
    try {
      const charge = await chargeMomo({
        // Gateway phone_number — the USSD push goes to this handset.
        phone: decryptedPhone(customer),
        amount: bid.price,
        txRef: escrow.txRef,
        narration: `Bimoto ride ${journeyId.slice(0, 8)}`,
        customerId,
        escrowId: escrow.id,
      });
      // D17 WATCH MODE — the name-mismatch alarm starts keeping its
      // logbook, at the ONE place in the repo where a wallet name
      // actually arrives.
      //
      // recordNameMismatchIfDifferent has existed unreferenced since it
      // was written. Its input needs a walletNameOnReceipt, and the hunt
      // for where one arrives ends here: chargeMomo returns it (from the
      // gateway's `data.customer.name`, charge.ts:92) and this is the
      // only caller of chargeMomo that has the escrow, the customer and
      // the txRef in scope at the same time. It is a REAL source, not a
      // stub — the fallback the dispatch allowed for is not needed.
      //
      // What it watches: the name on the MoMo wallet that paid versus the
      // name on the Bimoto account that booked. A large edit distance
      // between them is the shape of one person paying with another
      // person's wallet, which is worth counting long before it is worth
      // acting on.
      //
      // OBSERVE-ONLY, by the function's own construction: it wraps its
      // own write in try/catch and returns a verdict nobody here reads.
      // Fire-and-forget with a second catch on top, so it cannot reach
      // the payment path even if a future edit gave it a throwing branch.
      // Nothing about the charge, the escrow or the response changes.
      //
      // REVISIT AT THE PAYMENTS GATE: the distance threshold (<=2) is a
      // desk guess, and a month of real rows is what should set it.
      void recordNameMismatchIfDifferent({
        escrowId: escrow.id,
        customerId,
        walletNameOnReceipt: charge.walletNameOnReceipt,
        accountName: customer.nickname,
        txRef: escrow.txRef,
      }).catch((err) => {
        console.warn('[D17-WATCH] name-match check failed (observe-only)', {
          escrowId: escrow.id,
          err: err instanceof Error ? err.message : String(err),
        });
      });

      if (charge.status === 'SUCCESS' && charge.flwTxId) {
        await escrowService.markEscrowChargeSucceeded(escrow.id, charge.flwTxId);
        escrowStatus = 'HELD';
      }
      // PENDING is the common case — leave the escrow row PENDING; the
      // webhook/reconciler will resolve it.
    } catch (err) {
      const flw = err instanceof FlutterwaveError ? err : null;
      // NO_KEYS_CONFIGURED in dev/test: leave the escrow PENDING so the rest
      // of the flow (and the existing test suite) continues to work without
      // a real gateway. The reconciler will not transition rows whose
      // attempt is fresh (<30s) anyway.
      if (flw && flw.code === 'NO_KEYS_CONFIGURED') {
        // E2E only: with no gateway to confirm the charge, escrow would stay
        // PENDING forever, making the downstream FREEZE/REFUND/RELEASE
        // transitions illegal and blocking the e2e specs. Behind a dedicated
        // flag (set ONLY in .github/workflows/e2e.yml), simulate a successful
        // charge so escrow reaches HELD. We deliberately do NOT key this off
        // NODE_ENV: jest unit tests run under NODE_ENV=test and rely on the
        // escrow staying PENDING here (see the warn branch below). Production
        // charge behaviour is unchanged — the flag is unset everywhere else.
        if (process.env.E2E_FAKE_PAYMENTS === '1') {
          const syntheticFlwTxId = `e2e-${escrow.id}-${Date.now()}`;
          await escrowService.markEscrowChargeSucceeded(escrow.id, syntheticFlwTxId);
          escrowStatus = 'HELD';
        } else {
          console.warn(`[PAYMENT] No FLW keys; escrow ${escrow.id} stays PENDING`);
        }
      } else if (flw && !flw.retryable) {
        // PAY-TRUTH G2 — 'keep-match': the customer is on the BidListPage
        // right now, watching this request. Reverting the journey here is
        // what used to strand them (docs/payment-failure-matrix.md R1);
        // instead the match is held so the retry surface can charge the
        // SAME escrow again and they keep this motari.
        await escrowService.markEscrowChargeFailed(
          escrow.id,
          flw.code,
          undefined,
          'keep-match',
        );
        escrowStatus = 'FAILED';
        paymentFailureCode = flw.code;
      } else {
        // Retryable error (network/timeout/5xx) — leave PENDING; reconciler
        // will retry via verify after 30s.
        console.warn(
          `[PAYMENT] Transient charge error for escrow ${escrow.id}:`,
          flw?.code ?? err,
        );
      }
    }
  }

  return {
    ...result,
    escrowStatus,
    // PAY-TRUTH G3 — everything the retry surface needs to charge this
    // escrow again without a reload: which escrow, which reference (the
    // card widget charges against txRef), and what went wrong.
    escrowId: escrow.id,
    escrowTxRef: escrow.txRef,
    escrowAmount: escrow.amount,
    paymentFailureCode,
    // CUTGUARD v2 amendment 2 — B-2 is a CLASS, and this is its fourth
    // instance. It is the subtlest, so the reasoning is written down.
    //
    // v13's BidListPage does `setActiveJourney(updated)` with THIS body
    // and navigates to MatchedPage, whose commission block dereferences
    // `totalCommissionAmount` / `totalCommissionRate` / `driverPayout` —
    // none of which a customer-safe projection carries, and none of which
    // it may. That normally does not crash, because MatchedPage returns a
    // spinner until its own `GET /journeys/:id` resolves and overwrites
    // the store. But when that refetch FAILS, `isLoading` still clears in
    // the `finally`, and the page renders THIS payload. A failed fetch in
    // the seconds after a mobile-money round trip is not an exotic state
    // on the network these phones are on, and the screen it white-screens
    // is the one she lands on having just paid.
    //
    // So it is gated like the other three, and the default is legacy.
    ...(options.customerSavingsPreview
      ? { commissionBreakdown: customerCommission }
      : {}),
  };
}

/**
 * Card-payment sibling of `acceptBid`. Runs the identical pre-charge core
 * (validation, conflict gate, state transition, commission, escrow
 * creation in PENDING) but skips the MoMo gateway entirely. Returns the
 * escrow's `txRef` + `amount` under `cardCheckout` so the client can
 * initialise the Flutterwave Inline widget; the charge is later verified
 * via `POST /api/payments/initiate-card`, which flips the escrow to HELD.
 *
 * The escrow stays PENDING when this returns — exactly as the MoMo flow
 * leaves it before its own gateway confirmation.
 */
export async function acceptBidForCard(
  journeyId: string,
  actor: BidAcceptActor,
  bidId: string,
  options: {
    acknowledgeConflict?: boolean;
    autoFallback?: boolean;
    /** Card sibling of `acceptBid`'s gate, same default and same reason. */
    customerSavingsPreview?: boolean;
  } = {},
) {
  const core = await acceptBidCore(journeyId, actor, bidId, options);
  if (!core.matched) {
    // Same scheduled-ride conflict-warning shape as acceptBid.
    return core;
  }

  const { result, escrow, bid, commissionBreakdown } = core;

  // CUTGUARD v2 G3 (U-4) — the card sibling of the same exit, and the
  // same audience: `customerOnly`, answered directly. It carried the
  // identical thirteen keys.
  const customerCommission: CustomerSafeCommission =
    toCustomerSafeCommission(commissionBreakdown);

  return {
    ...result,
    escrowStatus: escrow.status,
    // Same gate, same default, same reason as the MoMo sibling above.
    ...(options.customerSavingsPreview
      ? { commissionBreakdown: customerCommission }
      : {}),
    paymentMethod: 'card' as const,
    cardCheckout: {
      escrowId: escrow.id,
      txRef: escrow.txRef,
      amount: escrow.amount ?? bid.price,
    },
  };
}

// Every WITHDRAWN write stamps its provenance: 'USER' for a human driver
// acting through the app or SMS, 'SYSTEM' for server-initiated machinery.
// The bid-cycle-ring detector ignores SYSTEM withdrawals.
/**
 * TEAM-ANSWERS G4 (OPEN DECISIONS item 16a, Kigali team, 18 August) —
 * the passenger says no to ONE driver's offer.
 *
 * Before this there was no way to decline a single bid: the only thing
 * that ever set DECLINED was accepting a rival, which mass-declined
 * everybody else. A passenger who did not want a particular motari's
 * offer could only ignore it and wait for the clock.
 *
 * Nothing about the journey moves. The request stays open, the other
 * offers stay live, no escrow exists yet and none is created — this
 * closes one offer and nothing else. The state machine already had the
 * edge (PENDING + DECLINE -> DECLINED); it was simply never reachable
 * from the customer side.
 *
 * The repeat is 409 ALREADY_DECLINED, matching this file's own
 * ALREADY_BID and rating.service's ALREADY_RATED — the codebase's
 * dominant idiom for "you already did this".
 */
export async function declineBid(
  journeyId: string,
  customerId: SessionUserId,
  bidId: string,
) {
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });

  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }

  if (journey.customerId !== customerId) {
    throw new AppError(403, 'NOT_JOURNEY_CUSTOMER', 'errors.notJourneyCustomer');
  }

  const bid = await prisma.bid.findUnique({ where: { id: bidId } });

  if (!bid) {
    throw new AppError(404, 'BID_NOT_FOUND', 'errors.bidNotFound');
  }

  // A bid id from another journey is not this passenger's to touch.
  // 404, not 400: they are not entitled to learn it exists.
  if (bid.journeyId !== journeyId) {
    throw new AppError(404, 'BID_NOT_FOUND', 'errors.bidNotFound');
  }

  if (bid.status === BidStatus.DECLINED) {
    throw new AppError(409, 'ALREADY_DECLINED', 'errors.alreadyDeclined');
  }

  if (bid.status !== BidStatus.PENDING) {
    throw new AppError(400, 'BID_NOT_PENDING', 'errors.bidNotPending');
  }

  // Ask the machine rather than assume the target, exactly as
  // withdrawBid does.
  const nextStatus = transitionBid(bid.status as BidStatus, BidAction.DECLINE);

  // Predicated on PENDING, so a decline racing an accept of the SAME bid
  // loses cleanly instead of overwriting a committed match. The accept
  // side is already symmetric: acceptBidCore refuses a non-PENDING bid
  // up front and claims it with the same predicate inside its
  // transaction, so a DECLINED bid can never be accepted afterwards.
  const claim = await prisma.bid.updateMany({
    where: { id: bidId, status: BidStatus.PENDING },
    data: { status: nextStatus },
  });

  if (claim.count === 0) {
    throw new AppError(400, 'BID_NOT_PENDING', 'errors.bidNotPending');
  }

  return prisma.bid.findUnique({ where: { id: bidId } });
}

export async function withdrawBid(
  bidId: string,
  driverId: string,
  source: 'USER' | 'SYSTEM',
) {
  const bid = await prisma.bid.findUnique({ where: { id: bidId } });

  if (!bid) {
    throw new AppError(404, 'BID_NOT_FOUND', 'errors.bidNotFound');
  }

  if (bid.driverId !== driverId) {
    throw new AppError(403, 'NOT_BID_OWNER', 'errors.notBidOwner');
  }

  const nextStatus = transitionBid(bid.status as BidStatus, BidAction.WITHDRAW);

  const updated = await prisma.bid.update({
    where: { id: bidId },
    data: { status: nextStatus, withdrawnSource: source },
  });

  return updated;
}

// ─────────────────────────────────────────────────────────────────────
// COUNTER-READY G2 — one counter-offer per bid.
//
// Ruling D4 (24 Aug) decided that a passenger may suggest a different
// number for exactly one motari's offer, exactly once. The dormant
// -shipping decision (25 Aug) decided that the experiment starts only
// after weeks of plain-bidding baseline, so everything below ships in
// APK 14 ASLEEP: with COUNTER_BID_ENABLED unset, both endpoints refuse
// at their first line and nothing here can be reached.
//
// THE MONEY PATH IS NOT FORKED. A counter that the motari accepts does
// not get its own charge, its own escrow or its own transaction: the
// price on the bid row is flipped to the agreed number and then
// `acceptBid` is called — the same function the customer's own tap
// calls, the same function auto-accept calls (customer-modes/auto-accept
// .ts, complete with its own note that reusing it is the point), the
// same acceptBidCore transaction, the same single-winner claim, the same
// escrow, the same commission ladder, the same chargeMomo. Agreement
// enters the existing path; it does not build a second one.
// ─────────────────────────────────────────────────────────────────────

/**
 * The dormant switch, asserted at the top of every counter entry point.
 *
 * 403 rather than 404: the route EXISTS, the caller is simply not
 * allowed to use it yet, and a 404 would make a disabled experiment
 * indistinguishable from a typo when the founder is checking whether the
 * flip took on the pilot server.
 */
function assertCounterEnabled(): void {
  if (!config.COUNTER_BID_ENABLED) {
    throw new AppError(403, 'COUNTER_DISABLED', 'errors.counterDisabled');
  }
}

/**
 * The passenger suggests a different price for ONE motari's offer.
 *
 * Refusals, in the order they are checked:
 *   403 COUNTER_DISABLED        — the experiment is not switched on.
 *   404 JOURNEY_NOT_FOUND       — no such journey.
 *   403 NOT_JOURNEY_CUSTOMER    — not this passenger's request.
 *   404 BID_NOT_FOUND           — no such bid, or not on this journey
 *                                 (404 and not 400: she is not entitled
 *                                 to learn a stranger's bid id exists —
 *                                 declineBid's own reasoning).
 *   409 COUNTER_ALREADY_EXISTS  — one counter per bid, ever.
 *   422 COUNTER_OUT_OF_BOUNDS   — outside MIN_PRICE_RWF/MAX_PRICE_RWF.
 *   422 COUNTER_EQUALS_BID_PRICE— the same number he already offered,
 *                                 which is not a counter, it is an
 *                                 accept she has not made.
 *   400 BID_NOT_PENDING         — withdrawn, expired, declined, matched.
 *
 * 422 and not 400 for the two price refusals: the body is well-formed
 * and the caller is entitled to be here — what is wrong is the VALUE,
 * and the client renders a different sentence for each.
 */
export async function counterBid(
  journeyId: string,
  customerId: SessionUserId,
  bidId: string,
  counterAmountRwf: number,
) {
  assertCounterEnabled();

  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });
  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }
  if (journey.customerId !== customerId) {
    throw new AppError(403, 'NOT_JOURNEY_CUSTOMER', 'errors.notJourneyCustomer');
  }

  const bid = await prisma.bid.findUnique({ where: { id: bidId } });
  if (!bid || bid.journeyId !== journeyId) {
    throw new AppError(404, 'BID_NOT_FOUND', 'errors.bidNotFound');
  }

  // One per bid, ever. The schema says the same thing by having exactly
  // one slot; this is the sentence the passenger reads.
  if (bid.counterAmountRwf !== null) {
    throw new AppError(409, 'COUNTER_ALREADY_EXISTS', 'errors.counterAlreadyExists');
  }

  // A counter is a price and obeys the price bounds wishPrice obeys
  // (journey.schema.ts:110) — the same two constants, so there is one
  // answer in this system to "what is a possible number of francs".
  if (counterAmountRwf < MIN_PRICE_RWF || counterAmountRwf > MAX_PRICE_RWF) {
    throw new AppError(422, 'COUNTER_OUT_OF_BOUNDS', 'errors.counterOutOfBounds');
  }
  if (counterAmountRwf === bid.price) {
    throw new AppError(422, 'COUNTER_EQUALS_BID_PRICE', 'errors.counterEqualsBidPrice');
  }

  if (bid.status !== BidStatus.PENDING) {
    throw new AppError(400, 'BID_NOT_PENDING', 'errors.bidNotPending');
  }

  // Everything above is a stale eligibility pre-check — the same posture
  // acceptBidCore takes about its own guards. The claim is this
  // predicated update, and the affected-row count decides: two counters
  // racing on one bid both pass the read above, and only one writes.
  const claim = await prisma.bid.updateMany({
    where: { id: bidId, status: BidStatus.PENDING, counterAmountRwf: null },
    data: { counterAmountRwf, counterAt: new Date() },
  });

  if (claim.count === 0) {
    // Re-read to answer with the truth rather than a guess about which
    // half of the predicate missed.
    const now = await prisma.bid.findUnique({ where: { id: bidId } });
    if (now?.counterAmountRwf != null) {
      throw new AppError(409, 'COUNTER_ALREADY_EXISTS', 'errors.counterAlreadyExists');
    }
    throw new AppError(400, 'BID_NOT_PENDING', 'errors.bidNotPending');
  }

  notifyBidCountered(bid.driverId, journeyId, bidId, counterAmountRwf, bid.price);

  return prisma.bid.findUnique({ where: { id: bidId } });
}

export type CounterResponseAction = 'accept' | 'decline';

/**
 * The motari answers the counter on his own bid.
 *
 * DECLINE is the small half: counterOutcome becomes DECLINED and the bid
 * STAYS PENDING AT ITS ORIGINAL PRICE. Nothing is closed — his offer is
 * still on the passenger's screen at the number he first named and she
 * can still accept it. That is why the decline event carries
 * originalPrice: a message that did not would read as "the offer is
 * gone", which is false.
 *
 * ACCEPT is the §0.3b two-step, and the ONLY concurrency story this
 * feature has:
 *
 *   1. A PREDICATED price-flip. `where` requires the bid to still be
 *      PENDING, to still carry THIS counter, to still be unanswered, and
 *      to still hold its ORIGINAL price. `data` writes the countered
 *      price onto the row and stamps counterOutcome ACCEPTED.
 *   2. Only then `acceptBid`, which re-reads the bid and charges the row
 *      it reads — so the escrow, the commission and the journey's
 *      agreedPrice are all computed from the agreed number, by the
 *      ordinary accept transaction, with no second money path in sight.
 *
 * The `status: PENDING` term of the predicate is what keeps step 1
 * honest. Without it, a customer accept that had ALREADY committed at
 * the original price would still match `price = original AND
 * counterOutcome = null`, and the flip would rewrite the price of a bid
 * whose escrow was already charged at the old number.
 *
 * If the customer's own accept of the ORIGINAL price wins first, the
 * predicate misses and this answers a clean 409 — honest, and no
 * double-charge is possible either way, because acceptBidCore refuses a
 * non-PENDING bid up front and again inside its transaction
 * (teamanswers-bid-decline pins that symmetry).
 *
 * WHEN acceptBid DOES NOT MATCH — it threw, or it returned the
 * scheduled-ride conflict shape — the flip is COMPENSATED: the original
 * price goes back on the row and counterOutcome is cleared, so a failed
 * acceptance leaves the passenger's screen exactly as it was, with his
 * original offer intact and her counter still open. The compensation is
 * itself predicated on the bid still being PENDING and still carrying
 * our flip: a row some other accept has since claimed belongs to that
 * accept, and we do not touch its price.
 *
 * The residual, named rather than hidden: in the sub-millisecond window
 * where a rival accept of the original price commits BETWEEN the flip
 * and acceptBid's own claim, the bid row can be left carrying the
 * countered price while the journey was charged the original. No money
 * is at risk — one escrow, one charge, at the number the passenger
 * tapped — and the divergence is a record artefact of a race the
 * single-winner arbiter has already correctly settled.
 */
export async function respondToCounter(
  journeyId: string,
  driverId: SessionUserId,
  bidId: string,
  action: CounterResponseAction,
) {
  assertCounterEnabled();

  const bid = await prisma.bid.findUnique({ where: { id: bidId } });
  if (!bid || bid.journeyId !== journeyId) {
    throw new AppError(404, 'BID_NOT_FOUND', 'errors.bidNotFound');
  }
  if (bid.driverId !== driverId) {
    throw new AppError(403, 'NOT_BID_OWNER', 'errors.notBidOwner');
  }
  if (bid.counterAmountRwf === null) {
    throw new AppError(404, 'COUNTER_NOT_FOUND', 'errors.counterNotFound');
  }
  if (bid.counterOutcome !== null) {
    throw new AppError(409, 'COUNTER_ALREADY_ANSWERED', 'errors.counterAlreadyAnswered');
  }
  if (bid.status !== BidStatus.PENDING) {
    throw new AppError(400, 'BID_NOT_PENDING', 'errors.bidNotPending');
  }

  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });
  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }

  const originalPrice = bid.price;
  const agreedPrice = bid.counterAmountRwf;

  if (action === 'decline') {
    const claim = await prisma.bid.updateMany({
      where: { id: bidId, status: BidStatus.PENDING, counterOutcome: null },
      data: { counterOutcome: 'DECLINED' },
    });
    if (claim.count === 0) {
      throw new AppError(409, 'COUNTER_ALREADY_ANSWERED', 'errors.counterAlreadyAnswered');
    }
    notifyCounterDeclined(journey.customerId, journeyId, bidId, originalPrice);
    return {
      matched: false as const,
      outcome: 'DECLINED' as const,
      bid: await prisma.bid.findUnique({ where: { id: bidId } }),
    };
  }

  // Step 1 — claim the counter and put the agreed number on the row.
  const flip = await prisma.bid.updateMany({
    where: {
      id: bidId,
      status: BidStatus.PENDING,
      price: originalPrice,
      counterAmountRwf: agreedPrice,
      counterOutcome: null,
    },
    data: { price: agreedPrice, counterOutcome: 'ACCEPTED' },
  });
  if (flip.count === 0) {
    throw new AppError(409, 'COUNTER_NO_LONGER_OPEN', 'errors.counterNoLongerOpen');
  }

  // Step 2 — the ordinary accept, on the ordinary path.
  //
  // acknowledgeConflict: true because the scheduled-ride soft-block
  // exists to warn the CUSTOMER that THIS driver has a conflicting
  // commitment — and this call is that driver deciding about his own
  // calendar. Same flag the scheduled-ride re-accept passes, for the
  // same reason.
  //
  // CUTGUARD v2 G4 — this passed `journey.customerId`, which made
  // acceptBidCore's customer check compare the row against itself. It was
  // a tautology, and unlike U-1 it was a HARMLESS one: the real check
  // stands twenty lines above — `bid.driverId !== driverId` → 403
  // NOT_BID_OWNER — and only the passenger can create the counter this
  // is answering. The actor here is the DRIVER, and saying so is the
  // point: a 'counter-accept' actor documents that the customer check
  // does not apply, instead of leaving a vacuous one that LOOKS like it
  // applies. That resemblance is exactly what hid U-1.
  let accepted: Awaited<ReturnType<typeof acceptBid>>;
  try {
    accepted = await acceptBid(journeyId, counterAcceptActor(driverId), bidId, {
      acknowledgeConflict: true,
    });
  } catch (err) {
    await revertCounterFlip(bidId, originalPrice, agreedPrice);
    throw err;
  }

  // acceptBid's success return SPREADS its result and drops the
  // `matched` discriminant, so the conflict shape is identified by the
  // field only it carries. (It is unreachable in practice here —
  // acknowledgeConflict is passed above — and handled anyway, because an
  // unhandled non-match would leave the flip on the row.)
  if ('conflictWarning' in accepted) {
    await revertCounterFlip(bidId, originalPrice, agreedPrice);
    throw new AppError(409, 'COUNTER_NO_LONGER_OPEN', 'errors.counterNoLongerOpen');
  }

  notifyCounterAccepted(journey.customerId, journeyId, bidId, agreedPrice);

  return {
    matched: true as const,
    outcome: 'ACCEPTED' as const,
    agreedPrice,
    accepted,
  };
}

/**
 * Undo a price-flip whose acceptance did not complete. Predicated on the
 * bid still being PENDING and still carrying exactly our flip, so a row
 * some other accept has claimed in the meantime is left alone — that
 * accept owns it, and its escrow was computed from what it read.
 */
async function revertCounterFlip(
  bidId: string,
  originalPrice: number,
  agreedPrice: number,
): Promise<void> {
  await prisma.bid.updateMany({
    where: {
      id: bidId,
      status: BidStatus.PENDING,
      price: agreedPrice,
      counterOutcome: 'ACCEPTED',
    },
    data: { price: originalPrice, counterOutcome: null },
  });
}
