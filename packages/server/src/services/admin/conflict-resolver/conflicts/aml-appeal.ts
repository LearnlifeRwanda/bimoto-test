// AML CRITICAL appeal: a flagged user (or admin reviewing on their behalf)
// disputes a CRITICAL flag. UPHOLD_FLAG keeps things as-is; OVERTURN_FLAG
// clears User.isFlagged ONLY if no other CRITICAL flag is still open.
//
// No EscrowAuditLog cross-write — overturning a flag has no immediate
// financial impact. Releasing held funds is a separate UNFREEZE_USER step.

import type {
  AdminAction,
  ConflictDecision,
  PrismaClient,
} from '@prisma/client';
import {
  appendAdminActionTx,
  assertConflictUndecidedTx,
} from '../../admin-action-audit.service';
import type {
  ConflictDecisionArgs,
  ConflictDetail,
  ConflictListItem,
  ConflictModule,
} from '../types';

const VALID_DECISIONS: ReadonlyArray<ConflictDecision> = [
  'UPHOLD_FLAG',
  'OVERTURN_FLAG',
  'NO_ACTION',
];

async function listOpen(
  prisma: PrismaClient,
  opts: { limit: number },
): Promise<ConflictListItem[]> {
  const flags = await prisma.amlFlag.findMany({
    where: {
      severity: 'CRITICAL',
      status: 'OPEN',
      user: { isFlagged: true },
    },
    include: { user: { select: { id: true, nickname: true, isFlagged: true } } },
    orderBy: { detectedAt: 'desc' },
    take: opts.limit,
  });
  const decided = await prisma.adminAction.findMany({
    where: {
      action: 'RESOLVE_AML_APPEAL',
      targetType: 'AML_FLAG',
      targetId: { in: flags.map((f: any) => f.id) },
    },
    select: { targetId: true },
  });
  const decidedIds = new Set<string>(decided.map((d: any) => d.targetId));
  return flags
    .filter((f: any) => !decidedIds.has(f.id))
    .map((f: any) => ({
      id: f.id,
      type: 'AML_APPEAL' as const,
      summary: `${f.type} on ${f.user?.nickname ?? f.userId}`,
      createdAt: f.detectedAt,
      metadata: { severity: f.severity, userId: f.userId },
    }));
}

async function countOpen(prisma: PrismaClient): Promise<number> {
  return (await listOpen(prisma, { limit: 1000 })).length;
}

async function getDetail(
  prisma: PrismaClient,
  id: string,
): Promise<ConflictDetail | null> {
  const flag = await prisma.amlFlag.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, nickname: true, phoneEncrypted: true, isFlagged: true } },
      journey: true,
      escrow: true,
    },
  });
  if (!flag) return null;
  const otherFlags = await prisma.amlFlag.findMany({
    where: {
      userId: flag.userId,
      severity: 'CRITICAL',
      status: 'OPEN',
      NOT: { id: flag.id },
    },
  });
  return {
    id: flag.id,
    type: 'AML_APPEAL',
    summary: `${flag.type} on ${flag.user?.nickname ?? flag.userId}`,
    createdAt: flag.detectedAt,
    data: { flag, otherCriticalFlags: otherFlags },
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
      action: 'RESOLVE_AML_APPEAL',
      targetType: 'AML_FLAG',
      targetId: args.id,
      conflictType: 'AML_APPEAL',
    });

    const flag = await tx.amlFlag.findUnique({ where: { id: args.id } });
    if (!flag) {
      const err: any = new Error('AML_FLAG_NOT_FOUND');
      err.code = 'AML_FLAG_NOT_FOUND';
      throw err;
    }
    if (args.decision === 'OVERTURN_FLAG') {
      await tx.amlFlag.update({
        where: { id: flag.id },
        data: {
          status: 'DISMISSED',
          resolvedAt: new Date(),
          resolvedBy: args.adminId,
          resolutionNotes: args.reason,
        },
      });
      const remaining = await tx.amlFlag.count({
        where: {
          userId: flag.userId,
          severity: 'CRITICAL',
          status: 'OPEN',
          NOT: { id: flag.id },
        },
      });
      if (remaining === 0) {
        await tx.user.update({
          where: { id: flag.userId },
          data: { isFlagged: false, flagReason: null },
        });
      }
    } else if (args.decision === 'UPHOLD_FLAG') {
      await tx.amlFlag.update({
        where: { id: flag.id },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolvedBy: args.adminId,
          resolutionNotes: args.reason,
        },
      });
    }
    return appendAdminActionTx(tx, {
      adminId: args.adminId,
      action: 'RESOLVE_AML_APPEAL',
      targetType: 'AML_FLAG',
      targetId: args.id,
      reason: args.reason,
      payload: { userId: flag.userId, flagType: flag.type },
      conflictType: 'AML_APPEAL',
      conflictDecision: args.decision,
    });
  });
}

export const amlAppealModule: ConflictModule = {
  type: 'AML_APPEAL',
  validDecisions: VALID_DECISIONS,
  listOpen,
  countOpen,
  getDetail,
  decide,
};
