// Dispatch M — cooperative scope helpers. Defence-in-depth even when
// the route layer has already gated via requireCooperativeLeader.
// Every mutation that touches a driver MUST call
// assertDriverInCooperative (or assertUserDriverInCooperative) before
// writing — the smallest-wrongness gate is exactly this check.
//
// AuthorizationError is thrown (not AppError 404) so the calling
// route handler can decide whether to surface 404 (privacy) or 403
// (operator tooling).

import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';

export class AuthorizationError extends Error {
  constructor(public reason: string) {
    super(`AuthorizationError: ${reason}`);
  }
}

/**
 * Get the cooperativeId the current request is scoped to.
 * - For COOPERATIVE_LEADER: req.user.cooperativeId (set by middleware).
 * - For ADMIN: from ?cooperativeId=… or body.cooperativeId, falls
 *   back to the admin's own cooperativeId if any.
 * Returns null if neither is available.
 */
export function getRequestCooperativeId(req: Request): string | null {
  if (!req.user) return null;
  return (req.user.cooperativeId as string | null | undefined) ?? null;
}

/**
 * Verify a DriverProfile belongs to the given cooperative. Throws
 * AuthorizationError on mismatch or missing profile so callers can
 * map to 404 (preserves cross-cooperative privacy by not leaking
 * existence) or 403 as appropriate.
 */
export async function assertDriverInCooperative(
  prisma: PrismaClient,
  driverProfileId: string,
  cooperativeId: string,
): Promise<void> {
  const profile = await prisma.driverProfile.findUnique({
    where: { id: driverProfileId },
    select: { id: true, cooperativeId: true },
  });
  if (!profile || profile.cooperativeId !== cooperativeId) {
    throw new AuthorizationError('driver-not-in-cooperative');
  }
}

/**
 * Same as assertDriverInCooperative but accepts the User.id of a
 * driver (which is what bid.service.createBid takes). Used by the
 * dispatch service before invoking createBid.
 */
export async function assertUserDriverInCooperative(
  prisma: PrismaClient,
  userId: string,
  cooperativeId: string,
): Promise<void> {
  const profile = await prisma.driverProfile.findUnique({
    where: { userId },
    select: { id: true, cooperativeId: true },
  });
  if (!profile || profile.cooperativeId !== cooperativeId) {
    throw new AuthorizationError('driver-not-in-cooperative');
  }
}

/**
 * Verify a User belongs to the given cooperative (used for
 * leader-membership checks and cooperative-internal lookups).
 */
export async function assertUserInCooperative(
  prisma: PrismaClient,
  userId: string,
  cooperativeId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, cooperativeId: true },
  });
  if (!user || user.cooperativeId !== cooperativeId) {
    throw new AuthorizationError('user-not-in-cooperative');
  }
}
