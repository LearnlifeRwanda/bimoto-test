import type { PrismaClient } from '@prisma/client';
import type { ReportPeriod, UserGrowthSection } from '../types';

export async function aggregate(
  period: ReportPeriod,
  prisma: PrismaClient,
): Promise<UserGrowthSection> {
  const window = { gte: period.startUtc, lt: period.endUtc };

  const totalUsers = await prisma.user.count({
    where: { createdAt: { lt: period.endUtc } },
  });
  const newUsersInPeriod = await prisma.user.count({ where: { createdAt: window } });

  const totalsByRole = await prisma.user.groupBy({
    by: ['role'],
    where: { createdAt: { lt: period.endUtc } },
    _count: { _all: true },
  });
  const newByRole = await prisma.user.groupBy({
    by: ['role'],
    where: { createdAt: window },
    _count: { _all: true },
  });
  const newMap = new Map(newByRole.map((r) => [r.role, r._count._all]));
  const byRole = totalsByRole.map((r) => ({
    role: r.role,
    total: r._count._all,
    new: newMap.get(r.role) ?? 0,
  }));

  const activeRows = await prisma.journey.findMany({
    where: { createdAt: window },
    select: { customerId: true },
    distinct: ['customerId'],
  });

  return {
    totalUsers,
    newUsersInPeriod,
    byRole,
    activeUsers: activeRows.length,
  };
}
