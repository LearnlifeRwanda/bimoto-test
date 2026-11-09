import type { BnrReport, BnrReportStatus } from '@prisma/client';
import prisma from '../../../prisma';

export async function createReport(
  period: string,
  generatedBy: string | undefined,
): Promise<BnrReport> {
  return prisma.bnrReport.create({
    data: { period, status: 'PENDING', generatedBy: generatedBy ?? null },
  });
}

export async function markGenerating(id: string): Promise<void> {
  await prisma.bnrReport.update({
    where: { id },
    data: { status: 'GENERATING' },
  });
}

export async function markCompleted(
  id: string,
  pdfPath: string,
  pdfBytes: number,
  csvPath: string,
  csvBytes: number,
): Promise<void> {
  await prisma.bnrReport.update({
    where: { id },
    data: {
      status: 'COMPLETED',
      generatedAt: new Date(),
      pdfPath,
      pdfBytes,
      csvPath,
      csvBytes,
      errorMessage: null,
    },
  });
}

export async function markFailed(id: string, errorMessage: string): Promise<void> {
  await prisma.bnrReport.update({
    where: { id },
    data: { status: 'FAILED', errorMessage },
  });
}

export async function findByPeriod(period: string): Promise<BnrReport | null> {
  return prisma.bnrReport.findFirst({
    where: { period, status: 'COMPLETED' },
    orderBy: { generatedAt: 'desc' },
  });
}

export async function listReports(opts: {
  limit?: number;
  status?: BnrReportStatus;
}): Promise<BnrReport[]> {
  return prisma.bnrReport.findMany({
    where: opts.status ? { status: opts.status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 50,
  });
}

export async function findById(id: string): Promise<BnrReport | null> {
  return prisma.bnrReport.findUnique({ where: { id } });
}

export async function deleteOlderThan(cutoffDate: Date): Promise<number> {
  const result = await prisma.bnrReport.deleteMany({
    where: { createdAt: { lt: cutoffDate } },
  });
  return result.count;
}
