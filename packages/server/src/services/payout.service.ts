import * as Sentry from '@sentry/node';
import { decryptedPhone } from './user-phone';
import { randomUUID } from 'crypto';
import prisma from '../prisma';
import { AppError } from '../middleware/error-handler';
import { getEffectivePreference } from './payout/training-wheels';
import { assertAmlCheck, AmlError } from './aml';

// Re-exported from the generated Prisma client under the names importers
// already use, so the compiler catches drift between these unions and the
// schema enums instead of a hand-rolled mirror silently diverging.
import type { PayoutPreference, PayoutBatchTrigger } from '@prisma/client';
export type { PayoutPreference, PayoutBatchTrigger };

export interface PendingPayout {
  driverId: string;
  amount: number;
}

export async function creditDriverBalance(
  driverId: string,
  amount: number,
  txOrPrisma: any = prisma,
): Promise<void> {
  if (amount <= 0) return;

  await txOrPrisma.driverBalance.upsert({
    where: { driverId },
    create: { driverId, pendingAmount: amount },
    update: { pendingAmount: { increment: amount } },
  });
}

export async function getPendingDriverPayouts(): Promise<PendingPayout[]> {
  const balances = await prisma.driverBalance.findMany({
    where: { pendingAmount: { gt: 0 } },
  });
  if (balances.length === 0) return [];

  const driverIds = balances.map((b: any) => b.driverId);
  const users = await prisma.user.findMany({
    where: { id: { in: driverIds } },
    select: { id: true, frozenAt: true },
  });
  const frozen = new Set<string>(
    users.filter((u: any) => u.frozenAt).map((u: any) => u.id),
  );

  // Any un-settled PENDING batch (held or not) means money may be in flight
  // for that driver — paying the full balance again would double-pay. The
  // payout reconciliation job guarantees PENDING rows resolve, so this
  // exclusion is temporary per driver, not a starvation risk.
  const inFlightRows = await prisma.driverPayoutBatch.findMany({
    where: { driverId: { in: driverIds }, status: 'PENDING', paidOutAt: null },
    select: { driverId: true },
  });
  const inFlightDrivers = new Set<string>(
    inFlightRows.map((r: any) => r.driverId),
  );

  return balances
    .filter(
      (b: any) => !frozen.has(b.driverId) && !inFlightDrivers.has(b.driverId),
    )
    .map((b: any) => ({
      driverId: b.driverId,
      amount: b.pendingAmount,
    }));
}

export async function createPendingBatch(
  driverId: string,
  amount: number,
  txRef: string,
  trigger: PayoutBatchTrigger = 'SCHEDULED_22H',
  opts: { db?: any; id?: string } = {},
): Promise<{ id: string }> {
  if (amount <= 0) {
    throw new AppError(400, 'INVALID_PAYOUT_AMOUNT', 'errors.invalidPayoutAmount');
  }
  const db = opts.db ?? prisma;
  const batch = await db.driverPayoutBatch.create({
    data: {
      ...(opts.id ? { id: opts.id } : {}),
      driverId,
      amount,
      txRef,
      status: 'PENDING',
      trigger,
    },
  });
  return { id: batch.id };
}

/**
 * True when the error is the partial unique index
 * DriverPayoutBatch_driverId_pending_key rejecting a second un-settled
 * PENDING batch for the same driver (migration
 * 20260729000000_payout_idempotency_one_inflight_batch). Prisma surfaces
 * it as P2002 with target ["driverId"] — distinct from a txRef collision,
 * whose target is ["txRef"].
 */
function isInFlightBatchConflict(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } };
  if (e?.code !== 'P2002') return false;
  const target = e.meta?.target;
  if (Array.isArray(target)) return target.includes('driverId');
  if (typeof target === 'string') {
    return target.includes('driverId') || target.includes('driverId_pending');
  }
  // P2002 with no usable target: treat as the in-flight conflict rather
  // than 500 a driver who double-tapped. The alternative collision on
  // this table (txRef) cannot occur from concurrent same-driver calls
  // once refs are batch-derived.
  return true;
}

/**
 * Filter pending balances by the driver's effective payout preference.
 * Drivers with completedShifts < 3 + AT_SHIFT_END are bucketed as
 * TWICE_DAILY by getEffectivePreference (training wheels).
 *
 * Frozen drivers are excluded — see Dispatch H. The freeze service also
 * marks existing PENDING batches as held, but that doesn't refund the
 * underlying DriverBalance, so we also skip the cohort entry until the
 * freeze is lifted.
 *
 * Beyond held batches, ANY un-settled PENDING batch excludes the driver:
 * a PENDING batch means money may be in flight and paying the full balance
 * again would double-pay. The payout reconciliation job guarantees PENDING
 * rows resolve, so the exclusion is temporary per driver.
 */
export async function getPendingForCohort(
  preference: PayoutPreference,
): Promise<PendingPayout[]> {
  const balances = await prisma.driverBalance.findMany({
    where: { pendingAmount: { gt: 0 } },
  });
  if (balances.length === 0) return [];

  const driverIds = balances.map((b: any) => b.driverId);
  const users = await prisma.user.findMany({ where: { id: { in: driverIds } } });
  const byId = new Map<string, any>(users.map((u: any) => [u.id, u]));

  const inFlightRows = await prisma.driverPayoutBatch.findMany({
    where: { driverId: { in: driverIds }, status: 'PENDING', paidOutAt: null },
    select: { driverId: true },
  });
  const driversWithInFlightBatch = new Set<string>(
    inFlightRows.map((r: any) => r.driverId),
  );

  return balances
    .filter((b: any) => {
      const u = byId.get(b.driverId);
      if (!u) return false;
      if (u.frozenAt) return false;
      if (driversWithInFlightBatch.has(b.driverId)) return false;
      const effective = getEffectivePreference({
        payoutPreference: u.payoutPreference,
        completedShifts: u.completedShifts,
      });
      return effective === preference;
    })
    .map((b: any) => ({ driverId: b.driverId, amount: b.pendingAmount }));
}

export async function getPendingPastFallback(
  maxAgeHours = 24,
): Promise<PendingPayout[]> {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  const balances = await prisma.driverBalance.findMany({
    where: {
      pendingAmount: { gt: 0 },
      lastUpdatedAt: { lt: cutoff },
    },
  });
  return balances.map((b: any) => ({ driverId: b.driverId, amount: b.pendingAmount }));
}

/**
 * Atomically creates and processes a payout batch for a single driver.
 * Used by SHIFT_END (immediate), PREFERENCE_CHANGE (after 30-min cooldown),
 * and FALLBACK_24H triggers.
 */
export async function firePreferenceChangeBatch(
  driverId: string,
  trigger: PayoutBatchTrigger,
): Promise<{ batchId: string | null; amount: number }> {
  // Defensive: refuse to disburse for a frozen driver or one with an
  // outstanding un-settled PENDING batch (held or in flight at the gateway —
  // paying again would double-pay). The caller's cohort filter already
  // excludes these, but a SHIFT_END / FALLBACK_24H caller could bypass that
  // path.
  const driverRow = await prisma.user.findUnique({
    where: { id: driverId },
    select: { frozenAt: true },
  });
  if (driverRow?.frozenAt) {
    return { batchId: null, amount: 0 };
  }
  const inFlightExisting = await prisma.driverPayoutBatch.findFirst({
    where: { driverId, status: 'PENDING', paidOutAt: null },
    select: { id: true },
  });
  if (inFlightExisting) {
    return { batchId: null, amount: 0 };
  }

  const balance = await prisma.driverBalance.findUnique({ where: { driverId } });
  const amount = balance?.pendingAmount ?? 0;
  if (amount <= 0) {
    return { batchId: null, amount: 0 };
  }

  // AML hard-cap on outbound transfer. A breach blocks the batch entirely;
  // no PENDING row is created so the funds stay in the driver balance and
  // surface to admin via the AmlFlag row.
  try {
    await assertAmlCheck({
      userId: driverId,
      amount,
      action: 'PAYOUT',
      metadata: { trigger },
    });
  } catch (err) {
    if (err instanceof AmlError) {
      return { batchId: null, amount: 0 };
    }
    throw err;
  }

  // The reference the gateway deduplicates on is derived from the batch
  // row itself (its pre-generated id), never from the clock: a retried
  // transfer for the same batch presents the identical reference, while
  // two legitimately separate payouts (different batch rows) still
  // differ. Max length 77 chars ("bimoto-payout-" 14 + driver prefix 8 +
  // 1 + trigger ≤17 + 1 + uuid 36), under Flutterwave's 100-char
  // transfer-reference cap. The day-keyed txRef in payout.job.ts is a
  // different, correct scheme — do not unify them.
  const batchId = randomUUID();
  const txRef = `bimoto-payout-${driverId.slice(0, 8)}-${trigger.toLowerCase()}-${batchId}`;

  // Atomic check-and-create: the in-flight re-check and the batch insert
  // run in one transaction, so the check above is only a fast path. Two
  // concurrent callers can still both pass the re-check (READ COMMITTED
  // doesn't serialize the reads) — the partial unique index
  // DriverPayoutBatch_driverId_pending_key is the ultimate arbiter, and
  // the loser's P2002 is mapped to the same "nothing to do" shape a
  // sequential second call gets. A driver double-tapping "end shift"
  // sees a clean no-op, never a 500.
  let batch: { id: string };
  try {
    const created = await prisma.$transaction(async (tx: any) => {
      const stillInFlight = await tx.driverPayoutBatch.findFirst({
        where: { driverId, status: 'PENDING', paidOutAt: null },
        select: { id: true },
      });
      if (stillInFlight) return null;
      return createPendingBatch(driverId, amount, txRef, trigger, {
        db: tx,
        id: batchId,
      });
    });
    if (!created) {
      return { batchId: null, amount: 0 };
    }
    batch = created;
  } catch (err) {
    if (isInFlightBatchConflict(err)) {
      return { batchId: null, amount: 0 };
    }
    throw err;
  }

  // Lazy-import the gateway client + transfer module so this service stays
  // safe to load without FLW keys configured.
  const { transferToWallet, FlutterwaveError } = await import('./payment');
  const driver = await prisma.user.findUnique({ where: { id: driverId } });
  if (!driver) {
    await markBatchFailed(batch.id, 'driver_not_found');
    return { batchId: batch.id, amount };
  }

  try {
    const transfer = await transferToWallet({
      // The MoMo account_number IS this number (see payout.job.ts).
      phone: decryptedPhone(driver),
      amount,
      narration: `Bimoto driver payout (${trigger})`,
      reference: txRef,
    });
    if (transfer.flwTransferId) {
      await markBatchPaidOut(driverId, batch.id, transfer.flwTransferId);
    }
  } catch (err) {
    const code = err instanceof FlutterwaveError ? err.code : 'UNKNOWN';
    await markBatchFailed(batch.id, code);
  }

  return { batchId: batch.id, amount };
}

export async function markBatchPaidOut(
  driverId: string,
  batchId: string,
  flwTransferId: string,
): Promise<void> {
  await prisma.$transaction(async (tx: any) => {
    const batch = await tx.driverPayoutBatch.findUnique({ where: { id: batchId } });
    if (!batch) {
      throw new AppError(404, 'PAYOUT_BATCH_NOT_FOUND', 'errors.payoutBatchNotFound');
    }
    if (batch.status !== 'PENDING') {
      throw new AppError(409, 'BATCH_NOT_PENDING', 'errors.batchNotPending');
    }

    // ESCROW-CREDIT G3 — the PENDING → SUCCESS flip is claimed with a status
    // predicate: the webhook and the reconciler racing on the same batch both
    // pass the read above, but only one flip matches, so the balance is
    // deducted exactly once. The loser gets the same 409 a sequential second
    // caller gets.
    const flipped = await tx.driverPayoutBatch.updateMany({
      where: { id: batchId, status: 'PENDING' },
      data: {
        status: 'SUCCESS',
        flwTransferId,
        paidOutAt: new Date(),
      },
    });
    if (flipped.count === 0) {
      throw new AppError(409, 'BATCH_NOT_PENDING', 'errors.batchNotPending');
    }

    // ESCROW-CREDIT G3 — deduct by atomic conditional decrement, mirroring
    // markBatchTransferReversed's increment style. The old read-compute-
    // overwrite wrote an absolute value, so a creditDriverBalance increment
    // landing between the read and the write was silently destroyed. A
    // decrement composes with concurrent increments: a credit landing
    // mid-settlement survives to the next sweep.
    const decremented = await tx.driverBalance.updateMany({
      where: { driverId, pendingAmount: { gte: batch.amount } },
      data: { pendingAmount: { decrement: batch.amount } },
    });
    if (decremented.count === 0) {
      const balance = await tx.driverBalance.findUnique({ where: { driverId } });
      if (!balance) return;

      // The conditional decrement refused because it would go negative: we
      // disbursed more than the driver's tracked balance. Surface it loudly,
      // then clamp to zero by decrementing exactly what is there — still an
      // increment-style write, so a concurrent credit survives even here.
      console.error(
        `[PAYOUT] Clamp discrepancy on batch ${batchId}: driver ${driverId} ` +
          `paid ${batch.amount} RWF but pendingAmount is ${balance.pendingAmount} RWF`,
      );
      Sentry.captureMessage('payout-clamp-discrepancy', {
        level: 'error',
        extra: {
          driverId,
          batchId,
          batchAmount: batch.amount,
          pendingAmount: balance.pendingAmount,
        },
      });

      await tx.driverBalance.updateMany({
        where: { driverId },
        data: { pendingAmount: { decrement: balance.pendingAmount } },
      });
    }
  });
}

/**
 * Reverses an already-settled payout batch: the gateway reported failure
 * *after* we marked the batch SUCCESS and deducted the driver balance.
 * Flips SUCCESS → FAILED and re-credits the balance in one transaction so
 * the driver's money is restored atomically. Refuses (no-op with a warn)
 * for batches in any other state — markBatchFailed handles PENDING ones.
 */
export async function markBatchTransferReversed(
  batchId: string,
  reason: string,
): Promise<void> {
  const reversed = await prisma.$transaction(async (tx: any) => {
    const batch = await tx.driverPayoutBatch.findUnique({ where: { id: batchId } });
    if (!batch || batch.status !== 'SUCCESS') {
      console.warn(
        `[PAYOUT] markBatchTransferReversed: batch ${batchId} is ` +
          `${batch?.status ?? 'missing'}, not SUCCESS; skipping`,
      );
      return null;
    }

    await tx.driverPayoutBatch.update({
      where: { id: batchId },
      data: { status: 'FAILED', failureReason: reason, reversedAt: new Date() },
    });
    await creditDriverBalance(batch.driverId, batch.amount, tx);
    return batch;
  });

  if (reversed) {
    // Money-integrity event: a settled transfer bounced at the gateway.
    console.error(
      `[PAYOUT] Transfer reversed for batch ${batchId} ` +
        `(driver ${reversed.driverId}); re-credited ${reversed.amount} RWF (${reason})`,
    );
    Sentry.captureMessage('payout-transfer-reversed', {
      level: 'error',
      extra: {
        batchId,
        driverId: reversed.driverId,
        amount: reversed.amount,
        reason,
      },
    });
  }
}

export async function markBatchFailed(
  batchId: string,
  reason: string,
): Promise<void> {
  // ESCROW-CREDIT G3 — the old read-then-update let a reconciler flip a
  // webhook-settled SUCCESS batch to FAILED between its stale read and its
  // write. The status predicate makes the check and the write one atomic
  // statement: only a batch still PENDING can fail; anything else no-ops,
  // exactly as the sequential guard behaved.
  await prisma.driverPayoutBatch.updateMany({
    where: { id: batchId, status: 'PENDING' },
    data: { status: 'FAILED', failureReason: reason },
  });
}
