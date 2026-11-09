import * as Sentry from '@sentry/node';
import prisma from '../../prisma';
import { recordFlag, AmlFlagSeverity } from './flag-store';
import {
  HARD_SINGLE_TX_RWF,
  HARD_DAILY_CUMULATIVE_RWF,
  SOFT_SINGLE_TX_RWF,
  SOFT_DAILY_CUMULATIVE_RWF,
  VELOCITY_HOURLY_THRESHOLD,
} from './thresholds';

export type AmlAction = 'CHARGE' | 'PAYOUT';

export class AmlError extends Error {
  statusCode: number;
  code: string;
  details: Record<string, unknown>;

  constructor(code: string, statusCode: number, details: Record<string, unknown> = {}) {
    super(code);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, AmlError.prototype);
  }
}

export interface AmlCheckInput {
  userId: string;
  amount: number;
  action: AmlAction;
  journeyId?: string | null;
  escrowId?: string | null;
  metadata?: Record<string, unknown>;
}

// NOTE (BID-ATOMICITY G4, report-first): BOTH branches deliberately sum
// escrow rows. For PAYOUT that means the cap measures the driver's
// escrowed EARNINGS accrued in the window, not the DriverPayoutBatch
// disbursements actually sent — a batch drains a balance that may have
// accrued over several days, so the two measures genuinely differ. The
// dispatch flags this as a possible summing-source bug; the semantics
// are not decidable from code + docs alone, so per §3 it is reported,
// not changed. See the completion report / PR description.
async function rolling24hSum(
  db: any,
  userId: string,
  action: AmlAction,
): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (action === 'CHARGE') {
    const rows = await db.escrow.findMany({
      where: { customerId: userId, createdAt: { gte: cutoff } },
      select: { amount: true },
    });
    return rows.reduce((sum: number, r: any) => sum + (r.amount ?? 0), 0);
  }
  const rows = await db.escrow.findMany({
    where: { driverId: userId, createdAt: { gte: cutoff } },
    select: { driverPayout: true },
  });
  return rows.reduce((sum: number, r: any) => sum + (r.driverPayout ?? 0), 0);
}

// BID-ATOMICITY G4 — the daily-cumulative sum-and-decide is atomic per
// subject: a transaction-scoped advisory lock keyed on (action, userId)
// serializes concurrent checks, so each check decides on a snapshot that
// already contains every earlier check's transaction. Chosen over a
// SERIALIZABLE transaction (the summed escrow rows are written by OTHER
// transactions, so SSI cannot link them to this read) and over a new
// conditional-insert ledger table (which would change what the cap
// measures — forbidden by §3). The full guarantee is a chain:
//   * CHARGE — the escrow row for the charge being checked is committed
//     BEFORE assertAmlCheck runs (acceptBid creates the escrow, then
//     charges), so it is ALREADY in the summed set: the escrow table is
//     the ledger and this check is its conditional gate. With checks
//     serialized by this lock, N concurrent charges can never jointly
//     pass while jointly over the cap.
//   * PAYOUT — at most one un-settled batch per driver exists at a time
//     (partial unique index DriverPayoutBatch_driverId_pending_key), so
//     concurrent payout attempts for one subject collapse to one batch
//     regardless of what their checks concluded.
// The lock dies with the transaction (same rationale as job-lock.ts).
// Test mocks without $transaction / $queryRaw fall back to the plain
// read — behaviour there is byte-identical to before this dispatch.
async function withAmlSubjectLock<T>(
  userId: string,
  action: AmlAction,
  fn: (db: any) => Promise<T>,
): Promise<T> {
  const client: any = prisma;
  if (typeof client.$transaction !== 'function') {
    return fn(client);
  }
  return client.$transaction(async (tx: any) => {
    if (typeof tx.$queryRaw === 'function') {
      const lockKey = `aml:${action}:${userId}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS locked`;
    }
    return fn(tx);
  });
}

async function safeRecordFlag(
  input: Parameters<typeof recordFlag>[0],
): Promise<void> {
  try {
    await recordFlag(input);
  } catch (err) {
    // Soft-flag writes are best-effort. A DB failure must NOT become a DoS
    // vector that blocks legitimate transactions.
    console.error('[AML] recordFlag failed (best-effort)', err);
    if (process.env.SENTRY_DSN) Sentry.captureException(err, { extra: { input } });
  }
}

/**
 * Hard-cap enforcement runs BEFORE the gateway call. A breach throws AmlError
 * (transaction blocked); soft-threshold breaches write a flag and return.
 *
 * Comparison uses `>=` against thresholds — exactly-at-threshold also blocks.
 */
export async function assertAmlCheck(input: AmlCheckInput): Promise<void> {
  const { userId, amount, action } = input;

  // Hard single-transaction cap (blocks at exactly the threshold).
  if (amount >= HARD_SINGLE_TX_RWF) {
    await safeRecordFlag({
      userId,
      journeyId: input.journeyId ?? null,
      escrowId: input.escrowId ?? null,
      type: 'HARD_LIMIT_EXCEEDED',
      severity: 'CRITICAL',
      metadata: { action, attempted: amount, threshold: HARD_SINGLE_TX_RWF, ...input.metadata },
    });
    throw new AmlError('AML_HARD_LIMIT_EXCEEDED', 403, {
      threshold: HARD_SINGLE_TX_RWF,
      attempted: amount,
      kind: 'single_transaction',
    });
  }

  // BID-ATOMICITY G4 — sum AND hard-decide inside the per-subject lock,
  // so racing checks for one user serialize instead of all reading the
  // same pre-decision snapshot. The soft flags below reuse the locked
  // sum but run after release — they never block, so serializing them
  // buys nothing. Flag writes stay best-effort on the global client.
  const existing24h = await withAmlSubjectLock(userId, action, async (db) => {
    const sum = await rolling24hSum(db, userId, action);

    // Hard daily cumulative cap.
    if (sum + amount >= HARD_DAILY_CUMULATIVE_RWF) {
      await safeRecordFlag({
        userId,
        journeyId: input.journeyId ?? null,
        escrowId: input.escrowId ?? null,
        type: 'DAILY_CUMULATIVE_EXCEEDED',
        severity: 'CRITICAL',
        metadata: {
          action,
          attempted: amount,
          existing24h: sum,
          threshold: HARD_DAILY_CUMULATIVE_RWF,
          ...input.metadata,
        },
      });
      throw new AmlError('AML_HARD_LIMIT_EXCEEDED', 403, {
        threshold: HARD_DAILY_CUMULATIVE_RWF,
        attempted: amount + sum,
        kind: 'daily_cumulative',
      });
    }
    return sum;
  });

  // Soft single-transaction flag (transaction proceeds).
  if (amount >= SOFT_SINGLE_TX_RWF) {
    const severity: AmlFlagSeverity = 'LOW';
    await safeRecordFlag({
      userId,
      journeyId: input.journeyId ?? null,
      escrowId: input.escrowId ?? null,
      type: 'SOFT_LIMIT_EXCEEDED',
      severity,
      metadata: { action, attempted: amount, threshold: SOFT_SINGLE_TX_RWF, ...input.metadata },
    });
  }

  // Soft daily cumulative flag.
  if (existing24h + amount >= SOFT_DAILY_CUMULATIVE_RWF && amount < SOFT_SINGLE_TX_RWF) {
    // Only emit this if the single-tx soft flag did not already fire — avoids
    // redundant rows on the same large transaction.
    await safeRecordFlag({
      userId,
      journeyId: input.journeyId ?? null,
      escrowId: input.escrowId ?? null,
      type: 'DAILY_CUMULATIVE_EXCEEDED',
      severity: 'MEDIUM',
      metadata: {
        action,
        attempted: amount,
        existing24h,
        threshold: SOFT_DAILY_CUMULATIVE_RWF,
        ...input.metadata,
      },
    });
  }
}

/**
 * Velocity OBSERVATION (informational at v1 — does NOT block). Counts a
 * customer's journeys in the last 1h and writes a MEDIUM AmlFlag above
 * the threshold.
 *
 * COUNTER-READY G4 — renamed from `assertVelocityOk`, which asserted
 * nothing. It has no throwing branch: it writes through safeRecordFlag,
 * which swallows its own failures, and returns void. The old name said
 * "this call is a gate", and the D17 call site in createJourney had to
 * carry a paragraph explaining that it is not — a comment doing a name's
 * job. `observeVelocity` says what it does, so the next reader does not
 * have to be told.
 *
 * BEHAVIOUR UNCHANGED — same body, same threshold, same flag, same
 * signature. The rename is the whole change.
 */
export async function observeVelocity(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  const count = await prisma.journey.count({
    where: { customerId: userId, createdAt: { gte: cutoff } },
  });
  if (count > VELOCITY_HOURLY_THRESHOLD) {
    await safeRecordFlag({
      userId,
      type: 'VELOCITY_EXCEEDED',
      severity: 'MEDIUM',
      metadata: { hourlyCount: count, threshold: VELOCITY_HOURLY_THRESHOLD },
    });
  }
}
