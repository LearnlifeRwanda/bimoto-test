// SERVICES/RIDE-REPORT.SERVICE.TS
//
// TEAM-ANSWERS G3 — the driver files an incident report about a
// finished ride. Never a score. See packages/shared/src/types/
// ride-report.ts for the substitution this encodes and why.
//
// What this service will never do, stated so a future reader does not
// have to infer it from absence: it computes no per-customer average,
// count or aggregate; it writes nothing to any customer's profile; it
// returns no number about a person. Pattern visibility comes from the
// admin conflicts list — the same place it comes from for the other
// nine conflict types.

import prisma from '../prisma';
import { AppError } from '../middleware/error-handler';
import type { RideReportReason } from '@bimoto/shared';

/**
 * The statuses in which a ride is over and a driver may say something
 * about it. The driver's End tap moves a journey to
 * AWAITING_CONFIRMATION; the passenger's confirm (or the 2-hour
 * auto-confirm) takes it to COMPLETED; a dispute or an interruption
 * ends it elsewhere. All four are rides that happened.
 *
 * Reporting is deliberately NOT gated on COMPLETED alone: the driver's
 * natural moment is the receipt he sees the instant he taps End, and by
 * then the journey is AWAITING_CONFIRMATION, not COMPLETED.
 */
export const REPORTABLE_JOURNEY_STATUSES = [
  'AWAITING_CONFIRMATION',
  'COMPLETED',
  'DISPUTED',
  'INTERRUPTED',
] as const;

export async function createRideReport(
  journeyId: string,
  reporterId: string,
  reason: RideReportReason,
  details?: string,
) {
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });

  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }

  // Only the driver who actually drove it. Not "a driver" — this one.
  if (journey.driverId !== reporterId) {
    throw new AppError(403, 'NOT_JOURNEY_DRIVER', 'errors.notJourneyDriver');
  }

  if (!(REPORTABLE_JOURNEY_STATUSES as ReadonlyArray<string>).includes(journey.status)) {
    throw new AppError(400, 'JOURNEY_NOT_ENDED', 'errors.journeyNotEnded');
  }

  // One report per journey per driver. The repeat answers 409
  // ALREADY_REPORTED — the codebase's dominant idiom for "you already
  // did this" (bid.service ALREADY_BID, rating.service ALREADY_RATED).
  const existing = await prisma.rideReport.findUnique({
    where: { journeyId_reporterId: { journeyId, reporterId } },
  });

  if (existing) {
    throw new AppError(409, 'ALREADY_REPORTED', 'errors.alreadyReported');
  }

  return prisma.rideReport.create({
    data: {
      journeyId,
      reporterId,
      reason,
      details: details ?? null,
    },
  });
}
