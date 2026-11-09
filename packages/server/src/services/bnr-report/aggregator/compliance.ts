import type { PrismaClient } from '@prisma/client';
import { ATTESTATIONS } from '../config';
import type { ComplianceSection, ReportPeriod } from '../types';

export async function aggregate(
  period: ReportPeriod,
  prisma: PrismaClient,
): Promise<ComplianceSection> {
  const window = { gte: period.startUtc, lt: period.endUtc };

  const lastEntry = await prisma.escrowAuditLog.findFirst({
    where: { createdAt: window },
    orderBy: { createdAt: 'desc' },
    select: { entryHash: true },
  });
  const hashChainEntries = await prisma.escrowAuditLog.count({
    where: { createdAt: window },
  });

  return {
    reportPeriod: period.label,
    generatedAt: new Date().toISOString(),
    hashChainHead: lastEntry?.entryHash ?? null,
    hashChainEntries,
    attestations: ATTESTATIONS,
  };
}
