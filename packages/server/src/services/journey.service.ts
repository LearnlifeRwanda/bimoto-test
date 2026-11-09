import prisma from '../prisma';
import {
  toCustomerSafeCommission as projectCustomerSafeCommission,
  toFullCommissionBreakdown,
  type CustomerSafeCommissionView as CustomerSafeCommissionViewType,
} from './commission-view';
import { CancelReason, VehicleType } from '@prisma/client';
import { AppError } from '../middleware/error-handler';
import { haversineDistance } from '../utils/geo';
import {
  BookingMode,
  CUSTOMER_TIERS,
  CreateJourneyInput,
  DRIVER_SEARCH_RADIUS_KM,
  DRIVER_TIERS,
  EscrowStatus,
  JourneyAction,
  JourneyStatus,
  MATCHED_LATE_THRESHOLD_MS,
  MATCHED_NO_SHOW_THRESHOLD_MS,
  SOCKET_EVENTS,
  UserRole,
  calculateCommission,
  transitionJourney,
  validateParcelLoad,
  isCarryingPassenger,
} from '@bimoto/shared';
import * as escrowService from './escrow.service';
import { applyWaiver, resolveWaiverCommission } from './fee-waiver/apply';
import { getActiveWaiversForDrivers } from './fee-waiver';
import { CURATED_BIDDER_SELECT } from './bidder-view';
import { observeVelocity } from './aml';
import {
  applyDriverPenaltyForNoShow,
  type DriverPenaltyOutcome,
} from './driver-penalty';
import {
  notifyDriverAccountFlagged,
  notifyDriverAccountSuspended,
  notifyDriverNoShowWarning,
  notifyEscrowRefunded,
  notifyEscrowReleased,
} from './notification.service';
import { appendAuditEntry, appendAuditEntryTx } from './escrow-audit.service';
import { validateJourneyPlausibility } from './journey-validation.service';
import {
  validateScheduledFor,
  validatePickupCoords,
  computeBidWindowTimes,
  bumpScheduledCancellationCount,
} from './scheduled-rides';
import {
  assertLateCompletionAcceptable,
  recordReconciliationResponse as recordReconciliationResponsePrimitive,
  triggerReconciliationOpening,
  type RecordReconciliationInput,
} from './journey-resilience';
import { filterJourneysByCascade } from './discovery/feed-filter';
import { scheduleCascadeBroadcasts } from './discovery/supply-broadcast';
import { broadcastUrgentImmediately } from './discovery/urgent-broadcast';
import { emitToJourney, getIO } from '../socket';
import { estimatePrice } from './fair-price.service';
import {
  CEILING_MULTIPLIER_MIN,
  CEILING_MULTIPLIER_MAX,
} from './customer-modes/config';
import { scheduleSuggestUpEmits } from './customer-modes/suggest-up-scheduler';
import { onJourneyExitsRequested } from './journey-state-transitions';
import { validateChildBooking } from './child-safety/booking-validator';
import { UNSTATED_VEHICLE_DEFAULT } from './child-safety/unstated-vehicle';
import { getPendingDeletion } from './account-deletion.service';
import {
  validateLegSequence,
  createLegsForJourney,
} from './legs/legs.service';

const LATE_COMPLETION_DUE_HOURS = 24;

const START_PROXIMITY_THRESHOLD_KM = 1.0;
const END_PROXIMITY_THRESHOLD_KM = 2.0;

/**
 * OUTBOX G2 — the journey a previous attempt with this exact client
 * request id already created, or null.
 *
 * `clientRequestId` names a booking ATTEMPT, not a journey: the phone
 * mints it before the first POST and reuses it on every replay. Scoped
 * to the customer, so one passenger's attempt id can never resolve to
 * another passenger's ride.
 */
export async function findJourneyByClientRequestId(
  customerId: string,
  clientRequestId: string,
) {
  return prisma.journey.findFirst({ where: { customerId, clientRequestId } });
}

export async function createJourney(customerId: string, data: CreateJourneyInput) {
  // PILOT-GUARD Item 1(b) — a flag flags; it does not block.
  //
  // This used to 403 EVERY booking by a flagged account. Nothing told
  // the account it had been flagged, nothing said why, and — because the
  // reputation path wrote no AmlFlag row — nothing put it in front of an
  // admin. The user simply stopped being able to book, permanently.
  //
  // That is the design middleware/auth.ts rules out in as many words:
  // "flag→automatic-block-without-review is the surveillance-creep
  // failure mode the project explicitly avoided", flagged users
  // "continue to use the app while admin reviews their case", and only
  // an explicit admin freeze (User.frozenAt) blocks. The block is
  // removed so this path matches the written policy: the 3-in-7d
  // threshold still RAISES the flag (with its reason, see
  // scheduled-rides/cancellation-reputation.ts), the flag is visible and
  // reviewable at /admin/flagged, and the flagged account keeps booking
  // until a human decides otherwise.
  //
  // Freezing is unchanged and still blocks — at the auth layer, above
  // every route, where it always did.

  // R3-CHILD — gate child-passenger trips against placeholder legal
  // thresholds before doing any other work. The validator returns a
  // typed blockCode that the client can map to a localised message,
  // and a requirements object that drives the helmet / guardian-phone
  // post-checks below.
  const childInput = {
    // ANY-VEHICLE G6(b) — an unstated preference is validated as the
    // strictest vehicle in the table, so an any-vehicle booking
    // fail-closes. One source of truth for the reasoning:
    vehicleType: (data.vehiclePreference ??
      UNSTATED_VEHICLE_DEFAULT) as VehicleType,
    childAgeYears: data.childAgeYears ?? null,
    hasChildPassenger: data.hasChildPassenger ?? false,
    isUnaccompaniedMinor: data.childIsUnaccompaniedMinor ?? false,
  };
  const childValidation = validateChildBooking(childInput);
  if (!childValidation.allowed) {
    throw new AppError(422, childValidation.blockCode, childValidation.blockReason);
  }
  if (
    childValidation.requirements.requireHelmetConfirmation &&
    !(data.childPassengerHelmetConfirmed ?? false)
  ) {
    throw new AppError(
      422,
      'HELMET_CONFIRMATION_REQUIRED',
      'Helmet confirmation required for child passengers on motos.',
    );
  }
  if (
    childValidation.requirements.requireGuardianPhone &&
    !(data.childGuardianPhone ?? '').trim()
  ) {
    throw new AppError(
      422,
      'GUARDIAN_PHONE_REQUIRED',
      'Guardian phone number required for unaccompanied minor trips.',
    );
  }

  // FIELD-FIT G5 — what this machine may carry, per the team's own
  // rules (shared/constants/parcel-weight.ts, settled 11 August).
  // Additive: a request that declares neither a weight nor a size is
  // unaffected, so every booking that was valid before this existed
  // still is. Only a declaration that exceeds a stated limit is
  // refused, and the refusal names the limit so the customer can act
  // on it.
  const parcelLoad = validateParcelLoad({
    // ANY-VEHICLE G6(b) — same constant, weaker claim: getParcelAllowance
    // already treats anything non-bicycle as a moto, so this changes no
    // outcome and only makes the existing branch legible here.
    vehicleType: data.vehiclePreference ?? UNSTATED_VEHICLE_DEFAULT,
    journeyType: data.type,
    weightKg: (data as any).goodsWeightKg ?? null,
    sizeCategory: data.goodsSizeCategory ?? null,
  });
  if (!parcelLoad.allowed) {
    throw new AppError(422, parcelLoad.code!, parcelLoad.messageKey!);
  }
  if (parcelLoad.advisory) {
    // The moto-alone envelope rule, which is stated but not yet a
    // refusal (shared/constants/parcel-weight.ts explains why). Logged
    // so the team can see how often real bookings sit outside it before
    // deciding whether it should start refusing them.
    console.log(
      `[PARCEL-OVER-RULE] ${parcelLoad.advisory} ` +
        `vehicle=${data.vehiclePreference ?? UNSTATED_VEHICLE_DEFAULT} ` +
        `type=${data.type} size=${data.goodsSizeCategory ?? 'none'} customer=${customerId}`,
    );
  }

  // PARCEL-CATEGORY — the category × journey-type rule, mirroring the
  // spirit of legs.service.validateLegSequence's
  // PARCEL_CATEGORY_ON_NON_GOODS_LEG: a thing that is not carrying
  // cargo has no contents to declare.
  //
  // THE PREDICATE. `isCarryingPassenger` — the same shared signal the
  // parcel-load validation directly above keys off (it is what
  // validateParcelLoad reads to pick the allowance table). The test is
  // "does this journey carry a person", never "is this journey GOODS":
  // JourneyType has four members and THREE of them (GOODS,
  // PRIORITY_MESSENGER, URGENT_MESSENGER) are parcel runs, so gating on
  // GOODS alone would refuse a legitimate category on an urgent
  // messenger parcel. journey.routes.ts:~1060 reads the same
  // distinction the same way, for the same reason, and the client's
  // ParcelBadge.isParcelJourney mirrors it from the other side.
  //
  // Only a DECLARED category is refused. A PASSENGER booking that sends
  // no category, or an explicit null, is untouched — additive by
  // construction, so every request that was valid before this field
  // existed still is.
  if (isCarryingPassenger(data.type) && (data as any).parcelCategory) {
    throw new AppError(
      422,
      'PARCEL_CATEGORY_ON_PASSENGER_JOURNEY',
      'A passenger journey carries no parcel and cannot declare a parcel category.',
    );
  }

  // R3-LEGS — multi-stop foundation. Validate the optional legs[]
  // input (defaults to [] when omitted, the v1 single-leg default).
  // Failures throw 422 with a typed code so the client can localise.
  const legsInput = (data as any).legs ?? [];
  const legsValidation = validateLegSequence(legsInput);
  if (!legsValidation.valid) {
    throw new AppError(422, legsValidation.code, legsValidation.reason);
  }

  const estimatedDistance = haversineDistance(
    data.pickupLat,
    data.pickupLng,
    data.destinationLat,
    data.destinationLng,
  );

  const isScheduled = data.bookingMode === BookingMode.SCHEDULED;
  let scheduledFields: {
    bookingMode: BookingMode;
    status: JourneyStatus;
    scheduledFor?: Date;
    bidWindowOpensAt?: Date;
    autoFallbackAt?: Date;
  } = { bookingMode: BookingMode.IMMEDIATE, status: JourneyStatus.REQUESTED };

  if (isScheduled) {
    if (!data.scheduledFor) {
      throw new AppError(400, 'SCHEDULED_FOR_REQUIRED', 'errors.scheduledForRequired');
    }
    const scheduledFor = new Date(data.scheduledFor);
    validateScheduledFor(scheduledFor);
    validatePickupCoords(data.pickupLat, data.pickupLng);

    // ACCOUNT-RIGHTS-CORE G3 — the ONE carve-out in the 72-hour deletion
    // hold (founder ruling D1, 20 Aug).
    //
    // D1 is emphatic that the window is normal: everything works, SOS and
    // the blocking states are untouched, and mobility is never gated. The
    // single exception is this one, and it is not a gate on mobility — it
    // is a refusal to promise a ride the account will not be there to
    // take. A passenger with a deletion executing on Friday cannot book a
    // Saturday pickup; they can book any time before Friday, they can
    // book immediate rides all week, and cancelling the deletion makes
    // Saturday bookable again immediately.
    //
    // Scoped to SCHEDULED bookings on purpose. An IMMEDIATE ride happens
    // now, so it cannot outlive the account, and this block never runs
    // for one.
    const pendingDeletion = await getPendingDeletion(customerId);
    if (pendingDeletion && scheduledFor > pendingDeletion.executesAt) {
      throw new AppError(
        400,
        'SCHEDULED_PAST_DELETION',
        'errors.scheduledPastDeletion',
      );
    }
    const { bidWindowOpensAt, autoFallbackAt } = computeBidWindowTimes(scheduledFor);
    scheduledFields = {
      bookingMode: BookingMode.SCHEDULED,
      status: JourneyStatus.SCHEDULED,
      scheduledFor,
      bidWindowOpensAt,
      autoFallbackAt,
    };
  }

  // Dispatch K3 — customer modes. WAIT_AND_COMPARE is the default and
  // preserves the existing comparison-shopping flow exactly. NEED_TO_GO
  // requires a multiplier in [MIN..MAX] and locks priceCeilingRwf at
  // creation time using the current fair-price midpoint, so subsequent
  // admin re-tunes never change the ceiling for an in-flight journey.
  const requestMode: 'WAIT_AND_COMPARE' | 'NEED_TO_GO' =
    (data as any).requestMode ?? 'WAIT_AND_COMPARE';
  let priceCeilingMultiplier: number | null = null;
  let priceCeilingRwf: number | null = null;
  const rawMultiplier = (data as any).priceCeilingMultiplier as
    | number
    | undefined;

  if (requestMode === 'NEED_TO_GO') {
    if (rawMultiplier === undefined) {
      throw new AppError(
        400,
        'PRICE_CEILING_MULTIPLIER_REQUIRED',
        'errors.priceCeilingMultiplierRequired',
      );
    }
    if (
      rawMultiplier < CEILING_MULTIPLIER_MIN ||
      rawMultiplier > CEILING_MULTIPLIER_MAX
    ) {
      throw new AppError(
        400,
        'PRICE_CEILING_MULTIPLIER_OUT_OF_RANGE',
        'errors.priceCeilingMultiplierOutOfRange',
      );
    }
    priceCeilingMultiplier = rawMultiplier;
    const range = estimatePrice(estimatedDistance);
    if (
      !range ||
      !Number.isFinite(range.min) ||
      !Number.isFinite(range.max)
    ) {
      throw new AppError(
        422,
        'FAIR_PRICE_UNAVAILABLE',
        'errors.fairPriceUnavailable',
      );
    }
    const fairPriceMidpoint = (range.min + range.max) / 2;
    priceCeilingRwf = Math.round(fairPriceMidpoint * priceCeilingMultiplier);
  } else if (rawMultiplier !== undefined) {
    throw new AppError(
      400,
      'PRICE_CEILING_MULTIPLIER_NOT_ALLOWED',
      'errors.priceCeilingMultiplierNotAllowed',
    );
  }

  // R3-LEGS — wrap journey + legs creation in a transaction so a
  // legs-insert failure rolls back the journey row. For single-leg
  // journeys (legs: []), createLegsForJourney is a no-op.
  // OUTBOX G2 — the fast path for a replayed booking. The route already
  // pre-checks this, so reaching here with a hit means two replays of the
  // same held booking raced; the unique index below is what actually
  // guarantees it, and this read only saves the wasted insert.
  if (data.clientRequestId) {
    const already = await findJourneyByClientRequestId(customerId, data.clientRequestId);
    if (already) return already;
  }

  let journey;
  try {
    journey = await prisma.$transaction(async (tx) => {
    const created = await tx.journey.create({
      data: {
        customerId,
        // OUTBOX G2 — the booking attempt's own name, when the client
        // gave one. Null for every create that does not, which is every
        // create that existed before this field.
        clientRequestId: data.clientRequestId ?? null,
        type: data.type,
        status: scheduledFields.status,
        pickupLat: data.pickupLat,
        pickupLng: data.pickupLng,
        pickupName: data.pickupName,
        destinationLat: data.destinationLat,
        destinationLng: data.destinationLng,
        destinationName: data.destinationName,
        // LANDMARKS G4 — the passenger's own words about each place.
        // Empty means the passenger had nothing to add, and nothing
        // downstream renders anything.
        pickupDescription: data.pickupDescription?.trim() || null,
        destinationDescription: data.destinationDescription?.trim() || null,
        // TEAM-SAID G1 — the child-travel advisory, stored exactly as
        // it was answered and read by nothing but the motari's screen.
        // `?? null` rather than `?? false` on purpose: a passenger who
        // was never asked is not a passenger who said no.
        travellingWithChild: data.travellingWithChild ?? null,
        vehiclePreference: data.vehiclePreference ?? null,
        wishPrice: data.wishPrice ?? null,
        estimatedDistance,
        goodsDescription: data.goodsDescription ?? null,
        goodsSizeCategory: data.goodsSizeCategory ?? null,
        // PARCEL-CATEGORY — what the sender said the parcel contains.
        // Stored exactly as sent and injected with nothing: the client
        // defaults to OTHER on submit (the leg-flow convention), so a
        // NULL here means the sender was genuinely never asked — an
        // older client, or the offline outbox replaying a body written
        // before this field existed.
        parcelCategory: (data as any).parcelCategory ?? null,
        goodsWeightKg: (data as any).goodsWeightKg ?? null,
        // TEAM-SAID G3 — the delivery tier the sender chose. Stored and
        // shown to the motari; read by no pricing code on the way past.
        deliverySpeed: (data as any).deliverySpeed ?? null,
        // LIVE-WIRE G5 — only STANDARD carries a window. An hours value
        // arriving alongside EXPRESS is dropped rather than stored, so
        // the two can never disagree in the database.
        standardDeliveryHours:
          (data as any).deliverySpeed === 'STANDARD'
            ? ((data as any).standardDeliveryHours ?? null)
            : null,
        goodsFragile: data.goodsFragile ?? false,
        recipientName: data.recipientName ?? null,
        recipientPhone: data.recipientPhone ?? null,
        bookingMode: scheduledFields.bookingMode,
        scheduledFor: scheduledFields.scheduledFor ?? null,
        bidWindowOpensAt: scheduledFields.bidWindowOpensAt ?? null,
        autoFallbackAt: scheduledFields.autoFallbackAt ?? null,
        requestMode: requestMode as any,
        priceCeilingMultiplier,
        priceCeilingRwf,
        // R3-CHILD — persist the customer's child-passenger declaration.
        hasChildPassenger: data.hasChildPassenger ?? false,
        childAgeYears: data.childAgeYears ?? null,
        childIsUnaccompaniedMinor: data.childIsUnaccompaniedMinor ?? false,
        childGuardianPhone: data.childGuardianPhone ?? null,
        childPassengerHelmetConfirmed: data.childPassengerHelmetConfirmed ?? false,
      },
    });
    await createLegsForJourney(tx, created.id, legsInput);
    return created;
    });
  } catch (err) {
    // OUTBOX G2 — the race the pre-check cannot win: two replays of one
    // held booking arriving together, both reading "no journey yet",
    // both inserting. Postgres lets exactly one through the unique index
    // and the loser lands here. The loser's answer is the winner's
    // journey — which is the correct answer to "create this booking",
    // because the booking exists.
    if (
      data.clientRequestId &&
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'P2002'
    ) {
      const winner = await findJourneyByClientRequestId(customerId, data.clientRequestId);
      if (winner) return winner;
    }
    throw err;
  }

  // Increment user's totalRequests
  await prisma.user.update({
    where: { id: customerId },
    data: { totalRequests: { increment: 1 } },
  });

  // D17 WATCH MODE — the velocity alarm starts keeping its logbook.
  //
  // observeVelocity (named assertVelocityOk until COUNTER-READY G4)
  // has existed, fully written and fully unreferenced,
  // since it was added: it counts a customer's journeys in the last hour
  // and writes a MEDIUM AmlFlag above the threshold. It has never once
  // run, so the threshold in it is a number chosen at a desk and nothing
  // in the repo can say whether it is right.
  //
  // The D17 fold gives it its natural call site and NOTHING ELSE. It is
  // observe-only by its own design — it writes a flag through
  // safeRecordFlag, which swallows its own failures, and it has no
  // throwing branch (verified by reading it in full, not by trusting the
  // docstring). The name used to say "assert" while the function did
  // not; G4 renamed it, and this paragraph is now a description of the
  // function rather than a correction of its name.
  //
  // Called AFTER the journey exists, so the count includes this booking
  // and a flag can be attributed to a real row. Fire-and-forget, with its
  // own catch, so that even if a future edit gave it a throwing branch it
  // could not reach the request path. The customer sees nothing; no
  // response field changes; no booking is refused.
  //
  // REVISIT AT THE PAYMENTS GATE. The point of watch mode is that when
  // real money starts moving, the threshold is set from what Kigali
  // actually did for a month rather than from a guess.
  void observeVelocity(customerId).catch((err) => {
    console.warn('[D17-WATCH] velocity check failed (observe-only)', {
      customerId,
      err: err instanceof Error ? err.message : String(err),
    });
  });

  // K1 — schedule the bid-discovery cascade for REQUESTED journeys.
  // SCHEDULED bookings open their bid window via a separate cron, so
  // the cascade only kicks in for IMMEDIATE/REQUESTED creates here.
  if (journey.status === JourneyStatus.REQUESTED) {
    let io = null as ReturnType<typeof getIO> | null;
    try {
      io = getIO();
    } catch {
      // Socket.io not initialised (test harness): the cascade still
      // works — feed-filter recomputes ring on every read — but live
      // socket nudges are skipped. Documented graceful degradation.
    }
    if (journey.type === 'URGENT_MESSENGER') {
      // R3-T — bypass the time-based ring rollout and fan out the
      // journey to every eligible driver at the maximum radius
      // immediately. Fire-and-forget: we don't await the broadcast
      // (matches K1 cascade scheduling semantics — discovery never
      // blocks the API response).
      broadcastUrgentImmediately({
        prisma,
        io,
        journeyId: journey.id,
        pickup: { lat: journey.pickupLat, lng: journey.pickupLng },
      }).catch((err) => {
        console.warn('[R3-T] urgent broadcast failed', {
          journeyId: journey.id,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    } else {
      scheduleCascadeBroadcasts({
        prisma,
        io,
        journeyId: journey.id,
        pickup: { lat: journey.pickupLat, lng: journey.pickupLng },
        discoveryStartedAt: journey.discoveryStartedAt ?? journey.createdAt,
      });
    }
    // Dispatch K3 — schedule suggest-up tier reveals (60s, 120s).
    // Cancelled when the journey transitions out of REQUESTED.
    // (Urgent journeys are eligible for suggest-up too, though they
    // rarely need it — the cascade is already at max radius.)
    scheduleSuggestUpEmits(journey.id, journey.customerId, io, prisma);
  }

  return journey;
}

/**
 * FIELD-FIT G5 — how often an engaged motari was kept off the feed.
 *
 * The team explicitly wanted to know how often this happens, so every
 * block emits one parseable line. A counter in memory answers "since
 * this process started" cheaply for the diagnostics screen; the log
 * line is the durable record, and survives a restart in whatever the
 * host keeps. Deliberately not a database write: this fires on every
 * poll of a 15-second feed refresh, and a row per poll would cost more
 * than the answer is worth.
 */
const engagedDriverFeedBlocks = new Map<string, number>();

function recordEngagedDriverFeedBlock(
  driverId: string,
  journeyId: string,
  journeyStatus: string,
): void {
  const next = (engagedDriverFeedBlocks.get(driverId) ?? 0) + 1;
  engagedDriverFeedBlocks.set(driverId, next);
  console.log(
    `[FEED-BLOCKED] driver=${driverId} engagedOn=${journeyId} status=${journeyStatus} count=${next}`,
  );
}

/** Blocked-feed counts by driver since process start (diagnostics/tests). */
export function getEngagedDriverFeedBlockCounts(): Record<string, number> {
  return Object.fromEntries(engagedDriverFeedBlocks);
}

/** Test seam — reset the in-memory counters. */
export function _resetEngagedDriverFeedBlockCounts(): void {
  engagedDriverFeedBlocks.clear();
}

export async function getJourneys(
  userId: string,
  role: string,
  status?: string,
  lat?: number,
  lng?: number,
  viewAs?: 'customer' | 'driver',
  // RIDES-REACH G1 — "my rides", read ONLY by the driver arm below.
  // Appended last and optional, so every existing call site keeps its
  // exact meaning. Defaults false: absent is a discovery request, which
  // is what it has always been.
  history = false,
  // CUTGUARD v2 amendment 2 (B-2, as a CLASS) — whether the caller can
  // render a customer savings preview. Same option, same name, same
  // default as `getBidsForJourney`'s, because it is the same question
  // about the same shape; a second spelling would be a second thing to
  // keep in step. Appended last and optional, so every existing call
  // site keeps its exact meaning, and absent ⇒ LEGACY ⇒ no preview.
  options: { customerSavingsPreview?: boolean } = {},
) {
  // Determine effective role for the query
  const effectiveRole = viewAs || (role === UserRole.BOTH ? 'customer' : role.toLowerCase());

  if (effectiveRole === 'customer') {
    // For customer: return their journeys.
    //
    // RIDES-REACH G1 — `history` is deliberately NOT read here, and the
    // omission is the point: `customerId: userId` already IS "her
    // rides", so there is nothing for the flag to narrow. Declaring the
    // key in journeyQuerySchema stops Zod stripping it, and this arm
    // goes on ignoring it — byte for byte the same response, with and
    // without it.
    const rows = await prisma.journey.findMany({
      where: {
        customerId: userId,
        ...(status ? { status: status as JourneyStatus } : {}),
      },
      include: {
        // MONEY-VIEW v2 G2 — was `include: { driver: { include: {
        // driverProfile: true } } }`, which returned the bidder's ENTIRE
        // `User` row and his ENTIRE `DriverProfile` — his live
        // coordinates and the reason an admin once rejected him — to
        // every customer listing her own journeys.
        bids: { include: { driver: { select: CURATED_BIDDER_SELECT } } },
        escrow: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // MONEY-VIEW v2 G1 — this arm's every row belongs to the requesting
    // CUSTOMER by the `where` above, so there is one viewer and one view.
    // Projected here rather than at the two returns below, so the
    // no-show-decision path cannot become the exit that ships the raw row.
    const journeys = rows.map((j: any) => {
      const escrow = toCustomerEscrowView(j.escrow);
      // MONEY-VIEW v2 G3 — the rides list's money block was DEAD: nothing
      // has ever attached a breakdown to this route. It is attached here,
      // derived from the settlement record rather than recomputed, and in
      // the customer-safe shape #206 already built a variant for — so the
      // screen renders it through the guard it already has.
      //
      // CUTGUARD v2 amendment 2 — and attached only to a client that can
      // RENDER it. This was the second of B-2's three surfaces and it was
      // ungated: v13's HistoryPage guards on PRESENCE only and then reads
      // `totalCommissionRate`, `totalCommissionAmount`, `driverTier`,
      // `driverCommissionRate` and `driverPayout` off the object — none
      // of which the customer-safe shape carries, and none of which it
      // may carry (#202: they reconstruct the motari's net). The
      // discriminator that makes v14 safe, `hasCustomerSafeCommission`,
      // landed in #206 — after the da9eca0 APK — so it is not in v13.
      //
      // No backward-compatible payload exists: the fields v13
      // dereferences are exactly the fields this shape must withhold. The
      // recipient's version is the only lever, so it is the one used.
      const commissionBreakdown = options.customerSavingsPreview
        ? toCustomerListCommission(escrow)
        : null;
      return {
        ...j,
        escrow,
        // OMITTED, never nulled — v13 guards on presence, so a null is
        // still a crash. Same omit-don't-null rule as bid.service:339.
        ...(commissionBreakdown ? { commissionBreakdown } : {}),
      };
    });

    // R3-N-5 — for any DRIVER_NO_SHOW journeys, attach the admin's
    // dispute-resolution decision (if any) so the customer's history
    // surface can render the journey-outcome badge.
    const noShowIds = journeys
      .filter((j: any) => j.cancelReason === 'DRIVER_NO_SHOW')
      .map((j: any) => j.id);
    if (noShowIds.length === 0) return journeys;
    const decisions = await prisma.adminAction.findMany({
      where: {
        action: 'RESOLVE_DRIVER_NO_SHOW_DISPUTE',
        targetType: 'JOURNEY',
        targetId: { in: noShowIds },
      },
      select: { targetId: true, conflictDecision: true, createdAt: true },
    });
    const byJourney = new Map<string, any>(
      decisions.map((d: any) => [d.targetId, d]),
    );
    return journeys.map((j: any) => {
      if (j.cancelReason !== 'DRIVER_NO_SHOW') return j;
      const d = byJourney.get(j.id);
      return {
        ...j,
        noShowResolution: d
          ? { decision: d.conflictDecision, decidedAt: d.createdAt }
          : null,
      };
    });
  }

  if (effectiveRole === 'driver') {
    // RIDES-REACH G1 — this arm answers TWO questions, and until now
    // only one of them had a `where` of its own.
    //
    //   DISCOVERY — "what open work is near me?" Every REQUESTED
    //     journey in radius, minus the cascade rings and minus the
    //     machines he does not ride. It belongs to nobody yet, and it
    //     needs a coordinate to mean anything at all.
    //   OWN RIDES — "which rides are mine?" The rides he is the driver
    //     of. No coordinate, no vehicle match and no cascade: none of
    //     those describe a ride he is already on.
    //
    // The FIELD-FIT comment below has promised the second since #159
    // ("A driver querying a specific status ... still gets his answer")
    // but the `where` it describes never carried `driverId`. It was
    // `{ status: REQUESTED, ...(status ? { status } : {}) }`, so a
    // non-REQUESTED query returned EVERY such journey in radius — a
    // rival's COMPLETED ride, his passenger, his route, his money
    // (MONEY-VIEW's finding B). And the LOCATION_REQUIRED gate stood
    // ABOVE the fork, so the coordinate-less own-rides query threw 400
    // before reaching any of it: that is why /rides (HistoryPage) and
    // /driver/no-show-disputes (NoShowDisputesPage) were both dead
    // screens for a motari (finding A).
    //
    // NO STATUS LIST IS NEEDED to say "his". A REQUESTED journey has
    // `driverId: null` by construction, so `driverId: userId` already
    // means MATCHED-or-later AND his; `status` narrows on top of it,
    // which is the promised behaviour finally made true rather than a
    // second, looser rule beside it.
    const isDiscoveryQuery =
      !history && (!status || status === JourneyStatus.REQUESTED);

    const driverInclude = {
      // MONEY-VIEW v2 G2 — the feed's widest door, closed.
      //
      // This was `bids: true`. The mapper below strips the escrow and runs
      // `stripJourneyForScope` per row — but that strip deletes only
      // `recipientName`, `recipientPhone` and `childGuardianPhone`, so RAW
      // BID ROWS rode along in `...rest` to every motari in radius: each
      // rival's PRICE, his driverId, his ETA. #206 scoped the rows on
      // `GET /journeys/:id/bids`; this is the same room's wider door, and
      // in a sealed-bid marketplace `price` IS the bid.
      //
      // What a motari legitimately wants to know is how much competition a
      // request already has, and whether HE has bid on it. So the rows are
      // replaced by a COUNT and his OWN row — filtered in the query, so a
      // rival's price never leaves the database at all.
      //
      // The client census settled the shape rather than guessing it: no
      // driver surface renders anything off a feed row's `bids` today —
      // DashboardPage, the only reader of this endpoint, does not touch
      // the key. `bidCount` ships anyway because it is one integer, it is
      // honest, and it is what the card will want; `myBid` is what
      // `commitment` already does for the scheduled-rides feed.
      _count: { select: { bids: true } },
      bids: { where: { driverId: userId } },
      customer: {
        select: { id: true, nickname: true, completedRides: true },
      },
      // LIVE-WIRE G5 — the field's item 15: "an approved offer reappears
      // in available requests." It is not a bug: a match whose payment
      // never completed is released back to REQUESTED by the
      // unpaid-match reaper (escrow.service.releaseMatchTx, #155/#156),
      // which re-opens every bid it had closed. What was missing was any
      // way for the motari to know that is what he is looking at. The
      // surviving escrow row is the marker; the flag below is derived
      // from it so the request card can say so in words.
      // MONEY-VIEW v2 G3 — the settlement columns join the select so a
      // motari's OWN rows can carry his money view. They never reach a
      // payload: the mapper destructures `escrow` out entirely and ships
      // only the derived `reopenedUnpaid` flag plus, on rows he is the
      // driver of, the settlement view built from them. `txRef`/`flwTxId`
      // are not selected at all.
      escrow: {
        select: {
          status: true,
          amount: true,
          commission: true,
          driverPayout: true,
          driverTier: true,
          customerTier: true,
          driverCommissionRate: true,
          customerCommissionRate: true,
          waivedCommissionAmount: true,
          feeWaiverId: true,
        },
      },
    };

    // ONE MAPPER FOR BOTH BRANCHES, so a row's shape cannot drift
    // between them. MONEY-VIEW's bid seals (a count and his own bid),
    // its settlement attach and PARCEL-VISIBLE's per-row scope strip
    // all live here and nowhere else in this arm — every one of them is
    // DOWNSTREAM of the `where`, so narrowing the `where` only shrinks
    // what reaches them.
    const mapDriverRow = (journey: any) => {
      // A REQUESTED journey that still owns an escrow can only have got
      // here by being released: a first-time request has no escrow at
      // all. HELD/RELEASED are excluded because those escrows belong to
      // a match that DID pay (a later cancel/refund path), not to the
      // unpaid release this names.
      const escrowStatus = journey.escrow?.status ?? null;
      const settlement = toDriverSettlementCommission(journey.escrow);
      const { escrow: _escrow, bids: _bids, _count: _bidCount, ...rest } = journey;
      // PARCEL-VISIBLE G2 — the feed is the OTHER door onto the same
      // scalars, and it is the wider one: `getJourneyById` reaches a
      // motari who opened the request, this reaches every motari in
      // radius. Scoped PER ROW rather than for the whole call, because
      // this branch also answers a driver asking for his own journeys by
      // status — on those he is the `participant` and keeps everything
      // (invariant 1), while an open request he has no relationship to is
      // stripped exactly as `getJourneyById` strips it.
      const scope = journeyViewerScope(userId, journey);
      return stripJourneyForScope(
        {
          ...rest,
          reopenedUnpaid:
            escrowStatus !== null && escrowStatus !== 'HELD' && escrowStatus !== 'RELEASED',
          // How much competition this request already has, and whether
          // this motari is already in it. Destructured OUT of `rest`
          // above, so no raw row can survive a later edit to the spread.
          //
          // TWO SEALS, NOT ONE. The `where` on the include is the first;
          // this `find` is the second, and it is not belt-and-braces
          // theatre — a test written against a mapper handed rival rows
          // caught `_bids[0]` shipping a RIVAL's row as "my bid" the
          // moment the query filter was removed. A projection that is
          // only correct because the query above it is correct is one
          // edit away from being the leak.
          bidCount: _bidCount?.bids ?? 0,
          myBid: _bids?.find((b: any) => b.driverId === userId) ?? null,
          // MONEY-VIEW v2 G3 — his settlement, on the rows that are HIS.
          //
          // Gated on `driverId === userId` rather than on the branch:
          // this arm answers both the open-request feed and a driver
          // querying his own journeys by status, and an open request
          // belongs to nobody yet. A row he is not the driver of gets
          // no money view at all — the key is omitted, which is the
          // shape every screen already handles.
          ...(journey.driverId === userId && settlement
            ? { commissionBreakdown: settlement }
            : {}),
        },
        scope,
      );
    };

    if (!isDiscoveryQuery) {
      // HIS RIDES — the answer /rides (HistoryPage) and
      // /driver/no-show-disputes (NoShowDisputesPage) have both been
      // asking for since #156, which shipped them.
      //
      // Ordered newest-first, matching the customer arm and what a
      // history list means. The three priority buckets are deliberately
      // NOT used: an urgent-first queue is a rule about which OPEN work
      // to offer next, and it would only scramble the order of rides he
      // has already done.
      //
      // No `driverProfile` lookup either. Its only two consumers are
      // the vehicle prefilter and the cascade, both discovery rules,
      // and a 404 on a missing profile would turn the cured screen back
      // into the error screen it has been. `driverId: userId` is the
      // whole authorization here: a row that is not his cannot be in
      // the result to be scoped in the first place.
      const ownRides = await prisma.journey.findMany({
        where: {
          driverId: userId,
          ...(status ? { status: status as JourneyStatus } : {}),
        },
        include: driverInclude,
        orderBy: { createdAt: 'desc' },
      });
      return ownRides.map(mapDriverRow);
    }

    // DISCOVERY — everything below this line is the feed exactly as it
    // was, on exactly the queries that reached it before.
    //
    // For driver: REQUESTED journeys within search radius
    if (lat == null || lng == null) {
      throw new AppError(400, 'LOCATION_REQUIRED', 'errors.locationRequired');
    }

    // Get driver's vehicle type
    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId },
    });

    if (!driverProfile) {
      throw new AppError(404, 'DRIVER_PROFILE_NOT_FOUND', 'errors.driverProfileNotFound');
    }

    // FIELD-FIT G5 — a motari carrying a passenger is not offered
    // another one. The team asked for this and asked to know how often
    // it happens, so the block is counted as well as applied.
    //
    // Enforced here, in the feed, rather than at bid time: the point is
    // that the second request never appears, so nobody is tempted by a
    // ride he cannot take. Bid and matching rules are untouched — a
    // driver who reaches an offer another way is refused by the same
    // logic as before, not by this.
    //
    // Only the discovery feed is filtered. A driver querying a specific
    // status (his own IN_PROGRESS journeys, say) still gets his answer —
    // and now gets it from the own-rides branch above, which is the
    // `where` this sentence always described. The `isDiscoveryQuery`
    // guard that used to wrap this block IS that branch now.
    const engagedOn = await prisma.journey.findFirst({
      where: {
        driverId: userId,
        status: {
          in: [
            JourneyStatus.MATCHED,
            JourneyStatus.IN_PROGRESS,
            JourneyStatus.AWAITING_CONFIRMATION,
          ],
        },
      },
      select: { id: true, status: true },
    });
    if (engagedOn) {
      recordEngagedDriverFeedBlock(userId, engagedOn.id, engagedOn.status);
      return [];
    }

    // R3-EXPRESS / R3-PRIORITY — driver-view priority queue with three
    // buckets. URGENT_MESSENGER first, PRIORITY_MESSENGER second, then
    // other journey types. Within urgent and priority buckets the
    // longest-waiting trip wins (oldest createdAt asc); within the
    // other bucket the existing newest-first order is preserved.
    // Three queries + in-memory concat keeps the semantics precise
    // without a raw SQL fallback. The +50% query cost over the
    // 2-bucket version is acceptable at pilot scale (dozens of open
    // journeys per area); a future dispatch could consolidate into a
    // single findMany with a CASE-based sort key.
    //
    // RIDES-REACH G1 — the `...(status ? { status } : {})` spread this
    // object used to carry is gone, not changed: only a discovery query
    // reaches here now, and on one of those `status` is either absent
    // or REQUESTED, so the spread could never have written anything but
    // the value already on the line above it. Same three queries, same
    // rows.
    const driverWhere = {
      status: JourneyStatus.REQUESTED,
    };
    const urgentJourneys = await prisma.journey.findMany({
      where: { ...driverWhere, type: 'URGENT_MESSENGER' },
      include: driverInclude,
      orderBy: { createdAt: 'asc' },
    });
    const priorityJourneys = await prisma.journey.findMany({
      where: { ...driverWhere, type: 'PRIORITY_MESSENGER' },
      include: driverInclude,
      orderBy: { createdAt: 'asc' },
    });
    const otherJourneys = await prisma.journey.findMany({
      where: {
        ...driverWhere,
        type: { notIn: ['URGENT_MESSENGER', 'PRIORITY_MESSENGER'] },
      },
      include: driverInclude,
      orderBy: { createdAt: 'desc' },
    });
    const journeys = [
      ...urgentJourneys,
      ...priorityJourneys,
      ...otherJourneys,
    ].map(mapDriverRow);

    // Vehicle + outer-radius prefilter (legacy guard rail).
    const vehicleMatched = journeys.filter((journey: any) => {
      const distance = haversineDistance(lat, lng, journey.pickupLat, journey.pickupLng);
      const withinRadius = distance <= DRIVER_SEARCH_RADIUS_KM;
      const vehicleMatch =
        !journey.vehiclePreference || journey.vehiclePreference === driverProfile.vehicleType;
      return withinRadius && vehicleMatch;
    });

    // Discovery cascade. The `isDiscoveryPhase` early return that used
    // to sit here is gone with the fork: only a discovery query reaches
    // this line, so the test it made was always true here.
    return filterJourneysByCascade(
      {
        lastLat: driverProfile.lastLat,
        lastLng: driverProfile.lastLng,
        lastLocationAt: driverProfile.lastLocationAt,
      },
      vehicleMatched,
    );
  }

  return [];
}

/**
 * LIVE-WIRE G4 — the money on a journey, scoped to its owner.
 *
 * `commissionBreakdown` describes what is taken out of the fare before
 * the motari is credited. The customer pays `agreedPrice`; everything
 * else in that object is the driver's wallet, and the Kigali team asked
 * for it to stop being on the passenger's screen. So:
 *
 *   - the journey's customer sees a customer-safe subset — the price,
 *     their own tier and what that tier saved them, and whether a fee
 *     waiver applied. Nothing from which the driver's net can be
 *     reconstructed (which rules out totalCommissionAmount and
 *     totalCommissionRate, since payout = price - amount);
 *   - the driver, and privileged/no-viewer callers, see it all.
 *
 * `payoutContext` is the other half of the team's item 18: a driver
 * pricing a bid on a REQUESTED journey could only ever be shown a RANGE
 * ("you will receive 1,100–1,150"), because the client knows his own
 * tier but not the customer's. This hands him the customer's rate — his
 * own money's arithmetic, on a journey he is bidding for — so the bid
 * screen can say the exact number. Driver-scoped only.
 */
// CUTGUARD v2 G3 — the type and the projector MOVED to
// services/commission-view.ts and are re-exported here.
//
// They moved because they were in the wrong place to be a boundary. A
// projector living in journey.service is a journey-read helper that other
// paths may call; `bid.service.acceptBid` did not, and built its own
// thirteen-key breakdown inline — which is how the passenger came to hold
// the motari's `driverPayout` after #207 had supposedly removed it.
//
// In its own module it is importable by every money exit without a
// service-to-service dependency, and the type it returns is now BRANDED:
// an inline literal cannot be assigned where a CustomerSafeCommission is
// expected, so the bypass that produced U-4 no longer compiles.
export {
  toCustomerSafeCommission,
  type CustomerSafeCommission,
  type CustomerSafeCommissionView,
  type FullCommissionBreakdown,
} from './commission-view';

/**
 * MONEY-VIEW v2 G1 — the escrow row, projected per viewer.
 *
 * `toCustomerSafeCommission` above answers "what does THIS viewer see of
 * the COMMISSION?" and #202 routed the computed breakdown through it. The
 * escrow ROW is the same money at a different exit and had no such place
 * at all: `getJourneyById` (`escrow: true`) and the customer list arm
 * (`escrow: true`) both handed over every column the model has —
 * `commission`, `driverPayout`, `driverTier`, `driverCommissionRate`,
 * `waivedCommissionAmount`, and the processor's own references `txRef`
 * and `flwTxId`.
 *
 * That was not theoretical. RideReceiptPage:146 reads
 *
 *     driverReceived = breakdown?.driverPayout ?? escrow?.driverPayout
 *
 * and the customer's `breakdown` is the redacted four, so the first arm is
 * `undefined` on every passenger receipt and the fallback PRINTED the
 * motari's net — the exact number #202 removed from the breakdown, back on
 * the customer's screen through the row beside it. `feeAmount` fell through
 * to `escrow.commission` / `escrow.waivedCommissionAmount` the same way.
 *
 * WHAT EACH VIEWER GETS, and why:
 *
 *   CUSTOMER — `id`, `amount`, `status`, `releasedAt`, her OWN tier and
 *   rate, and `feeWaiverApplied` as a DERIVED BOOLEAN.
 *     - `id` and `status` are load-bearing, not courtesy: PaymentsPage:55
 *       reads `journey.escrow?.id` to poll `GET /api/payments/:escrowId/
 *       status`, and `retryMomoCharge(escrowId)` needs the same id. A view
 *       without them breaks the payment-retry surface.
 *     - `waivedCommissionAmount` is NOT given, and the boolean is not
 *       squeamishness: on a waived ride the waived amount IS the nominal
 *       tier commission, so publishing it hands back `driverPayout =
 *       amount − waived`. #202 decided a customer gets a boolean here; the
 *       row must not contradict the breakdown standing next to it.
 *     - `commission`, `driverPayout`, `driverTier`, `driverCommissionRate`
 *       are the motari's wallet, by the same rule.
 *
 *   DRIVER — `id`, `amount`, `commission`, `driverPayout`, `status`,
 *   `releasedAt`, his OWN tier and rate, and the waiver fields, because
 *   the waiver is his money and the amount is what he was NOT charged.
 *   ApproachPage:87 reads `escrow?.status` and nothing else today; the
 *   settlement columns are his by right, not by current readership.
 *
 *   PRIVILEGED / server-internal — the full row, unchanged. Admin tooling,
 *   the conflict resolver, the jobs and the BNR aggregators all read
 *   columns no client may see, and none of them is a client exit.
 *
 * NEITHER VIEW CARRIES `txRef` OR `flwTxId`. They are the payment
 * processor's references, they identify a charge to anyone holding them,
 * and the census found no client of any role that renders either. The one
 * dereference that existed — BidListPage:244 copying `journey.escrow.txRef`
 * into `PaymentFailure.txRef` — wrote a field that is never read back:
 * `handleSwitchToCard`, the only consumer that needs a reference, re-reads
 * it from `GET /api/payments/:escrowId/status` immediately before opening
 * the widget and says so ("never taken from page state",
 * BidListPage.tsx:753), because a MoMo retry mints a fresh one and page
 * state is stale by construction. That dead carrier is removed in G3.
 *
 * `feeWaiverApplied` is derived from `feeWaiverId !== null` rather than
 * from the live waiver table, so it agrees with LAUNCH-TRUTH G3's rule
 * that once an escrow row exists ITS waiver decision wins — a waiver
 * expiring after the ride must not un-waive the display.
 *
 * Both take `null` and return `null`, so a journey with no escrow keeps
 * saying it has none.
 */
export interface CustomerEscrowView {
  id: string;
  amount: number;
  status: string;
  releasedAt: Date | null;
  customerTier: string | null;
  customerCommissionRate: number | null;
  feeWaiverApplied: boolean;
}

export interface DriverEscrowView {
  id: string;
  amount: number;
  commission: number;
  driverPayout: number;
  status: string;
  releasedAt: Date | null;
  driverTier: string | null;
  driverCommissionRate: number | null;
  waivedCommissionAmount: number | null;
  feeWaiverApplied: boolean;
}

/** The shape both views project from — the Prisma `Escrow` row. */
interface EscrowRowish {
  id: string;
  amount: number;
  commission: number;
  driverPayout: number;
  status: unknown;
  releasedAt: Date | null;
  driverTier?: string | null;
  customerTier?: string | null;
  driverCommissionRate?: number | null;
  customerCommissionRate?: number | null;
  waivedCommissionAmount?: number | null;
  feeWaiverId?: string | null;
}

export function toCustomerEscrowView(
  escrow: EscrowRowish | null | undefined,
): CustomerEscrowView | null {
  if (!escrow) return null;
  return {
    id: escrow.id,
    amount: escrow.amount,
    status: String(escrow.status),
    releasedAt: escrow.releasedAt ?? null,
    customerTier: escrow.customerTier ?? null,
    customerCommissionRate: escrow.customerCommissionRate ?? null,
    feeWaiverApplied: (escrow.feeWaiverId ?? null) !== null,
  };
}

export function toDriverEscrowView(
  escrow: EscrowRowish | null | undefined,
): DriverEscrowView | null {
  if (!escrow) return null;
  return {
    id: escrow.id,
    amount: escrow.amount,
    commission: escrow.commission,
    driverPayout: escrow.driverPayout,
    status: String(escrow.status),
    releasedAt: escrow.releasedAt ?? null,
    driverTier: escrow.driverTier ?? null,
    driverCommissionRate: escrow.driverCommissionRate ?? null,
    waivedCommissionAmount: escrow.waivedCommissionAmount ?? null,
    feeWaiverApplied: (escrow.feeWaiverId ?? null) !== null,
  };
}

/**
 * MONEY-VIEW v2 G3 — the settlement row, read as a money view.
 *
 * `GET /api/journeys` attaches no `commissionBreakdown` at all — there is
 * no such column on `Journey` and the list route computes nothing — so
 * the money blocks on the rides list have been DEAD since they were
 * written. #206 guarded them (correctly: the guard's job is to make the
 * shape safe, not to bet on which shapes arrive) and recorded them as
 * dead. This is what makes them live.
 *
 * DERIVED FROM THE ESCROW ROW, NOT RECOMPUTED. `calculateCommission` off
 * today's tier counts would answer for the rider a customer IS, not for
 * the one she WAS when the ride settled — a passenger crossing the
 * 20-ride line would watch her history rewrite itself. The escrow row is
 * the settlement record: it stores the rates and tiers that were applied
 * and the payout that was credited. Everything below is arithmetic on
 * those stored numbers plus one shared constant, so the list can never
 * disagree with the receipt.
 *
 * The two savings figures are the one genuine derivation, and they use
 * the same definition `calculateCommission` does (tiers.ts:63-66):
 * saving = round(price × (baseline rate − the rate that applied)), where
 * the baseline is the entry tier's rate.
 *
 * A row whose escrow predates the tier columns (all four nullable, added
 * after the model) yields `null` and the key is simply not attached —
 * which is shape 3 in commission-view.ts's taxonomy, the one every
 * screen already handles.
 */
function customerSavingsFrom(amount: number, customerRate: number): number {
  return Math.round(amount * (CUSTOMER_TIERS[0].commissionRate - customerRate));
}

/**
 * The customer-safe four, off the settlement record — the same shape
 * `toCustomerSafeCommission` produces and `hasCustomerSafeCommission`
 * recognises, so the rides list renders through the variant #206 built
 * for MatchedPage with no new client guard.
 */
export function toCustomerListCommission(
  escrowView: CustomerEscrowView | null,
): CustomerSafeCommissionViewType | null {
  if (!escrowView) return null;
  if (escrowView.customerTier === null || escrowView.customerCommissionRate === null) {
    return null;
  }
  // CUTGUARD v2 G3 — through the projector, not an inline literal. The
  // four fields were already right here; what changes is that the shape
  // is now MINTED by the one function allowed to mint it, so this site
  // and the accept site cannot drift apart again.
  return projectCustomerSafeCommission({
    bidPrice: escrowView.amount,
    customerTier: escrowView.customerTier,
    customerSavings: customerSavingsFrom(
      escrowView.amount,
      escrowView.customerCommissionRate,
    ),
    feeWaiverApplied: escrowView.feeWaiverApplied,
  });
}

/**
 * The motari's settlement, in the FULL shape `hasFullCommissionBreakdown`
 * admits — so the block HistoryPage already guards renders for him with
 * no new client guard either.
 *
 * `totalCommissionAmount` is the NOMINAL ladder figure, matching what
 * `getJourneyById` puts there and what LAUNCH-TRUTH G1 stored: under a
 * waiver `commission` holds the CHARGED amount (0) and
 * `waivedCommissionAmount` holds what the tier rate would have taken. So
 * the nominal is the waived amount when a waiver applied and the charged
 * amount otherwise, and `driverPayout` is read straight off the row
 * because that is what escrow actually credited.
 */
export function toDriverSettlementCommission(escrow: {
  amount: number;
  commission: number;
  driverPayout: number;
  driverTier?: string | null;
  customerTier?: string | null;
  driverCommissionRate?: number | null;
  customerCommissionRate?: number | null;
  waivedCommissionAmount?: number | null;
  feeWaiverId?: string | null;
} | null | undefined) {
  if (!escrow) return null;
  const {
    driverTier,
    customerTier,
    driverCommissionRate: driverRate,
    customerCommissionRate: customerRate,
  } = escrow;
  if (
    driverTier == null ||
    customerTier == null ||
    driverRate == null ||
    customerRate == null
  ) {
    return null;
  }
  const feeWaiverApplied = (escrow.feeWaiverId ?? null) !== null;
  const waived = escrow.waivedCommissionAmount ?? 0;
  return {
    bidPrice: escrow.amount,
    driverTier,
    driverCommissionRate: driverRate,
    customerTier,
    customerCommissionRate: customerRate,
    totalCommissionRate: driverRate + customerRate,
    // Nominal — the ladder's truth; a waiver zeroes the CHARGE only.
    totalCommissionAmount: feeWaiverApplied ? waived : escrow.commission,
    driverPayout: escrow.driverPayout,
    customerSavings: customerSavingsFrom(escrow.amount, customerRate),
    driverSavings: Math.round(
      escrow.amount * (DRIVER_TIERS[0].commissionRate - driverRate),
    ),
    feeWaiverApplied,
    chargedCommissionAmount: escrow.commission,
    waivedCommissionAmount: waived,
  };
}

/**
 * INCLUDE-REACH G4 — who may see how much of a journey.
 *
 * `GET /api/journeys/:id` returned, to any authenticated account that knew a
 * journey UUID: the whole chat (`messages`), the escrow row, every leg's
 * `contactName`/`contactPhone` — third-party PII belonging to people who are
 * not party to the request at all — and every bidder's full driver profile.
 * `requestingUserId` was read four times in the function and never once to
 * decide what came back; across its 144 lines it threw exactly one error, a
 * 404 for a journey that did not exist. AUTH-READ (#183) closed this same
 * shape at the chat route; this is the second door into the same room.
 *
 * The fix is NOT a participant gate. BidPage.tsx:56 fetches this route for a
 * journey the driver is not yet part of — that is how a motari inspects an
 * open request before bidding, and a blanket gate would end the marketplace.
 * So the projection is scoped to the viewer, exactly as `bidViewerScope`
 * (bid.service.ts:84-91) scopes a bid's commission breakdown:
 *
 *   - participant (the customer, the matched driver) → everything, unchanged;
 *   - bidder (anyone else, while the journey is still REQUESTED) → what the
 *     bid screen needs to price a bid, and nothing that belongs to a
 *     conversation, a settlement or a third party;
 *   - outsider (anyone else, once the journey is MATCHED to somebody) → the
 *     same lean projection, which the route then answers with a 404;
 *   - privileged (no viewer id — server-internal callers) → everything.
 *
 * ROLE IS DELIBERATELY NOT CONSULTED, and `bidViewerScope` does not consult
 * it either. A `BOTH` account is both a passenger and a motari (see the note
 * at rating.routes.ts:77 — "customerOnly … admits role BOTH, and a BOTH user
 * can be the driver on this very journey"), so role cannot tell a bidder from
 * a bystander. What CAN: a REQUESTED journey is broadcast to the driver pool
 * already — its pickup, destination and price are the open-request card.
 *
 * The denial lives in the ROUTE, not here, and that is not an accident:
 * `POST /:id/emergency` and `GET /:id/emergency/active` also call this
 * function and answer an outsider with 403, a shape their own tests assert
 * (sosfollow-emergency-state.test.ts:222,257). Throwing 404 here would have
 * silently rewritten those two routes.
 */
export type JourneyViewerScope = 'participant' | 'bidder' | 'outsider' | 'privileged';

export function journeyViewerScope(
  requestingUserId: string | undefined,
  // `status` is deliberately a plain string: the Prisma enum carries members
  // (SCHEDULED) that the shared enum does not, and this function is called
  // with rows from both sides of that seam — the route hands it a full
  // journey, the service a three-column probe.
  journey: { customerId: string; driverId: string | null; status: string } | null,
): JourneyViewerScope {
  if (!requestingUserId) return 'privileged';
  if (!journey) return 'outsider';
  if (requestingUserId === journey.customerId) return 'participant';
  if (journey.driverId !== null && requestingUserId === journey.driverId) return 'participant';
  return journey.status === String(JourneyStatus.REQUESTED) ? 'bidder' : 'outsider';
}

/**
 * PARCEL-VISIBLE G2 — the people in a parcel, hidden until there is a
 * relationship to hide them from.
 *
 * #185 scoped the RELATIONS for a bidder (`BID_DECISION_LEG_SELECT` drops
 * every leg's `contactName`/`contactPhone`), but the bidder/outsider read is
 * an `include`, and an `include` returns every SCALAR the row has. So the
 * three columns below travelled anyway, to an audience with no relationship
 * to the journey at all:
 *
 *   - `recipientName` / `recipientPhone` — written at createJourney by an
 *     ordinary GoodsRequestPage booking. The parcel recipient lives on the
 *     JOURNEY, not on a leg, so #185's leg projection never touched them.
 *     Every bidding motari, and every driver whose feed the request reached,
 *     could read a named third party's phone number BEFORE any match.
 *   - `childGuardianPhone` — a minor's guardian. Same door, worse room.
 *
 * The list is a FLOOR, not a ceiling: evidence may add to it, nothing may
 * take from it (PARCEL-VISIBLE invariant 2).
 */
export const PROTECTED_JOURNEY_FIELDS_PRE_MATCH = [
  'recipientName',
  'recipientPhone',
  'childGuardianPhone',
] as const;

/**
 * The single sanctioned path for the strip above. Applied at BOTH pre-match
 * read sites — `getJourneyById`'s bidder/outsider `lean` return and
 * `getJourneys`' driver-feed mapper — and nowhere else.
 *
 * ORACLE HONESTY: route-guard rule 2 reasons about MODELS, not columns. It
 * cannot police a scalar leak without flagging every legitimate participant
 * read of `recipientPhone` (the delivered-SMS path at ~:1119 among them), so
 * it does not police this class at all. The ratchet for the class is the
 * wire-level E2E in journey-read-authorization.spec.ts, which reads the RAW
 * response text: a projection either narrows or it does not.
 *
 * `participant` and `privileged` are returned by IDENTITY — the same object,
 * not a copy — so a participant payload stays byte-identical (invariant 1).
 *
 * The strip DELETES the keys rather than nulling them: an absent key cannot
 * be mistaken for "this parcel has no recipient", and the E2E asserts key
 * ABSENCE.
 */
export function stripJourneyForScope<T extends object>(
  journey: T,
  scope: JourneyViewerScope,
): T {
  if (scope !== 'bidder' && scope !== 'outsider') return journey;
  const scoped = { ...journey } as Record<string, unknown>;
  for (const field of PROTECTED_JOURNEY_FIELDS_PRE_MATCH) {
    delete scoped[field];
  }
  return scoped as T;
}

/**
 * What a motari needs to decide a bid: where, how far, what vehicle, what
 * the passenger wishes to pay, and — for a parcel run — how big the thing is
 * and what kind of thing it is.
 *
 * What is deliberately absent: `messages`, `escrow`, `driver`, `bids` (with
 * them, every rival's profile), and each leg's `contactName`/`contactPhone`.
 *
 * FLAGGED, NOT RESOLVED — the leg contacts are the 20-Aug field request.
 * JourneyLegsDisplay.tsx:219-222 renders `contactName · contactPhone`, and
 * BidPage mounts it, so a bidding motari can read a parcel sender's name and
 * phone today, on a journey he has no relationship to. Whether he SHOULD see
 * them before he is matched is a founder decision this dispatch does not
 * make; what it does is stop them reaching an unbounded audience. The screen
 * degrades cleanly (the render is guarded by `leg.contactName &&`), the
 * matched driver still sees them, and restoring pre-match visibility is one
 * line here if the answer comes back the other way.
 */
const BID_DECISION_LEG_SELECT = {
  id: true,
  journeyId: true,
  sequence: true,
  type: true,
  status: true,
  lat: true,
  lng: true,
  name: true,
  expectedDurationMinutes: true,
  completedAt: true,
  parcelSize: true,
  parcelCategory: true,
} as const;

export async function getJourneyById(
  journeyId: string,
  requestingUserId?: string,
  // CUTGUARD v2 amendment 2 (B-2, as a CLASS) — see getJourneys above.
  // Absent ⇒ LEGACY ⇒ no preview, which is what every non-route caller
  // gets and wants: the breakdown is a client-display projection and no
  // server-internal consumer reads it (census in the amendment report).
  options: { customerSavingsPreview?: boolean } = {},
) {
  // The scope is resolved BEFORE the projection, from the three columns that
  // decide it — the same two-step `getBidsForJourney` makes (bid.service.ts:
  // 92-94). A projection chosen after the fact would have already loaded the
  // chat into memory.
  const base = await prisma.journey.findUnique({
    where: { id: journeyId },
    select: { customerId: true, driverId: true, status: true },
  });

  if (!base) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }

  const scope = journeyViewerScope(requestingUserId, base);

  if (scope === 'bidder' || scope === 'outsider') {
    const lean = await prisma.journey.findUnique({
      where: { id: journeyId },
      include: {
        customer: {
          select: { id: true, nickname: true, completedRides: true },
        },
        legs: { select: BID_DECISION_LEG_SELECT, orderBy: { sequence: 'asc' } },
      },
    });

    if (!lean) {
      throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
    }

    // An outsider's payload never reaches a client: `GET /:id` answers them
    // with 404, and the emergency routes read only `customerId`/`driverId`
    // off this before their own 403. No rating, no commission, no waiver
    // read — there is nobody to compute them for.
    if (scope === 'outsider') {
      return stripJourneyForScope({ ...lean, myRating: null }, scope);
    }

    // LIVE-WIRE G4, preserved verbatim for the viewer it was written for: a
    // driver pricing a bid on a REQUESTED journey is told the customer's
    // rate, so the bid screen can say the exact number instead of a band.
    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId: requestingUserId as string },
      select: { totalRides: true },
    });
    const preview = calculateCommission(
      // Rates are scale-free; 10 000 is a probe, not a price.
      10_000,
      driverProfile?.totalRides ?? 0,
      lean.customer?.completedRides ?? 0,
    );
    const waiver = await getActiveWaiversForDrivers([requestingUserId as string]);
    return stripJourneyForScope(
      {
        ...lean,
        // A REQUESTED journey is never COMPLETED, so this was always null here.
        myRating: null,
        payoutContext: {
          driverCommissionRate: preview.driverCommissionRate,
          customerCommissionRate: preview.customerCommissionRate,
          totalCommissionRate: preview.totalCommissionRate,
          driverTier: preview.driverTier.tier,
          feeWaiverApplied: (waiver.get(requestingUserId as string) ?? null) !== null,
        },
      },
      scope,
    );
  }

  // participant | privileged. INCLUDE-REACH left this branch byte-identical
  // for a participant; MONEY-VIEW v2 changes it deliberately and in exactly
  // three ways, all narrowings of what a participant may READ: the escrow
  // row is projected per viewer (G1), the matched driver's profile is
  // curated, and a driver participant's bid rows are his own (both G2).
  // The customer's payload loses nothing she is entitled to.
  // MONEY-VIEW v2 G2 — WHICH bid rows this participant may read.
  //
  // #206 scoped the rows on `GET /journeys/:id/bids` and left this door
  // untouched: the participant branch returned every bid on the journey
  // to BOTH participants. The customer owns the auction — she is choosing
  // between the offers, so the whole list is her decision. The MATCHED
  // DRIVER reading his rivals' prices is the #206 defect at another exit,
  // in a sealed-bid marketplace where `price` IS the bid. His view is his
  // own bid, which is also the only row any driver surface renders
  // (BidPage's `loadMyCounter` filters `b.driverId === user.id`).
  //
  // Filtered in the QUERY, not after it: a rival's price that never left
  // the database cannot be the next `...rest` spread's problem.
  // Privileged callers (no viewer id) keep the whole list, unchanged.
  const bidsForViewer =
    requestingUserId === undefined || requestingUserId === base.customerId
      ? {}
      : { where: { driverId: requestingUserId } };

  const journey = await prisma.journey.findUnique({
    where: { id: journeyId },
    include: {
      bids: {
        ...bidsForViewer,
        include: {
          // MONEY-VIEW v2 G2 — was `driverProfile: true`, which shipped
          // every bidder's live position and verification internals to
          // the customer choosing between them.
          driver: { select: CURATED_BIDDER_SELECT },
        },
        orderBy: { price: 'asc' },
      },
      escrow: true,
      messages: {
        orderBy: { createdAt: 'asc' },
      },
      customer: {
        select: { id: true, nickname: true, completedRides: true },
      },
      // MONEY-VIEW v2 G2 — the MATCHED driver, curated by the same rule.
      //
      // Not a bid row, and the same room: `driverProfile: true` handed the
      // passenger her motari's live coordinates (`lastLat`/`lastLng`/
      // `lastLocationAt`) and his verification internals — `rejectionReason`
      // in an admin's words, `revokedAt`, the licence and insurance photo
      // URLs. His position reaches her legitimately through the approach
      // STREAM, which is scoped, rate-limited and stops at IN_PROGRESS;
      // this was the same data with none of that.
      //
      // Census before narrowing, both sides: the client reads exactly
      // `vehicleType` (MatchedPage:120, ChatPage:30, ActiveRidePage:138,
      // ApproachPage:80), `verificationStatus` + `ruraAuthorizationNumber`
      // (MatchedPage:340-341, ChatPage:118-122) and `avgRating`/`totalRides`
      // through lib/driver-rating.ts; the server reads `totalRides` for the
      // commission attach below and `vehicleType` at the ETA route. All
      // nine are in the curated set. The emergency route's `lastLat`/
      // `lastLng` read (journey.routes.ts:1113) is its OWN
      // `prisma.user.findUnique` with an explicit select and is untouched.
      driver: { select: CURATED_BIDDER_SELECT },
      // R3-LEGS — include legs for multi-stop journeys, sorted by
      // execution order. Single-leg journeys return [] (the v1
      // backward-compat invariant).
      legs: { orderBy: { sequence: 'asc' } },
    },
  });

  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }

  // TRUE-WORDS G5.1 — the viewer's own stars for this ride.
  //
  // COCKPIT #164 shipped the rating card with no read model: reopening a
  // receipt on a ride you had already rated offered the stars again, and
  // the only way to learn you had rated was to submit and get 409
  // ALREADY_RATED. Rather than add an endpoint, the read rides the GET the
  // receipt already calls — purely additive, so consumers that do not know
  // the field ignore it, and no endpoint is added, renamed or removed.
  //
  // Only the VIEWER's own rating is exposed. The counterpart's stars are
  // not theirs to see, and nothing here reveals whether the other side
  // has rated.
  const myRating =
    requestingUserId && journey.status === 'COMPLETED'
      ? await prisma.rating.findUnique({
          where: { journeyId_raterId: { journeyId, raterId: requestingUserId } },
          // TEAM-ANSWERS G2 — the reason rides the same read as the
          // stars, so a reopened receipt shows the whole of what the
          // passenger sent, not a fragment of it.
          select: { stars: true, comment: true, reason: true, createdAt: true },
        })
      : null;

  // MONEY-VIEW v2 G1 — the escrow row, scoped to the viewer, on the SAME
  // determination the commission redaction below uses
  // (`requestingUserId === journey.customerId`). Computed once here and
  // spread into all three returns of this branch, so no exit of the
  // function can be the one that forgets.
  //
  // `privileged` (no `requestingUserId` — server-internal callers) keeps
  // the raw row: `POST /:id/emergency` and the conflict resolver read
  // columns no client may see, and neither is a client exit.
  const scopedEscrow =
    requestingUserId === undefined
      ? journey.escrow
      : requestingUserId === journey.customerId
        ? toCustomerEscrowView(journey.escrow)
        : toDriverEscrowView(journey.escrow);

  // Include commission breakdown if journey is MATCHED or later with agreed price
  if (journey.agreedPrice && journey.driverId) {
    const driverProfile = journey.driver?.driverProfile;
    const driverRides = driverProfile?.totalRides ?? 0;
    const customerRides = journey.customer?.completedRides ?? 0;
    const commission = calculateCommission(journey.agreedPrice, driverRides, customerRides);

    // LAUNCH-TRUTH G3 — the escrow row is the settlement record: once it
    // exists, its waiver decision wins (a waiver expiring after the ride
    // must not un-waive the display). Only a journey with no escrow yet
    // consults the live waiver state.
    const escrow: any = journey.escrow;
    const waiverRes = escrow?.feeWaiverId
      ? {
          charged: escrow.commission,
          waived: escrow.waivedCommissionAmount ?? 0,
          waiverId: escrow.feeWaiverId as string,
          effectiveDriverPayout: escrow.driverPayout,
        }
      : escrow
        ? resolveWaiverCommission(null, commission)
        : await applyWaiver(journey.driverId, commission);

    // CUTGUARD v2 G3 — the third of the three sites that wrote this
    // ladder out by hand, now built by the same projector as the bid
    // list and the accept path. Same values, one shape.
    const fullBreakdown = toFullCommissionBreakdown({
      bidPrice: journey.agreedPrice,
      commission,
      waiver: waiverRes,
    });

    return {
      ...journey,
      escrow: scopedEscrow,
      myRating,
      // CUTGUARD v2 amendment 2 — the FIRST of B-2's three surfaces, and
      // the one with the worst reach: this feeds MatchedPage, the screen
      // a passenger sits on for the whole ride. v13 guards on presence
      // and then reads `totalCommissionAmount` and `driverPayout` off the
      // object; the customer-safe shape carries neither, and must not.
      //
      // The DRIVER arm is untouched and never gated — his build has
      // always rendered the full ladder, and the gate narrows by CLIENT,
      // not by viewer.
      ...(requestingUserId && requestingUserId === journey.customerId
        ? options.customerSavingsPreview
          ? { commissionBreakdown: projectCustomerSafeCommission(fullBreakdown) }
          : {}
        : { commissionBreakdown: fullBreakdown }),
    };
  }

  // G4 — an unmatched journey a DRIVER is looking at (the bid screen).
  // No commission breakdown exists yet (no agreed price), so this is the
  // only place the exact-net arithmetic can come from.
  if (requestingUserId && requestingUserId !== journey.customerId) {
    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId: requestingUserId },
      select: { totalRides: true },
    });
    const preview = calculateCommission(
      // Rates are scale-free; 10 000 is a probe, not a price.
      10_000,
      driverProfile?.totalRides ?? 0,
      journey.customer?.completedRides ?? 0,
    );
    const waiver = await getActiveWaiversForDrivers([requestingUserId]);
    return {
      ...journey,
      escrow: scopedEscrow,
      myRating,
      payoutContext: {
        driverCommissionRate: preview.driverCommissionRate,
        customerCommissionRate: preview.customerCommissionRate,
        totalCommissionRate: preview.totalCommissionRate,
        driverTier: preview.driverTier.tier,
        feeWaiverApplied: (waiver.get(requestingUserId) ?? null) !== null,
      },
    };
  }

  return { ...journey, escrow: scopedEscrow, myRating };
}

export async function startJourney(journeyId: string, driverId: string, lat: number | null, lng: number | null) {
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });

  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }

  if (journey.driverId !== driverId) {
    throw new AppError(403, 'NOT_ASSIGNED_DRIVER', 'errors.notAssignedDriver');
  }

  // GPS proximity validation
  if (lat != null && lng != null) {
    const distanceToPickup = haversineDistance(lat, lng, journey.pickupLat, journey.pickupLng);
    if (distanceToPickup > START_PROXIMITY_THRESHOLD_KM) {
      throw new AppError(400, 'TOO_FAR_FROM_PICKUP', 'errors.tooFarFromPickup');
    }
  }

  const nextStatus = transitionJourney(
    journey.status as JourneyStatus,
    JourneyAction.START_JOURNEY,
  );

  const updated = await prisma.journey.update({
    where: { id: journeyId },
    data: {
      status: nextStatus,
      startedAt: new Date(),
    },
  });

  // Update driver location if GPS available
  if (lat != null && lng != null) {
    await prisma.driverProfile.update({
      where: { userId: driverId },
      data: { lastLat: lat, lastLng: lng, lastLocationAt: new Date() },
    });
  }

  // Flag GPS missing in audit if no coordinates
  if (lat == null || lng == null) {
    const escrow = await prisma.escrow.findUnique({ where: { journeyId } });
    if (escrow) {
      await appendAuditEntry(escrow.id, 'GPS_MISSING_AT_START', escrow.amount, driverId, {
        gps_missing: true,
      });
    }
  }

  return updated;
}

export async function endJourney(journeyId: string, driverId: string, lat: number | null, lng: number | null) {
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });

  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }

  if (journey.driverId !== driverId) {
    throw new AppError(403, 'NOT_ASSIGNED_DRIVER', 'errors.notAssignedDriver');
  }

  const verdict = await assertLateCompletionAcceptable(
    {
      id: journey.id,
      destinationLat: journey.destinationLat,
      destinationLng: journey.destinationLng,
      startedAt: journey.startedAt,
    },
    lat,
    lng,
  );
  if (!verdict.accept) {
    throw new AppError(400, 'TOO_FAR_FROM_DESTINATION', 'errors.tooFarFromDestination');
  }

  const isLate = verdict.reason === 'GPS_DARK_PERIOD';
  const action = isLate ? JourneyAction.LATE_END_JOURNEY : JourneyAction.END_JOURNEY;
  const nextStatus = transitionJourney(journey.status as JourneyStatus, action);
  const now = new Date();

  // MONEY-ATOMIC G3 — the end stamp and the late-completion bookkeeping
  // are one unit. Before this, marking the journey late and incrementing
  // the driver's lateCompletionCount were separate statements: a failure
  // between them left a journey flagged lateCompletion whose driver never
  // got the counter that feeds the penalty ladder — the record said late,
  // the driver's account said clean. The LATE_END_JOURNEY audit entry
  // joins the same transaction (appendAuditEntryTx, the tx-accepting form)
  // because it IS the record of the decision, not a note about it.
  const updated = await prisma.$transaction(async (tx: any) => {
    const journeyRow = await tx.journey.update({
      where: { id: journeyId },
      data: {
        status: nextStatus,
        endedAt: now,
        ...(isLate
          ? {
              lateCompletion: true,
              dueAt: new Date(now.getTime() + LATE_COMPLETION_DUE_HOURS * 60 * 60 * 1000),
            }
          : {}),
      },
    });

    if (isLate) {
      await tx.user.update({
        where: { id: driverId },
        data: { lateCompletionCount: { increment: 1 } },
      });
      const escrow = await tx.escrow.findUnique({ where: { journeyId } });
      if (escrow) {
        await appendAuditEntryTx(tx, escrow.id, 'LATE_END_JOURNEY', escrow.amount, driverId, {
          reason: 'GPS_DARK_PERIOD',
          dueAt: journeyRow.dueAt?.toISOString(),
        });
      }
    }

    return journeyRow;
  });

  // Update driver location if GPS available.
  if (lat != null && lng != null) {
    await prisma.driverProfile.update({
      where: { userId: driverId },
      data: { lastLat: lat, lastLng: lng, lastLocationAt: new Date() },
    });
  }

  // Flag GPS missing in audit if no coordinates
  if (lat == null || lng == null) {
    const escrow = await prisma.escrow.findUnique({ where: { journeyId } });
    if (escrow) {
      await appendAuditEntry(escrow.id, 'GPS_MISSING_AT_END', escrow.amount, driverId, {
        gps_missing: true,
      });
    }
  }

  // For goods transport: notify recipient
  if (updated.type === 'GOODS' && updated.recipientPhone) {
    const smsService = require('./sms.service');
    await smsService.sendSms(
      updated.recipientPhone,
      `Your Bimoto delivery has arrived! Journey ID: ${updated.id}. Please confirm receipt in the app or reply OK to this message.`
    ).catch((err: Error) => console.error('Failed to send recipient SMS:', err));
  }

  return updated;
}

export async function confirmJourney(journeyId: string, customerId: string) {
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });

  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }

  if (journey.customerId !== customerId) {
    throw new AppError(403, 'NOT_JOURNEY_CUSTOMER', 'errors.notJourneyCustomer');
  }

  const nextStatus = transitionJourney(
    journey.status as JourneyStatus,
    JourneyAction.CONFIRM,
  );

  // Run plausibility check before releasing escrow
  //
  // MONEY-ATOMIC G2 — this diagnostic stays OUTSIDE the settlement
  // transaction below, and now runs before it opens. It is best-effort by
  // design (the swallow is the point: a diagnostic failure may not roll
  // back a payment), and running it ahead of the transaction keeps its
  // RELEASED_WITH_FLAGS entry where it has always been in the escrow's
  // audit chain — immediately before the RELEASED entry the release
  // writes — while guaranteeing a flags entry is never recorded for a
  // release that then rolled back.
  try {
    const validation = await validateJourneyPlausibility(journeyId);
    if (!validation.valid) {
      const escrow = await prisma.escrow.findUnique({ where: { journeyId } });
      if (escrow) {
        await appendAuditEntry(escrow.id, 'RELEASED_WITH_FLAGS', escrow.amount, customerId, {
          flags: validation.flags,
          rawDistanceKm: validation.rawDistanceKm,
          cleanedDistanceKm: validation.cleanedDistanceKm,
          expectedDistanceKm: validation.expectedDistanceKm,
          gpsPointCount: validation.gpsPointCount,
          outlierCount: validation.outlierCount,
        });
      }
    }
  } catch {
    // Don't block journey confirmation if plausibility check fails
  }

  // MONEY-ATOMIC G2 — confirmation is all-or-nothing. The COMPLETED stamp,
  // the escrow release (MONEY MOVES) and both completedRides counters now
  // commit together or not at all.
  //
  // Before this, each was its own statement. A failure after the status
  // update left a terminal COMPLETED journey whose escrow was still HELD:
  // no cron re-examines confirmed journeys, so the driver was simply never
  // paid, and the customer's app showed the ride as done. Rolling the
  // status back with the money is what makes a retry possible.
  //
  // Composed, not re-implemented: releaseEscrowTx is the tx-accepting
  // variant that releaseEscrow itself wraps (escrow.service.ts, the
  // BID-ATOMICITY G1 precedent). Calling the standalone here would nest a
  // transaction inside this one; calling the *Tx variant joins it.
  // NOTIFY G3 — the release info comes OUT of the transaction rather
  // than being captured in a closure variable, so it is typed and so it
  // can only be read once the unit has committed.
  const { journeyRow: updated, releasedTo } = await prisma.$transaction(async (tx: any) => {
    let released: { driverId: string; driverPayout: number } | null = null;
    const journeyRow = await tx.journey.update({
      where: { id: journeyId },
      data: {
        status: nextStatus,
        confirmedAt: new Date(),
      },
    });

    // Same load-then-release shape as the releaseEscrow standalone, and
    // the same 404 when there is no escrow row — except that the throw
    // now rolls the confirmation back instead of stranding it.
    const escrow = await tx.escrow.findUnique({ where: { journeyId } });
    if (!escrow) {
      throw new AppError(404, 'ESCROW_NOT_FOUND', 'errors.escrowNotFound');
    }
    const claimed = await escrowService.releaseEscrowTx(tx, escrow, customerId);
    // Captured for the post-commit announcement below. releaseEscrowTx
    // returns null when another writer already claimed this release, and
    // a null must not produce a second "you were paid" for one payment.
    if (claimed) {
      released = { driverId: escrow.driverId, driverPayout: escrow.driverPayout };
    }

    // Increment completedRides for both customer and driver
    await tx.user.update({
      where: { id: customerId },
      data: { completedRides: { increment: 1 } },
    });

    if (journey.driverId) {
      await tx.user.update({
        where: { id: journey.driverId },
        data: { completedRides: { increment: 1 } },
      });
    }

    return { journeyRow, releasedTo: released };
  });

  // NOTIFY G3 — and NOW tell the motari he was paid.
  //
  // POST-COMMIT, deliberately and necessarily. Inside the transaction
  // this would announce money that a rollback could still take back,
  // and the whole point of MONEY-ATOMIC G2 above is that the release is
  // not real until this line is reached.
  //
  // `driverPayout`, not `amount`: the passenger's fare and the motari's
  // payout are different numbers (escrow.service credits driverPayout to
  // his balance), and telling him the fare would be telling him he
  // earned money he did not.
  //
  // Fire-and-forget by contract — the helper never throws — so a dead
  // socket cannot turn a completed ride into a 500.
  if (releasedTo) {
    notifyEscrowReleased(releasedTo.driverId, journeyId, releasedTo.driverPayout);
  }

  return updated;
}

export async function disputeJourney(journeyId: string, customerId: string, reason: string) {
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });

  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }

  if (journey.customerId !== customerId) {
    throw new AppError(403, 'NOT_JOURNEY_CUSTOMER', 'errors.notJourneyCustomer');
  }

  const nextStatus = transitionJourney(
    journey.status as JourneyStatus,
    JourneyAction.DISPUTE,
  );

  // MONEY-ATOMIC G3 — raising a dispute is all-or-nothing. The DISPUTED
  // stamp, the escrow freeze, the dispute message and both halves of the
  // dispute-rate bookkeeping now commit together or not at all.
  //
  // Before this they were five separate statements, and the first two were
  // the dangerous pair: a failure after the status update left a DISPUTED
  // journey whose escrow was NOT frozen — money the customer had just
  // disputed still releasable by the ordinary confirm path.
  //
  // Composed, not re-implemented: freezeEscrowTx is the tx-accepting
  // variant (escrow.service.ts). The standalone freezeEscrow additionally
  // short-circuits on an already-FROZEN escrow and 404s when there is no
  // escrow row; both behaviours are reproduced here so the caller-visible
  // contract is unchanged.
  const { updated, updatedUser, newRate, shouldFlag } = await prisma.$transaction(
    async (tx: any) => {
      // The dispute-rate write below is a read-modify-write on a row two
      // disputes by the same customer both touch, and READ COMMITTED does
      // not serialize it: both would read the same completedRides/
      // disputeCount pair and the later write would silently discard the
      // earlier rate — the number the fraud flag is computed from. A
      // transaction-scoped advisory lock keyed on the customer serializes
      // disputes for that one user, exactly as fee-waiver/index.ts and
      // aml/limits.ts serialize their own count-then-decide sections. The
      // lock dies with the transaction (same rationale as job-lock.ts).
      // Skipped under unit-test mocks without $queryRaw — behaviour there
      // is the sequential behaviour, unchanged.
      if (typeof tx.$queryRaw === 'function') {
        const lockKey = `dispute-rate:${customerId}`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS locked`;
      }

      const journeyRow = await tx.journey.update({
        where: { id: journeyId },
        data: { status: nextStatus },
      });

      // Freeze escrow
      const escrow = await tx.escrow.findUnique({ where: { journeyId } });
      if (!escrow) {
        throw new AppError(404, 'ESCROW_NOT_FOUND', 'errors.escrowNotFound');
      }
      if (escrow.status !== EscrowStatus.FROZEN) {
        await escrowService.freezeEscrowTx(tx, escrow, customerId);
      }

      // Store dispute reason as a message
      await tx.message.create({
        data: {
          journeyId,
          senderId: customerId,
          text: `[DISPUTE] ${reason}`,
          isQuickMessage: false,
        },
      });

      // Dispute rate tracking
      const userRow = await tx.user.update({
        where: { id: customerId },
        data: {
          disputeCount: { increment: 1 },
        },
      });

      const rate = userRow.disputeCount / Math.max(userRow.completedRides, 1);
      const flag = userRow.completedRides >= 10 && rate > 0.3;

      await tx.user.update({
        where: { id: customerId },
        data: {
          disputeRate: rate,
          ...(flag ? { isFlagged: true } : {}),
        },
      });

      return { updated: journeyRow, updatedUser: userRow, newRate: rate, shouldFlag: flag };
    },
  );

  if (shouldFlag) {
    console.warn(`[FRAUD] User ${customerId} dispute rate ${(newRate * 100).toFixed(1)}% after ${updatedUser.completedRides} rides. Account flagged.`);
  }

  return updated;
}

export async function interruptJourney(
  journeyId: string,
  customerId: string,
  lat?: number,
  lng?: number,
  reason?: string,
) {
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });

  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }

  if (journey.customerId !== customerId) {
    throw new AppError(403, 'NOT_JOURNEY_CUSTOMER', 'errors.notJourneyCustomer');
  }

  const nextStatus = transitionJourney(
    journey.status as JourneyStatus,
    JourneyAction.INTERRUPT,
  );

  const updated = await prisma.journey.update({
    where: { id: journeyId },
    data: { status: nextStatus },
  });

  // Freeze escrow
  await escrowService.freezeEscrow(journeyId, customerId);

  // Open reconciliation so the customer-initiated interruption surfaces to
  // the admin JOURNEY_RECONCILIATION queue once both parties record
  // conflicting responses. Mirrors systemInterruptJourney (the stale-detection
  // path); without this the route's "freezes escrow for admin review" promise
  // was never wired — only the cron path stamped reconciliationOpenedAt.
  await triggerReconciliationOpening(journeyId);

  // Store interrupt info as GPS point if location provided
  if (lat != null && lng != null) {
    await prisma.gpsPoint.create({
      data: {
        journeyId,
        lat,
        lng,
        timestamp: new Date(),
      },
    });
  }

  // Store reason as message if provided
  if (reason) {
    await prisma.message.create({
      data: {
        journeyId,
        senderId: customerId,
        text: `[INTERRUPTED] ${reason}`,
        isQuickMessage: false,
      },
    });
  }

  return updated;
}

// R3-N-1 — per-reason elapsed-time gates. After this dispatch, R3-N-2
// will reuse MATCHED_NO_SHOW_THRESHOLD_MS for the auto-timeout cron.
const CUSTOMER_NO_SHOW_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * R3-N-1 — applies asymmetric attribution counts based on the cancel
 * reason. Always runs inside the cancelJourney $transaction so the
 * counters and the Journey row update commit atomically.
 *
 * Exported (not just module-private) so R3-N-2's auto-timeout cron can
 * call it directly with reason=BOTH_NO_SHOW (system-derived).
 *
 * R3-N-4 — DRIVER_NO_SHOW and BOTH_NO_SHOW also evaluate the graduated
 * penalty thresholds (warning / 24h suspend / flag). The post-increment
 * count is read inside the same tx so suspension/flag setting is
 * atomic with the counter; the returned outcome lets the caller fire
 * push notifications AFTER the tx commits.
 */
export async function applyCancelAttribution(
  tx: any,
  journey: { customerId: string; driverId: string | null },
  reason: CancelReason,
  callerId: string,
): Promise<DriverPenaltyOutcome | null> {
  const customerId = journey.customerId;
  const driverId = journey.driverId;

  switch (reason) {
    case CancelReason.CUSTOMER_CHANGED_MIND:
      await tx.user.update({
        where: { id: callerId },
        data: { cancellationCount: { increment: 1 } },
      });
      return null;
    case CancelReason.DRIVER_NO_SHOW: {
      if (!driverId) return null;
      const post = await tx.user.update({
        where: { id: driverId },
        data: { noShowCount: { increment: 1 } },
        select: { noShowCount: true },
      });
      return applyDriverPenaltyForNoShow(tx, driverId, post.noShowCount);
    }
    case CancelReason.DRIVER_LATE:
      if (driverId) {
        await tx.user.update({
          where: { id: driverId },
          data: { lateMarkCount: { increment: 0.5 } },
        });
      }
      await tx.user.update({
        where: { id: customerId },
        data: { lateMarkCount: { increment: 0.5 } },
      });
      return null;
    case CancelReason.DRIVER_WRONG_VEHICLE:
      if (driverId) {
        await tx.user.update({
          where: { id: driverId },
          data: { wrongVehicleCount: { increment: 1 } },
        });
      }
      return null;
    case CancelReason.SAFETY_CONCERN:
      // No counter increment. Reason is stored on Journey.cancelReason
      // so admins can filter the audit log; the dedicated conflict
      // pipeline lands in a future smaller dispatch.
      return null;
    case CancelReason.CUSTOMER_NO_SHOW:
      await tx.user.update({
        where: { id: customerId },
        data: { noShowCount: { increment: 1 } },
      });
      return null;
    case CancelReason.DRIVER_CAN_NOT_MAKE_IT:
      if (driverId) {
        await tx.user.update({
          where: { id: driverId },
          data: { driverInitiatedCancellationCount: { increment: 1 } },
        });
      }
      return null;
    case CancelReason.BOTH_NO_SHOW: {
      // System-derived only. R3-N-1 user-initiated path rejects this
      // reason before reaching here; R3-N-2 will call us directly.
      let outcome: DriverPenaltyOutcome | null = null;
      if (driverId) {
        const post = await tx.user.update({
          where: { id: driverId },
          data: { noShowCount: { increment: 0.5 } },
          select: { noShowCount: true },
        });
        outcome = await applyDriverPenaltyForNoShow(
          tx,
          driverId,
          post.noShowCount,
        );
      }
      await tx.user.update({
        where: { id: customerId },
        data: { noShowCount: { increment: 0.5 } },
      });
      return outcome;
    }
  }
  return null;
}

/**
 * R3-N-4 — fire post-commit pushes for a graduated penalty outcome.
 * Safe to call with null (no-op). Pushes are fire-and-forget; they
 * NEVER throw out of this helper.
 */
export function dispatchDriverPenaltyPush(
  outcome: DriverPenaltyOutcome | null,
  journeyId: string,
): void {
  if (!outcome) return;
  if (outcome.flagged) {
    notifyDriverAccountFlagged(outcome.driverId, journeyId);
    return;
  }
  if (outcome.suspendedUntil) {
    notifyDriverAccountSuspended(
      outcome.driverId,
      journeyId,
      outcome.suspendedUntil,
    );
    return;
  }
  if (outcome.warningOnly) {
    notifyDriverNoShowWarning(
      outcome.driverId,
      journeyId,
      outcome.newCount,
    );
  }
}

export async function cancelJourney(
  journeyId: string,
  userId: string,
  reason: CancelReason = CancelReason.CUSTOMER_CHANGED_MIND,
) {
  const journey = await prisma.journey.findUnique({
    where: { id: journeyId },
    include: { escrow: true },
  });

  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }

  // Verify user is the customer or the driver
  if (journey.customerId !== userId && journey.driverId !== userId) {
    throw new AppError(403, 'NOT_JOURNEY_PARTICIPANT', 'errors.notJourneyParticipant');
  }

  // R3-N-1 — per-reason validation. Asymmetric attribution must not
  // be triggerable by the wrong party or before the elapsed-time
  // window has passed.
  const isCustomer = journey.customerId === userId;
  const isDriver = journey.driverId === userId;
  const elapsedSinceMatched = journey.matchedAt
    ? Date.now() - journey.matchedAt.getTime()
    : 0;

  switch (reason) {
    case CancelReason.CUSTOMER_CHANGED_MIND:
      // Always allowed — preserves the existing free-cancel behaviour.
      break;
    case CancelReason.DRIVER_NO_SHOW:
      if (!isCustomer) {
        throw new AppError(403, 'WRONG_CALLER_FOR_REASON', 'errors.wrongCallerForReason');
      }
      if (journey.status !== JourneyStatus.MATCHED) {
        throw new AppError(400, 'WRONG_STATE_FOR_NO_SHOW', 'errors.wrongStateForNoShow');
      }
      if (journey.startedAt !== null) {
        throw new AppError(
          400,
          'JOURNEY_STARTED_CANNOT_BE_NO_SHOW',
          'errors.journeyStartedCannotBeNoShow',
        );
      }
      if (elapsedSinceMatched < MATCHED_NO_SHOW_THRESHOLD_MS) {
        throw new AppError(400, 'TOO_EARLY_FOR_NO_SHOW', 'errors.tooEarlyForNoShow');
      }
      break;
    case CancelReason.DRIVER_LATE:
      if (!isCustomer) {
        throw new AppError(403, 'WRONG_CALLER_FOR_REASON', 'errors.wrongCallerForReason');
      }
      if (journey.status !== JourneyStatus.MATCHED) {
        throw new AppError(400, 'WRONG_STATE_FOR_LATE', 'errors.wrongStateForLate');
      }
      if (elapsedSinceMatched < MATCHED_LATE_THRESHOLD_MS) {
        throw new AppError(400, 'TOO_EARLY_FOR_LATE', 'errors.tooEarlyForLate');
      }
      break;
    case CancelReason.DRIVER_WRONG_VEHICLE:
      if (!isCustomer) {
        throw new AppError(403, 'WRONG_CALLER_FOR_REASON', 'errors.wrongCallerForReason');
      }
      if (journey.status !== JourneyStatus.MATCHED) {
        throw new AppError(
          400,
          'WRONG_STATE_FOR_WRONG_VEHICLE',
          'errors.wrongStateForWrongVehicle',
        );
      }
      break;
    case CancelReason.SAFETY_CONCERN:
      // Always allowed by either party.
      break;
    case CancelReason.CUSTOMER_NO_SHOW:
      if (!isDriver) {
        throw new AppError(403, 'WRONG_CALLER_FOR_REASON', 'errors.wrongCallerForReason');
      }
      if (journey.status !== JourneyStatus.MATCHED) {
        throw new AppError(400, 'WRONG_STATE_FOR_NO_SHOW', 'errors.wrongStateForNoShow');
      }
      if (elapsedSinceMatched < CUSTOMER_NO_SHOW_THRESHOLD_MS) {
        throw new AppError(
          400,
          'TOO_EARLY_FOR_CUSTOMER_NO_SHOW',
          'errors.tooEarlyForCustomerNoShow',
        );
      }
      break;
    case CancelReason.DRIVER_CAN_NOT_MAKE_IT:
      if (!isDriver) {
        throw new AppError(403, 'WRONG_CALLER_FOR_REASON', 'errors.wrongCallerForReason');
      }
      if (journey.status !== JourneyStatus.MATCHED) {
        throw new AppError(
          400,
          'WRONG_STATE_FOR_HONEST_WITHDRAWAL',
          'errors.wrongStateForHonestWithdrawal',
        );
      }
      // No time minimum — honest withdrawal allowed at any time.
      break;
    case CancelReason.BOTH_NO_SHOW:
      // System-only; R3-N-2 calls applyCancelAttribution directly.
      throw new AppError(
        400,
        'BOTH_NO_SHOW_IS_SYSTEM_ONLY',
        'errors.bothNoShowIsSystemOnly',
      );
  }

  // COUNTER-READY G2 — cancelling an already-cancelled journey ANSWERS.
  //
  // THE FIELD EVIDENCE. The pilot server log carries the live defect
  // `Invalid journey transition: CANCELLED + CANCEL`: transitionJourney
  // below has no CANCELLED→CANCEL edge, so a second cancel of the same
  // journey throws instead of answering. Today that is mostly reachable
  // by a retry; this wave ADDS a cancel button to the offers screen (the
  // withdraw affordance), and a double-tap on a phone with a slow
  // network would hit it directly.
  //
  // A second cancel wanted the journey cancelled, and the journey is
  // cancelled. So it succeeds, and returns the journey exactly as it
  // stands — with NO second side-effect. Everything below this line is
  // skipped: no second journey.update (which would overwrite cancelledAt
  // and cancelReason with the retry's), no second refundEscrowTx, no
  // second applyCancelAttribution (which increments no-show counters and
  // can flag or suspend a driver), no second penalty push, no second
  // refund announcement, no second scheduled-cancellation bump.
  //
  // PLACED AFTER THE PER-REASON SWITCH, on purpose. Only the reasons the
  // switch lets through reach here, so every existing per-reason refusal
  // keeps its exact behaviour: a DRIVER_NO_SHOW aimed at a cancelled
  // journey still gets WRONG_STATE_FOR_NO_SHOW, because that caller did
  // NOT get the outcome they asked for — the attribution they wanted was
  // never made and never can be. What becomes idempotent is the
  // always-allowed set (CUSTOMER_CHANGED_MIND, SAFETY_CONCERN), which is
  // the set the withdraw button uses and the set the log shows failing.
  //
  // Any OTHER terminal state keeps refusing: a COMPLETED or EXPIRED
  // journey is not cancelled and saying "done" about it would be a lie.
  // transitionJourney still owns that refusal, unchanged.
  //
  // The escrow relation is dropped so the idempotent answer has the SAME
  // shape as the first cancel's (a plain journey row, from
  // tx.journey.update below) — `journey` was read with `include:
  // { escrow: true }` for the refund branch, and a retry must not be the
  // one call that hands a participant the escrow row.
  if (journey.status === JourneyStatus.CANCELLED) {
    const { escrow: _escrow, ...alreadyCancelled } = journey;
    return alreadyCancelled;
  }

  const nextStatus = transitionJourney(
    journey.status as JourneyStatus,
    JourneyAction.CANCEL,
  );

  // SENDER-MATCH-2 — the refund joins the cancellation instead of racing it.
  //
  // This used to read: "refundEscrow runs its own internal $transaction
  // (escrow row + audit log). Call it before the journey/attribution tx so
  // the two logical units commit independently — mirrors the pre-R3-N-1
  // behaviour and avoids nesting Prisma transactions."
  //
  // The stated reason was nesting-avoidance, which is exactly the concern
  // the *Tx variant pattern (#184 MONEY-ATOMIC) obsoleted: refundEscrowTx is
  // the tx-accepting half that refundEscrow itself wraps, so composing joins
  // this transaction rather than nesting a second one inside it. Nothing
  // else was load-bearing about the split, and what it cost was real: the
  // refund COMMITTED FIRST, and a failure in the cancellation that followed
  // left a refunded escrow on a still-MATCHED journey — money returned for a
  // ride the system still believed was happening.
  //
  // Now the status, the cancelReason/cancelledAt stamps, the per-reason
  // attribution and the refund are one unit. A failure anywhere inside
  // leaves the journey MATCHED and the escrow HELD, which is a state the
  // user can simply retry from.
  //
  // Composed, not re-implemented: the standalone refundEscrow additionally
  // 404s when there is no escrow row. That branch is unreachable from here —
  // the `journey.escrow` guard below is what decides the call — so the
  // caller-visible contract is unchanged. refundEscrowTx's single-winner
  // claim (returning null when a racing writer already moved the escrow) is
  // preserved by joining rather than reimplementing it.
  //
  // R3-N-1 — the journey update + attribution half of the same transaction.
  let penaltyOutcome: DriverPenaltyOutcome | null = null;
  // NOTIFY G3 — set inside the transaction, announced after it commits.
  // SENDER-MATCH-2 folded the refund INTO this unit, so a refund is not
  // real until the whole cancellation is: announcing from inside would
  // promise money back that a rollback still takes away.
  let refundedAmount: number | null = null;
  const updated = await prisma.$transaction(async (tx: any) => {
    const updatedJourney = await tx.journey.update({
      where: { id: journeyId },
      data: {
        status: nextStatus,
        cancelledAt: new Date(),
        cancelReason: reason,
      },
    });

    if (journey.status === JourneyStatus.MATCHED) {
      if (journey.escrow) {
        const claimed = await escrowService.refundEscrowTx(tx, journey.escrow, userId);
        // NOTIFY G3 — captured for the post-commit announcement below.
        // refundEscrowTx returns null when a racing writer already moved
        // this escrow, and one refund must not produce two messages.
        if (claimed) refundedAmount = journey.escrow.amount;
      }
      penaltyOutcome = await applyCancelAttribution(
        tx,
        { customerId: journey.customerId, driverId: journey.driverId },
        reason,
        userId,
      );
    }

    return updatedJourney;
  });

  // R3-N-4 — fire graduated-penalty push outside the transaction.
  dispatchDriverPenaltyPush(penaltyOutcome, journeyId);

  // NOTIFY G3 — and the passenger learns her money is coming back.
  //
  // Addressed to the CUSTOMER, who may not be whoever cancelled: a
  // driver's withdrawal refunds a passenger who is still standing at the
  // pickup point, and she is the one person in that exchange who has
  // been told nothing.
  if (refundedAmount !== null) {
    notifyEscrowRefunded(journey.customerId, journeyId, refundedAmount);
  }

  // Dispatch Q — REQUESTED→CANCELLED path: clean up suggest-up timers.
  if (journey.status === JourneyStatus.REQUESTED) {
    onJourneyExitsRequested(journeyId, 'journey-cancelled');
  }

  // SCHEDULED ride cancellation by the customer: bump separate counter
  // (orthogonal to the reason taxonomy — counts schedule-specific
  // cancellations regardless of reason).
  if (journey.bookingMode === BookingMode.SCHEDULED && journey.customerId === userId) {
    await bumpScheduledCancellationCount(userId);
  }

  return updated;
}

// R3-N-4 — driver disputes a system- or customer-attributed
// DRIVER_NO_SHOW. The 7-day window matches typical fraud-review
// SLAs and gives the admin queue time to drain without indefinitely
// open disputes.
// HYGIENE W3 G5 / §E-6 — renamed from DISPUTE_WINDOW_MS. It collided by
// name with the shared DISPUTE_WINDOW_HOURS (24h), and the two are
// different rules, not a disagreement: that one is the customer's window
// to dispute after an AUTO-CONFIRMATION, this one is the driver's window
// to dispute a no-show CANCELLATION. Module-private, so the rename reaches
// no other file, no test and no locale key. The value is unchanged.
const CANCELLATION_DISPUTE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// R3-N-4 — customer re-discovery. After a DRIVER_NO_SHOW cancellation,
// the customer can spawn a fresh REQUESTED journey with the same
// pickup/destination via POST /redispatch within this window. Past
// the window the customer must create a journey from scratch (same
// flow, no auto-prefill).
const REDISPATCH_WINDOW_MS = 30 * 60 * 1000;

export async function redispatchJourney(
  journeyId: string,
  customerId: string,
) {
  const original = await prisma.journey.findUnique({
    where: { id: journeyId },
    include: { redispatches: true },
  });
  if (!original) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }
  if (original.customerId !== customerId) {
    throw new AppError(
      403,
      'NOT_JOURNEY_CUSTOMER',
      'errors.notJourneyCustomer',
    );
  }
  if (original.status !== JourneyStatus.CANCELLED) {
    throw new AppError(400, 'NOT_CANCELLED', 'errors.notCancelled');
  }
  if (original.cancelReason !== CancelReason.DRIVER_NO_SHOW) {
    throw new AppError(400, 'NOT_A_NO_SHOW', 'errors.notANoShow');
  }
  if (
    !original.cancelledAt ||
    Date.now() - original.cancelledAt.getTime() > REDISPATCH_WINDOW_MS
  ) {
    throw new AppError(
      400,
      'REDISPATCH_WINDOW_CLOSED',
      'errors.redispatchWindowClosed',
    );
  }
  if (original.redispatches && original.redispatches.length > 0) {
    throw new AppError(
      400,
      'ALREADY_REDISPATCHED',
      'errors.alreadyRedispatched',
    );
  }

  const fresh = await createJourney(customerId, {
    type: original.type,
    pickupLat: original.pickupLat,
    pickupLng: original.pickupLng,
    pickupName: original.pickupName,
    destinationLat: original.destinationLat,
    destinationLng: original.destinationLng,
    destinationName: original.destinationName,
    // The place has not moved, so the words about it travel to the
    // re-dispatched journey with the rest of it.
    pickupDescription: original.pickupDescription ?? undefined,
    destinationDescription: original.destinationDescription ?? undefined,
    // The child has not stopped travelling because the first motari
    // never came, so the advisory travels to the re-dispatched journey
    // with the rest of it.
    travellingWithChild: original.travellingWithChild ?? undefined,
    vehiclePreference: original.vehiclePreference ?? undefined,
    wishPrice: original.wishPrice ?? undefined,
    bookingMode: BookingMode.IMMEDIATE,
    goodsFragile: original.goodsFragile,
  } as CreateJourneyInput);

  return prisma.journey.update({
    where: { id: fresh.id },
    data: { redispatchedFromId: original.id },
  });
}

export async function disputeNoShow(journeyId: string, driverId: string) {
  const journey = await prisma.journey.findUnique({
    where: { id: journeyId },
  });
  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }
  if (journey.driverId !== driverId) {
    throw new AppError(403, 'NOT_ASSIGNED_DRIVER', 'errors.notAssignedDriver');
  }
  if (journey.cancelReason !== CancelReason.DRIVER_NO_SHOW) {
    throw new AppError(400, 'NOT_A_NO_SHOW', 'errors.notANoShow');
  }
  if (journey.driverDisputedAt !== null) {
    throw new AppError(400, 'ALREADY_DISPUTED', 'errors.alreadyDisputed');
  }
  if (!journey.cancelledAt) {
    throw new AppError(400, 'NOT_CANCELLED', 'errors.notCancelled');
  }
  if (Date.now() - journey.cancelledAt.getTime() > CANCELLATION_DISPUTE_WINDOW_MS) {
    throw new AppError(
      400,
      'DISPUTE_WINDOW_CLOSED',
      'errors.disputeWindowClosed',
    );
  }
  return prisma.journey.update({
    where: { id: journeyId },
    data: { driverDisputedAt: new Date() },
  });
}

const LATE_CANCEL_GUARD_MS = 30 * 60 * 1000;

export async function cancelScheduledJourney(journeyId: string, customerId: string) {
  const journey = await prisma.journey.findUnique({
    where: { id: journeyId },
    include: { escrow: true },
  });

  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }
  if (journey.customerId !== customerId) {
    throw new AppError(403, 'NOT_JOURNEY_CUSTOMER', 'errors.notJourneyCustomer');
  }
  if (journey.bookingMode !== BookingMode.SCHEDULED) {
    throw new AppError(400, 'NOT_SCHEDULED_RIDE', 'errors.notScheduledRide');
  }
  if (
    journey.status === JourneyStatus.MATCHED &&
    journey.scheduledFor &&
    journey.scheduledFor.getTime() - Date.now() < LATE_CANCEL_GUARD_MS
  ) {
    throw new AppError(400, 'LATE_CANCEL_NOT_ALLOWED', 'errors.lateCancelNotAllowed');
  }
  return cancelJourney(journeyId, customerId);
}

/**
 * Records a reconciliation response for either party of an INTERRUPTED journey.
 * If both parties have now responded:
 *   - both ARRIVED_SAFELY -> COMPLETED via RECONCILE_BOTH_ARRIVED
 *   - any other combination -> DISPUTED via RECONCILE_CONFLICT
 */
export async function recordReconciliationResponse(input: RecordReconciliationInput) {
  const journey = await prisma.journey.findUnique({ where: { id: input.journeyId } });
  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }
  if (journey.customerId !== input.respondingUserId && journey.driverId !== input.respondingUserId) {
    throw new AppError(403, 'NOT_JOURNEY_PARTICIPANT', 'errors.notJourneyParticipant');
  }

  const result = await recordReconciliationResponsePrimitive(input);

  if (result.bothPartiesResponded && result.verdict) {
    const action =
      result.verdict === 'BOTH_ARRIVED'
        ? JourneyAction.RECONCILE_BOTH_ARRIVED
        : JourneyAction.RECONCILE_CONFLICT;
    const nextStatus = transitionJourney(journey.status as JourneyStatus, action);

    await prisma.journey.update({
      where: { id: input.journeyId },
      data: {
        status: nextStatus,
        ...(result.verdict === 'BOTH_ARRIVED' ? { confirmedAt: new Date() } : {}),
      },
    });

    const escrow = await prisma.escrow.findUnique({ where: { journeyId: input.journeyId } });
    if (escrow) {
      await appendAuditEntry(escrow.id, `RECONCILED_${result.verdict}`, escrow.amount, 'SYSTEM', {
        respondingUserId: input.respondingUserId,
      });
    }

    if (result.verdict === 'BOTH_ARRIVED') {
      // Release escrow exactly like confirmJourney does.
      try {
        await escrowService.releaseEscrow(input.journeyId, journey.customerId);
      } catch {
        // Escrow may already be in a non-HELD state — don't block reconciliation.
      }
    } else {
      try {
        await escrowService.freezeEscrow(input.journeyId, journey.customerId);
      } catch {
        // Already frozen / non-HELD — don't block reconciliation.
      }
    }

    emitToJourney(input.journeyId, SOCKET_EVENTS.JOURNEY_RECONCILED, {
      journeyId: input.journeyId,
      verdict: result.verdict,
      status: nextStatus,
    });
  }

  return result;
}

/**
 * System-driven INTERRUPT for stale-detection. No customerId check (caller
 * is the cron, not a user). Transitions IN_PROGRESS -> INTERRUPTED, sets
 * staleDetectedAt, opens reconciliation, writes audit.
 */
export async function systemInterruptJourney(journeyId: string, reason: string): Promise<void> {
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });
  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }
  if (journey.status !== JourneyStatus.IN_PROGRESS) {
    return; // idempotent: already moved on
  }

  const nextStatus = transitionJourney(
    journey.status as JourneyStatus,
    JourneyAction.INTERRUPT,
  );

  await prisma.journey.update({
    where: { id: journeyId },
    data: {
      status: nextStatus,
      staleDetectedAt: new Date(),
    },
  });

  const escrow = await prisma.escrow.findUnique({ where: { journeyId } });
  if (escrow) {
    await appendAuditEntry(escrow.id, 'SYSTEM_INTERRUPT', escrow.amount, 'SYSTEM', {
      reason,
    });
  }

  await triggerReconciliationOpening(journeyId);
  emitToJourney(journeyId, SOCKET_EVENTS.JOURNEY_INTERRUPTED, {
    journeyId,
    status: nextStatus,
    reason,
    triggeredBy: 'system',
  });
}
