// Admin freeze + unfreeze service.
//
// Both operations run inside a single Prisma transaction so we never end
// up with a half-applied state (e.g. user frozen but no AdminAction row,
// which would corrupt the hash chain). Side effects that cannot be made
// transactional — socket disconnect, SMS notification, auth-cache
// invalidation — fire AFTER commit and are best-effort.
//
// Note on EscrowAuditLog cross-write: the existing EscrowAuditLog model
// requires a FK-valid `escrowId`. A FREEZE_USER + payout-hold doesn't
// touch a single escrow, so we keep the canonical record in AdminAction.
// The conflict-resolver modules cross-write to EscrowAuditLog for actions
// that DO move money on a specific escrow (refund / pay / split).
//
// Cache-invalidation contract: callers MUST receive an updated
// frozenAt/frozenBy state on the next auth check. The post-commit hook
// invokes invalidateAuthStatusCache(userId).

import type { Server as SocketIOServer } from 'socket.io';
import type {
  AdminAction,
  FreezeCategory,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import prisma from '../../prisma';
import { sendSms } from '../sms.service';
import { decryptedPhoneOrNull } from '../user-phone';
import { appendAdminActionTx } from './admin-action-audit.service';
import { disconnectUserSockets } from './socket-disconnect.helper';
import { invalidateAuthStatusCache } from '../../middleware/auth-status-cache';
import { revokeAllRefreshTokensForUser } from '../refresh-token.service';
import {
  FREEZE_SMS_TEMPLATE,
  NOTIFY_SMS_ON_FREEZE,
  NOTIFY_SMS_ON_UNFREEZE,
  SOCKET_DISCONNECT_REASON,
  UNFREEZE_SMS_TEMPLATE,
} from './config';

export interface FreezeArgs {
  userId: string;
  adminId: string;
  reason: string;
  category: FreezeCategory;
  notify: boolean;
}

export interface UnfreezeArgs {
  userId: string;
  adminId: string;
  reason: string;
  releasePayouts: boolean;
  notify: boolean;
}

export interface FreezeResult {
  adminAction: AdminAction;
  heldBatchCount: number;
  user: { id: string; phone: string; nickname: string };
}

/**
 * Count of currently-frozen drivers. Single owner of this predicate —
 * PAYOUT-D's admin payout summary previously inlined it because no
 * importable function existed. (The freeze list route is a different
 * query: a user-wide listing with an optional category filter.)
 */
export async function countFrozenDrivers(
  client: PrismaClient = prisma,
): Promise<number> {
  return client.user.count({
    where: { frozenAt: { not: null }, role: 'DRIVER' },
  });
}

export async function freezeUser(
  args: FreezeArgs,
  client: PrismaClient = prisma,
  io?: SocketIOServer | null,
): Promise<FreezeResult> {
  const result = await client.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.user.findUnique({ where: { id: args.userId } });
    if (!existing) {
      const err: any = new Error('USER_NOT_FOUND');
      err.code = 'USER_NOT_FOUND';
      throw err;
    }

    const user = await tx.user.update({
      where: { id: args.userId },
      data: {
        frozenAt: new Date(),
        frozenReason: args.reason,
        frozenBy: args.adminId,
        frozenCategory: args.category,
      },
    });

    let heldBatchCount = 0;
    if (user.role === 'DRIVER' || user.role === 'BOTH') {
      const updated = await tx.driverPayoutBatch.updateMany({
        where: {
          driverId: args.userId,
          paidOutAt: null,
          status: 'PENDING',
          held: false,
        },
        data: {
          held: true,
          heldAt: new Date(),
          heldBy: args.adminId,
          heldReason: 'admin-freeze',
        },
      });
      heldBatchCount = updated.count;
    }

    const adminAction = await appendAdminActionTx(tx, {
      adminId: args.adminId,
      action: 'FREEZE_USER',
      targetType: 'USER',
      targetId: args.userId,
      reason: args.reason,
      payload: { category: args.category, heldBatchCount },
    });

    return { user, adminAction, heldBatchCount };
  });

  invalidateAuthStatusCache(args.userId);

  // PREPROTO-AUTH G3 — a freeze must kill session RENEWAL immediately,
  // independent of the access-token cache TTL: revoke every live refresh
  // token at the store. Best-effort like the other post-commit effects
  // (the refresh path also live-checks frozenAt as a second line).
  try {
    await revokeAllRefreshTokensForUser(args.userId);
  } catch (err) {
    console.warn('[ADMIN] refresh-token-revoke-fail', err);
  }

  try {
    disconnectUserSockets(io ?? null, args.userId, SOCKET_DISCONNECT_REASON);
  } catch (err) {
    console.warn('[ADMIN] socket-disconnect-fail', err);
  }

  const frozenUserPhone = decryptedPhoneOrNull(result.user);
  if (args.notify && NOTIFY_SMS_ON_FREEZE && frozenUserPhone) {
    try {
      const body = FREEZE_SMS_TEMPLATE.replace(
        '${id}',
        result.adminAction.id.slice(0, 8),
      );
      await sendSms(frozenUserPhone, body);
    } catch (err) {
      console.warn('[ADMIN] freeze-sms-send-fail', err);
    }
  }

  return {
    adminAction: result.adminAction,
    heldBatchCount: result.heldBatchCount,
    user: {
      id: result.user.id,
      phone: frozenUserPhone ?? '',
      nickname: result.user.nickname,
    },
  };
}

export async function unfreezeUser(
  args: UnfreezeArgs,
  client: PrismaClient = prisma,
  io?: SocketIOServer | null,
): Promise<FreezeResult> {
  const result = await client.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.user.findUnique({ where: { id: args.userId } });
    if (!existing) {
      const err: any = new Error('USER_NOT_FOUND');
      err.code = 'USER_NOT_FOUND';
      throw err;
    }

    const user = await tx.user.update({
      where: { id: args.userId },
      data: {
        frozenAt: null,
        frozenReason: null,
        frozenBy: null,
        frozenCategory: null,
      },
    });

    let releasedCount = 0;
    if (args.releasePayouts) {
      const updated = await tx.driverPayoutBatch.updateMany({
        where: {
          driverId: args.userId,
          held: true,
          paidOutAt: null,
        },
        data: {
          held: false,
          heldAt: null,
          heldBy: null,
          heldReason: null,
        },
      });
      releasedCount = updated.count;
    }

    const adminAction = await appendAdminActionTx(tx, {
      adminId: args.adminId,
      action: 'UNFREEZE_USER',
      targetType: 'USER',
      targetId: args.userId,
      reason: args.reason,
      payload: {
        releasePayouts: args.releasePayouts,
        releasedBatchCount: releasedCount,
      },
    });

    return { user, adminAction, heldBatchCount: releasedCount };
  });

  invalidateAuthStatusCache(args.userId);

  const unfrozenUserPhone = decryptedPhoneOrNull(result.user);
  if (args.notify && NOTIFY_SMS_ON_UNFREEZE && unfrozenUserPhone) {
    try {
      await sendSms(unfrozenUserPhone, UNFREEZE_SMS_TEMPLATE);
    } catch (err) {
      console.warn('[ADMIN] unfreeze-sms-send-fail', err);
    }
  }

  return {
    adminAction: result.adminAction,
    heldBatchCount: result.heldBatchCount,
    user: {
      id: result.user.id,
      phone: unfrozenUserPhone ?? '',
      nickname: result.user.nickname,
    },
  };
}
