// Stale driver no-show: a driver had a bid ACCEPTED but the journey
// never started within STALE_DRIVER_NO_SHOW_THRESHOLD_MIN minutes of the
// acceptance. Indicates the driver took the slot and ghosted.
//
// Decisions: NO_ACTION (false alarm), FORCE_COMPLETE (no-op marker for
// follow-up FREEZE_USER), or RESOLVED_REFUND if the journey escrowed.

import type {
  AdminAction,
  ConflictDecision,
  PrismaClient,
} from '@prisma/client';
import { JourneyAction, JourneyStatus, transitionJourney } from '@bimoto/shared';
import {
  appendAdminActionTx,
  assertConflictUndecidedTx,
} from '../../admin-action-audit.service';
import { appendAuditEntryTx } from '../../../escrow-audit.service';
import { refundEscrowTx } from '../../../escrow.service';
import { refundMomo } from '../../../payment/refund';
import { STALE_DRIVER_NO_SHOW_THRESHOLD_MIN } from '../../config';
import type {
  ConflictDecisionArgs,
  ConflictDetail,
  ConflictListItem,
  ConflictModule,
} from '../types';

const VALID_DECISIONS: ReadonlyArray<ConflictDecision> = [
  'NO_ACTION',
  'FORCE_COMPLETE',
  'RESOLVED_REFUND',
];

async function listOpen(
  prisma: PrismaClient,
  opts: { limit: number },
): Promise<ConflictListItem[]> {
  const cutoff = new Date(
    Date.now() - STALE_DRIVER_NO_SHOW_THRESHOLD_MIN * 60 * 1000,
  );
  const accepted = await prisma.bid.findMany({
    where: {
      status: 'ACCEPTED',
      updatedAt: { lt: cutoff },
      journey: { startedAt: null, status: { in: ['MATCHED'] } },
    },
    include: {
      journey: { select: { id: true, startedAt: true, pickupName: true, destinationName: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: opts.limit,
  });
  const decided = await prisma.adminAction.findMany({
    where: {
      action: 'RESOLVE_STALE_DRIVER_NO_SHOW',
      targetType: 'BID',
      targetId: { in: accepted.map((b: any) => b.id) },
    },
    select: { targetId: true },
  });
  const decidedIds = new Set<string>(decided.map((d: any) => d.targetId));
  return accepted
    .filter((b: any) => !decidedIds.has(b.id))
    .map((b: any) => ({
      id: b.id,
      type: 'STALE_DRIVER_NO_SHOW' as const,
      summary: `Driver ${b.driverId.slice(0, 8)} accepted ${b.journey?.pickupName ?? '?'} but never started`,
      createdAt: b.updatedAt,
      metadata: { driverId: b.driverId, journeyId: b.journeyId, price: b.price },
    }));
}

async function countOpen(prisma: PrismaClient): Promise<number> {
  return (await listOpen(prisma, { limit: 1000 })).length;
}

async function getDetail(
  prisma: PrismaClient,
  id: string,
): Promise<ConflictDetail | null> {
  const bid = await prisma.bid.findUnique({
    where: { id },
    include: {
      journey: { include: { escrow: true } },
      driver: { select: { id: true, nickname: true, phoneEncrypted: true } },
    },
  });
  if (!bid) return null;
  return {
    id: bid.id,
    type: 'STALE_DRIVER_NO_SHOW',
    summary: `Stale driver acceptance for ${bid.journey?.pickupName ?? '?'}`,
    createdAt: bid.updatedAt,
    data: { bid, journey: bid.journey, escrow: bid.journey?.escrow },
  };
}

async function decide(
  args: ConflictDecisionArgs,
  prisma: PrismaClient,
): Promise<AdminAction> {
  if (!VALID_DECISIONS.includes(args.decision)) {
    const err: any = new Error('INVALID_DECISION');
    err.code = 'INVALID_DECISION';
    throw err;
  }

  // R3-FLW-STALE-NO-SHOW-REFUND-INTEGRATION — move the customer's money via
  // the Flutterwave gateway BEFORE opening the Prisma transaction (external
  // I/O must not hold a DB connection). Mirrors PR #88's journey-reconciliation
  // pattern, adapted to the bid→journey→escrow load. Gated on the SAME runtime
  // conditions as the in-tx settlement below (journey MATCHED + escrow HELD) so
  // we never fire a real refund for a decision the transaction will skip. If
  // the gateway throws, we never enter the transaction: no state change, no
  // audit, no AdminAction; the admin retries (Flutterwave dedupes refunds by
  // source tx id, so retries are safe). Skip the gateway when no real money
  // moved: E2E_FAKE_PAYMENTS=1, null flwTxId, or a synthetic 'e2e-' flwTxId.
  let flwRefundTxId: string | undefined;
  if (args.decision === 'RESOLVED_REFUND') {
    const pre = await prisma.bid.findUnique({
      where: { id: args.id },
      include: { journey: { include: { escrow: true } } },
    });
    if (!pre) {
      const err: any = new Error('BID_NOT_FOUND');
      err.code = 'BID_NOT_FOUND';
      throw err;
    }
    const preEscrow = pre.journey?.escrow ?? null;
    if (
      preEscrow &&
      preEscrow.status === 'HELD' &&
      pre.journey?.status === JourneyStatus.MATCHED &&
      preEscrow.flwTxId &&
      !String(preEscrow.flwTxId).startsWith('e2e-') &&
      process.env.E2E_FAKE_PAYMENTS !== '1'
    ) {
      const refundResult = await refundMomo({
        flwTxId: preEscrow.flwTxId,
        amount: preEscrow.amount,
        escrowId: preEscrow.id,
        reason: args.reason,
      });
      flwRefundTxId = refundResult.flwRefundTxId ?? undefined;
    }
  }

  return prisma.$transaction(async (tx: any) => {
    // BID-ATOMICITY G4 — single-winner: claim the decision before any
    // side-effect. A racing second admin serializes on the advisory
    // lock, sees the winner's AdminAction, and gets ALREADY_DECIDED
    // (409) with the whole transaction rolled back.
    await assertConflictUndecidedTx(tx, {
      action: 'RESOLVE_STALE_DRIVER_NO_SHOW',
      targetType: 'BID',
      targetId: args.id,
      conflictType: 'STALE_DRIVER_NO_SHOW',
    });

    const bid = await tx.bid.findUnique({
      where: { id: args.id },
      include: { journey: { include: { escrow: true } } },
    });
    if (!bid) {
      const err: any = new Error('BID_NOT_FOUND');
      err.code = 'BID_NOT_FOUND';
      throw err;
    }
    const journey = bid.journey ?? null;
    const escrow = journey?.escrow ?? null;

    let crossLinkedEscrowAuditLogId: string | undefined;

    // R3-STALE-NO-SHOW-WIRING-FIX — apply the settlement. The bid was
    // ACCEPTED → escrow was charged to HELD; the driver then ghosted (never
    // called START_JOURNEY, so the journey is still MATCHED). RESOLVED_REFUND
    // unwinds: escrow HELD → REFUNDED, journey MATCHED → CANCELLED.
    //
    // Guarded on the runtime-actual states because the decide route does NOT
    // re-check the listOpen predicate: if a race moved the journey out of
    // MATCHED (it started → the driver did NOT actually no-show) or the escrow
    // out of HELD (already settled by another path), we skip the settlement
    // and only record the AdminAction. transitionJourney/transitionEscrow would
    // otherwise throw on the now-invalid transition.
    if (
      args.decision === 'RESOLVED_REFUND' &&
      escrow &&
      escrow.status === 'HELD' &&
      journey &&
      journey.status === JourneyStatus.MATCHED
    ) {
      await appendAuditEntryTx(
        tx,
        escrow.id,
        'ADMIN_STALE_DRIVER_NO_SHOW_REFUND',
        escrow.amount,
        args.adminId,
        { reason: args.reason, journeyId: journey.id, bidId: bid.id },
      );
      const lastLog = await tx.escrowAuditLog.findFirst({
        where: { escrowId: escrow.id },
        orderBy: { sequenceNumber: 'desc' },
        select: { id: true },
      });
      crossLinkedEscrowAuditLogId = lastLog?.id;

      // The Flutterwave refund (if any) already fired before this transaction;
      // flwRefundTxId is recorded in the REFUNDED audit entry's metadata.
      await refundEscrowTx(tx, escrow, args.adminId, flwRefundTxId);

      const nextJourneyStatus = transitionJourney(
        journey.status as JourneyStatus,
        JourneyAction.ADMIN_REFUND,
      );
      await tx.journey.update({
        where: { id: journey.id },
        data: { status: nextJourneyStatus },
      });
    }
    // FORCE_COMPLETE and NO_ACTION: AdminAction only (unchanged).

    return appendAdminActionTx(tx, {
      adminId: args.adminId,
      action: 'RESOLVE_STALE_DRIVER_NO_SHOW',
      targetType: 'BID',
      targetId: args.id,
      reason: args.reason,
      payload: { driverId: bid.driverId, journeyId: bid.journeyId },
      conflictType: 'STALE_DRIVER_NO_SHOW',
      conflictDecision: args.decision,
      crossLinkedEscrowAuditLogId,
    });
  });
}

export const staleDriverNoShowModule: ConflictModule = {
  type: 'STALE_DRIVER_NO_SHOW',
  validDecisions: VALID_DECISIONS,
  listOpen,
  countOpen,
  getDetail,
  decide,
};
