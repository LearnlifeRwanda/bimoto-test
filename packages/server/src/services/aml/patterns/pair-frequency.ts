import prisma from '../../../prisma';
import { recordFlag } from '../flag-store';
import { PAIR_FREQ_24H_THRESHOLD, PAIR_FREQ_7D_THRESHOLD } from '../thresholds';

/**
 * Same customer-driver pair high-frequency (collusion / self-dealing).
 * Trips on either >24h-window OR >7d-window threshold; records the
 * triggering window in metadata for admin context.
 */
export async function detect(now: Date = new Date()): Promise<number> {
  const twentyFourHrAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Group by (customerId, driverId) over 7d (broader window subsumes 24h).
  // We then bucket the per-pair counts by which window each rolled.
  const grouped = await prisma.journey.groupBy({
    by: ['customerId', 'driverId'],
    where: {
      driverId: { not: null },
      createdAt: { gte: sevenDaysAgo },
      status: { in: ['COMPLETED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'] },
    },
    _count: { _all: true },
  });

  let recorded = 0;
  for (const g of grouped) {
    const count7d = g._count._all;
    if (!g.driverId) continue;
    if (count7d <= PAIR_FREQ_24H_THRESHOLD && count7d <= PAIR_FREQ_7D_THRESHOLD) continue;

    // Re-count just the 24h slice for this pair (cheap targeted query).
    const count24h = await prisma.journey.count({
      where: {
        customerId: g.customerId,
        driverId: g.driverId,
        createdAt: { gte: twentyFourHrAgo },
        status: { in: ['COMPLETED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'] },
      },
    });

    const trips24h = count24h > PAIR_FREQ_24H_THRESHOLD;
    const trips7d = count7d > PAIR_FREQ_7D_THRESHOLD;
    if (!trips24h && !trips7d) continue;

    const triggerWindow = trips24h && trips7d ? 'both' : trips24h ? '24h' : '7d';
    await recordFlag({
      userId: g.customerId,
      type: 'PAIR_FREQUENCY',
      severity: 'HIGH',
      metadata: {
        driverId: g.driverId,
        count24h,
        count7d,
        triggerWindow,
        threshold24h: PAIR_FREQ_24H_THRESHOLD,
        threshold7d: PAIR_FREQ_7D_THRESHOLD,
      },
    });
    recorded += 1;
  }
  return recorded;
}
