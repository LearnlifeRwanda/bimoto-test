// SERVICES/RATING.SERVICE.TS
//
// TEAM-ANSWERS G2 (OPEN DECISIONS item 15, Kigali team, 18 August).
//
// THE NARROWING — deliberate, and the one non-additive change in this
// dispatch. This service used to accept EITHER direction: the route
// resolved "customer rates driver; driver rates customer" and passed
// whichever ratee it found. No client ever called the driver direction
// (the sole caller of POST /:id/rate has always been the passenger
// receipt card, RateRideCard.tsx), so it was a latent passenger-scoring
// path rather than a live one — but latent is enough: a score attached
// to a passenger absorbs bias, invites retaliation, and once the number
// exists someone will one day propose it for matching.
//
// So the direction is now fixed by construction, in two independent
// places: the route is customerOnly, and this service refuses any ratee
// that is not the journey's driver. A Rating row whose ratee is the
// customer cannot be created through any path in this codebase.
//
// The driver's half of the team's ask — "identify and manage issues
// from both sides" — ships instead as an incident report
// (ride-report.service.ts / ConflictType RIDE_REPORT): the same pattern
// visibility for ops, without the number.

import prisma from '../prisma';
import { notifyRatingReceived } from './notification.service';
import { AppError } from '../middleware/error-handler';
import { MIN_RATING, MAX_RATING } from '@bimoto/shared';
import type { RatingReason } from '@bimoto/shared';

export async function createRating(
  journeyId: string,
  raterId: string,
  ratedId: string,
  stars: number,
  comment?: string,
  reason?: RatingReason,
) {
  if (stars < MIN_RATING || stars > MAX_RATING) {
    throw new AppError(400, 'INVALID_RATING', 'errors.invalidRating');
  }

  // Verify journey exists and is completed
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });

  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }

  if (journey.status !== 'COMPLETED') {
    throw new AppError(400, 'JOURNEY_NOT_COMPLETED', 'errors.journeyNotCompleted');
  }

  // TEAM-ANSWERS G2 — one direction only. The rater must be this
  // journey's PASSENGER; anybody else (the driver included) is not a
  // rater here at all.
  if (journey.customerId !== raterId) {
    throw new AppError(403, 'NOT_JOURNEY_PARTICIPANT', 'errors.notJourneyParticipant');
  }

  // …and the ratee must be this journey's DRIVER. This is the line that
  // makes a passenger score impossible rather than merely unreachable:
  // no caller, present or future, can persuade this service to write a
  // Rating row pointing at a customer.
  if (!journey.driverId || journey.driverId !== ratedId) {
    throw new AppError(400, 'INVALID_RATED_USER', 'errors.invalidRatedUser');
  }

  // Check for duplicate rating
  const existing = await prisma.rating.findUnique({
    where: { journeyId_raterId: { journeyId, raterId } },
  });

  if (existing) {
    throw new AppError(409, 'ALREADY_RATED', 'errors.alreadyRated');
  }

  // MONEY-ATOMIC G4 — the rating and the driver's published average are
  // one unit, and concurrent ratings for one driver are serialized.
  //
  // Two defects lived here. (a) The rating.create committed on its own and
  // the avgRating update followed as a separate statement: a failure
  // between them left the rating stored and the driver's public average
  // permanently stale, with nothing that ever recomputes it. (b) The
  // aggregate is a read-modify-write across a boundary no row lock spans —
  // it reads the Rating table and writes DriverProfile — so two ratings
  // landing at once could both aggregate before either wrote, and the
  // later write would publish an average that ignores the other rating.
  // A transaction alone fixes (a) and NOT (b): READ COMMITTED is happy to
  // let both aggregates run against the same snapshot of committed rows.
  //
  // So: one transaction, and a transaction-scoped advisory lock keyed on
  // the driver, taken before the create — the fee-waiver/index.ts and
  // aml/limits.ts idiom, over the same shape of problem (a computation
  // over rows that other transactions are adding to). The lock dies with
  // the transaction (same rationale as job-lock.ts). Skipped under unit
  // -test mocks without $queryRaw — behaviour there is the sequential
  // behaviour, unchanged.
  //
  // The @@unique([journeyId, raterId]) index is untouched and remains what
  // stops the same passenger rating the same journey twice.
  const created = await prisma.$transaction(async (tx: any) => {
    if (typeof tx.$queryRaw === 'function') {
      const lockKey = `driver-rating:${ratedId}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS locked`;
    }

    const rating = await tx.rating.create({
      data: {
        journeyId,
        raterId,
        ratedId,
        stars,
        comment: comment ?? null,
        reason: reason ?? null,
      },
    });

    // Recalculate the DRIVER's avgRating. The ratee is guaranteed to be
    // the journey's driver by the guard above, so this aggregate is — and
    // stays — a driver-only number. No per-customer average, count or
    // aggregate is computed or stored anywhere.
    const driverProfile = await tx.driverProfile.findUnique({
      where: { userId: ratedId },
    });

    if (driverProfile) {
      // Aggregated INSIDE the lock and after the create, so the average
      // published below counts this rating and every rating serialized
      // ahead of it.
      const avgResult = await tx.rating.aggregate({
        where: { ratedId },
        _avg: { stars: true },
      });

      const avgRating = avgResult._avg.stars ?? 0;

      await tx.driverProfile.update({
        where: { userId: ratedId },
        data: { avgRating },
      });
    }

    return rating;
  });

  // NOTIFY G3 — the motari learns he was rated.
  //
  // POST-COMMIT: the row and the recalculated average are durable by the
  // time this runs, so the number he is told is the number that is
  // stored. Stars only — the comment and the reason stay on the row for
  // an admin conflict view, and the rater is not named. The helper never
  // throws, so a dead socket cannot fail a rating that already landed.
  notifyRatingReceived(ratedId, journeyId, stars);

  return created;
}
