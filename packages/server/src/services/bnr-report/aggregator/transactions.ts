import type { PrismaClient } from '@prisma/client';
import {
  HARD_SINGLE_TX_RWF,
  SOFT_SINGLE_TX_RWF,
} from '../../aml/thresholds';
import type { ReportPeriod, TransactionsSection, TransactionTier } from '../types';

function tierFor(amount: number): TransactionTier {
  if (amount <= SOFT_SINGLE_TX_RWF) return 'micro';
  if (amount <= HARD_SINGLE_TX_RWF) return 'standard';
  return 'large';
}

export async function aggregate(
  period: ReportPeriod,
  prisma: PrismaClient,
): Promise<TransactionsSection> {
  const where = { createdAt: { gte: period.startUtc, lt: period.endUtc } };

  const journeys = await prisma.journey.findMany({
    where,
    select: { status: true, agreedPrice: true, escrow: { select: { amount: true, status: true } } },
  });

  const totalCount = journeys.length;
  let totalAmountRwf = 0;
  const tierBuckets: Record<TransactionTier, { count: number; amount: number }> = {
    micro: { count: 0, amount: 0 },
    standard: { count: 0, amount: 0 },
    large: { count: 0, amount: 0 },
  };
  let successCount = 0;
  let failedCount = 0;

  for (const j of journeys) {
    const amount = j.escrow?.amount ?? j.agreedPrice ?? 0;
    totalAmountRwf += amount;
    const t = tierFor(amount);
    tierBuckets[t].count += 1;
    tierBuckets[t].amount += amount;
    if (j.status === 'COMPLETED') successCount += 1;
    if (j.escrow?.status === 'FAILED') failedCount += 1;
  }

  const byTier = (Object.keys(tierBuckets) as TransactionTier[]).map((tier) => ({
    tier,
    count: tierBuckets[tier].count,
    amount: tierBuckets[tier].amount,
  }));

  const byPaymentMethod = [
    { method: 'FLUTTERWAVE', count: totalCount, amount: totalAmountRwf },
  ];

  return {
    totalCount,
    totalAmountRwf,
    byTier,
    byPaymentMethod,
    successRate: totalCount > 0 ? successCount / totalCount : 0,
    failedCount,
  };
}
