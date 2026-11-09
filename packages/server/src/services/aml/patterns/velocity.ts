import prisma from '../../../prisma';
import { recordFlag } from '../flag-store';
import { VELOCITY_HOURLY_THRESHOLD, VELOCITY_RETRY_EXCLUDE_MINUTES } from '../thresholds';

/**
 * Customer velocity (>N requests in 1h) EXCLUDING legitimate-retry chains
 * (a request within VELOCITY_RETRY_EXCLUDE_MINUTES of a CHARGE_FAILED audit
 * event for the same customer is treated as a MoMo-balance retry).
 */
export async function detect(now: Date = new Date()): Promise<number> {
  const oneHrAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const grouped = await prisma.journey.groupBy({
    by: ['customerId'],
    where: { createdAt: { gte: oneHrAgo } },
    _count: { _all: true },
  });

  let recorded = 0;
  for (const g of grouped) {
    if (g._count._all <= VELOCITY_HOURLY_THRESHOLD) continue;

    // Pull the customer's recent journeys + recent CHARGE_FAILED audits;
    // exclude journeys within RETRY_EXCLUDE_MINUTES *after* a failure.
    const recentJourneys = await prisma.journey.findMany({
      where: { customerId: g.customerId, createdAt: { gte: oneHrAgo } },
      select: { id: true, createdAt: true },
    });
    const failureAudits = await prisma.escrowAuditLog.findMany({
      where: {
        action: 'CHARGE_FAILED',
        createdAt: { gte: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
        escrow: { customerId: g.customerId },
      },
      select: { createdAt: true },
    });
    const failureWindowMs = VELOCITY_RETRY_EXCLUDE_MINUTES * 60 * 1000;
    const adjusted = recentJourneys.filter((j) => {
      const t = j.createdAt.getTime();
      return !failureAudits.some((f) => {
        const fT = f.createdAt.getTime();
        return t >= fT && t <= fT + failureWindowMs;
      });
    });

    if (adjusted.length <= VELOCITY_HOURLY_THRESHOLD) continue;

    await recordFlag({
      userId: g.customerId,
      type: 'VELOCITY_EXCEEDED',
      severity: 'MEDIUM',
      metadata: {
        rawCount: g._count._all,
        adjustedCount: adjusted.length,
        excludedRetries: g._count._all - adjusted.length,
        threshold: VELOCITY_HOURLY_THRESHOLD,
      },
    });
    recorded += 1;
  }
  return recorded;
}
