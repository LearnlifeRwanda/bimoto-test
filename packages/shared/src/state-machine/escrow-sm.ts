import { EscrowStatus, EscrowAction } from '../types/escrow.js';

const transitions: Record<EscrowStatus, Partial<Record<EscrowAction, EscrowStatus>>> = {
  [EscrowStatus.PENDING]: {
    [EscrowAction.CONFIRM_CHARGE]: EscrowStatus.HELD,
    [EscrowAction.FAIL_CHARGE]: EscrowStatus.FAILED,
  },
  [EscrowStatus.HELD]: {
    [EscrowAction.RELEASE]: EscrowStatus.RELEASED,
    [EscrowAction.REFUND]: EscrowStatus.REFUNDED,
    [EscrowAction.FREEZE]: EscrowStatus.FROZEN,
  },
  [EscrowStatus.FROZEN]: {
    [EscrowAction.RELEASE]: EscrowStatus.RELEASED,
    [EscrowAction.REFUND]: EscrowStatus.REFUNDED,
  },
  [EscrowStatus.RELEASED]: {},
  [EscrowStatus.REFUNDED]: {},
  // PAY-TRUTH G2 — FAILED is no longer terminal. A declined charge is a
  // customer standing in the road, not a closed book: RETRY_CHARGE brings
  // the SAME escrow row back to PENDING so it can be charged again with a
  // fresh txRef. Nothing is deleted and no second row is created — the
  // Escrow.journeyId unique means a journey has exactly one escrow for
  // its whole life, so reusing this one is the only recovery that exists.
  [EscrowStatus.FAILED]: {
    [EscrowAction.RETRY_CHARGE]: EscrowStatus.PENDING,
  },
};

export function transitionEscrow(current: EscrowStatus, action: EscrowAction): EscrowStatus {
  const next = transitions[current]?.[action];
  if (!next) throw new Error(`Invalid escrow transition: ${current} + ${action}`);
  return next;
}
