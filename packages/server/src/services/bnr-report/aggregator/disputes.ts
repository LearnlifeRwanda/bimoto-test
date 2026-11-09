import type { PrismaClient } from '@prisma/client';
import type { DisputesSection, ReportPeriod } from '../types';

export async function aggregate(
  period: ReportPeriod,
  prisma: PrismaClient,
): Promise<DisputesSection> {
  const opened = await prisma.journey.findMany({
    where: {
      reconciliationOpenedAt: { gte: period.startUtc, lt: period.endUtc },
    },
    select: { id: true, reconciliationOpenedAt: true },
  });
  const openedCount = opened.length;

  const responses = await prisma.journeyReconciliationResponse.findMany({
    where: { createdAt: { gte: period.startUtc, lt: period.endUtc } },
    select: { journeyId: true, response: true, createdAt: true },
  });
  const resolvedCount = responses.length;

  const outcomeCounts = new Map<string, number>();
  for (const r of responses) {
    outcomeCounts.set(r.response, (outcomeCounts.get(r.response) ?? 0) + 1);
  }
  const byOutcome = Array.from(outcomeCounts, ([outcome, count]) => ({ outcome, count }));

  const openedById = new Map(
    opened.map((j) => [j.id, j.reconciliationOpenedAt as Date | null]),
  );
  const durationsHours: number[] = [];
  for (const r of responses) {
    const startedAt = openedById.get(r.journeyId);
    if (startedAt) {
      durationsHours.push((r.createdAt.getTime() - startedAt.getTime()) / 3_600_000);
    }
  }
  const averageResolutionHours =
    durationsHours.length > 0
      ? durationsHours.reduce((s, v) => s + v, 0) / durationsHours.length
      : null;

  const outstandingCount = await prisma.journey.count({
    where: { status: 'DISPUTED', reconciliationOpenedAt: { lt: period.endUtc } },
  });

  return {
    openedCount,
    resolvedCount,
    outstandingCount,
    averageResolutionHours,
    byOutcome,
  };
}
