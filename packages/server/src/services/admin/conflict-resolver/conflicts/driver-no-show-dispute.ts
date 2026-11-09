// R3-N-4 — driver no-show dispute conflict module.
//
// A driver whose journey was cancelled with cancelReason=DRIVER_NO_SHOW
// (either by the customer via R3-N-1's cancel-with-reason flow or by
// the R3-N-2 system-derived auto-cancel cron) can file a dispute via
// POST /api/journeys/:id/dispute-no-show. That endpoint stamps
// driverDisputedAt on the journey; this module surfaces the disputed
// journey in the admin queue.
//
// Decisions:
//   - OVERTURN_FLAG: driver's dispute is upheld; rolls back the
//     noShowCount increment that R3-N-1's applyCancelAttribution
//     applied. Best-effort reversal — strict suspension lift is
//     documented as a known limitation since the suspension may have
//     been triggered by an unrelated earlier no-show.
//   - UPHOLD_FLAG: driver's dispute is rejected; attribution stands.
//   - NO_ACTION: close the dispute without touching counters.

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
  notifyDriverDisputeUpheld,
  notifyDriverDisputeRejected,
  notifyDriverDisputeClosedNoAction,
} from '../../../notification.service';
import type {
  ConflictDecisionArgs,
  ConflictDetail,
  ConflictListItem,
  ConflictModule,
} from '../types';

const VALID_DECISIONS: ReadonlyArray<ConflictDecision> = [
  'OVERTURN_FLAG',
  'UPHOLD_FLAG',
  'NO_ACTION',
];

async function listOpen(
  prisma: PrismaClient,
  opts: { limit: number },
): Promise<ConflictListItem[]> {
  const journeys = await prisma.journey.findMany({
    where: {
      cancelReason: 'DRIVER_NO_SHOW',
      driverDisputedAt: { not: null },
    },
    orderBy: { driverDisputedAt: 'desc' },
    take: opts.limit,
  });
  const decided = await prisma.adminAction.findMany({
    where: {
      action: 'RESOLVE_DRIVER_NO_SHOW_DISPUTE',
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
      type: 'DRIVER_NO_SHOW_DISPUTE' as const,
      summary: `Driver ${(j.driverId ?? '').slice(0, 8)} disputes no-show on ${j.pickupName ?? '?'}`,
      createdAt: j.driverDisputedAt!,
      metadata: {
        driverId: j.driverId,
        customerId: j.customerId,
        cancelledAt: j.cancelledAt,
        matchedAt: j.matchedAt,
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
  const journey = await prisma.journey.findUnique({
    where: { id },
    include: {
      driver: {
        select: {
          id: true,
          nickname: true,
          noShowCount: true,
          suspendedUntil: true,
          isFlagged: true,
        },
      },
      customer: { select: { id: true, nickname: true } },
      gpsPoints: { orderBy: { timestamp: 'desc' }, take: 10 },
    },
  });
  if (
    !journey ||
    journey.cancelReason !== 'DRIVER_NO_SHOW' ||
    !journey.driverDisputedAt
  ) {
    return null;
  }
  return {
    id: journey.id,
    type: 'DRIVER_NO_SHOW_DISPUTE',
    summary: `Driver disputes no-show on ${journey.pickupName ?? '?'}`,
    createdAt: journey.driverDisputedAt,
    data: {
      journey,
      driver: journey.driver,
      customer: journey.customer,
      recentGps: journey.gpsPoints,
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
  // R3-N-5 — captured inside the tx so we can fire the appropriate
  // dispute-resolution push AFTER the transaction commits. If the tx
  // throws (e.g. JOURNEY_NOT_FOUND, deadlock, audit-chain failure),
  // we never reach the post-tx block, so a phantom notification cannot
  // outrun a rolled-back state change.
  let driverIdForPush: string | null = null;
  const adminAction = await prisma.$transaction(async (tx: any) => {
    // BID-ATOMICITY G4 — single-winner: claim the decision before any
    // side-effect. A racing second admin serializes on the advisory
    // lock, sees the winner's AdminAction, and gets ALREADY_DECIDED
    // (409) with the whole transaction rolled back.
    await assertConflictUndecidedTx(tx, {
      action: 'RESOLVE_DRIVER_NO_SHOW_DISPUTE',
      targetType: 'JOURNEY',
      targetId: args.id,
      conflictType: 'DRIVER_NO_SHOW_DISPUTE',
    });

    const journey = await tx.journey.findUnique({ where: { id: args.id } });
    if (!journey) {
      const err: any = new Error('JOURNEY_NOT_FOUND');
      err.code = 'JOURNEY_NOT_FOUND';
      throw err;
    }
    driverIdForPush = journey.driverId ?? null;
    if (args.decision === 'OVERTURN_FLAG' && journey.driverId) {
      // Roll back the +1 (or +0.5 in BOTH_NO_SHOW edge cases) that
      // applyCancelAttribution applied. We choose -1 here to mirror
      // the one canonical DRIVER_NO_SHOW path; admins can manually
      // adjust BOTH_NO_SHOW edge cases via FREEZE_USER notes.
      await tx.user.update({
        where: { id: journey.driverId },
        data: { noShowCount: { decrement: 1 } },
      });
    }
    return appendAdminActionTx(tx, {
      adminId: args.adminId,
      action: 'RESOLVE_DRIVER_NO_SHOW_DISPUTE',
      targetType: 'JOURNEY',
      targetId: args.id,
      reason: args.reason,
      payload: {
        driverId: journey.driverId,
        customerId: journey.customerId,
      },
      conflictType: 'DRIVER_NO_SHOW_DISPUTE',
      conflictDecision: args.decision,
    });
  });

  // POST-TRANSACTION: fire the matching push. The transaction has
  // committed by the time we reach here. notify* helpers are
  // fire-and-forget so a flaky FCM/APNs leg cannot rollback the audit.
  if (driverIdForPush) {
    if (args.decision === 'OVERTURN_FLAG') {
      notifyDriverDisputeUpheld(driverIdForPush, args.id);
    } else if (args.decision === 'UPHOLD_FLAG') {
      notifyDriverDisputeRejected(driverIdForPush, args.id);
    } else {
      notifyDriverDisputeClosedNoAction(driverIdForPush, args.id);
    }
  }

  return adminAction;
}

export const driverNoShowDisputeModule: ConflictModule = {
  type: 'DRIVER_NO_SHOW_DISPUTE',
  validDecisions: VALID_DECISIONS,
  listOpen,
  countOpen,
  getDetail,
  decide,
};
