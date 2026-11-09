import prisma from '../../prisma';
import {
  markEscrowChargeSucceeded,
  markEscrowChargeFailed,
} from '../../services/escrow.service';
import { verifyTransaction, FlutterwaveError } from '../../services/payment';

const TIMEOUT_MS = 5 * 60 * 1000;

export interface PendingEscrowRow {
  id: string;
  txRef: string | null;
  lastChargeAttemptAt: Date | null;
}

export async function reconcileSinglePending(escrow: PendingEscrowRow): Promise<void> {
  if (!escrow.txRef) {
    console.warn(`[RECONCILE] Escrow ${escrow.id} has no txRef; skipping`);
    return;
  }

  let result;
  try {
    result = await verifyTransaction(escrow.txRef);
  } catch (err) {
    if (err instanceof FlutterwaveError && err.code === 'NO_KEYS_CONFIGURED') {
      // Dev/test environment with no keys — nothing to reconcile.
      return;
    }
    throw err;
  }

  if (result.status === 'SUCCESS' && result.flwTxId) {
    await markEscrowChargeSucceeded(escrow.id, result.flwTxId);
    return;
  }

  if (result.status === 'FAILED') {
    await markEscrowChargeFailed(escrow.id, 'gateway_reported_failure');
    return;
  }

  if (result.status === 'NOT_FOUND') {
    const ageMs = escrow.lastChargeAttemptAt
      ? Date.now() - escrow.lastChargeAttemptAt.getTime()
      : Number.POSITIVE_INFINITY;
    if (ageMs >= TIMEOUT_MS) {
      await markEscrowChargeFailed(escrow.id, 'gateway_lost_or_timeout');
    }
    return;
  }

  // PENDING — keep waiting; next tick will check again.
}
