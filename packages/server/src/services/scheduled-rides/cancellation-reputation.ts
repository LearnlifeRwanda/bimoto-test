import prisma from '../../prisma';

export const SCHEDULED_CANCEL_FLAG_THRESHOLD = process.env.SCHEDULED_CANCEL_FLAG_THRESHOLD
  ? Number(process.env.SCHEDULED_CANCEL_FLAG_THRESHOLD)
  : 3;
export const SCHEDULED_CANCEL_WINDOW_DAYS = process.env.SCHEDULED_CANCEL_WINDOW_DAYS
  ? Number(process.env.SCHEDULED_CANCEL_WINDOW_DAYS)
  : 7;

// PILOT-GUARD Item 1(a) — the reason a flag exists is part of the flag.
//
// aml/flag-store.ts has always written User.flagReason alongside
// User.isFlagged, and the two conflict-resolver siblings clear both
// together. This path wrote isFlagged alone, so an account flagged here
// arrived in /admin/flagged with nothing saying why — unreviewable, and
// indistinguishable from an AML flag. The reason is a stable code, not
// prose: it is data an admin filters on, not a sentence.
export const SCHEDULED_CANCELLATIONS_FLAG_REASON = 'SCHEDULED_CANCELLATIONS_3_IN_7D';

export async function bumpScheduledCancellationCount(userId: string): Promise<{
  newCount: number;
  lifetimeCount: number;
  threshold: number;
  isFlagged: boolean;
  flagReason: string | null;
}> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { scheduledCancellationCount: { increment: 1 } },
  });
  const recent = await getRecentScheduledCancellations(userId, SCHEDULED_CANCEL_WINDOW_DAYS);
  const isFlagged = recent >= SCHEDULED_CANCEL_FLAG_THRESHOLD;
  if (isFlagged) {
    await prisma.user.update({
      where: { id: userId },
      data: { isFlagged: true, flagReason: SCHEDULED_CANCELLATIONS_FLAG_REASON },
    });
    console.warn(
      `[FRAUD] User ${userId} scheduled cancellations ${recent} in ${SCHEDULED_CANCEL_WINDOW_DAYS}d. Flagged.`,
    );
  }
  // PILOT-GUARD Item 1(d) — `newCount` is the number the DECISION used.
  //
  // It used to return User.scheduledCancellationCount, a lifetime tally
  // that is incremented only on customer-initiated cancels, while the
  // flag was decided by a rolling 7-day count of every CANCELLED
  // SCHEDULED journey. The two answered different questions, so a caller
  // pairing `newCount` with `threshold` could read "2 of 3" on the very
  // call that flagged the account. The deciding number is now the one
  // reported; the lifetime tally is still returned, under its own name.
  return {
    newCount: recent,
    lifetimeCount: updated.scheduledCancellationCount,
    threshold: SCHEDULED_CANCEL_FLAG_THRESHOLD,
    isFlagged,
    flagReason: isFlagged ? SCHEDULED_CANCELLATIONS_FLAG_REASON : null,
  };
}

export async function getRecentScheduledCancellations(
  userId: string,
  days: number = SCHEDULED_CANCEL_WINDOW_DAYS,
): Promise<number> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return prisma.journey.count({
    where: {
      customerId: userId,
      bookingMode: 'SCHEDULED',
      status: 'CANCELLED',
      updatedAt: { gte: since },
    },
  });
}

export async function getReputationPenaltyForBidPriority(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isFlagged: true },
  });
  if (!user) return 1.0;
  return user.isFlagged ? 0.5 : 1.0;
}
