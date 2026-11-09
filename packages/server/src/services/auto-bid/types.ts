// SERVICES/AUTO-BID/TYPES.TS
//
// Shared interfaces for Dispatch K2 — driver auto-bid rules. A driver
// pre-configures up to MAX_RULES_PER_DRIVER rules; when a journey
// reaches them via K1's cascade, the evaluator picks the
// highest-priority matching rule and fires a Bid via the existing
// createBid path. Bids carry an `autoBidRuleId` foreign key so the
// driver can review which rule fired which bid in their history.
//
// FLAT vs PERCENT_OF_FAIR_PRICE: both modes go through the same
// evaluator. FLAT stores the bid amount directly in RWF; PERCENT
// stores a percentage (e.g. 110 = 110% of fair price = +10%) and
// the evaluator multiplies by the live fair-price estimate.

import type { DriverAutoBidRule } from '@prisma/client';

// TRUE-WORDS G5.3 — canonical is the shared VehicleType enum's 'E_MOTO',
// which is what every Journey.vehiclePreference row holds and what
// driver-auto-bid.routes.ts normalises to. The legacy 'EMOTO' spelling is
// still ACCEPTED at the route boundary and transformed away there (see
// that file's zod .transform, kept for deployed APKs), so it never reaches
// this type — which is why it is not a member. It used to be, and the type
// lied: it named a value no stored rule could ever hold.
// FLIGHT-RECORDER G5.4 — 'E_BIKE' joins them: it was always a member of
// the shared VehicleType enum and the only one the filter could not name,
// so an e-bike driver's rules could never be about his own machine.
export type VehicleTypeFilter = 'MOTO' | 'BIKE' | 'E_MOTO' | 'E_BIKE' | null;

export type BidAmountModeT = 'FLAT' | 'PERCENT_OF_FAIR_PRICE';

export interface RuleInput {
  // 0..MAX_RULES_PER_DRIVER-1; lower number wins.
  priority: number;
  enabled: boolean;
  // Max distance from driver's last known location to journey pickup.
  maxPickupDistanceM: number;
  // Max ride distance (pickup → destination).
  maxRideDistanceM: number;
  vehicleTypeFilter: VehicleTypeFilter;
  bidAmountMode: BidAmountModeT;
  // FLAT: RWF amount (FLAT_BID_MIN_RWF..FLAT_BID_MAX_RWF).
  // PERCENT_OF_FAIR_PRICE: percent value (PERCENT_BID_MIN..PERCENT_BID_MAX),
  // e.g. 110 means 110% of the fair-price estimate.
  bidAmountValue: number;
}

export interface MatchContext {
  journey: {
    id: string;
    pickupLat: number;
    pickupLng: number;
    destinationLat: number;
    destinationLng: number;
    vehiclePreference: string | null;
  };
  driver: {
    id: string;
    lastLat: number | null;
    lastLng: number | null;
    lastLocationAt: Date | null;
    frozenAt: Date | null;
  };
  rule: DriverAutoBidRule;
  // Computed via fair-price.service if rule.bidAmountMode === PERCENT_OF_FAIR_PRICE.
  // null if FLAT (caller doesn't bother) or fair-price unavailable.
  fairPriceRwf: number | null;
  now: Date;
}

export type AutoBidReason =
  | 'fired'
  | 'no-match'
  | 'rate-limited'
  | 'driver-frozen'
  | 'already-bid'
  | 'amount-out-of-range'
  | 'fair-price-unavailable';

export interface AutoBidResult {
  fired: boolean;
  bidAmount: number | null;
  bidId: string | null;
  ruleId: string | null;
  driverId: string;
  journeyId: string;
  reason: AutoBidReason;
}

// Structured store-layer error codes. Routes translate to HTTP 400/403/404.
export type RuleStoreErrorCode =
  | 'TOO_MANY_RULES'
  | 'PRIORITY_TAKEN'
  | 'INVALID_AMOUNT'
  | 'INVALID_DISTANCE'
  | 'INVALID_PRIORITY'
  | 'RULE_NOT_FOUND'
  | 'NOT_RULE_OWNER';

export class RuleStoreError extends Error {
  readonly code: RuleStoreErrorCode;
  constructor(code: RuleStoreErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'RuleStoreError';
  }
}
