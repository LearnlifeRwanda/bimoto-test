// Fixture — a planted class-(a) function: a status change followed by a
// write to a second model, unbatched. This is the shape of all six
// MONEY-ATOMIC defects, and the guard must fail on it.

import prisma from '../prisma';

export async function settleSomething(journeyId: string, driverId: string) {
  const updated = await prisma.journey.update({
    where: { id: journeyId },
    data: { status: 'COMPLETED' },
  });

  await prisma.user.update({
    where: { id: driverId },
    data: { completedRides: { increment: 1 } },
  });

  return updated;
}
