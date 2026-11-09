import { JourneyStatus, JourneyAction } from '../types/journey.js';

const transitions: Record<JourneyStatus, Partial<Record<JourneyAction, JourneyStatus>>> = {
  [JourneyStatus.SCHEDULED]: {
    [JourneyAction.OPEN_BID_WINDOW]: JourneyStatus.REQUESTED,
    [JourneyAction.CANCEL]: JourneyStatus.CANCELLED,
    [JourneyAction.EXPIRE]: JourneyStatus.EXPIRED,
  },
  [JourneyStatus.REQUESTED]: {
    [JourneyAction.ACCEPT_BID]: JourneyStatus.MATCHED,
    [JourneyAction.CANCEL]: JourneyStatus.CANCELLED,
    [JourneyAction.EXPIRE]: JourneyStatus.EXPIRED,
  },
  [JourneyStatus.MATCHED]: {
    [JourneyAction.START_JOURNEY]: JourneyStatus.IN_PROGRESS,
    [JourneyAction.CANCEL]: JourneyStatus.CANCELLED,
    [JourneyAction.EXPIRE]: JourneyStatus.EXPIRED,
    // R3-STALE-NO-SHOW-WIRING-FIX — admin resolves a stale-driver-no-show
    // (driver won the bid but never started) in the customer's favour:
    // the still-MATCHED journey is cancelled. Same JourneyAction.ADMIN_REFUND
    // as the DISPUTED→CANCELLED case (PR #84); second valid source state.
    [JourneyAction.ADMIN_REFUND]: JourneyStatus.CANCELLED,
  },
  [JourneyStatus.IN_PROGRESS]: {
    [JourneyAction.END_JOURNEY]: JourneyStatus.AWAITING_CONFIRMATION,
    [JourneyAction.INTERRUPT]: JourneyStatus.INTERRUPTED,
    [JourneyAction.LATE_END_JOURNEY]: JourneyStatus.AWAITING_CONFIRMATION,
    // CUSTOMER_COMPLETE has NO CALLER as of founder decision D10
    // (EXPORT-AND-LEDGER G3): the endpoint and the service function that
    // drove this transition are deleted. The action and both of its rows
    // are left standing rather than removed — a JourneyAction member is
    // shared vocabulary, and D10 ruled on the endpoint, not on the state
    // machine's alphabet. Read this row as inert, not as a second way to
    // end a ride: the ways are the driver declaring plus the customer
    // confirming (or the auto-confirm), and interrupt/reconciliation for
    // the stuck case.
    [JourneyAction.CUSTOMER_COMPLETE]: JourneyStatus.AWAITING_CONFIRMATION,
  },
  [JourneyStatus.AWAITING_CONFIRMATION]: {
    [JourneyAction.CONFIRM]: JourneyStatus.COMPLETED,
    [JourneyAction.DISPUTE]: JourneyStatus.DISPUTED,
    [JourneyAction.AUTO_CONFIRM]: JourneyStatus.COMPLETED,
  },
  [JourneyStatus.COMPLETED]: {},
  [JourneyStatus.CANCELLED]: {},
  [JourneyStatus.INTERRUPTED]: {
    [JourneyAction.LATE_END_JOURNEY]: JourneyStatus.AWAITING_CONFIRMATION,
    // Callerless since D10 — see the IN_PROGRESS row above.
    [JourneyAction.CUSTOMER_COMPLETE]: JourneyStatus.AWAITING_CONFIRMATION,
    [JourneyAction.RECONCILE_BOTH_ARRIVED]: JourneyStatus.COMPLETED,
    [JourneyAction.RECONCILE_CONFLICT]: JourneyStatus.DISPUTED,
    [JourneyAction.EXPIRE]: JourneyStatus.EXPIRED,
  },
  // R3-RECONCILIATION-WIRING-FIX — DISPUTED is no longer terminal: an admin
  // resolving a JOURNEY_RECONCILIATION conflict drives it to a settled state.
  [JourneyStatus.DISPUTED]: {
    [JourneyAction.ADMIN_REFUND]: JourneyStatus.CANCELLED,
    [JourneyAction.ADMIN_PAY]: JourneyStatus.COMPLETED,
  },
  [JourneyStatus.EXPIRED]: {},
};

export function transitionJourney(
  current: JourneyStatus,
  action: JourneyAction,
): JourneyStatus {
  const next = transitions[current]?.[action];
  if (!next) throw new Error(`Invalid journey transition: ${current} + ${action}`);
  return next;
}
