import type { PrismaClient } from '@prisma/client';
import * as transactions from './transactions';
import * as disputes from './disputes';
import * as amlFlags from './aml-flags';
import * as users from './users';
import * as drivers from './drivers';
import * as compliance from './compliance';
import type { ReportData, ReportPeriod } from '../types';

export async function aggregateAll(
  period: ReportPeriod,
  prisma: PrismaClient,
): Promise<ReportData> {
  const [
    transactionsSection,
    disputesSection,
    amlFlagsSection,
    userGrowthSection,
    driverMetricsSection,
    complianceSection,
  ] = await Promise.all([
    transactions.aggregate(period, prisma),
    disputes.aggregate(period, prisma),
    amlFlags.aggregate(period, prisma),
    users.aggregate(period, prisma),
    drivers.aggregate(period, prisma),
    compliance.aggregate(period, prisma),
  ]);

  return {
    period,
    transactions: transactionsSection,
    disputes: disputesSection,
    amlFlags: amlFlagsSection,
    userGrowth: userGrowthSection,
    driverMetrics: driverMetricsSection,
    compliance: complianceSection,
  };
}
