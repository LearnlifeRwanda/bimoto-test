import prisma from '../../../prisma';
import { recordFlag } from '../flag-store';
import {
  PAYOUT_CONCENTRATION_THRESHOLD,
  PAYOUT_CONCENTRATION_AMOUNT_RWF,
  PAYOUT_CONCENTRATION_AMOUNT_MIN_CUSTOMERS,
} from '../thresholds';

/**
 * Driver-payout concentration: many unique customer-sourced escrows in 1h
 * (pure-count) OR high cumulative amount from a meaningful number of unique
 * customers (laundering shape: high value + many sources).
 */
export async function detect(now: Date = new Date()): Promise<number> {
  const oneHrAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const escrows = await prisma.escrow.findMany({
    where: {
      createdAt: { gte: oneHrAgo },
      status: { in: ['HELD', 'RELEASED'] },
    },
    select: { driverId: true, customerId: true, driverPayout: true },
  });

  const byDriver = new Map<string, { customers: Set<string>; total: number }>();
  for (const e of escrows) {
    if (!e.driverId) continue;
    const slot = byDriver.get(e.driverId) ?? { customers: new Set(), total: 0 };
    slot.customers.add(e.customerId);
    slot.total += e.driverPayout ?? 0;
    byDriver.set(e.driverId, slot);
  }

  let recorded = 0;
  for (const [driverId, { customers, total }] of byDriver) {
    const uniqueCount = customers.size;
    const tripsPureCount = uniqueCount > PAYOUT_CONCENTRATION_THRESHOLD;
    const tripsAmountClause =
      total >= PAYOUT_CONCENTRATION_AMOUNT_RWF &&
      uniqueCount > PAYOUT_CONCENTRATION_AMOUNT_MIN_CUSTOMERS;

    if (!tripsPureCount && !tripsAmountClause) continue;

    await recordFlag({
      userId: driverId,
      type: 'PAYOUT_CONCENTRATION',
      severity: 'CRITICAL',
      metadata: {
        uniqueCustomers: uniqueCount,
        cumulativeAmount: total,
        triggerClause: tripsPureCount && tripsAmountClause ? 'both' : tripsPureCount ? 'count' : 'amount',
        thresholdCount: PAYOUT_CONCENTRATION_THRESHOLD,
        thresholdAmount: PAYOUT_CONCENTRATION_AMOUNT_RWF,
        thresholdAmountMinCustomers: PAYOUT_CONCENTRATION_AMOUNT_MIN_CUSTOMERS,
      },
    });
    recorded += 1;
  }
  return recorded;
}
