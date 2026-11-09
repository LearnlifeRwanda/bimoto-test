// Graph-anomaly conflict module: surfaces AmlFlag rows produced by the
// graph-pattern detectors (Dispatch I) for admin review. UPHOLD_FLAG keeps the
// flag(s) RESOLVED; OVERTURN_FLAG dismisses every flag for ALL ring members
// (since these patterns flag ring-wide) and clears User.isFlagged where no
// other CRITICAL flag remains. NO_ACTION just records the decision without
// mutating the flag.
//
// No EscrowAuditLog cross-write — graph signals do not have a single per-flag
// financial impact.

import type {
  AdminAction,
  AmlFlagType,
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

const GRAPH_FLAG_TYPES: AmlFlagType[] = [
  'COLLUSION_RING',
  'MONEY_FUNNEL',
  'REPUTATION_RING',
  'GEO_ANOMALY',
  'SYNC_RATING_ATTACK',
  'BID_CYCLE_RING',
];

async function listOpen(
  prisma: PrismaClient,
  opts: { limit: number },
): Promise<ConflictListItem[]> {
  const flags = await prisma.amlFlag.findMany({
    where: {
      type: { in: GRAPH_FLAG_TYPES },
      status: 'OPEN',
    },
    include: { user: { select: { id: true, nickname: true, isFlagged: true } } },
    orderBy: { detectedAt: 'desc' },
    take: opts.limit,
  });
  const decided = await prisma.adminAction.findMany({
    where: {
      action: 'RESOLVE_GRAPH_ANOMALY',
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
      type: 'GRAPH_ANOMALY' as const,
      summary: `${f.type} on ${f.user?.nickname ?? f.userId}`,
      createdAt: f.detectedAt,
      metadata: { severity: f.severity, userId: f.userId, flagType: f.type },
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
    },
  });
  if (!flag) return null;
  const meta = (flag.metadata ?? {}) as Record<string, unknown>;
  const ringMembers: string[] = Array.isArray(meta.ringMembers)
    ? (meta.ringMembers as string[])
    : Array.isArray(meta.cliqueCustomers)
      ? Array.from(
          new Set([
            ...(meta.cliqueCustomers as string[]),
            ...((meta.cliqueDrivers as string[]) ?? []),
          ]),
        )
      : Array.isArray(meta.topCustomerIds)
        ? [flag.userId, ...(meta.topCustomerIds as string[])]
        : Array.isArray(meta.raterIds)
          ? [flag.userId, ...(meta.raterIds as string[])]
          : [flag.userId];
  const memberUsers = await prisma.user.findMany({
    where: { id: { in: ringMembers } },
    select: { id: true, nickname: true, role: true, isFlagged: true },
  });
  return {
    id: flag.id,
    type: 'GRAPH_ANOMALY',
    summary: `${flag.type} on ${flag.user?.nickname ?? flag.userId}`,
    createdAt: flag.detectedAt,
    data: { flag, ringMembers, memberUsers },
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
      action: 'RESOLVE_GRAPH_ANOMALY',
      targetType: 'AML_FLAG',
      targetId: args.id,
      conflictType: 'GRAPH_ANOMALY',
    });

    const flag = await tx.amlFlag.findUnique({ where: { id: args.id } });
    if (!flag) {
      const err: any = new Error('AML_FLAG_NOT_FOUND');
      err.code = 'AML_FLAG_NOT_FOUND';
      throw err;
    }
    const meta = (flag.metadata ?? {}) as Record<string, unknown>;
    const ringMembers: string[] = Array.isArray(meta.ringMembers)
      ? (meta.ringMembers as string[])
      : Array.isArray(meta.cliqueCustomers)
        ? Array.from(
            new Set([
              ...(meta.cliqueCustomers as string[]),
              ...((meta.cliqueDrivers as string[]) ?? []),
            ]),
          )
        : [flag.userId];

    let scannedNodes = 0;
    if (args.decision === 'OVERTURN_FLAG') {
      // Dismiss every OPEN flag of this same graph type for any ring member.
      const updateRes = await tx.amlFlag.updateMany({
        where: {
          type: flag.type,
          status: 'OPEN',
          userId: { in: ringMembers },
        },
        data: {
          status: 'DISMISSED',
          resolvedAt: new Date(),
          resolvedBy: args.adminId,
          resolutionNotes: args.reason,
        },
      });
      scannedNodes = updateRes.count;
      // Clear isFlagged on each member who has no other CRITICAL flag remaining.
      for (const memberId of ringMembers) {
        const remaining = await tx.amlFlag.count({
          where: { userId: memberId, severity: 'CRITICAL', status: 'OPEN' },
        });
        if (remaining === 0) {
          await tx.user.update({
            where: { id: memberId },
            data: { isFlagged: false, flagReason: null },
          });
        }
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
      action: 'RESOLVE_GRAPH_ANOMALY',
      targetType: 'AML_FLAG',
      targetId: args.id,
      reason: args.reason,
      payload: {
        flagType: flag.type,
        ringMemberCount: ringMembers.length,
        totalScannedNodes: scannedNodes,
      },
      conflictType: 'GRAPH_ANOMALY',
      conflictDecision: args.decision,
    });
  });
}

export const graphAnomalyModule: ConflictModule = {
  type: 'GRAPH_ANOMALY',
  validDecisions: VALID_DECISIONS,
  listOpen,
  countOpen,
  getDetail,
  decide,
};
