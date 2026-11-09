import prisma from '../../../prisma';
import { recordFlag } from '../flag-store';
import {
  NEW_ACCOUNT_RIDES_THRESHOLD,
  NEW_ACCOUNT_AGE_DAYS,
  NEW_ACCOUNT_HIGH_VALUE_RWF,
} from '../thresholds';

/**
 * New-account high-value: high-amount escrow tied to a customer who is fresh
 * by EITHER ride-count (completedRides < N) OR account age (createdAt < D days
 * ago). The OR catches tourists-immediately-using as well as ride-count-low.
 */
export async function detect(now: Date = new Date()): Promise<number> {
  const ageCutoff = new Date(now.getTime() - NEW_ACCOUNT_AGE_DAYS * 24 * 60 * 60 * 1000);
  // Limit lookback to last 24h of escrows so we don't re-scan history.
  const escrowCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const candidates = await prisma.escrow.findMany({
    where: {
      createdAt: { gte: escrowCutoff },
      amount: { gt: NEW_ACCOUNT_HIGH_VALUE_RWF },
    },
    select: {
      id: true,
      amount: true,
      customerId: true,
      journeyId: true,
      customer: { select: { completedRides: true, createdAt: true } },
    },
  });

  let recorded = 0;
  for (const e of candidates) {
    const c = e.customer;
    if (!c) continue;
    const lowRides = (c.completedRides ?? 0) < NEW_ACCOUNT_RIDES_THRESHOLD;
    const youngAccount = c.createdAt.getTime() > ageCutoff.getTime();
    if (!lowRides && !youngAccount) continue;

    await recordFlag({
      userId: e.customerId,
      journeyId: e.journeyId,
      escrowId: e.id,
      type: 'NEW_ACCOUNT_HIGH_VALUE',
      severity: 'MEDIUM',
      metadata: {
        amount: e.amount,
        completedRides: c.completedRides,
        accountAgeDays: Math.floor((now.getTime() - c.createdAt.getTime()) / 86_400_000),
        triggerClause: lowRides && youngAccount ? 'both' : lowRides ? 'rides' : 'age',
      },
    });
    recorded += 1;
  }
  return recorded;
}
