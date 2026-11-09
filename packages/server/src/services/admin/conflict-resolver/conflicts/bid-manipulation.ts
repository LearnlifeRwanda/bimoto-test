// Bid manipulation: a driver accepts a bid, then withdraws within
// BID_MANIPULATION_WITHDRAW_WINDOW_SEC OR a (driver, customer) pair has
// >= BID_MANIPULATION_PAIR_THRESHOLD accepted-then-withdrawn cycles in
// BID_MANIPULATION_PAIR_WINDOW_DAYS.
//
// Decisions: NO_ACTION, RESOLVED_REFUND (if customer was charged), or
// FORCE_COMPLETE (no-op marker — admin will follow up with a separate
// FREEZE_USER call). No EscrowAuditLog cross-write here unless decision
// is RESOLVED_REFUND on a bid that already had escrow held.

import type {
  AdminAction,
  ConflictDecision,
  PrismaClient,
} from '@prisma/client';
import {
  appendAdminActionTx,
  assertConflictUndecidedTx,
} from '../../admin-action-audit.service';
import {
  BID_MANIPULATION_PAIR_THRESHOLD,
  BID_MANIPULATION_PAIR_WINDOW_DAYS,
  BID_MANIPULATION_WITHDRAW_WINDOW_SEC,
} from '../../config';
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
  // Heuristic: WITHDRAWN bids that flipped from ACCEPTED in <= window seconds.
  // Prisma doesn't track per-status timestamps, so we approximate via
  // updatedAt - createdAt being near zero AND status WITHDRAWN.
  const since = new Date(
    Date.now() - BID_MANIPULATION_PAIR_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const candidates = await prisma.bid.findMany({
    where: { status: 'WITHDRAWN', updatedAt: { gte: since } },
    include: {
      journey: { select: { customerId: true, pickupName: true, destinationName: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: opts.limit,
  });
  const decided = await prisma.adminAction.findMany({
    where: {
      action: 'RESOLVE_BID_MANIPULATION',
      targetType: 'BID',
      targetId: { in: candidates.map((b: any) => b.id) },
    },
    select: { targetId: true },
  });
  const decidedIds = new Set<string>(decided.map((d: any) => d.targetId));
  return candidates
    .filter((b: any) => {
      if (decidedIds.has(b.id)) return false;
      const ageSec =
        (new Date(b.updatedAt).getTime() -
          new Date(b.createdAt).getTime()) /
        1000;
      return ageSec <= BID_MANIPULATION_WITHDRAW_WINDOW_SEC;
    })
    .map((b: any) => ({
      id: b.id,
      type: 'BID_MANIPULATION' as const,
      summary: `Driver ${b.driverId.slice(0, 8)} on journey ${b.journey?.pickupName ?? '?'}`,
      createdAt: b.updatedAt,
      metadata: {
        driverId: b.driverId,
        customerId: b.journey?.customerId,
        price: b.price,
      },
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
      journey: true,
      driver: { select: { id: true, nickname: true, phoneEncrypted: true } },
    },
  });
  if (!bid) return null;
  const since = new Date(
    Date.now() - BID_MANIPULATION_PAIR_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const pairBids = await prisma.bid.findMany({
    where: {
      driverId: bid.driverId,
      status: 'WITHDRAWN',
      updatedAt: { gte: since },
      journey: { customerId: bid.journey?.customerId },
    },
    select: { id: true, createdAt: true, updatedAt: true, price: true },
  });
  return {
    id: bid.id,
    type: 'BID_MANIPULATION',
    summary: `Driver ${bid.driverId} bid manipulation`,
    createdAt: bid.updatedAt,
    data: {
      bid,
      pairBidCount: pairBids.length,
      pairThreshold: BID_MANIPULATION_PAIR_THRESHOLD,
      pairBids,
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
      action: 'RESOLVE_BID_MANIPULATION',
      targetType: 'BID',
      targetId: args.id,
      conflictType: 'BID_MANIPULATION',
    });

    const bid = await tx.bid.findUnique({ where: { id: args.id } });
    if (!bid) {
      const err: any = new Error('BID_NOT_FOUND');
      err.code = 'BID_NOT_FOUND';
      throw err;
    }
    return appendAdminActionTx(tx, {
      adminId: args.adminId,
      action: 'RESOLVE_BID_MANIPULATION',
      targetType: 'BID',
      targetId: args.id,
      reason: args.reason,
      payload: { driverId: bid.driverId, journeyId: bid.journeyId },
      conflictType: 'BID_MANIPULATION',
      conflictDecision: args.decision,
    });
  });
}

export const bidManipulationModule: ConflictModule = {
  type: 'BID_MANIPULATION',
  validDecisions: VALID_DECISIONS,
  listOpen,
  countOpen,
  getDetail,
  decide,
};
