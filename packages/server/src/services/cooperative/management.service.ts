// Dispatch M — operational management. Approve / reject driver
// applications, set active flag, add / remove drivers from the
// cooperative. Every mutation:
//   1. Asserts the driver is in the leader's cooperative
//      (defence-in-depth even though the route layer also gates).
//   2. Runs inside a single transaction with appendAdminActionTx so
//      the audit hash chain stays intact even if the underlying
//      driver mutation fails midway.
//   3. Uses action='COOPERATIVE_LEADER_ACTION' on the AdminAction row
//      with payload encoding the specific subaction.

import type { PrismaClient, DriverProfile } from '@prisma/client';
import { appendAdminActionTx } from '../admin/admin-action-audit.service';
import { assertDriverApprovable } from '../driver-verification.service';
import { AuthorizationError } from './scope';
import { COOPERATIVE_REASON_MIN_LENGTH } from './config';

export interface ManagementContext {
  leaderUserId: string;
  cooperativeId: string;
  driverProfileId: string;
  reason?: string;
}

async function assertScopeInTx(
  tx: any,
  driverProfileId: string,
  cooperativeId: string,
): Promise<any> {
  const profile = await tx.driverProfile.findUnique({
    where: { id: driverProfileId },
  });
  if (!profile || profile.cooperativeId !== cooperativeId) {
    throw new AuthorizationError('driver-not-in-cooperative');
  }
  return profile;
}

export async function approveDriver(
  prisma: PrismaClient,
  ctx: ManagementContext,
): Promise<DriverProfile> {
  const reason = (ctx.reason ?? '').trim() || 'cooperative-leader-approval';
  return prisma.$transaction(async (tx: any) => {
    const profile = await assertScopeInTx(tx, ctx.driverProfileId, ctx.cooperativeId);
    // DRIVER-ID v3 — same approval gate as the admin route: person
    // identifier mandatory, plate per the vehicle-compliance matrix, no
    // direct REVOKED -> VERIFIED.
    assertDriverApprovable(profile);
    const updated = await tx.driverProfile.update({
      where: { id: ctx.driverProfileId },
      data: {
        verificationStatus: 'VERIFIED',
        verifiedAt: new Date(),
        rejectionReason: null,
      },
    });
    await appendAdminActionTx(tx, {
      adminId: ctx.leaderUserId,
      action: 'COOPERATIVE_LEADER_ACTION',
      targetType: 'DRIVER_PROFILE',
      targetId: ctx.driverProfileId,
      reason,
      payload: { subaction: 'APPROVE', cooperativeId: ctx.cooperativeId },
    });
    return updated;
  });
}

export async function rejectDriver(
  prisma: PrismaClient,
  ctx: ManagementContext,
): Promise<DriverProfile> {
  const reason = (ctx.reason ?? '').trim();
  if (reason.length < COOPERATIVE_REASON_MIN_LENGTH) {
    const err: any = new Error('REASON_TOO_SHORT');
    err.code = 'REASON_TOO_SHORT';
    throw err;
  }
  return prisma.$transaction(async (tx: any) => {
    await assertScopeInTx(tx, ctx.driverProfileId, ctx.cooperativeId);
    const updated = await tx.driverProfile.update({
      where: { id: ctx.driverProfileId },
      data: { verificationStatus: 'REJECTED', rejectionReason: reason },
    });
    await appendAdminActionTx(tx, {
      adminId: ctx.leaderUserId,
      action: 'COOPERATIVE_LEADER_ACTION',
      targetType: 'DRIVER_PROFILE',
      targetId: ctx.driverProfileId,
      reason,
      payload: { subaction: 'REJECT', cooperativeId: ctx.cooperativeId },
    });
    return updated;
  });
}

export async function setDriverActive(
  prisma: PrismaClient,
  ctx: ManagementContext & { active: boolean },
): Promise<DriverProfile> {
  const reason = (ctx.reason ?? '').trim() || `set-active-${ctx.active}`;
  return prisma.$transaction(async (tx: any) => {
    await assertScopeInTx(tx, ctx.driverProfileId, ctx.cooperativeId);
    const updated = await tx.driverProfile.update({
      where: { id: ctx.driverProfileId },
      data: { active: ctx.active },
    });
    await appendAdminActionTx(tx, {
      adminId: ctx.leaderUserId,
      action: 'COOPERATIVE_LEADER_ACTION',
      targetType: 'DRIVER_PROFILE',
      targetId: ctx.driverProfileId,
      reason,
      payload: {
        subaction: 'SET_ACTIVE',
        active: ctx.active,
        cooperativeId: ctx.cooperativeId,
      },
    });
    return updated;
  });
}

/**
 * Sponsor an existing DriverProfile into the leader's cooperative.
 * Used when a leader vouches for a driver who registered on Bimoto
 * outside the cooperative flow.
 */
export async function addDriverToCooperativeViaLeader(
  prisma: PrismaClient,
  ctx: ManagementContext,
): Promise<DriverProfile> {
  const reason = (ctx.reason ?? '').trim() || 'cooperative-leader-sponsor';
  return prisma.$transaction(async (tx: any) => {
    const profile = await tx.driverProfile.findUnique({
      where: { id: ctx.driverProfileId },
    });
    if (!profile) {
      throw new AuthorizationError('driver-not-found');
    }
    if (profile.cooperativeId && profile.cooperativeId !== ctx.cooperativeId) {
      const err: any = new Error('DRIVER_ALREADY_IN_OTHER_COOPERATIVE');
      err.code = 'DRIVER_ALREADY_IN_OTHER_COOPERATIVE';
      throw err;
    }
    const cooperative = await tx.cooperative.findUnique({
      where: { id: ctx.cooperativeId },
    });
    if (!cooperative) {
      throw new AuthorizationError('cooperative-not-found');
    }
    const updated = await tx.driverProfile.update({
      where: { id: ctx.driverProfileId },
      data: {
        cooperativeId: ctx.cooperativeId,
        cooperativeName: cooperative.name,
      },
    });
    await appendAdminActionTx(tx, {
      adminId: ctx.leaderUserId,
      action: 'COOPERATIVE_LEADER_ACTION',
      targetType: 'DRIVER_PROFILE',
      targetId: ctx.driverProfileId,
      reason,
      payload: {
        subaction: 'ADD_TO_COOPERATIVE',
        cooperativeId: ctx.cooperativeId,
      },
    });
    return updated;
  });
}

export async function removeDriverFromCooperativeViaLeader(
  prisma: PrismaClient,
  ctx: ManagementContext,
): Promise<DriverProfile> {
  const reason = (ctx.reason ?? '').trim();
  if (reason.length < COOPERATIVE_REASON_MIN_LENGTH) {
    const err: any = new Error('REASON_TOO_SHORT');
    err.code = 'REASON_TOO_SHORT';
    throw err;
  }
  return prisma.$transaction(async (tx: any) => {
    await assertScopeInTx(tx, ctx.driverProfileId, ctx.cooperativeId);
    const updated = await tx.driverProfile.update({
      where: { id: ctx.driverProfileId },
      data: { cooperativeId: null, cooperativeName: null },
    });
    await appendAdminActionTx(tx, {
      adminId: ctx.leaderUserId,
      action: 'COOPERATIVE_LEADER_ACTION',
      targetType: 'DRIVER_PROFILE',
      targetId: ctx.driverProfileId,
      reason,
      payload: {
        subaction: 'REMOVE_FROM_COOPERATIVE',
        previousCooperativeId: ctx.cooperativeId,
      },
    });
    return updated;
  });
}
