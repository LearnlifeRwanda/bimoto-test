// DRIVER-ID v3 — driver identity lifecycle service.
//
// The jacket number (stored in ruraAuthorizationNumber) is the
// person-first identifier: any physical object carrying it is a
// convenience pointer, never a trust token — only the app's live state
// verifies. The column doubles as the slot where motorized drivers
// record their RURA transport authorization, but its identifier role is
// vehicle-independent (seeded BIKE/E_BIKE drivers carry jacket numbers
// with no RURA authorization). This module owns the lifecycle rules the
// schema cannot express:
//
//   1. Approval gate: a profile may only become VERIFIED when the
//      person identifier (ruraAuthorizationNumber) is present — for
//      every vehicle type — and the registration plate is present for
//      vehicle types whose compliance entry requires one. The columns
//      stay nullable for pre-approval rows, so the mandatory-at-approval
//      rule lives here as code, driven by VEHICLE_COMPLIANCE.
//   2. No direct REVOKED -> VERIFIED transition: a revoked driver must
//      re-apply through the driver-verification submission flow (which
//      resets REVOKED -> PENDING) and pass review again.
//
// Every writer of verificationStatus = 'VERIFIED' (admin approve route,
// cooperative-leader approve) MUST call assertDriverApprovable first.

import type { Server as SocketIOServer } from 'socket.io';
import type { AdminAction, PrismaClient } from '@prisma/client';
import { getVehicleCompliance } from '@bimoto/shared';
import prisma from '../prisma';
import { AppError } from '../middleware/error-handler';
import { appendAdminActionTx } from './admin/admin-action-audit.service';
import { disconnectUserSockets } from './admin/socket-disconnect.helper';
import { SOCKET_DISCONNECT_REASON } from './admin/config';
import { firePreferenceChangeBatch } from './payout.service';

export interface ApprovableProfileFields {
  verificationStatus: string;
  vehicleType: string;
  ruraAuthorizationNumber: string | null;
  registrationPlate: string | null;
}

export function assertDriverApprovable(profile: ApprovableProfileFields): void {
  if (profile.verificationStatus === 'REVOKED') {
    throw new AppError(
      422,
      'DRIVER_REVOKED_REAPPLY_REQUIRED',
      'errors.driverRevokedReapplyRequired',
    );
  }

  const compliance = getVehicleCompliance(profile.vehicleType);
  const missing: string[] = [];
  // The identifier is required regardless of vehicle type: identity is
  // person-bound, not vehicle-bound.
  if (!profile.ruraAuthorizationNumber) missing.push('ruraAuthorizationNumber');
  if (compliance.registrationRequired && !profile.registrationPlate) {
    missing.push('registrationPlate');
  }
  if (missing.length > 0) {
    throw new AppError(
      422,
      'DRIVER_MISSING_IDENTIFIERS',
      'errors.driverMissingIdentifiers',
      { missing },
    );
  }
}

export interface RevokeDriverArgs {
  driverId: string;
  adminId: string;
  reason: string;
}

export interface RevokeDriverResult {
  profile: { userId: string; verificationStatus: string; revokedAt: Date | null };
  adminAction: AdminAction;
  withdrawnBidCount: number;
  settlement: {
    // Non-null when the standard payout path disbursed a batch.
    batchId: string | null;
    amount: number;
    // True when the driver is frozen: freeze wins, no settlement now —
    // the normal payout machinery settles after unfreeze.
    deferredForFreeze: boolean;
  };
}

/**
 * Revoke a driver's identity: the number's validity dies, the records and
 * the money do not. Sets verificationStatus REVOKED + revokedAt, forces
 * isOnline false, withdraws every open bid with withdrawnSource SYSTEM,
 * and writes the hash-chained REVOKE_DRIVER AdminAction — all in one
 * transaction (freeze-service convention). Then settles any positive
 * balance through the standard payout path.
 *
 * Settlement ordering: revocation is independent of freeze and
 * suspendedUntil and changes neither. If the driver is frozen we do NOT
 * settle — freeze wins; the balance stays put and the regular payout
 * machinery (which excludes frozen drivers) settles it after unfreeze.
 * firePreferenceChangeBatch enforces the same rule internally, so the
 * explicit check here is belt-and-suspenders plus an honest result flag.
 */
export async function revokeDriver(
  args: RevokeDriverArgs,
  client: PrismaClient = prisma,
  io?: SocketIOServer | null,
): Promise<RevokeDriverResult> {
  const result = await client.$transaction(async (tx: any) => {
    const existing = await tx.driverProfile.findUnique({
      where: { userId: args.driverId },
    });
    if (!existing) {
      const err: any = new Error('DRIVER_PROFILE_NOT_FOUND');
      err.code = 'DRIVER_PROFILE_NOT_FOUND';
      throw err;
    }
    if (existing.verificationStatus === 'REVOKED') {
      const err: any = new Error('ALREADY_REVOKED');
      err.code = 'ALREADY_REVOKED';
      throw err;
    }

    const profile = await tx.driverProfile.update({
      where: { userId: args.driverId },
      data: {
        verificationStatus: 'REVOKED',
        revokedAt: new Date(),
        isOnline: false,
      },
    });

    // First production writer of withdrawnSource: 'SYSTEM' (the enum
    // shipped in the AML-FP dispatch with no writer). Bulk updateMany
    // rather than the per-bid withdrawBid(): the shared bid state
    // machine has no ACCEPTED -> WITHDRAWN edge for user actions, but
    // revocation is a system-level override that must clear ACCEPTED
    // bids too so no new journey can start on a dead number. The
    // bid-cycle-ring detector ignores SYSTEM withdrawals by design.
    const withdrawn = await tx.bid.updateMany({
      where: {
        driverId: args.driverId,
        status: { in: ['PENDING', 'ACCEPTED'] },
      },
      data: { status: 'WITHDRAWN', withdrawnSource: 'SYSTEM' },
    });

    const adminAction = await appendAdminActionTx(tx, {
      adminId: args.adminId,
      action: 'REVOKE_DRIVER',
      targetType: 'USER',
      targetId: args.driverId,
      reason: args.reason,
      payload: { withdrawnBidCount: withdrawn.count },
    });

    const user = await tx.user.findUnique({
      where: { id: args.driverId },
      select: { frozenAt: true },
    });

    return {
      profile,
      adminAction,
      withdrawnBidCount: withdrawn.count,
      frozen: Boolean(user?.frozenAt),
    };
  });

  // Post-commit, best-effort: a revoked driver should stop receiving
  // journey broadcasts immediately.
  try {
    disconnectUserSockets(io ?? null, args.driverId, SOCKET_DISCONNECT_REASON);
  } catch (err) {
    console.warn('[ADMIN] revoke-socket-disconnect-fail', err);
  }

  // Honest settlement, never confiscation: pay out any positive balance
  // through the standard AML-checked, freeze-respecting payout path.
  // No parallel payout machinery — this is the existing single-driver
  // settlement engine with the ADMIN trigger (its first ADMIN caller).
  let settlement: RevokeDriverResult['settlement'] = {
    batchId: null,
    amount: 0,
    deferredForFreeze: result.frozen,
  };
  if (!result.frozen) {
    const fired = await firePreferenceChangeBatch(args.driverId, 'ADMIN');
    settlement = { ...fired, deferredForFreeze: false };
  }

  return {
    profile: {
      userId: result.profile.userId,
      verificationStatus: result.profile.verificationStatus,
      revokedAt: result.profile.revokedAt,
    },
    adminAction: result.adminAction,
    withdrawnBidCount: result.withdrawnBidCount,
    settlement,
  };
}
