// PREPROTO-AUTH G3 — server-side refresh-token store. Sessions were
// fully stateless (a leaked refresh token was a 7-day master key with no
// kill switch); every refresh token now has a row here, so it can be
// rotated, revoked on logout/freeze, and reuse of a rotated token is
// detected as theft and kills the whole family.

import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';
import prisma from '../prisma';

/** sha256 of the signed JWT — the raw token string is never at rest. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface PersistTokenInput {
  jti: string;
  userId: string;
  familyId: string;
  token: string;
  expiresAt: Date;
}

export async function persistRefreshToken(input: PersistTokenInput): Promise<void> {
  await prisma.refreshToken.create({
    data: {
      jti: input.jti,
      userId: input.userId,
      familyId: input.familyId,
      hashedToken: hashToken(input.token),
      expiresAt: input.expiresAt,
    },
  });
}

export async function findByJti(jti: string) {
  return prisma.refreshToken.findUnique({ where: { jti } });
}

/**
 * Rotation: stamp the old row with its successor and persist the new
 * token in the same family. The old token stays queryable — presenting
 * it again is the reuse-detection signal.
 */
export async function rotateRefreshToken(
  oldJti: string,
  next: PersistTokenInput,
): Promise<void> {
  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { jti: oldJti },
      data: { replacedByJti: next.jti },
    }),
    prisma.refreshToken.create({
      data: {
        jti: next.jti,
        userId: next.userId,
        familyId: next.familyId,
        hashedToken: hashToken(next.token),
        expiresAt: next.expiresAt,
      },
    }),
  ]);
}

/**
 * Reuse = theft: revoke every live token in the family. Called when a
 * rotated/revoked token is presented, on logout, and (via
 * revokeAllRefreshTokensForUser) on freeze.
 */
export async function revokeFamily(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Freeze/kill-switch: revoke every live session the user has.
 *
 * ACCOUNT-RIGHTS-CORE G2 — takes an optional client so the same query can
 * JOIN a caller's transaction, the *Tx composition precedent from
 * escrow.service (#184). Account erasure needs the revoke to commit or
 * roll back with the anonymisation: a revoke that survived a rolled-back
 * erasure would log a still-live user out for nothing, and an
 * anonymisation that committed without the revoke is the defect this
 * wave exists to close.
 *
 * Deliberately one function, not two. Freeze calls it bare and gets the
 * previous behaviour byte for byte; erasure passes its `tx`. Forking a
 * second copy is how the two would drift.
 */
export async function revokeAllRefreshTokensForUser(
  userId: string,
  client: Pick<PrismaClient, 'refreshToken'> = prisma,
): Promise<number> {
  const result = await client.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
