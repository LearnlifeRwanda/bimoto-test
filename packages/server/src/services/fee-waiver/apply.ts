// LAUNCH-TRUTH G3 — the commission waiver resolver.
//
// Rule (panel invariant): commission is ALWAYS computed at the nominal
// tier rate by the unchanged calculateCommission — never skipped, never
// branched around. A waiver then zeroes the CHARGED amount and records
// what would have been charged. The same resolver runs at preview and
// at settlement, so the number the driver sees before bidding and the
// number credited at escrow release are produced by one rule.
//
// resolveWaiverCommission is the pure zeroing rule; applyWaiver joins
// it to getActiveWaiver (the single is-this-driver-waived predicate)
// for one-driver call sites. Batch call sites (the per-bid list) fetch
// waivers via getActiveWaiversForDrivers and reuse the same pure rule.

import { getActiveWaiver } from './index';

export interface NominalCommissionShape {
  totalCommissionAmount: number;
  driverPayout: number;
}

export interface WaiverResolution {
  /** Amount actually charged: 0 under a waiver, nominal otherwise. */
  charged: number;
  /** Nominal amount forgiven: nominal under a waiver, 0 otherwise. */
  waived: number;
  waiverId: string | null;
  /** What the driver keeps: the whole fare under a waiver. */
  effectiveDriverPayout: number;
}

/** Pure zeroing rule — nominal in, charged/waived/effective out. */
export function resolveWaiverCommission(
  waiver: { id: string } | null,
  commission: NominalCommissionShape,
): WaiverResolution {
  if (!waiver) {
    return {
      charged: commission.totalCommissionAmount,
      waived: 0,
      waiverId: null,
      effectiveDriverPayout: commission.driverPayout,
    };
  }
  return {
    charged: 0,
    waived: commission.totalCommissionAmount,
    waiverId: waiver.id,
    // driverPayout + totalCommissionAmount = the fare, by construction
    // in calculateCommission — the waived driver keeps all of it.
    effectiveDriverPayout: commission.driverPayout + commission.totalCommissionAmount,
  };
}

export async function applyWaiver(
  driverId: string,
  commission: NominalCommissionShape,
  at: Date = new Date(),
): Promise<WaiverResolution> {
  const waiver = await getActiveWaiver(driverId, at);
  return resolveWaiverCommission(waiver, commission);
}
