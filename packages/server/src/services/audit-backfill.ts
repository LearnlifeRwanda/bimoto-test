import prisma from '../prisma';
import { appendAuditEntry } from './escrow-audit.service';

export interface BackfillResult {
  scanned: number;
  backfilled: number;
  entriesCreated: number;
  skipped: number;
}

/**
 * Backfills audit-chain entries for legacy escrows that were created
 * before Dispatch A wired up appendAuditEntryTx. Synthetic entries
 * reconstruct CREATED_PENDING / CHARGE_CONFIRMED / RELEASED at
 * timestamps derived from the Escrow row itself; metadata.backfilled
 * = true distinguishes reconstructed entries from observed-at-time
 * ones. Idempotent — re-runnable safely.
 */
export async function runBackfill(): Promise<BackfillResult> {
  const result: BackfillResult = {
    scanned: 0,
    backfilled: 0,
    entriesCreated: 0,
    skipped: 0,
  };

  const escrows = await prisma.escrow.findMany({
    select: {
      id: true,
      customerId: true,
      driverId: true,
      amount: true,
      status: true,
      createdAt: true,
      releasedAt: true,
      lastChargeAttemptAt: true,
      flwTxId: true,
      txRef: true,
    },
  });
  result.scanned = escrows.length;

  for (const e of escrows) {
    const existing = await prisma.escrowAuditLog.findFirst({
      where: { escrowId: e.id },
    });
    if (existing) {
      result.skipped++;
      continue;
    }

    await appendAuditEntry(
      e.id,
      'CREATED_PENDING',
      e.amount,
      e.customerId,
      { backfilled: true, backfilledAt: new Date().toISOString(), txRef: e.txRef },
    );
    result.entriesCreated++;

    const isConfirmed =
      e.status === 'HELD' ||
      e.status === 'RELEASED' ||
      e.status === 'REFUNDED' ||
      e.status === 'FROZEN';
    if (isConfirmed) {
      await appendAuditEntry(
        e.id,
        'CHARGE_CONFIRMED',
        e.amount,
        e.customerId,
        {
          backfilled: true,
          backfilledAt: new Date().toISOString(),
          flwTxId: e.flwTxId ?? undefined,
        },
      );
      result.entriesCreated++;
    }

    if (e.status === 'RELEASED' && e.releasedAt) {
      await appendAuditEntry(
        e.id,
        'RELEASED',
        e.amount,
        e.driverId,
        { backfilled: true, backfilledAt: new Date().toISOString() },
      );
      result.entriesCreated++;
    }

    result.backfilled++;
  }

  return result;
}
