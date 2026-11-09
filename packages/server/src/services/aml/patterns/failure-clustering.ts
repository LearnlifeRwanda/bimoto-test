import prisma from '../../../prisma';
import { recordFlag } from '../flag-store';
import { FAILURE_CLUSTER_THRESHOLD } from '../thresholds';

/**
 * Flutterwave failure clustering: > N CHARGE_FAILED audit events for a single
 * customer in any 1h window in the last 24h. Often a real MoMo balance issue
 * — LOW severity is enough for ops to review without urgency.
 */
export async function detect(now: Date = new Date()): Promise<number> {
  const lookback = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const failures = await prisma.escrowAuditLog.findMany({
    where: { action: 'CHARGE_FAILED', createdAt: { gte: lookback } },
    select: {
      createdAt: true,
      escrow: { select: { customerId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const byCustomer = new Map<string, Date[]>();
  for (const f of failures) {
    const cid = f.escrow?.customerId;
    if (!cid) continue;
    const arr = byCustomer.get(cid) ?? [];
    arr.push(f.createdAt);
    byCustomer.set(cid, arr);
  }

  const windowMs = 60 * 60 * 1000;
  let recorded = 0;
  for (const [customerId, times] of byCustomer) {
    if (times.length <= FAILURE_CLUSTER_THRESHOLD) continue;
    let tripped = false;
    let peakCount = 0;
    for (let i = 0; i < times.length; i++) {
      let count = 0;
      for (let j = i; j < times.length; j++) {
        if (times[j].getTime() - times[i].getTime() > windowMs) break;
        count += 1;
      }
      if (count > peakCount) peakCount = count;
      if (count > FAILURE_CLUSTER_THRESHOLD) tripped = true;
    }
    if (!tripped) continue;
    await recordFlag({
      userId: customerId,
      type: 'FAILURE_CLUSTERING',
      severity: 'LOW',
      metadata: {
        peakCountIn1h: peakCount,
        totalFailuresIn24h: times.length,
        threshold: FAILURE_CLUSTER_THRESHOLD,
      },
    });
    recorded += 1;
  }
  return recorded;
}
