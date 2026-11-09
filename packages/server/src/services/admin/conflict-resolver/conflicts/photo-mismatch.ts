// Photo mismatch: a goods journey has a delivery photo that the customer
// flagged as not matching the recipient. The bimoto schema does not
// currently have a dedicated PhotoFlag table; for the pilot we therefore
// queue every COMPLETED goods journey with both pickup and delivery
// photos within PHOTO_MISMATCH_QUEUE_HOURS for admin spot-check. A future
// dispatch can introduce an explicit flag.
//
// Decisions: NO_ACTION (photo OK), RESOLVED_REFUND (cross-writes
// EscrowAuditLog), FORCE_COMPLETE (no-op marker).

import type {
  AdminAction,
  ConflictDecision,
  PrismaClient,
} from '@prisma/client';
import {
  appendAdminActionTx,
  assertConflictUndecidedTx,
} from '../../admin-action-audit.service';
import { appendAuditEntryTx } from '../../../escrow-audit.service';
import { PHOTO_MISMATCH_QUEUE_HOURS } from '../../config';
import type {
  ConflictDecisionArgs,
  ConflictDetail,
  ConflictListItem,
  ConflictModule,
} from '../types';

const VALID_DECISIONS: ReadonlyArray<ConflictDecision> = [
  'NO_ACTION',
  'RESOLVED_REFUND',
  'FORCE_COMPLETE',
];

async function listOpen(
  prisma: PrismaClient,
  opts: { limit: number },
): Promise<ConflictListItem[]> {
  const since = new Date(
    Date.now() - PHOTO_MISMATCH_QUEUE_HOURS * 60 * 60 * 1000,
  );
  const journeys = await prisma.journey.findMany({
    where: {
      type: 'GOODS',
      status: 'COMPLETED',
      pickupPhotoUrl: { not: null },
      deliveryPhotoUrl: { not: null },
      endedAt: { gte: since },
    },
    select: {
      id: true,
      endedAt: true,
      pickupName: true,
      destinationName: true,
      recipientName: true,
    },
    orderBy: { endedAt: 'desc' },
    take: opts.limit,
  });
  const decided = await prisma.adminAction.findMany({
    where: {
      action: 'RESOLVE_PHOTO_MISMATCH',
      targetType: 'JOURNEY',
      targetId: { in: journeys.map((j: any) => j.id) },
    },
    select: { targetId: true },
  });
  const decidedIds = new Set<string>(decided.map((d: any) => d.targetId));
  return journeys
    .filter((j: any) => !decidedIds.has(j.id))
    .map((j: any) => ({
      id: j.id,
      type: 'PHOTO_MISMATCH' as const,
      summary: `Goods to ${j.recipientName ?? j.destinationName}`,
      createdAt: j.endedAt,
    }));
}

async function countOpen(prisma: PrismaClient): Promise<number> {
  return (await listOpen(prisma, { limit: 1000 })).length;
}

async function getDetail(
  prisma: PrismaClient,
  id: string,
): Promise<ConflictDetail | null> {
  const j = await prisma.journey.findUnique({
    where: { id },
    include: { escrow: true },
  });
  if (!j) return null;
  return {
    id: j.id,
    type: 'PHOTO_MISMATCH',
    summary: `Goods to ${j.recipientName ?? j.destinationName}`,
    createdAt: j.endedAt ?? j.createdAt,
    data: {
      journey: j,
      escrow: j.escrow,
      pickupPhotoUrl: j.pickupPhotoUrl,
      deliveryPhotoUrl: j.deliveryPhotoUrl,
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
  return prisma.$transaction(async (tx: any) => {
    // BID-ATOMICITY G4 — single-winner: claim the decision before any
    // side-effect. A racing second admin serializes on the advisory
    // lock, sees the winner's AdminAction, and gets ALREADY_DECIDED
    // (409) with the whole transaction rolled back.
    await assertConflictUndecidedTx(tx, {
      action: 'RESOLVE_PHOTO_MISMATCH',
      targetType: 'JOURNEY',
      targetId: args.id,
      conflictType: 'PHOTO_MISMATCH',
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
    if (args.decision === 'RESOLVED_REFUND' && journey.escrow) {
      await appendAuditEntryTx(
        tx,
        journey.escrow.id,
        'ADMIN_PHOTO_MISMATCH_REFUND',
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
    return appendAdminActionTx(tx, {
      adminId: args.adminId,
      action: 'RESOLVE_PHOTO_MISMATCH',
      targetType: 'JOURNEY',
      targetId: args.id,
      reason: args.reason,
      payload: { decision: args.decision },
      conflictType: 'PHOTO_MISMATCH',
      conflictDecision: args.decision,
      crossLinkedEscrowAuditLogId,
    });
  });
}

export const photoMismatchModule: ConflictModule = {
  type: 'PHOTO_MISMATCH',
  validDecisions: VALID_DECISIONS,
  listOpen,
  countOpen,
  getDetail,
  decide,
};
