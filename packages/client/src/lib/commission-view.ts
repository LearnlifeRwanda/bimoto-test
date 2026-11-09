// CLEAN-SWEEP G1 — the one place that decides how much of a commission
// breakdown a screen may dereference.
//
// THE SHAPE IS NOT ONE SHAPE. `CommissionBreakdown` (shared/types/journey.ts)
// declares eleven fields and every screen typed its payload as that whole
// interface — but the server hands out THREE different shapes through it:
//
//   1. the FULL breakdown — driver and privileged callers, every field;
//   2. the CUSTOMER-SAFE subset — EXPORT-AND-LEDGER G4's
//      `toCustomerSafeCommission` (server/services/journey.service.ts),
//      which is exactly { bidPrice, customerTier, customerSavings,
//      feeWaiverApplied } and OMITS totalCommissionAmount,
//      totalCommissionRate and driverPayout, because the motari's net is
//      reconstructible from them (payout = price − amount);
//   3. NOTHING — the key absent entirely (a customer's bid list, a list
//      route that attaches no breakdown at all).
//
// A `breakdown &&` test proves only that shape 3 did not happen. Shape 2
// then walks straight into `undefined.toLocaleString()`, which is the
// crash the field dump carried nine times on MatchedPage and which
// RideReceiptPage still carried after it (CLEAN-SWEEP §0.2).
//
// So the predicate lives HERE, once, and every screen that dereferences a
// money field imports it. Three copies of a guard are three chances for
// the fourth field report; one copy is none.
import type { CommissionBreakdown } from '@bimoto/shared';

/**
 * What the wire ACTUALLY carries.
 *
 * `CommissionBreakdown` declares ten of its fields non-optional, which is
 * why every screen believed they were there — and is the same kind of lie
 * `User.emergencyContacts` told (CLEAN-SWEEP §0.4). It describes shape 1
 * and nothing else, while three shapes come down the same key. The
 * compiler proved it during this change: `!hasFullCommissionBreakdown(b)`
 * narrowed a `CommissionBreakdown` to `never`, because by the type there
 * is no other shape it could be.
 *
 * So a screen's payload field is typed as this — every money field
 * possibly absent — and the guards below are the only way back to a shape
 * you may dereference. The shared type is left alone: it is the SERVER's
 * full breakdown, correctly, and narrowing it there would be a server
 * change this dispatch does not make.
 */
export type WireCommissionBreakdown = Partial<CommissionBreakdown>;

/**
 * A breakdown that carries every field any screen in this app reads.
 *
 * Deliberately the SUPERSET, not the per-screen minimum: the guard's job
 * is to make a missing-field crash structurally impossible, so it answers
 * "is this the full shape?" rather than "does this happen to satisfy the
 * caller I was written for?". The server's full breakdown always carries
 * all ten, so no full-shape payload is refused by widening it.
 *
 * `feeWaiverApplied`, `chargedCommissionAmount` and `waivedCommissionAmount`
 * are NOT required: the shared type marks them optional (pre-waiver caches
 * and fixtures omit them) and every read of them is a boolean test or a
 * branch, never a dereference.
 */
export type FullCommissionBreakdown = CommissionBreakdown;

/** The four fields, and only the four, that a customer is given. */
export interface CustomerSafeCommission {
  bidPrice: number;
  customerTier: string;
  customerSavings: number;
  feeWaiverApplied?: boolean;
}

/**
 * True when the breakdown carries every field the app's money blocks
 * dereference. The one guard; five consuming screens.
 */
export function hasFullCommissionBreakdown(
  b: WireCommissionBreakdown | undefined | null,
): b is FullCommissionBreakdown {
  return (
    !!b &&
    typeof b.bidPrice === 'number' &&
    typeof b.driverTier === 'string' &&
    typeof b.driverCommissionRate === 'number' &&
    typeof b.customerTier === 'string' &&
    typeof b.customerCommissionRate === 'number' &&
    typeof b.totalCommissionRate === 'number' &&
    typeof b.totalCommissionAmount === 'number' &&
    typeof b.driverPayout === 'number' &&
    typeof b.customerSavings === 'number' &&
    typeof b.driverSavings === 'number'
  );
}

/**
 * True when the breakdown carries the customer-safe four.
 *
 * The full shape satisfies this too — it is a superset — so callers that
 * want the REDACTED case specifically must test
 * `!hasFullCommissionBreakdown(b) && hasCustomerSafeCommission(b)`. That
 * ordering is deliberate: it is the shape the server designed for a
 * passenger, and the only shape the customer variant may render from.
 */
export function hasCustomerSafeCommission(
  b: WireCommissionBreakdown | undefined | null,
): b is CustomerSafeCommission {
  return (
    !!b &&
    typeof b.bidPrice === 'number' &&
    typeof b.customerTier === 'string' &&
    typeof b.customerSavings === 'number'
  );
}
