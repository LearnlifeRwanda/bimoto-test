// SERVICES/COMMISSION-VIEW.TS
//
// CUTGUARD v2 G3 — THE customer money-projection boundary.
//
// WHAT WAS ACTUALLY WRONG, and it is not what it looked like.
// `toCustomerSafeCommission` existed and was correct. It was defined in
// journey.service.ts and called at exactly ONE site (the journey read).
// So it was not a boundary — it was a function most customer paths
// happened to call. `POST /accept-bid` did not call it. It built its own
// thirteen-key breakdown inline, including `driverPayout`, and handed the
// passenger the motari's full settlement. #207 scoped the bid LIST and
// the accept RESULT went out the door beside it.
//
// That is the CLASS: a customer-facing commission was projected
// per-endpoint, by hand, by whoever wrote the endpoint. Fixing the accept
// path alone would leave the class open — the next exit forgets in
// exactly the same way, because nothing about the code makes forgetting
// hard.
//
// THE FIX IS A TYPE. `CustomerSafeCommission` is NOMINAL, not structural:
// it carries a branded property that only this module can produce. A
// customer-scoped payload declares its commission as that type, and an
// inline object literal — however carefully written — cannot be assigned
// to it. `driverPayout` on a customer response is a compile error, not a
// review finding.
//
// The brand is a `unique symbol` key. It is declared and never assigned
// at runtime, so it costs nothing and, because JSON.stringify skips
// symbol-keyed properties, it never reaches the wire. The single cast
// that mints one lives in `toCustomerSafeCommission` below and nowhere
// else — that cast IS the boundary, which is why it is one line in one
// file with this comment on it rather than an idiom scattered around.
//
// The static twin is scripts/serialization-guard rule S3: a
// `commissionBreakdown` written as an object literal rather than produced
// by a projector is a red build. The type stops a customer response
// carrying driver money; S3 stops a new hand-rolled projection being
// written at all.

/**
 * The brand. Declared, never assigned; `unique symbol` makes it
 * unforgeable from outside this module because no other file can name it.
 */
declare const CUSTOMER_SAFE_COMMISSION: unique symbol;

/**
 * WHAT A CUSTOMER MAY SEE of the commission on her own ride.
 *
 * Four fields, and the reason it is these four is arithmetic rather than
 * taste: `customerSavings` is a function of the CUSTOMER rate alone, so
 * it narrows to nothing about the motari. `totalCommissionAmount` and
 * `totalCommissionRate` are excluded because either of them plus the
 * price reconstructs `driverPayout`, which is the number this whole
 * boundary exists to withhold.
 *
 * Constructible ONLY by `toCustomerSafeCommission`. That is the point:
 * an inline literal with the same four fields will not typecheck here,
 * so there is no second way to make one and no second place to get it
 * wrong.
 */
export interface CustomerSafeCommission {
  /** Brand. Never assigned at runtime; never serialized. */
  readonly [CUSTOMER_SAFE_COMMISSION]: true;
  bidPrice: number;
  customerTier: string;
  customerSavings: number;
  feeWaiverApplied: boolean;
}

/**
 * The DRIVER's view — the full ladder, including his own net.
 *
 * Named as a type so a driver-scoped payload can say so, and so the
 * difference between the two audiences is a thing the compiler knows
 * about rather than a comment somebody has to read.
 */
export interface FullCommissionBreakdown {
  bidPrice: number;
  driverTier: string;
  driverCommissionRate: number;
  customerTier: string;
  customerCommissionRate: number;
  totalCommissionRate: number;
  totalCommissionAmount: number;
  driverPayout: number;
  customerSavings: number;
  driverSavings: number;
  feeWaiverApplied: boolean;
  chargedCommissionAmount: number;
  waivedCommissionAmount: number;
}

/**
 * The four fields, before branding. Callers build this; only this module
 * turns it into a CustomerSafeCommission.
 */
export interface CustomerSafeCommissionInput {
  bidPrice: number;
  customerTier: string;
  customerSavings: number;
  feeWaiverApplied: boolean;
}

/**
 * THE projector. The only constructor of a customer-facing commission.
 *
 * Accepts anything carrying the four fields — including a
 * FullCommissionBreakdown, which is the ordinary case: the accept path
 * and the journey read both compute the full ladder first (they must:
 * the escrow is written from it) and then answer the customer with this.
 * The extra keys are DROPPED here rather than merely left unread, so a
 * caller cannot accidentally forward them.
 */
export function toCustomerSafeCommission(
  full: CustomerSafeCommissionInput,
): CustomerSafeCommission {
  // THE ONE CAST. Everything above is arranged so that this is the
  // single place a CustomerSafeCommission comes into existence; moving,
  // copying, or adding a second one re-opens the class.
  return {
    bidPrice: full.bidPrice,
    customerTier: full.customerTier,
    customerSavings: full.customerSavings,
    feeWaiverApplied: full.feeWaiverApplied,
  } as CustomerSafeCommission;
}

/**
 * Back-compat alias for the name journey.service.ts published before this
 * module existed. Kept so importers and tests that name the view type
 * keep working; new code should say `CustomerSafeCommission`.
 */
export type CustomerSafeCommissionView = CustomerSafeCommission;

/**
 * The DRIVER projector — the symmetric half of the boundary.
 *
 * It exists because "one function decides what each audience sees" is
 * only true if BOTH audiences go through a function. The full ladder was
 * written out as an object literal at three sites (the bid list's driver
 * arm, the accept path, the journey read), each of them correct and each
 * of them one edit away from drifting from the others — which is the
 * shape of the drift that produced U-4 in the first place, just on the
 * other side.
 *
 * Takes the two things the ladder is computed from, so a caller cannot
 * assemble a breakdown out of pieces that did not come from one
 * calculation: the commission result and the fee-waiver result.
 *
 * NOTE ON THE MONEY. This projector does not compute anything. Every
 * value is copied from the inputs exactly as the three literals it
 * replaces copied them — `totalCommissionAmount` stays NOMINAL (the
 * ladder's truth; a waiver zeroes the CHARGE, not the ladder), and
 * `driverPayout` stays the waiver-effective payout. The escrow is written
 * from the same inputs, upstream, and is untouched.
 */
export function toFullCommissionBreakdown(input: {
  bidPrice: number;
  commission: {
    driverTier: { tier: string };
    driverCommissionRate: number;
    customerTier: { tier: string };
    customerCommissionRate: number;
    totalCommissionRate: number;
    totalCommissionAmount: number;
    customerSavings: number;
    driverSavings: number;
  };
  waiver: {
    effectiveDriverPayout: number;
    waiverId: string | null;
    charged: number;
    waived: number;
  };
}): FullCommissionBreakdown {
  const { bidPrice, commission, waiver } = input;
  return {
    bidPrice,
    driverTier: commission.driverTier.tier,
    driverCommissionRate: commission.driverCommissionRate,
    customerTier: commission.customerTier.tier,
    customerCommissionRate: commission.customerCommissionRate,
    totalCommissionRate: commission.totalCommissionRate,
    // Nominal — the ladder's truth; a waiver zeroes the charge only.
    totalCommissionAmount: commission.totalCommissionAmount,
    driverPayout: waiver.effectiveDriverPayout,
    customerSavings: commission.customerSavings,
    driverSavings: commission.driverSavings,
    feeWaiverApplied: waiver.waiverId !== null,
    chargedCommissionAmount: waiver.charged,
    waivedCommissionAmount: waiver.waived,
  };
}
