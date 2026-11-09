// SERVICES/AUTO-BID/EVALUATOR.TS
//
// HAZARD: this module has NO internal try/catch. Every caller MUST
// wrap calls in try/catch + Sentry capture + a Promise.race timeout.
// The canonical pattern is in services/auto-bid/cascade-integration.ts
// (per-driver try/catch + 5s race + sentryHook). If you add a new
// caller, copy the wrapping pattern from there. A bare call to
// evaluateRulesForJourney (or any other export here) without try/catch
// will propagate uncaught errors and may abort an entire ring's driver
// iteration.
//
// Future split: this file is over the 250-line ceiling. Track for
// split into match.ts (ruleMatches) + compute-amount.ts
// (computeBidAmount) + orchestrator.ts (evaluateRulesForJourney). The
// pure functions are easy to extract; the orchestrator's DB tx logic
// stays in one place. OUT OF SCOPE for Dispatch Q.
//
// Pure-then-IO evaluator for Dispatch K2.
//   - ruleMatches(ctx)        : pure predicate; no DB, no socket.
//   - computeBidAmount(rule, fairPriceRwf)
//                             : pure RWF amount or null if PERCENT
//                               mode but fair price unavailable.
//   - evaluateRulesForJourney : full IO entry point — loads driver,
//                               journey, rules, fair price; checks
//                               rate limit and existing-bid; reuses
//                               createBid; emits a socket event for
//                               the driver to see "auto-bid fired".
//
// FLAT mode → bidAmountValue is RWF, used directly.
// PERCENT_OF_FAIR_PRICE → bidAmountValue is a percent (e.g. 110 means
//   110% of fair price = +10%). Smallest-wrongness gate: a value of
//   110 must produce 2200 against fairPrice=2000, NOT 110.

import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { haversineMeters } from '../discovery/cascade';
import { DRIVER_LOCATION_FRESHNESS_SECONDS } from '../discovery/config';
import { estimatePrice } from '../fair-price.service';
import { createBid } from '../bid.service';
import { DEFAULT_ETA_MINUTES } from './config';
import { checkRateLimit, recordAutoBid } from './rate-limiter';
import { SOCKET_EVENTS } from '@bimoto/shared';
import type {
  AutoBidResult,
  BidAmountModeT,
  MatchContext,
} from './types';

export function ruleMatches(
  ctx: Omit<MatchContext, 'fairPriceRwf'>,
): boolean {
  const { journey, driver, rule, now } = ctx;
  if (!rule.enabled) return false;
  if (driver.frozenAt !== null) return false;
  if (
    driver.lastLat === null ||
    driver.lastLng === null ||
    driver.lastLocationAt === null
  ) {
    return false;
  }
  // Driver location freshness — same threshold as K1's discovery.
  const ageSec =
    (now.getTime() - driver.lastLocationAt.getTime()) / 1000;
  if (ageSec > DRIVER_LOCATION_FRESHNESS_SECONDS) return false;

  // ANY-VEHICLE G4 — a NULL journey.vehiclePreference PASSES a
  // non-null vehicleTypeFilter.
  //
  // The filter means "jobs for this kind of vehicle" (the rules screen
  // offers it against "any machine", which is the null filter). An
  // any-vehicle job is BY DEFINITION suitable for every kind of
  // vehicle, the rule's included — so it is a job for this kind of
  // vehicle, and the filter should pass it.
  //
  // The plain !== this replaces said otherwise: a null preference
  // equals no filter value, so every filtered rule silently skipped
  // every any-vehicle journey. That was invisible while the customer
  // had no way to REQUEST any-vehicle (G1 gives them one), and it
  // excluded exactly the motari who had told us in advance what work
  // he wants from exactly the jobs open to him.
  //
  // A MISMATCHED explicit preference still skips, unchanged: a moto
  // rule does not fire on a job the customer asked a bicycle for.
  //
  // Falsy rather than `!== null`, which is the same test the three
  // sibling vehicle filters already make on this field — the driver
  // feed (journey.service.ts:660), bid gating (bid.service.ts:327) and
  // cooperative dispatch (dispatch.service.ts:126). This was the only
  // one of the four that did not.
  if (
    rule.vehicleTypeFilter !== null &&
    journey.vehiclePreference &&
    journey.vehiclePreference !== rule.vehicleTypeFilter
  ) {
    return false;
  }

  const pickupDist = haversineMeters(
    { lat: driver.lastLat, lng: driver.lastLng },
    { lat: journey.pickupLat, lng: journey.pickupLng },
  );
  if (pickupDist > rule.maxPickupDistanceM) return false;

  const rideDist = haversineMeters(
    { lat: journey.pickupLat, lng: journey.pickupLng },
    { lat: journey.destinationLat, lng: journey.destinationLng },
  );
  if (rideDist > rule.maxRideDistanceM) return false;

  return true;
}

export function computeBidAmount(
  rule: { bidAmountMode: BidAmountModeT; bidAmountValue: number },
  fairPriceRwf: number | null,
): number | null {
  if (rule.bidAmountMode === 'FLAT') {
    return Math.round(rule.bidAmountValue);
  }
  if (rule.bidAmountMode === 'PERCENT_OF_FAIR_PRICE') {
    if (fairPriceRwf === null) return null;
    // bidAmountValue is a PERCENT (e.g. 110 = 110%), NOT a fraction.
    return Math.round(fairPriceRwf * (rule.bidAmountValue / 100));
  }
  return null;
}

interface JourneyShape {
  id: string;
  pickupLat: number;
  pickupLng: number;
  destinationLat: number;
  destinationLng: number;
  vehiclePreference: string | null;
  estimatedDistance: number | null;
}

interface DriverShape {
  id: string;
  frozenAt: Date | null;
  driverProfile: {
    lastLat: number | null;
    lastLng: number | null;
    lastLocationAt: Date | null;
  } | null;
}

async function fairPriceForJourney(
  journey: JourneyShape,
): Promise<number | null> {
  if (journey.estimatedDistance === null || journey.estimatedDistance === undefined) {
    // Fall back to haversine pickup→destination in km.
    const km = haversineMeters(
      { lat: journey.pickupLat, lng: journey.pickupLng },
      { lat: journey.destinationLat, lng: journey.destinationLng },
    ) / 1000;
    if (!Number.isFinite(km) || km <= 0) return null;
    const range = estimatePrice(km);
    return Math.round((range.min + range.max) / 2);
  }
  const range = estimatePrice(journey.estimatedDistance);
  return Math.round((range.min + range.max) / 2);
}

export async function evaluateRulesForJourney(
  prisma: PrismaClient,
  driverId: string,
  journeyId: string,
  io: SocketIOServer | null,
  now: Date = new Date(),
): Promise<AutoBidResult> {
  const ratecheck = checkRateLimit(driverId, now);
  if (!ratecheck.allowed) {
    return {
      fired: false,
      bidAmount: null,
      bidId: null,
      ruleId: null,
      driverId,
      journeyId,
      reason: 'rate-limited',
    };
  }

  const driver = (await prisma.user.findUnique({
    where: { id: driverId },
    include: { driverProfile: true },
  })) as DriverShape | null;

  if (!driver) {
    return {
      fired: false,
      bidAmount: null,
      bidId: null,
      ruleId: null,
      driverId,
      journeyId,
      reason: 'no-match',
    };
  }

  if (driver.frozenAt !== null) {
    return {
      fired: false,
      bidAmount: null,
      bidId: null,
      ruleId: null,
      driverId,
      journeyId,
      reason: 'driver-frozen',
    };
  }

  // Already-bid short-circuit before doing more work.
  const existingBid = await prisma.bid.findUnique({
    where: { journeyId_driverId: { journeyId, driverId } },
  });
  if (existingBid) {
    return {
      fired: false,
      bidAmount: null,
      bidId: null,
      ruleId: null,
      driverId,
      journeyId,
      reason: 'already-bid',
    };
  }

  const journey = (await prisma.journey.findUnique({
    where: { id: journeyId },
  })) as JourneyShape | null;
  if (!journey) {
    return {
      fired: false,
      bidAmount: null,
      bidId: null,
      ruleId: null,
      driverId,
      journeyId,
      reason: 'no-match',
    };
  }

  const rules = await prisma.driverAutoBidRule.findMany({
    where: { driverId, enabled: true },
    orderBy: { priority: 'asc' },
  });

  let firstMatch: (typeof rules)[number] | null = null;
  for (const rule of rules) {
    const matched = ruleMatches({
      journey,
      driver: {
        id: driver.id,
        lastLat: driver.driverProfile?.lastLat ?? null,
        lastLng: driver.driverProfile?.lastLng ?? null,
        lastLocationAt: driver.driverProfile?.lastLocationAt ?? null,
        frozenAt: driver.frozenAt,
      },
      rule,
      now,
    });
    if (matched) {
      firstMatch = rule;
      break;
    }
  }

  if (!firstMatch) {
    return {
      fired: false,
      bidAmount: null,
      bidId: null,
      ruleId: null,
      driverId,
      journeyId,
      reason: 'no-match',
    };
  }

  let fairPriceRwf: number | null = null;
  if (firstMatch.bidAmountMode === 'PERCENT_OF_FAIR_PRICE') {
    fairPriceRwf = await fairPriceForJourney(journey);
    if (fairPriceRwf === null) {
      return {
        fired: false,
        bidAmount: null,
        bidId: null,
        ruleId: firstMatch.id,
        driverId,
        journeyId,
        reason: 'fair-price-unavailable',
      };
    }
  }

  const bidAmount = computeBidAmount(
    {
      bidAmountMode: firstMatch.bidAmountMode as BidAmountModeT,
      bidAmountValue: firstMatch.bidAmountValue,
    },
    fairPriceRwf,
  );

  if (bidAmount === null || bidAmount <= 0) {
    return {
      fired: false,
      bidAmount: null,
      bidId: null,
      ruleId: firstMatch.id,
      driverId,
      journeyId,
      reason: 'amount-out-of-range',
    };
  }

  // Reuse the existing createBid path so vehicle compliance, journey
  // status and the unique (journeyId, driverId) check all run through
  // the same code as a manual bid.
  const bid = await createBid(journeyId, driverId, bidAmount, DEFAULT_ETA_MINUTES);

  // Stamp the rule reference on the just-created bid.
  await prisma.bid.update({
    where: { id: bid.id },
    data: { autoBidRuleId: firstMatch.id },
  });

  recordAutoBid(driverId, now);

  if (io) {
    io.to(`user:${driverId}`).emit(SOCKET_EVENTS.AUTO_BID_FIRED, {
      journeyId,
      bidId: bid.id,
      ruleId: firstMatch.id,
      bidAmount,
    });
  }

  return {
    fired: true,
    bidAmount,
    bidId: bid.id,
    ruleId: firstMatch.id,
    driverId,
    journeyId,
    reason: 'fired',
  };
}
