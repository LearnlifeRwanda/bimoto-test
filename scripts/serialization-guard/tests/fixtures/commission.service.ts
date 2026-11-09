// FIXTURE — rule S3, both directions.
//
// Parsed as text by the self-test; never imported, never built.

import { toCustomerSafeCommission, toFullCommissionBreakdown } from './commission-view';

declare const bid: any;
declare const commission: any;
declare const waiverRes: any;

// REFUSED — the accept path's original shape: the full ladder written
// inline and handed on. `driverPayout` and the two total* fields (either
// of which reconstructs it) are exactly what U-4 shipped to a passenger.
export function handRolledInline() {
  return {
    matched: true,
    commissionBreakdown: {
      bidPrice: bid.price,
      driverTier: commission.driverTier.tier,
      driverCommissionRate: commission.driverCommissionRate,
      totalCommissionRate: commission.totalCommissionRate,
      totalCommissionAmount: commission.totalCommissionAmount,
      driverPayout: waiverRes.effectiveDriverPayout,
      customerSavings: commission.customerSavings,
      driverSavings: commission.driverSavings,
      feeWaiverApplied: waiverRes.waiverId !== null,
    },
  };
}

// REFUSED — the same literal given a name first. One more line, same
// hand-rolled projection.
export function handRolledAsLocal() {
  const commissionBreakdown = {
    bidPrice: bid.price,
    customerTier: commission.customerTier.tier,
    customerSavings: commission.customerSavings,
    feeWaiverApplied: false,
  };
  return { commissionBreakdown };
}

// ACCEPTED — produced by the customer projector.
export function projectedForCustomer() {
  return {
    commissionBreakdown: toCustomerSafeCommission({
      bidPrice: bid.price,
      customerTier: commission.customerTier.tier,
      customerSavings: commission.customerSavings,
      feeWaiverApplied: waiverRes.waiverId !== null,
    }),
  };
}

// ACCEPTED — produced by the driver projector. The rule is about WHO
// decided the shape, not about which audience: a driver may see the full
// ladder, and it is still built in one place.
export function projectedForDriver() {
  return {
    commissionBreakdown: toFullCommissionBreakdown({
      bidPrice: bid.price,
      commission,
      waiver: waiverRes,
    }),
  };
}
