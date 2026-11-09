// LAUNCH-TRUTH G2 — fee-waiver grant / extend / revoke service.
//
// Every mutation runs inside one Prisma transaction with its
// hash-chained AdminAction row (same discipline as the freeze flow):
// a waiver is an incentive, incentives get farmed, and the audit data
// must exist for a future detector even though none is built here.
//
// getActiveWaiver is the single truth about "is this driver waived
// right now" — nothing else may re-implement the predicate. Revocation
// is forward-only: rides already waived stay waived; a driver is never
// re-billed.

import type { FeeWaiver, FeeWaiverType } from '@prisma/client';
import prisma from '../../prisma';
import { AppError } from '../../middleware/error-handler';
import { appendAdminActionTx } from '../admin/admin-action-audit.service';
import {
  FEE_WAIVER_LIFETIME_MAX,
  FEE_WAIVER_TEMPORARY_MAX,
  FEE_WAIVER_TEMPORARY_MONTHS,
  FEE_WAIVER_TEMPORARY_MAX_TOTAL_MONTHS,
} from './config';

export interface GrantFeeWaiverArgs {
  driverId: string;
  type: FeeWaiverType;
  campaign: string;
  adminId: string;
  reason: string;
}

export interface ExtendFeeWaiverArgs {
  waiverId: string;
  months: number;
  adminId: string;
  reason: string;
}

export interface RevokeFeeWaiverArgs {
  waiverId: string;
  adminId: string;
  reason: string;
}

export interface CampaignCounters {
  lifetimeUsed: number;
  lifetimeMax: number;
  temporaryUsed: number;
  temporaryMax: number;
}

function addMonths(base: Date, months: number): Date {
  const d = new Date(base);
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * The one truth about "is this driver waived right now": the waiver
 * must be non-revoked AND either LIFETIME (expiresAt null) or not yet
 * expired at `at`.
 */
export async function getActiveWaiver(
  driverId: string,
  at: Date = new Date(),
): Promise<FeeWaiver | null> {
  return prisma.feeWaiver.findFirst({
    where: {
      driverId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
    },
  });
}

/**
 * Batch variant of the same predicate for per-bid lists (one query for
 * N drivers instead of N). Lives here so the "is waived right now"
 * rule has exactly one home.
 */
export async function getActiveWaiversForDrivers(
  driverIds: string[],
  at: Date = new Date(),
): Promise<Map<string, FeeWaiver>> {
  if (driverIds.length === 0) return new Map();
  const waivers = await prisma.feeWaiver.findMany({
    where: {
      driverId: { in: driverIds },
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
    },
  });
  return new Map(waivers.map((w: FeeWaiver) => [w.driverId, w]));
}

/** Non-revoked grants consumed per instrument, against their caps. */
export async function getCampaignCounters(): Promise<CampaignCounters> {
  const [lifetimeUsed, temporaryUsed] = await Promise.all([
    prisma.feeWaiver.count({ where: { type: 'LIFETIME', revokedAt: null } }),
    prisma.feeWaiver.count({ where: { type: 'TEMPORARY', revokedAt: null } }),
  ]);
  return {
    lifetimeUsed,
    lifetimeMax: FEE_WAIVER_LIFETIME_MAX,
    temporaryUsed,
    temporaryMax: FEE_WAIVER_TEMPORARY_MAX,
  };
}

export async function grantFeeWaiver(args: GrantFeeWaiverArgs): Promise<FeeWaiver> {
  const { driverId, type, campaign, adminId, reason } = args;

  const driver = await prisma.user.findUnique({ where: { id: driverId } });
  if (!driver) {
    throw new AppError(404, 'DRIVER_NOT_FOUND', 'errors.driverNotFound');
  }

  const grantTx = prisma.$transaction(async (tx: any) => {
    // BID-ATOMICITY G4 — the campaign cap below is count-then-create,
    // and READ COMMITTED does not serialize the counts: two grants
    // racing at cap-1 both count cap-1 and both create, breaching the
    // cap. A per-type transaction-scoped advisory lock serializes grant
    // transactions of the same instrument, so the count each grant sees
    // includes every earlier grant. (A cap over a COUNT cannot be a
    // table constraint, so the lock is the enforcement; the per-driver
    // partial unique index below remains the driver-level backstop.)
    // Skipped under unit-test mocks without $queryRaw — behaviour there
    // is the sequential behaviour, unchanged.
    if (typeof tx.$queryRaw === 'function') {
      const lockKey = `fee-waiver-grant:${type}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS locked`;
    }

    // At most one non-revoked waiver per driver (the partial unique
    // index backs this; the check gives a clean 409 instead of a raw
    // constraint violation). An expired-but-unrevoked waiver also
    // blocks: revoke it first so the record shows the succession.
    const existing = await tx.feeWaiver.findFirst({
      where: { driverId, revokedAt: null },
    });
    if (existing) {
      const stillLive =
        existing.expiresAt === null || existing.expiresAt.getTime() > Date.now();
      throw new AppError(
        409,
        stillLive ? 'WAIVER_ALREADY_ACTIVE' : 'WAIVER_EXISTS_UNREVOKED',
        'errors.waiverAlreadyExists',
      );
    }

    // Campaign caps — counted over non-revoked grants, enforced
    // server-side only (never in the UI).
    const used = await tx.feeWaiver.count({
      where: { type, revokedAt: null },
    });
    const cap = type === 'LIFETIME' ? FEE_WAIVER_LIFETIME_MAX : FEE_WAIVER_TEMPORARY_MAX;
    if (used >= cap) {
      throw new AppError(
        409,
        type === 'LIFETIME' ? 'LIFETIME_CAP_REACHED' : 'TEMPORARY_CAP_REACHED',
        'errors.waiverCapReached',
        { used, cap },
      );
    }

    const grantedAt = new Date();
    const expiresAt =
      type === 'LIFETIME' ? null : addMonths(grantedAt, FEE_WAIVER_TEMPORARY_MONTHS);

    const waiver = await tx.feeWaiver.create({
      data: {
        driverId,
        type,
        campaign,
        grantedAt,
        grantedBy: adminId,
        expiresAt,
        reason,
      },
    });

    await appendAdminActionTx(tx, {
      adminId,
      action: 'GRANT_FEE_WAIVER',
      targetType: 'USER',
      targetId: driverId,
      reason,
      payload: {
        waiverId: waiver.id,
        type,
        campaign,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      },
    });

    return waiver;
  });

  // BID-ATOMICITY G4 — #138 house style: a loser whose insert hits the
  // per-driver partial unique (FeeWaiver_one_nonrevoked_per_driver —
  // reachable when two DIFFERENT-type grants for one driver race, which
  // the per-type lock does not serialize) gets the same clean 409 the
  // sequential second grant gets, never a raw P2002 500.
  return grantTx.catch((err: any) => {
    if (err?.code === 'P2002') {
      throw new AppError(409, 'WAIVER_ALREADY_ACTIVE', 'errors.waiverAlreadyExists');
    }
    throw err;
  });
}

export async function extendFeeWaiver(args: ExtendFeeWaiverArgs): Promise<FeeWaiver> {
  const { waiverId, months, adminId, reason } = args;

  if (!Number.isInteger(months) || months < 1) {
    throw new AppError(400, 'INVALID_EXTENSION_MONTHS', 'errors.invalidExtensionMonths');
  }

  return prisma.$transaction(async (tx: any) => {
    const waiver = await tx.feeWaiver.findUnique({ where: { id: waiverId } });
    if (!waiver) {
      throw new AppError(404, 'WAIVER_NOT_FOUND', 'errors.waiverNotFound');
    }
    if (waiver.revokedAt) {
      throw new AppError(409, 'WAIVER_REVOKED', 'errors.waiverRevoked');
    }
    // A lifetime waiver never expires — there is nothing to extend.
    if (waiver.type === 'LIFETIME') {
      throw new AppError(422, 'CANNOT_EXTEND_LIFETIME', 'errors.cannotExtendLifetime');
    }

    const newExpiresAt = addMonths(waiver.expiresAt!, months);
    const ceiling = addMonths(waiver.grantedAt, FEE_WAIVER_TEMPORARY_MAX_TOTAL_MONTHS);
    if (newExpiresAt.getTime() > ceiling.getTime()) {
      throw new AppError(
        422,
        'EXTENSION_EXCEEDS_CEILING',
        'errors.extensionExceedsCeiling',
        { ceiling: ceiling.toISOString() },
      );
    }

    const updated = await tx.feeWaiver.update({
      where: { id: waiverId },
      data: {
        expiresAt: newExpiresAt,
        extensionCount: { increment: 1 },
      },
    });

    await appendAdminActionTx(tx, {
      adminId,
      action: 'EXTEND_FEE_WAIVER',
      targetType: 'USER',
      targetId: waiver.driverId,
      reason,
      payload: {
        waiverId,
        months,
        newExpiresAt: newExpiresAt.toISOString(),
      },
    });

    return updated;
  });
}

export async function revokeFeeWaiver(args: RevokeFeeWaiverArgs): Promise<FeeWaiver> {
  const { waiverId, adminId, reason } = args;

  return prisma.$transaction(async (tx: any) => {
    const waiver = await tx.feeWaiver.findUnique({ where: { id: waiverId } });
    if (!waiver) {
      throw new AppError(404, 'WAIVER_NOT_FOUND', 'errors.waiverNotFound');
    }
    if (waiver.revokedAt) {
      throw new AppError(409, 'WAIVER_ALREADY_REVOKED', 'errors.waiverAlreadyRevoked');
    }

    // Forward-only: rides already waived stay waived. Nothing here (or
    // anywhere) may re-bill an escrow whose commission was zeroed.
    const updated = await tx.feeWaiver.update({
      where: { id: waiverId },
      data: { revokedAt: new Date(), revokedBy: adminId },
    });

    await appendAdminActionTx(tx, {
      adminId,
      action: 'REVOKE_FEE_WAIVER',
      targetType: 'USER',
      targetId: waiver.driverId,
      reason,
      payload: { waiverId, type: waiver.type, campaign: waiver.campaign },
    });

    return updated;
  });
}

/** Admin listing — waivers newest-first with the driver's identity. */
export async function listFeeWaivers(limit = 100, driverId?: string) {
  return prisma.feeWaiver.findMany({
    where: driverId ? { driverId } : undefined,
    orderBy: { grantedAt: 'desc' },
    take: limit,
    include: {
      driver: { select: { id: true, nickname: true, phoneEncrypted: true } },
    },
  });
}
