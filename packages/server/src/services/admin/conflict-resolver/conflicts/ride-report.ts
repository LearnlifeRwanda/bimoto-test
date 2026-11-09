// TEAM-ANSWERS G3 — the ride-report conflict module. The tenth type.
//
// A driver who had a bad ride files a RideReport (POST
// /api/journeys/:id/report). This module carries those reports into the
// admin conflicts dashboard the same way the other nine types carry
// their own trouble, using the same registry, the same list/detail/decide
// routes and the same hash-chained AdminAction audit.
//
// WHY A CONFLICT AND NOT A SCORE. The Kigali team asked (item 15) for
// driver-rates-passenger, so issues could be identified and managed from
// both sides. Managing them from both sides is exactly what this is; the
// score is what was left out, by founder decision. Repeated reports about
// one rider are visible to an admin here — same journey customer showing
// up across several open reports — without any number ever being
// attached to that rider. Nothing in this module computes an average, a
// count, or any per-customer statistic.
//
// DECISIONS — the two that mean something for an incident with no money
// attached (this module deliberately touches NO escrow: a report is not
// a dispute, and item 15 was answered "no dispute button"):
//   • NO_ACTION   — read, nothing to do. The report stays as a record.
//   • UPHOLD_FLAG — noted against the reported rider's record for the
//     admin pattern-view. "Record" here means precisely the hash-chained
//     AdminAction row this returns, which is queryable by conflict type
//     and by target — not a field on the rider, and not a score.
//
// The RideReport row itself is never mutated. The report is immutable
// historical state; the AdminAction is the resolution layer above it —
// the same posture as recipient-dispute, which this module follows.

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

const VALID_DECISIONS: ReadonlyArray<ConflictDecision> = ['NO_ACTION', 'UPHOLD_FLAG'];

function reportSummary(report: any): string {
  const details = (report.details ?? '').trim();
  const truncated =
    details.length > 60 ? `${details.slice(0, 57)}…` : details || '(no details given)';
  return `Driver report — ${report.reason}: ${truncated}`;
}

async function listOpen(
  prisma: PrismaClient,
  opts: { limit: number },
): Promise<ConflictListItem[]> {
  const reports = await prisma.rideReport.findMany({
    where: {},
    orderBy: { createdAt: 'desc' },
    take: opts.limit,
  });
  const decided = await prisma.adminAction.findMany({
    where: {
      action: 'RESOLVE_RIDE_REPORT',
      targetType: 'RIDE_REPORT',
      targetId: { in: reports.map((r: any) => r.id) },
    },
    select: { targetId: true },
  });
  const decidedIds = new Set<string>(decided.map((d: any) => d.targetId));
  return reports
    .filter((r: any) => !decidedIds.has(r.id))
    .map((r: any) => ({
      id: r.id,
      type: 'RIDE_REPORT' as const,
      summary: reportSummary(r),
      createdAt: r.createdAt,
      // The journey is the handle on everything else — who rode, who
      // drove, what happened. Carried here so the list is scannable
      // without opening every row; NOT a per-person statistic.
      metadata: {
        journeyId: r.journeyId,
        reporterId: r.reporterId,
        reason: r.reason,
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
  const report = await prisma.rideReport.findUnique({
    where: { id },
    include: {
      journey: {
        include: {
          customer: { select: { id: true, nickname: true } },
          driver: { select: { id: true, nickname: true } },
        },
      },
    },
  });
  if (!report) return null;

  const priorActions = await prisma.adminAction.findMany({
    where: {
      action: 'RESOLVE_RIDE_REPORT',
      targetType: 'RIDE_REPORT',
      targetId: id,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      adminId: true,
      conflictDecision: true,
      reason: true,
      createdAt: true,
    },
  });

  // Other open reports on rides by the SAME rider. This is the pattern
  // view the team wanted, and it is deliberately a list of incidents
  // read live from the journeys — not a stored counter, not an average,
  // and not anything that outlives the reports themselves.
  const riderId = report.journey?.customerId ?? null;
  const otherReportsForRider = riderId
    ? await prisma.rideReport.findMany({
        where: { id: { not: id }, journey: { customerId: riderId } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, journeyId: true, reason: true, createdAt: true },
      })
    : [];

  return {
    id: report.id,
    type: 'RIDE_REPORT',
    summary: reportSummary(report),
    createdAt: report.createdAt,
    data: {
      report: {
        id: report.id,
        journeyId: report.journeyId,
        reporterId: report.reporterId,
        reason: report.reason,
        details: report.details,
        createdAt: report.createdAt,
      },
      journey: report.journey
        ? {
            id: report.journey.id,
            type: report.journey.type,
            status: report.journey.status,
            agreedPrice: report.journey.agreedPrice,
            pickupName: report.journey.pickupName,
            destinationName: report.journey.destinationName,
            createdAt: report.journey.createdAt,
            endedAt: report.journey.endedAt,
          }
        : null,
      // Who was reported, seen through the journey — exactly as every
      // other conflict type shows its participants.
      reportedRider: report.journey?.customer ?? null,
      reportingDriver: report.journey?.driver ?? null,
      otherReportsForRider,
      priorActions,
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
    // Single-winner, as every other module: claim the decision before
    // anything else, so a racing second admin gets ALREADY_DECIDED (409)
    // with the whole transaction rolled back.
    await assertConflictUndecidedTx(tx, {
      action: 'RESOLVE_RIDE_REPORT',
      targetType: 'RIDE_REPORT',
      targetId: args.id,
      conflictType: 'RIDE_REPORT',
    });

    const report = await tx.rideReport.findUnique({ where: { id: args.id } });
    if (!report) {
      const err: any = new Error('RIDE_REPORT_NOT_FOUND');
      err.code = 'RIDE_REPORT_NOT_FOUND';
      throw err;
    }

    // No escrow movement, on either decision. A report is not a dispute:
    // item 15 was answered "no dispute button", and money never rides on
    // one side's account of a ride.
    return appendAdminActionTx(tx, {
      adminId: args.adminId,
      action: 'RESOLVE_RIDE_REPORT',
      targetType: 'RIDE_REPORT',
      targetId: args.id,
      reason: args.reason,
      payload: {
        journeyId: report.journeyId,
        reportReason: report.reason,
      },
      conflictType: 'RIDE_REPORT',
      conflictDecision: args.decision,
    });
  });
}

export const rideReportModule: ConflictModule = {
  type: 'RIDE_REPORT',
  validDecisions: VALID_DECISIONS,
  listOpen,
  countOpen,
  getDetail,
  decide,
};
