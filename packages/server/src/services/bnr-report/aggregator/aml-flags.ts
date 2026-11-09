import type { PrismaClient } from '@prisma/client';
import type { AmlFlagsSection, AmlSeverityCode, ReportPeriod } from '../types';

const ALL_SEVERITIES: AmlSeverityCode[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export async function aggregate(
  period: ReportPeriod,
  prisma: PrismaClient,
): Promise<AmlFlagsSection> {
  const window = { gte: period.startUtc, lt: period.endUtc };

  const flags = await prisma.amlFlag.findMany({
    where: { detectedAt: window },
    select: { type: true, severity: true, status: true, resolvedAt: true },
  });

  const totalCount = flags.length;

  const sevCounts = new Map<AmlSeverityCode, number>();
  for (const s of ALL_SEVERITIES) sevCounts.set(s, 0);
  for (const f of flags) {
    sevCounts.set(f.severity as AmlSeverityCode, (sevCounts.get(f.severity as AmlSeverityCode) ?? 0) + 1);
  }
  const bySeverity = ALL_SEVERITIES.map((severity) => ({
    severity,
    count: sevCounts.get(severity) ?? 0,
  }));

  const typeCounts = new Map<string, { count: number; criticalCount: number }>();
  for (const f of flags) {
    const cur = typeCounts.get(f.type) ?? { count: 0, criticalCount: 0 };
    cur.count += 1;
    if (f.severity === 'CRITICAL') cur.criticalCount += 1;
    typeCounts.set(f.type, cur);
  }
  const byType = Array.from(typeCounts, ([type, { count, criticalCount }]) => ({
    type,
    count,
    criticalCount,
  }));

  const flaggedUsers = await prisma.user.count({ where: { isFlagged: true } });

  const dismissedCount = await prisma.amlFlag.count({
    where: { status: 'DISMISSED', resolvedAt: window },
  });

  const pendingCount = await prisma.amlFlag.count({
    where: { status: 'OPEN', detectedAt: window },
  });

  return { totalCount, bySeverity, byType, flaggedUsers, dismissedCount, pendingCount };
}
