// Journey reconciliation conflicts: customer + driver disagreed on the
// outcome of a journey. F's reconciliation service writes one row per
// party; if both responded with anything other than ARRIVED_SAFELY, the
// pair is a CONFLICT and needs admin resolution.
//
// Open = the journey has reconciliation responses with a CONFLICT verdict
//        AND there is no AdminAction yet for this journey.
// Decide = write outcome via journey state machine + AdminAction; if a
//          refund / pay is issued, cross-write to EscrowAuditLog.

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
import { refundEscrowTx, releaseEscrowTx } from '../../../escrow.service';
import { refundMomo } from '../../../payment/refund';
import type {
  ConflictDecisionArgs,
  ConflictDetail,
  ConflictListItem,
  ConflictModule,
} from '../types';

const VALID_DECISIONS: ReadonlyArray<ConflictDecision> = [
  'RESOLVED_REFUND',
  'RESOLVED_PAY',
  'RESOLVED_SPLIT',
  'NO_ACTION',
];

async function listOpen(
  prisma: PrismaClient,
  opts: { limit: number },
): Promise<ConflictListItem[]> {
  const journeys = await prisma.journey.findMany({
    where: {
      reconciliationOpenedAt: { not: null },
      reconciliationResponses: { some: {} },
    },
    select: {
      id: true,
      reconciliationOpenedAt: true,
      pickupName: true,
      destinationName: true,
      reconciliationResponses: { select: { response: true, respondingUserId: true } },
    },
    orderBy: { reconciliationOpenedAt: 'desc' },
    take: opts.limit,
  });

  const decided = await prisma.adminAction.findMany({
    where: {
      action: 'RESOLVE_JOURNEY_RECONCILIATION',
      targetType: 'JOURNEY',
      targetId: { in: journeys.map((j: any) => j.id) },
    },
    select: { targetId: true },
  });
  const decidedIds = new Set<string>(decided.map((d: any) => d.targetId));

  return journeys
    .filter((j: any) => {
      if (decidedIds.has(j.id)) return false;
      const r = j.reconciliationResponses;
      if (r.length < 2) return false;
      const allArrived = r.every((x: any) => x.response === 'ARRIVED_SAFELY');
      return !allArrived;
    })
    .map((j: any) => ({
      id: j.id,
      type: 'JOURNEY_RECONCILIATION' as const,
      summary: `${j.pickupName} → ${j.destinationName}`,
      createdAt: j.reconciliationOpenedAt,
      metadata: { responses: j.reconciliationResponses },
    }));
}

async function countOpen(prisma: PrismaClient): Promise<number> {
  return (await listOpen(prisma, { limit: 1000 })).length;
}

async function getDetail(
  prisma: PrismaClient,
  id: string,
): Promise<ConflictDetail | null> {
  const journey = await prisma.journey.findUnique({
    where: { id },
    include: {
      reconciliationResponses: true,
      gpsPoints: { orderBy: { timestamp: 'asc' }, take: 200 },
      escrow: true,
    },
  });
  if (!journey) return null;
  return {
    id: journey.id,
    type: 'JOURNEY_RECONCILIATION',
    summary: `${journey.pickupName} → ${journey.destinationName}`,
    createdAt: journey.reconciliationOpenedAt ?? journey.createdAt,
    data: {
      journey,
      responses: journey.reconciliationResponses,
      gpsPoints: journey.gpsPoints,
      escrow: journey.escrow,
    },
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

  // R3-FLW-REFUND-INTEGRATION — for a real refund, move the money via the
  // Flutterwave gateway BEFORE opening the Prisma transaction, so the external
  // I/O doesn't hold a DB connection. If the gateway throws, we never enter the
  // transaction: no state change, no audit, no AdminAction — the admin retries
  // (Flutterwave dedupes refunds by source tx id, so retries are safe). The
  // resulting refund tx id is threaded into refundEscrowTx's audit metadata.
  let flwRefundTxId: string | undefined;
  if (args.decision === 'RESOLVED_REFUND') {
    const pre = await prisma.journey.findUnique({
      where: { id: args.id },
      include: { escrow: true },
    });
    if (!pre) {
      const err: any = new Error('JOURNEY_NOT_FOUND');
      err.code = 'JOURNEY_NOT_FOUND';
      throw err;
    }
    const escrow = pre.escrow;
    // Skip the gateway call when no real money moved:
    //   - escrow has no Flutterwave tx id (escrow never charged a real gateway)
    //   - the tx id is synthetic ('e2e-...') from the E2E_FAKE_PAYMENTS path
    //   - E2E_FAKE_PAYMENTS=1 (CI / dev fake-payments flag)
    if (
      escrow &&
      escrow.flwTxId &&
      !String(escrow.flwTxId).startsWith('e2e-') &&
      process.env.E2E_FAKE_PAYMENTS !== '1'
    ) {
      const refundResult = await refundMomo({
        flwTxId: escrow.flwTxId,
        amount: escrow.amount,
        escrowId: escrow.id,
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
      action: 'RESOLVE_JOURNEY_RECONCILIATION',
      targetType: 'JOURNEY',
      targetId: args.id,
      conflictType: 'JOURNEY_RECONCILIATION',
    });

    const journey = await tx.journey.findUnique({
      where: { id: args.id },
      include: { escrow: true },
    });
    if (!journey) {
      const err: any = new Error('JOURNEY_NOT_FOUND');
      err.code = 'JOURNEY_NOT_FOUND';
      throw err;
    }
    let crossLinkedEscrowAuditLogId: string | undefined;
    if (
      journey.escrow &&
      (args.decision === 'RESOLVED_REFUND' ||
        args.decision === 'RESOLVED_PAY' ||
        args.decision === 'RESOLVED_SPLIT')
    ) {
      await appendAuditEntryTx(
        tx,
        journey.escrow.id,
        `ADMIN_${args.decision}`,
        journey.escrow.amount,
        args.adminId,
        { reason: args.reason, journeyId: journey.id },
      );
      const log = await tx.escrowAuditLog.findFirst({
        where: { escrowId: journey.escrow.id },
        orderBy: { sequenceNumber: 'desc' },
        select: { id: true },
      });
      crossLinkedEscrowAuditLogId = log?.id;
    }

    // R3-RECONCILIATION-WIRING-FIX — apply the settlement the admin decided.
    // The sibling conflict modules are audit-only (they record intent without
    // moving state); JOURNEY_RECONCILIATION's customer-dispute workflow needs
    // the decision to actually settle. Journey transitions go through the state
    // machine (DISPUTED -> CANCELLED / COMPLETED) so the SM stays the single
    // invariant gate; escrow moves via the tx-accepting variants so the
    // escrow + journey + audit + AdminAction writes are atomic.
    if (journey.escrow && args.decision === 'RESOLVED_REFUND') {
      const nextStatus = transitionJourney(
        journey.status as JourneyStatus,
        JourneyAction.ADMIN_REFUND,
      );
      await tx.journey.update({ where: { id: journey.id }, data: { status: nextStatus } });
      // The Flutterwave refund (if any) already fired before this transaction;
      // flwRefundTxId is recorded in the REFUNDED audit entry's metadata.
      await refundEscrowTx(tx, journey.escrow, args.adminId, flwRefundTxId);
    } else if (journey.escrow && args.decision === 'RESOLVED_PAY') {
      const nextStatus = transitionJourney(
        journey.status as JourneyStatus,
        JourneyAction.ADMIN_PAY,
      );
      await tx.journey.update({ where: { id: journey.id }, data: { status: nextStatus } });
      await releaseEscrowTx(tx, journey.escrow, args.adminId);
      // Driver payout is a 2-step ledger-then-batch pattern (NOT a direct
      // gateway call at this layer): releaseEscrowTx above credits the
      // driver's DriverBalance.pendingAmount via creditDriverBalance(); the
      // scheduled payout worker (jobs/payout.job.ts) then drains pending
      // balances by calling transferToWallet (Flutterwave Transfer,
      // services/payment/transfer.ts) on its own cadence (the 22:00
      // Africa/Kigali daily job for the DAILY_22H cohort, the /api/payout/
      // end-shift endpoint, and the fallback job). The payout gateway is
      // already fully wired at the batch-job layer — there is no missing
      // hook here (corrects PR #88's misplaced TODO; R3-FLW-PAYOUT-INTEGRATION
      // is not a real backlog item).
    }
    // RESOLVED_SPLIT and NO_ACTION: intentionally no state flip.
    // TODO(R3-SPLIT-SEMANTICS): apply a proportional refund + release for split
    // decisions once a partial-amount field exists in the escrow schema.

    return appendAdminActionTx(tx, {
      adminId: args.adminId,
      action: 'RESOLVE_JOURNEY_RECONCILIATION',
      targetType: 'JOURNEY',
      targetId: args.id,
      reason: args.reason,
      payload: { decision: args.decision },
      conflictType: 'JOURNEY_RECONCILIATION',
      conflictDecision: args.decision,
      crossLinkedEscrowAuditLogId,
    });
  });
}

export const journeyReconciliationModule: ConflictModule = {
  type: 'JOURNEY_RECONCILIATION',
  validDecisions: VALID_DECISIONS,
  listOpen,
  countOpen,
  getDetail,
  decide,
};
