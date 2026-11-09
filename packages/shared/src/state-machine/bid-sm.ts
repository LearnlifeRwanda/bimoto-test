import { BidStatus, BidAction } from '../types/bid.js';

const transitions: Record<BidStatus, Partial<Record<BidAction, BidStatus>>> = {
  [BidStatus.PENDING]: {
    [BidAction.ACCEPT]: BidStatus.ACCEPTED,
    [BidAction.DECLINE]: BidStatus.DECLINED,
    [BidAction.WITHDRAW]: BidStatus.WITHDRAWN,
    [BidAction.EXPIRE]: BidStatus.EXPIRED,
  },
  // DOC-GUARD G4 — ACCEPTED and DECLINED are no longer dead ends.
  //
  // When a machine releases a failed match (the webhook, or the
  // unpaid-match reaper), the journey goes back on the market. The
  // losing bids were already being reopened by raw writes in
  // escrow.service.ts; the WINNING bid was not, so the customer came
  // back to a bid list showing a live Accept button on a bid that was
  // still ACCEPTED — and pressing it answered 400 BID_NOT_PENDING. The
  // button lied.
  //
  // Since SETTLE-UP (#155) a reopened bid can simply be accepted again:
  // the adopt branch revives the surviving escrow rather than creating
  // a second one. So the honest state for that bid is PENDING, and the
  // machine now says so instead of being bypassed.
  [BidStatus.ACCEPTED]: {
    [BidAction.REOPEN]: BidStatus.PENDING,
  },
  [BidStatus.DECLINED]: {
    [BidAction.REOPEN]: BidStatus.PENDING,
  },
  // Deliberately still terminal. A driver who withdrew, and a bid the
  // clock expired, are not brought back by someone else's payment
  // failing.
  [BidStatus.WITHDRAWN]: {},
  [BidStatus.EXPIRED]: {},
};

export function transitionBid(current: BidStatus, action: BidAction): BidStatus {
  const next = transitions[current]?.[action];
  if (!next) throw new Error(`Invalid bid transition: ${current} + ${action}`);
  return next;
}

/**
 * The statuses a machine-release reopens. Exported so the release path
 * can build its `where` clause from the state machine instead of
 * hard-coding a list beside it — the bug this fixes was exactly a
 * hard-coded list that had drifted from the truth.
 */
export const REOPENABLE_BID_STATUSES: BidStatus[] = Object.values(BidStatus).filter(
  (status) => transitions[status]?.[BidAction.REOPEN] !== undefined,
);

/**
 * The status a REOPEN produces, asked of the machine rather than
 * assumed. `updateMany` writes one value across every matched row, so
 * this also asserts that every reopenable status agrees on the target;
 * if someone later adds a REOPEN edge that lands somewhere else, this
 * throws instead of silently mass-writing the wrong status.
 */
export function reopenedBidStatus(): BidStatus {
  const targets = new Set(
    REOPENABLE_BID_STATUSES.map((status) => transitionBid(status, BidAction.REOPEN)),
  );
  if (targets.size !== 1) {
    throw new Error(
      `REOPEN must produce exactly one status for a bulk reopen, got: ${[...targets].join(', ')}`,
    );
  }
  return [...targets][0];
}
