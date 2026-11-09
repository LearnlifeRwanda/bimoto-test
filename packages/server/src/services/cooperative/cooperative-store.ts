// Dispatch M — Cooperative store. CRUD + leader assignment + driver
// association. Every write that touches both User and Cooperative
// (or DriverProfile and Cooperative) runs inside a transaction so we
// never leave a half-applied state — e.g. a User whose role flipped
// to COOPERATIVE_LEADER but whose cooperativeId is still null.
//
// On `setCooperativeLeader`: if the user is currently DRIVER, we
// promote them to BOTH (so they keep driver capability) AND attach
// the cooperativeLed relation. This decision keeps a leader who is
// also an active driver fully functional. ADMINs are not promoted —
// they remain ADMIN with an explicit cooperativeId scope.

import type { Cooperative, DriverProfile, PrismaClient } from '@prisma/client';

export interface CreateCooperativeInput {
  name: string;
  registrationNumber?: string;
  metadata?: Record<string, unknown>;
  commissionRate?: number;
  currency?: string;
}

export async function createCooperative(
  prisma: PrismaClient,
  input: CreateCooperativeInput,
): Promise<Cooperative> {
  return prisma.cooperative.create({
    data: {
      name: input.name,
      registrationNumber: input.registrationNumber,
      metadata: (input.metadata ?? {}) as any,
      commissionRate: input.commissionRate ?? 0.0,
      currency: input.currency ?? 'RWF',
    },
  });
}

export async function findCooperativeById(
  prisma: PrismaClient,
  id: string,
): Promise<Cooperative | null> {
  return prisma.cooperative.findUnique({ where: { id } });
}

export async function findCooperativeByName(
  prisma: PrismaClient,
  name: string,
): Promise<Cooperative | null> {
  return prisma.cooperative.findUnique({ where: { name } });
}

/**
 * Promote a User to COOPERATIVE_LEADER and attach them to a cooperative.
 * Runs in a transaction:
 *   1. Verify the user exists.
 *   2. Verify the cooperative exists.
 *   3. Set User.cooperativeId AND set role.
 *      - DRIVER  → BOTH (preserve driver capability)
 *      - BOTH    → BOTH (just set cooperativeId)
 *      - CUSTOMER → COOPERATIVE_LEADER
 *      - ADMIN   → ADMIN (admins keep their role; cooperativeId is set
 *                  for scope)
 *   4. Set Cooperative.leaderId.
 */
export async function setCooperativeLeader(
  prisma: PrismaClient,
  cooperativeId: string,
  userId: string,
): Promise<Cooperative> {
  return prisma.$transaction(async (tx: any) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) {
      const err: any = new Error('USER_NOT_FOUND');
      err.code = 'USER_NOT_FOUND';
      throw err;
    }

    const cooperative = await tx.cooperative.findUnique({
      where: { id: cooperativeId },
    });
    if (!cooperative) {
      const err: any = new Error('COOPERATIVE_NOT_FOUND');
      err.code = 'COOPERATIVE_NOT_FOUND';
      throw err;
    }

    let nextRole: string;
    switch (user.role) {
      case 'DRIVER':
        nextRole = 'BOTH';
        break;
      case 'BOTH':
        nextRole = 'BOTH';
        break;
      case 'ADMIN':
        nextRole = 'ADMIN';
        break;
      case 'COOPERATIVE_LEADER':
        nextRole = 'COOPERATIVE_LEADER';
        break;
      default:
        nextRole = 'COOPERATIVE_LEADER';
    }

    await tx.user.update({
      where: { id: userId },
      data: { role: nextRole, cooperativeId },
    });

    return tx.cooperative.update({
      where: { id: cooperativeId },
      data: { leaderId: userId },
    });
  });
}

/**
 * Attach a driver to a cooperative. Sets DriverProfile.cooperativeId
 * AND DriverProfile.cooperativeName (denormalised cache so existing
 * code paths that read cooperativeName keep working without a join).
 */
export async function addDriverToCooperative(
  prisma: PrismaClient,
  cooperativeId: string,
  driverProfileId: string,
): Promise<DriverProfile> {
  return prisma.$transaction(async (tx: any) => {
    const cooperative = await tx.cooperative.findUnique({
      where: { id: cooperativeId },
    });
    if (!cooperative) {
      const err: any = new Error('COOPERATIVE_NOT_FOUND');
      err.code = 'COOPERATIVE_NOT_FOUND';
      throw err;
    }

    const profile = await tx.driverProfile.findUnique({
      where: { id: driverProfileId },
    });
    if (!profile) {
      const err: any = new Error('DRIVER_PROFILE_NOT_FOUND');
      err.code = 'DRIVER_PROFILE_NOT_FOUND';
      throw err;
    }

    return tx.driverProfile.update({
      where: { id: driverProfileId },
      data: {
        cooperativeId,
        cooperativeName: cooperative.name,
      },
    });
  });
}

/**
 * Detach a driver from a cooperative. Clears both cooperativeId AND
 * the denormalised cooperativeName cache.
 */
export async function removeDriverFromCooperative(
  prisma: PrismaClient,
  driverProfileId: string,
): Promise<DriverProfile> {
  return prisma.driverProfile.update({
    where: { id: driverProfileId },
    data: { cooperativeId: null, cooperativeName: null },
  });
}

export async function listDriversInCooperative(
  prisma: PrismaClient,
  cooperativeId: string,
  opts: { limit: number; offset: number },
): Promise<DriverProfile[]> {
  return prisma.driverProfile.findMany({
    where: { cooperativeId },
    orderBy: { id: 'asc' },
    take: opts.limit,
    skip: opts.offset,
  });
}
