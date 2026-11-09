import prisma from '../../../prisma';
import { recordFlag } from '../flag-store';
import { BURST_THRESHOLD, BURST_SPEND_RWF, SILENCE_DAYS } from '../thresholds';

/**
 * Burst-followed-by-silence: a 48h window with >= BURST_THRESHOLD rides AND
 * >= BURST_SPEND_RWF cumulative spend, then >= SILENCE_DAYS of inactivity.
 * The high-spend AND-clause excludes tourist-pattern bursts.
 *
 * Lookback is capped at 60 days. Implementation: pull each user's recent
 * journeys + escrow.amount; slide a 48h window per user; if a window trips
 * AND the user has been silent for SILENCE_DAYS since the burst's end, flag.
 */
export async function detect(now: Date = new Date()): Promise<number> {
  const lookbackStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const silenceCutoff = new Date(now.getTime() - SILENCE_DAYS * 24 * 60 * 60 * 1000);

  // Find users who have been silent (no journeys) since silenceCutoff but had
  // activity earlier in the lookback window. groupBy customerId for efficiency.
  const recentlyActive = await prisma.journey.groupBy({
    by: ['customerId'],
    where: { createdAt: { gte: silenceCutoff } },
  });
  const recentlyActiveSet = new Set(recentlyActive.map((g) => g.customerId));

  const earlierActive = await prisma.journey.groupBy({
    by: ['customerId'],
    where: { createdAt: { gte: lookbackStart, lt: silenceCutoff } },
  });

  let recorded = 0;
  for (const g of earlierActive) {
    if (recentlyActiveSet.has(g.customerId)) continue; // not silent — skip

    const journeys = await prisma.journey.findMany({
      where: { customerId: g.customerId, createdAt: { gte: lookbackStart, lt: silenceCutoff } },
      select: { id: true, createdAt: true, escrow: { select: { amount: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (journeys.length < BURST_THRESHOLD) continue;

    // Sliding 48h window over journeys.
    const windowMs = 48 * 60 * 60 * 1000;
    let burstFound: { count: number; spend: number; endAt: Date } | null = null;
    for (let i = 0; i < journeys.length; i++) {
      const start = journeys[i].createdAt.getTime();
      let count = 0;
      let spend = 0;
      let endAt = journeys[i].createdAt;
      for (let j = i; j < journeys.length; j++) {
        if (journeys[j].createdAt.getTime() - start > windowMs) break;
        count += 1;
        spend += journeys[j].escrow?.amount ?? 0;
        endAt = journeys[j].createdAt;
      }
      if (count >= BURST_THRESHOLD && spend >= BURST_SPEND_RWF) {
        burstFound = { count, spend, endAt };
        break;
      }
    }
    if (!burstFound) continue;

    await recordFlag({
      userId: g.customerId,
      type: 'BURST_SILENCE',
      severity: 'HIGH',
      metadata: {
        burstCount: burstFound.count,
        burstSpend: burstFound.spend,
        burstEndedAt: burstFound.endAt.toISOString(),
        silenceDays: Math.floor((now.getTime() - burstFound.endAt.getTime()) / 86_400_000),
        thresholdRides: BURST_THRESHOLD,
        thresholdSpend: BURST_SPEND_RWF,
      },
    });
    recorded += 1;
  }
  return recorded;
}
