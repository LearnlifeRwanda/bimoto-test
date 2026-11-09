import prisma from '../prisma';
import { AppError } from '../middleware/error-handler';
import {
  EscrowStatus,
  EscrowAction,
  transitionEscrow,
  REOPENABLE_BID_STATUSES,
  reopenedBidStatus,
} from '@bimoto/shared';
import { appendAuditEntryTx } from './escrow-audit.service';
import { creditDriverBalance } from './payout.service';

function buildTxRef(journeyId: string): string {
  return `bimoto-${journeyId.slice(0, 8)}-${Date.now()}`;
}

// BID-ATOMICITY G1 — tx-accepting variant in the releaseEscrowTx style,
// so bid acceptance can create the escrow inside the same transaction
// that claims the bid and the journey: a losing accept rolls back with
// no escrow row, and the escrow can only ever belong to the accept that
// committed. The Escrow_journeyId_key unique stays the last-resort
// backstop underneath.
export async function createEscrowTx(
  tx: any,
  journeyId: string,
  customerId: string,
  driverId: string,
  amount: number,
  commission: {
    // LAUNCH-TRUTH G3 — the CHARGED amount (0 under an active fee
    // waiver, the nominal tier amount otherwise). The rates below stay
    // nominal in either case: they describe the ladder, not the charge.
    totalCommissionAmount: number;
    driverPayout: number;
    driverTier: { tier: string; commissionRate: number };
    customerTier: { tier: string; commissionRate: number };
    // Present only when a waiver zeroed the charge: the nominal amount
    // forgiven, and the audited grant that authorized it.
    waivedCommissionAmount?: number;
    feeWaiverId?: string | null;
  },
) {
  const txRef = buildTxRef(journeyId);
  const waiverApplied = commission.feeWaiverId != null;
  const created = await tx.escrow.create({
    data: {
      journeyId,
      customerId,
      driverId,
      amount,
      commission: commission.totalCommissionAmount,
      driverPayout: commission.driverPayout,
      status: EscrowStatus.PENDING,
      driverTier: commission.driverTier.tier,
      customerTier: commission.customerTier.tier,
      driverCommissionRate: commission.driverTier.commissionRate,
      customerCommissionRate: commission.customerTier.commissionRate,
      waivedCommissionAmount: waiverApplied
        ? commission.waivedCommissionAmount ?? 0
        : null,
      feeWaiverId: waiverApplied ? commission.feeWaiverId : null,
      txRef,
      lastChargeAttemptAt: new Date(),
    },
  });

  await appendAuditEntryTx(tx, created.id, 'CREATED_PENDING', amount, customerId, { txRef });

  return created;
}

export async function createEscrow(
  journeyId: string,
  customerId: string,
  driverId: string,
  amount: number,
  commission: Parameters<typeof createEscrowTx>[5],
) {
  return prisma.$transaction((tx: any) =>
    createEscrowTx(tx, journeyId, customerId, driverId, amount, commission),
  );
}

// SETTLE-UP G2 — the other half of createEscrowTx: adoption.
//
// PAY-TRUTH G2 closed the interactive dead end and reported the
// non-interactive one honestly (the NOTE on releaseMatchTx below). When a
// MACHINE releases a failed journey — the webhook minutes later, the
// reconciler's timeout sweep, the unpaid-match reaper — the journey goes
// back to REQUESTED but its FAILED escrow keeps owning journeyId. The
// customer who walks away and comes back to accept a fresh bid used to
// get a 500: Escrow.journeyId is @unique and createEscrowTx is a plain
// create, so the second accept died on P2002 inside the claim
// transaction.
//
// The surviving row was never in the way. Escrow.journeyId being @unique
// is the statement that a journey has EXACTLY ONE escrow for its whole
// life, so the row the second accept needs is the row that is already
// there. Adoption is therefore not a workaround for the constraint — it
// is the only accept the constraint permits:
//
//   * the revival goes through the state machine, not a raw status
//     write. FAILED is the only status with a RETRY_CHARGE edge, so a
//     HELD / RELEASED / REFUNDED / FROZEN escrow — money in flight or
//     already settled — can never be adopted by a new accept;
//   * the row ends up carrying the NEW bid's truth, not the dead one's.
//     Journey.agreedPrice is being set to the new price in this same
//     transaction; an escrow left on the old amount would make payout,
//     commission, receipts, the BNR aggregation and the reconciler's
//     ledger diff read two different numbers for one ride;
//   * nothing is erased. What the old attempt said is appended to the
//     audit chain as ADOPTED_ON_REACCEPT with the superseded amount,
//     driver and txRef, so the supersession is legible to an auditor at
//     the place an auditor already reads.
type AdoptableEscrow = {
  id: string;
  journeyId: string;
  status: string;
  amount: number;
  driverId: string;
  txRef: string | null;
};

export async function adoptEscrowTx(
  tx: any,
  existing: AdoptableEscrow,
  customerId: string,
  driverId: string,
  amount: number,
  commission: Parameters<typeof createEscrowTx>[5],
) {
  // Refused rather than transitioned: transitionEscrow would throw a raw
  // Error here (a 500), and "this journey's money is already in flight"
  // is a 409 the caller can name.
  if (existing.status !== EscrowStatus.FAILED) {
    throw new AppError(409, 'ESCROW_NOT_ADOPTABLE', 'errors.escrowNotAdoptable');
  }
  const next = transitionEscrow(existing.status as EscrowStatus, EscrowAction.RETRY_CHARGE);

  const txRef = buildTxRef(existing.journeyId);
  const waiverApplied = commission.feeWaiverId != null;

  // Predicated exactly like the journey and bid claims that precede it in
  // acceptBidCore's transaction: the adopt only lands if the row is STILL
  // the FAILED one that was read. A racing accept that got there first
  // leaves count 0, and this caller loses with the same 400 a losing bid
  // claim throws — no second escrow row can exist either way.
  const claimed = await tx.escrow.updateMany({
    where: { id: existing.id, status: EscrowStatus.FAILED },
    data: {
      status: next,
      driverId,
      amount,
      commission: commission.totalCommissionAmount,
      driverPayout: commission.driverPayout,
      driverTier: commission.driverTier.tier,
      customerTier: commission.customerTier.tier,
      driverCommissionRate: commission.driverTier.commissionRate,
      customerCommissionRate: commission.customerTier.commissionRate,
      waivedCommissionAmount: waiverApplied
        ? commission.waivedCommissionAmount ?? 0
        : null,
      feeWaiverId: waiverApplied ? commission.feeWaiverId : null,
      txRef,
      lastChargeAttemptAt: new Date(),
    },
  });
  if (claimed.count === 0) {
    throw new AppError(400, 'BID_NOT_PENDING', 'errors.bidNotPending');
  }

  await appendAuditEntryTx(tx, existing.id, 'ADOPTED_ON_REACCEPT', amount, customerId, {
    txRef,
    supersededTxRef: existing.txRef,
    supersededAmount: existing.amount,
    supersededDriverId: existing.driverId,
  });

  return tx.escrow.findUnique({ where: { id: existing.id } });
}

export async function markEscrowChargeSucceeded(
  escrowId: string,
  flwTxId: string,
): Promise<void> {
  const escrow = await prisma.escrow.findUnique({ where: { id: escrowId } });
  if (!escrow) {
    throw new AppError(404, 'ESCROW_NOT_FOUND', 'errors.escrowNotFound');
  }
  if (escrow.status !== EscrowStatus.PENDING) {
    // Idempotent — webhook + reconciler can both fire; first one wins.
    return;
  }

  const next = transitionEscrow(escrow.status as EscrowStatus, EscrowAction.CONFIRM_CHARGE);

  // ESCROW-CREDIT G2 — the read above is outside the transaction, so the
  // PENDING claim is re-asserted as an update predicate: a webhook and the
  // reconciler racing both pass the check, but only one update matches.
  // The loser skips the audit write, same as the sequential no-op above.
  await prisma.$transaction(async (tx: any) => {
    const claimed = await tx.escrow.updateMany({
      where: { id: escrowId, status: EscrowStatus.PENDING },
      data: { status: next, flwTxId },
    });
    if (claimed.count === 0) return;
    await appendAuditEntryTx(tx, escrow.id, 'CHARGE_CONFIRMED', escrow.amount, escrow.customerId, {
      flwTxId,
    });
  });
}

// PAY-TRUTH G2 — what a failed charge does to the MATCH.
//
// Before this dispatch there was one answer, applied to every caller:
// revert the journey to REQUESTED and let go of the driver. The comment
// said "so the customer can retry". The customer could not.
// docs/payment-failure-matrix.md R1 shows why: Escrow.journeyId is
// @unique and createEscrowTx is a plain create, so a REQUESTED journey
// that still owns a FAILED escrow answers 500 (P2002) to the next
// accept-bid. The revert did not enable a retry — it destroyed the only
// state a retry could have worked from.
//
//   'keep-match'    — the customer is AT the screen (the accept-bid
//                     charge, or a /initiate | /initiate-card retry).
//                     Keep the journey MATCHED and the bid ACCEPTED; the
//                     escrow row stays, FAILED, and is revived in place
//                     by RETRY_CHARGE. The motari who agreed to carry
//                     them is still theirs.
//   'release-match' — nobody is at the screen (a webhook minutes later,
//                     the reconciler's timeout sweep, the unpaid-match
//                     reaper). Free the driver. This is the pre-existing
//                     behaviour, unchanged, and it stays the DEFAULT so
//                     no caller inherits the new one by accident.
export type ChargeFailureDisposition = 'keep-match' | 'release-match';

// The pre-existing revert, extracted verbatim so the two dispositions
// share exactly one implementation. NOTE (reported, not fixed here): a
// journey released this way keeps its FAILED escrow, so a later accept
// still hits the journeyId unique. Making a released journey acceptable
// again means teaching acceptBidCore about an existing escrow row, which
// is #143's single-winner transaction — out of bounds for this dispatch.
async function releaseMatchTx(tx: any, journeyId: string): Promise<void> {
  await tx.journey.update({
    where: { id: journeyId },
    data: {
      status: 'REQUESTED',
      driverId: null,
      agreedPrice: null,
      commissionAmount: null,
    },
  });

  // Re-open the bids this match closed — the losers AND the winner.
  //
  // DOC-GUARD G4: this used to be `status: 'DECLINED'`, which left the
  // winning bid ACCEPTED on a journey that no longer had a driver. The
  // customer came back to a bid list with a live Accept button on it,
  // and pressing it answered 400 BID_NOT_PENDING. Both the source
  // states and the target now come from the state machine.
  await tx.bid.updateMany({
    where: { journeyId, status: { in: REOPENABLE_BID_STATUSES } },
    data: { status: reopenedBidStatus() },
  });
}

export async function markEscrowChargeFailed(
  escrowId: string,
  reason: string,
  extraMetadata?: Record<string, unknown>,
  disposition: ChargeFailureDisposition = 'release-match',
): Promise<void> {
  const escrow = await prisma.escrow.findUnique({ where: { id: escrowId } });
  if (!escrow) {
    throw new AppError(404, 'ESCROW_NOT_FOUND', 'errors.escrowNotFound');
  }
  if (escrow.status !== EscrowStatus.PENDING) {
    return;
  }

  const next = transitionEscrow(escrow.status as EscrowStatus, EscrowAction.FAIL_CHARGE);

  // ESCROW-CREDIT G2 — same predicated claim as markEscrowChargeSucceeded:
  // only the caller whose update matches PENDING writes the audit entry and
  // reverts the journey; a racing loser (or a FAILED racing a SUCCEEDED)
  // no-ops instead of double-applying the revert.
  await prisma.$transaction(async (tx: any) => {
    const claimed = await tx.escrow.updateMany({
      where: { id: escrowId, status: EscrowStatus.PENDING },
      data: { status: next },
    });
    if (claimed.count === 0) return;
    // The disposition is stamped on the audit entry: an auditor reading
    // the chain later must be able to tell why a journey is still MATCHED
    // over a FAILED escrow without inferring it from a timestamp.
    await appendAuditEntryTx(tx, escrow.id, 'CHARGE_FAILED', escrow.amount, escrow.customerId, {
      reason,
      disposition,
      ...(extraMetadata ?? {}),
    });

    if (disposition === 'release-match') {
      await releaseMatchTx(tx, escrow.journeyId);
    }
  });
}

// PAY-TRUTH G2 — the bounded end of 'keep-match'.
//
// Keeping the match is only honest while the customer is still there. A
// customer who closes the app after a decline would otherwise leave the
// motari holding a MATCHED journey that will never be paid, and a motari
// riding to a pickup for a fare that does not exist is the worst outcome
// in this whole dispatch. The reaper (jobs/unpaid-match-reaper.job.ts)
// applies the release the interactive path deliberately skipped, once the
// grace window has passed with no successful retry.
//
// Returns true when this call performed the release. Predicated on the
// escrow still being FAILED and the journey still MATCHED, so a customer
// who retried successfully in the meantime (escrow now PENDING or HELD)
// is never released out from under their own ride.
export async function releaseUnpaidMatch(
  escrowId: string,
  journeyId: string,
): Promise<boolean> {
  return prisma.$transaction(async (tx: any) => {
    const stillUnpaid = await tx.escrow.count({
      where: { id: escrowId, status: EscrowStatus.FAILED },
    });
    if (stillUnpaid === 0) return false;
    const claimed = await tx.journey.updateMany({
      where: { id: journeyId, status: 'MATCHED' },
      data: {
        status: 'REQUESTED',
        driverId: null,
        agreedPrice: null,
        commissionAmount: null,
      },
    });
    if (claimed.count === 0) return false;
    // DOC-GUARD G4 — same reopen as releaseMatchTx, and for the same
    // reason: the reaper's release must leave the winning bid PENDING
    // too, or the customer is shown an Accept button that 400s.
    await tx.bid.updateMany({
      where: { journeyId, status: { in: REOPENABLE_BID_STATUSES } },
      data: { status: reopenedBidStatus() },
    });
    return true;
  });
}

// R3-RECONCILIATION-WIRING-FIX — tx-accepting variant so an admin conflict
// resolution can release the escrow atomically alongside its EscrowAuditLog +
// AdminAction writes. Takes the already-loaded escrow row (the caller looked it
// up — releaseEscrow() up-front, decide() via its journey include) so it adds
// no extra read and keeps the existing callers' transaction shape unchanged.
type EscrowSettleRow = {
  id: string;
  journeyId: string;
  status: string;
  amount: number;
  driverId: string;
  driverPayout: number;
};

// ESCROW-CREDIT G1 — optional releaseMetadata is stashed on the RELEASED
// audit entry. Auto-confirm marks its entries with settledVia so they are
// distinguishable from the pre-G1 inline releases that never credited the
// driver (the remediation script keys off that absence).
//
// ESCROW-CREDIT G2 — the RELEASED transition is claimed atomically: the
// update is predicated on the status the caller loaded (the one it proved
// valid via transitionEscrow), and the affected-row count decides who won.
// Two callers racing on the same escrow both pass the stale-read checks,
// but only one update matches; the loser returns null and performs NO
// audit write, NO counter increments and NO balance credit — crediting is
// exclusively the winner's. Callers treat null as "already settled by
// someone else", which every current caller either ignores or coalesces.
export async function releaseEscrowTx(
  tx: any,
  escrow: EscrowSettleRow,
  triggeredBy: string,
  releaseMetadata?: Record<string, unknown>,
) {
  const nextStatus = transitionEscrow(escrow.status as EscrowStatus, EscrowAction.RELEASE);

  const claimed = await tx.escrow.updateMany({
    where: { journeyId: escrow.journeyId, status: escrow.status },
    data: {
      status: nextStatus,
      releasedAt: new Date(),
    },
  });
  if (claimed.count === 0) {
    return null;
  }

  await appendAuditEntryTx(tx, escrow.id, 'RELEASED', escrow.amount, triggeredBy, releaseMetadata);

  // Update driver's totalRides
  await tx.driverProfile.update({
    where: { userId: escrow.driverId },
    data: { totalRides: { increment: 1 } },
  });

  // completedShifts powers training-wheels logic in
  // services/payout/training-wheels.ts (new drivers < 3 shifts get
  // TWICE_DAILY default regardless of stored preference).
  await tx.user.update({
    where: { id: escrow.driverId },
    data: { completedShifts: { increment: 1 } },
  });

  // Credit driver's pending payout balance (drained by payout.job at 22:00).
  await creditDriverBalance(escrow.driverId, escrow.driverPayout, tx);

  return tx.escrow.findUnique({ where: { journeyId: escrow.journeyId } });
}

export async function releaseEscrow(journeyId: string, triggeredBy: string) {
  const escrow = await prisma.escrow.findUnique({ where: { journeyId } });
  if (!escrow) {
    throw new AppError(404, 'ESCROW_NOT_FOUND', 'errors.escrowNotFound');
  }
  return prisma.$transaction((tx: any) =>
    releaseEscrowTx(tx, escrow as unknown as EscrowSettleRow, triggeredBy),
  );
}

// R3-RECONCILIATION-WIRING-FIX — tx-accepting variant (see releaseEscrowTx).
// R3-FLW-REFUND-INTEGRATION — optional flwRefundTxId is stashed in the
// EscrowAuditLog entry's metadata when the caller actually moved money via
// Flutterwave, so the gateway refund tx is recoverable for reconciliation
// without a schema migration. Backward-compatible: existing 3-arg callers
// pass no metadata.
// ESCROW-CREDIT G2 — same single-winner claim as releaseEscrowTx: the
// update is predicated on the caller-loaded status; the racing loser
// returns null with no audit write.
export async function refundEscrowTx(
  tx: any,
  escrow: Pick<EscrowSettleRow, 'id' | 'journeyId' | 'status' | 'amount'>,
  triggeredBy: string,
  flwRefundTxId?: string,
) {
  const nextStatus = transitionEscrow(escrow.status as EscrowStatus, EscrowAction.REFUND);

  const claimed = await tx.escrow.updateMany({
    where: { journeyId: escrow.journeyId, status: escrow.status },
    data: { status: nextStatus },
  });
  if (claimed.count === 0) {
    return null;
  }

  await appendAuditEntryTx(
    tx,
    escrow.id,
    'REFUNDED',
    escrow.amount,
    triggeredBy,
    flwRefundTxId ? { flwRefundTxId } : undefined,
  );

  return tx.escrow.findUnique({ where: { journeyId: escrow.journeyId } });
}

export async function refundEscrow(journeyId: string, triggeredBy: string) {
  const escrow = await prisma.escrow.findUnique({ where: { journeyId } });
  if (!escrow) {
    throw new AppError(404, 'ESCROW_NOT_FOUND', 'errors.escrowNotFound');
  }
  return prisma.$transaction((tx: any) =>
    refundEscrowTx(tx, escrow as unknown as EscrowSettleRow, triggeredBy),
  );
}

// MAP-TRUTH G6 — handlePaymentFailure was DELETED here, not wired.
//
// It deleted the escrow row for a failed payment. PAY-TRUTH G1 (#153)
// found it had no callers anywhere in src, flagged it as a loaded gun in
// a drawer, and referred wire-or-delete to this dispatch. The decision
// is delete, for four reasons that all point the same way:
//
//   1. It violated the "no money row is ever deleted" invariant, and
//      took the row's audit chain with it by cascade. A payment failure
//      is a fact about the money, and the record of it is the thing an
//      auditor needs most.
//   2. It was fully superseded. markEscrowChargeFailed above is the live
//      path — called from webhook.routes, payment.routes, bid.service and
//      the reconciliation job — and it SUPERSEDES the row (PENDING →
//      FAILED) with an audit entry instead of erasing it.
//   3. Nothing was lost by removing it. Its only other effects, reverting
//      the journey to REQUESTED and re-opening declined bids, are exactly
//      what releaseMatchTx does, transactionally and predicated on a
//      claimed status so a race cannot double-apply the revert.
//   4. The only thing keeping it alive was a production-readiness test
//      that asserted escrow.delete HAD been called — a test of the
//      hazard, not a test protecting anything real. It went with it.
//
// The guard against it coming back is escrow-no-delete.test.ts, which
// fails if any production code deletes an escrow row again.

// R3-RECIPIENT-DISPUTE-ESCROW-FREEZE — tx-accepting variant (mirrors
// refundEscrowTx / releaseEscrowTx). Takes the already-loaded escrow row so a
// caller can freeze atomically alongside its own writes (e.g. the
// recipient-dispute SMS handler stamps the leg DISPUTED + freezes escrow in one
// transaction). Caller is responsible for only invoking it from a freezable
// state (HELD); transitionEscrow throws otherwise.
export async function freezeEscrowTx(
  tx: any,
  escrow: Pick<EscrowSettleRow, 'id' | 'journeyId' | 'status' | 'amount'>,
  triggeredBy: string,
) {
  const nextStatus = transitionEscrow(escrow.status as EscrowStatus, EscrowAction.FREEZE);
  const result = await tx.escrow.update({
    where: { journeyId: escrow.journeyId },
    data: { status: nextStatus },
  });
  await appendAuditEntryTx(tx, escrow.id, 'FROZEN', escrow.amount, triggeredBy);
  return result;
}

export async function freezeEscrow(journeyId: string, triggeredBy: string) {
  const escrow = await prisma.escrow.findUnique({
    where: { journeyId },
  });

  if (!escrow) {
    throw new AppError(404, 'ESCROW_NOT_FOUND', 'errors.escrowNotFound');
  }

  // If already frozen, just return
  if (escrow.status === EscrowStatus.FROZEN) {
    return escrow;
  }

  const nextStatus = transitionEscrow(escrow.status as EscrowStatus, EscrowAction.FREEZE);

  const updated = await prisma.$transaction(async (tx: any) => {
    const result = await tx.escrow.update({
      where: { journeyId },
      data: { status: nextStatus },
    });

    await appendAuditEntryTx(tx, escrow.id, 'FROZEN', escrow.amount, triggeredBy);

    return result;
  });

  return updated;
}
