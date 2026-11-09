// Fixture — the same two writes, composed into one transaction, plus a
// *Tx variant whose transaction belongs to its caller. Neither is a
// finding: the first is batched, the second writes through a parameter.

import prisma from '../prisma';

export async function settleSomethingTx(tx: any, journeyId: string, driverId: string) {
  const updated = await tx.journey.update({
    where: { id: journeyId },
    data: { status: 'COMPLETED' },
  });
  await tx.user.update({
    where: { id: driverId },
    data: { completedRides: { increment: 1 } },
  });
  return updated;
}

export async function settleSomething(journeyId: string, driverId: string) {
  return prisma.$transaction(async (tx: any) => {
    const updated = await tx.journey.update({
      where: { id: journeyId },
      data: { status: 'COMPLETED' },
    });
    await tx.user.update({
      where: { id: driverId },
      data: { completedRides: { increment: 1 } },
    });
    return updated;
  });
}

// The `db`-named transaction parameter — §D's most common lexical false
// positive. Two models, no $transaction in sight, and entirely correct:
// the transaction is the caller's.
export async function recordTwoThings(db: any, userId: string) {
  await db.user.update({ where: { id: userId }, data: { isFlagged: true } });
  await db.auditLog.create({ data: { userId, action: 'FLAGGED' } });
}

// One model written twice is not a cross-model boundary.
export async function bumpTwice(a: string, b: string) {
  await prisma.user.update({ where: { id: a }, data: { completedRides: { increment: 1 } } });
  await prisma.user.update({ where: { id: b }, data: { completedRides: { increment: 1 } } });
}
