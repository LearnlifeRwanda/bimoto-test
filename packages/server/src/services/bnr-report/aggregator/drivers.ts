import type { PrismaClient } from '@prisma/client';
import type { DriverMetricsSection, ReportPeriod } from '../types';

export async function aggregate(
  period: ReportPeriod,
  prisma: PrismaClient,
): Promise<DriverMetricsSection> {
  const window = { gte: period.startUtc, lt: period.endUtc };

  const completed = await prisma.journey.findMany({
    where: { status: 'COMPLETED', endedAt: window },
    select: { driverId: true },
  });
  const totalRidesCompleted = completed.length;
  const driverIds = new Set<string>();
  for (const j of completed) {
    if (j.driverId) driverIds.add(j.driverId);
  }
  const activeDrivers = driverIds.size;

  const paidBatches = await prisma.driverPayoutBatch.findMany({
    where: { status: 'SUCCESS', paidOutAt: window },
    select: { amount: true },
  });
  const totalPayoutsRwf = paidBatches.reduce((s, b) => s + b.amount, 0);
  const payoutBatchCount = paidBatches.length;

  const cancellationCount = await prisma.journey.count({
    where: { status: 'CANCELLED', updatedAt: window },
  });

  const averageRidesPerDriver =
    activeDrivers > 0 ? totalRidesCompleted / activeDrivers : 0;

  return {
    activeDrivers,
    totalRidesCompleted,
    totalPayoutsRwf,
    payoutBatchCount,
    averageRidesPerDriver,
    cancellationCount,
  };
}
