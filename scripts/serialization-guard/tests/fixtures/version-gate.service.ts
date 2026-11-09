// FIXTURE — rule S4, both directions.
//
// Parsed as text by the self-test; never imported, never built.
//
// The shapes here are the ones the real tree actually has, because S4's
// whole difficulty is that the three gated surfaces gate in three
// different places: the journey read inside the spread, the rides list at
// a variable two lines above the attach, and the bid list inside a
// `.map()` callback. A rule that only understood one of them would have
// to be argued with at every site.

import {
  toCustomerSafeCommission,
  toCustomerListCommission,
  projectCustomerSafeCommission,
  toFullCommissionBreakdown,
} from './commission-view';

declare const bid: any;
declare const commission: any;
declare const escrow: any;
declare const journey: any;
declare const rows: any[];
declare const fullBreakdown: any;

/* ------------------------------------------------- direction 1: it FAILS --- */

// REFUSED — the new surface, added by somebody not thinking about v13.
// This is B-2's exact shape and the reason the rule exists.
export function newCustomerSurface() {
  return {
    ...journey,
    commissionBreakdown: toCustomerSafeCommission({
      bidPrice: bid.price,
      customerTier: commission.customerTier.tier,
      customerSavings: commission.customerSavings,
      feeWaiverApplied: false,
    }),
  };
}

// REFUSED — the rides-list SHAPE without the rides-list GATE: projected
// into a local, attached by shorthand. The projector is what condemns it,
// not the syntax.
export function ungatedShorthand() {
  const commissionBreakdown = toCustomerListCommission(escrow);
  return { ...journey, commissionBreakdown };
}

// REFUSED — inside a `.map()` callback, which is where two of the three
// real surfaces live. The finding must name the enclosing NAMED function
// so the allowlist key does not move when a line above it moves.
export function ungatedInsideMap() {
  return rows.map((j) => ({
    ...j,
    commissionBreakdown: toCustomerSafeCommission({
      bidPrice: j.price,
      customerTier: j.tier,
      customerSavings: j.savings,
      feeWaiverApplied: false,
    }),
  }));
}

/* ------------------------------------------------- direction 2: it PASSES -- */

// ACCEPTED — the DRIVER ladder, ungated on purpose. His build has always
// rendered it, and the gate narrows by CLIENT, not by viewer. If S4 ever
// asks for a gate here it has misread the audience.
export function driverLadderNeverGated() {
  return {
    ...journey,
    commissionBreakdown: toFullCommissionBreakdown({
      bidPrice: bid.price,
      commission,
      waiver: null,
    }),
  };
}

// ACCEPTED — the journey read's shape: gated in the spread itself.
export function gatedInSpread(options: { customerSavingsPreview?: boolean } = {}) {
  return {
    ...journey,
    ...(options.customerSavingsPreview
      ? { commissionBreakdown: projectCustomerSafeCommission(fullBreakdown) }
      : {}),
  };
}

// ACCEPTED — the rides list's shape: gated at the variable, attached by
// shorthand two lines later.
export function gatedAtTheVariable(options: { customerSavingsPreview?: boolean } = {}) {
  const commissionBreakdown = options.customerSavingsPreview
    ? toCustomerListCommission(escrow)
    : null;
  return { ...journey, ...(commissionBreakdown ? { commissionBreakdown } : {}) };
}

// ACCEPTED — the bid list's shape: gated inside the callback.
export function gatedInsideMap(options: { customerSavingsPreview?: boolean } = {}) {
  return rows.map((b) => ({
    ...b,
    ...(options.customerSavingsPreview
      ? {
          commissionBreakdown: toCustomerSafeCommission({
            bidPrice: b.price,
            customerTier: b.tier,
            customerSavings: b.savings,
            feeWaiverApplied: false,
          }),
        }
      : {}),
  }));
}

/* --------------------------------------------------------- the residual --- */

// THE STATED RESIDUAL. A SECOND attach, added later, inside a function
// that already mentions the option — this one is ungated and S4 clears
// it, because the check is lexical and function-scoped.
//
// What S4 catches is the realistic case and the one that actually
// happened: a NEW surface, in a NEW function, with nobody thinking about
// v13. A second attach inside an already-gated function is a diff a
// reviewer is looking straight at. This fixture exists so that the
// residual is a tested, written-down property rather than something
// discovered later and called a bug.
export function secondAttachInAGatedFunction(options: { customerSavingsPreview?: boolean } = {}) {
  const first = options.customerSavingsPreview
    ? { commissionBreakdown: toCustomerListCommission(escrow) }
    : {};
  const second = { commissionBreakdown: toCustomerSafeCommission(escrow) };
  return { ...journey, ...first, ...second };
}
