// SERVICES/CUSTOMER-MODES/TYPES.TS
//
// Shared types for Dispatch K3 — customer modes + suggest-up.
// Kept framework-free so they can be imported by the evaluator,
// suggest-up service, scheduler, routes, and tests without dragging
// in Prisma or Express.

export type RequestMode = 'WAIT_AND_COMPARE' | 'NEED_TO_GO';

export interface RequestModePayload {
  requestMode: RequestMode;
  // Required when NEED_TO_GO. Rejected when WAIT_AND_COMPARE so the
  // ceiling can never silently apply to a comparison-shopping journey.
  priceCeilingMultiplier?: number;
}

export interface SuggestUpStatus {
  // [] before T1 fires or after the cascade window closes; [50] in
  // the T1..T2 band; [50, 100] from T2 onward (until cascade ends).
  availableAmounts: number[];
  alreadyTakenCount: number;
  // Wall-clock instant of the next tier reveal, or null when no more
  // reveals are pending.
  nextAmountAvailableAt: Date | null;
}

export type AutoAcceptReason =
  | 'auto-accepted'
  | 'mode-not-need-to-go'
  | 'price-exceeds-ceiling'
  | 'window-expired'
  | 'journey-not-open'
  | 'race-lost'
  | 'no-ceiling-set'
  | 'bid-missing';

export interface AutoAcceptResult {
  triggered: boolean;
  bidId: string | null;
  reason: AutoAcceptReason;
}

export interface SuggestUpInput {
  // Must match a value in SUGGEST_UP_VALID_AMOUNTS. The route layer
  // 400s if not.
  addRwf: number;
}

// Reasons returned by the pure suggest-up validator. The route layer
// translates these to HTTP status codes.
export type SuggestUpInvalidReason =
  | 'too-early'
  | 'amount-not-yet-available'
  | 'invalid-amount'
  | 'not-owner'
  | 'journey-not-open';

export interface SuggestUpValidation {
  valid: boolean;
  reason: SuggestUpInvalidReason | 'ok';
}
