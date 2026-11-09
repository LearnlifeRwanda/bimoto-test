// GPS plausibility: a journey marked COMPLETED but the latest GPS point
// is more than GPS_PLAUSIBILITY_RADIUS_KM from the destination. Suggests
// either a faked completion or a customer-initiated completion away from
// the actual destination.
//
// Decisions: FORCE_COMPLETE (no payment change), RESOLVED_REFUND (cross-
// writes EscrowAuditLog), NO_ACTION.

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
import { GPS_PLAUSIBILITY_RADIUS_KM } from '../../config';
import type {
  ConflictDecisionArgs,
  ConflictDetail,
  ConflictListItem,
  ConflictModule,
} from '../types';

const VALID_DECISIONS: ReadonlyArray<ConflictDecision> = [
  'FORCE_COMPLETE',
  'RESOLVED_REFUND',
  'NO_ACTION',
];

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function listOpen(
  prisma: PrismaClient,
  opts: { limit: number },
): Promise<ConflictListItem[]> {
  const journeys = await prisma.journey.findMany({
    where: { status: 'COMPLETED', endedAt: { not: null } },
    select: {
      id: true,
      destinationLat: true,
      destinationLng: true,
      destinationName: true,
      pickupName: true,
      endedAt: true,
      gpsPoints: { orderBy: { timestamp: 'desc' }, take: 1 },
    },
    orderBy: { endedAt: 'desc' },
    take: Math.min(opts.limit * 4, 500),
  });
  const decided = await prisma.adminAction.findMany({
    where: {
      action: 'RESOLVE_GPS_PLAUSIBILITY',
      targetType: 'JOURNEY',
      targetId: { in: journeys.map((j: any) => j.id) },
    },
    select: { targetId: true },
  });
  const decidedIds = new Set<string>(decided.map((d: any) => d.targetId));
  const flagged: ConflictListItem[] = [];
  for (const j of journeys) {
    if (decidedIds.has(j.id)) continue;
    const last = j.gpsPoints?.[0];
    if (!last) continue;
    const dist = haversineKm(
      j.destinationLat,
      j.destinationLng,
      last.lat,
      last.lng,
    );
    if (dist > GPS_PLAUSIBILITY_RADIUS_KM) {
      flagged.push({
        id: j.id,
        type: 'GPS_PLAUSIBILITY',
        summary: `${j.pickupName} → ${j.destinationName} (off by ${dist.toFixed(2)}km)`,
        // cast-kept: the query filters `endedAt: { not: null }`, but Prisma's
        // generated types do not narrow a field's nullability from a `where`.
        createdAt: j.endedAt as Date,
        metadata: { distanceKm: dist },
      });
    }
    if (flagged.length >= opts.limit) break;
  }
  return flagged;
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
    include: {
      gpsPoints: { orderBy: { timestamp: 'asc' } },
      escrow: true,
    },
  });
  if (!j) return null;
  return {
    id: j.id,
    type: 'GPS_PLAUSIBILITY',
    summary: `${j.pickupName} → ${j.destinationName}`,
    createdAt: j.endedAt ?? j.createdAt,
    data: { journey: j, escrow: j.escrow },
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
      action: 'RESOLVE_GPS_PLAUSIBILITY',
      targetType: 'JOURNEY',
      targetId: args.id,
      conflictType: 'GPS_PLAUSIBILITY',
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
        'ADMIN_GPS_PLAUSIBILITY_REFUND',
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
      action: 'RESOLVE_GPS_PLAUSIBILITY',
      targetType: 'JOURNEY',
      targetId: args.id,
      reason: args.reason,
      payload: { decision: args.decision },
      conflictType: 'GPS_PLAUSIBILITY',
      conflictDecision: args.decision,
      crossLinkedEscrowAuditLogId,
    });
  });
}

export const gpsPlausibilityModule: ConflictModule = {
  type: 'GPS_PLAUSIBILITY',
  validDecisions: VALID_DECISIONS,
  listOpen,
  countOpen,
  getDetail,
  decide,
};
