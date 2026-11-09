// SERVICES/MOBILITY/STORE.TS
//
// Architectural discipline: this file exports WRITE-ONLY operations on
// MobilityAggregate. Reads of MobilityAggregate happen ONLY in the admin
// viewer route (routes/admin-mobility.routes.ts) and any future
// intelligence-product endpoints.
//
// Operational services (payment, journey, bid, sms-inbound, etc.)
// MUST NOT import this file. There is no operational reason to read
// mobility aggregates from inside operational code paths. If you're
// tempted to do so, talk to a co-founder first.
//
// The MobilityAggregate table itself has no foreign keys back to
// operational data. Once aggregated, individual journey identities are
// architecturally unrecoverable.

import type { PrismaClient, Prisma } from '@prisma/client';
import type { AggregateRow } from './types';

export async function bulkInsertAggregates(
  prisma: PrismaClient,
  rows: AggregateRow[],
): Promise<{ inserted: number; conflicts: number }> {
  if (rows.length === 0) return { inserted: 0, conflicts: 0 };
  const data = rows.map((r) => ({
    tier: r.tier,
    aggregateType: r.aggregateType,
    cellId: r.cellId,
    cellCenterLat: r.cellCenterLat,
    cellCenterLng: r.cellCenterLng,
    bucketStart: r.bucketStart,
    bucketEnd: r.bucketEnd,
    count: r.count,
    // cast-kept: a nullable Json column's typed input is
    // NullableJsonNullValueInput | InputJsonValue, which cannot express a bare
    // `null`. Substituting Prisma.JsonNull/DbNull here would change what is
    // written to the column, so the value is preserved and only its type is cast.
    attributesJson: (r.attributesJson ?? null) as Prisma.InputJsonValue,
  }));
  const result = await prisma.mobilityAggregate.createMany({
    data,
    skipDuplicates: true,
  });
  const inserted = (result?.count as number) ?? 0;
  return { inserted, conflicts: rows.length - inserted };
}

export async function deleteOlderThanForRetention(
  prisma: PrismaClient,
  cutoffUtc: Date,
): Promise<{ deleted: number }> {
  const result = await prisma.mobilityAggregate.deleteMany({
    where: { bucketStart: { lt: cutoffUtc } },
  });
  return { deleted: (result?.count as number) ?? 0 };
}
