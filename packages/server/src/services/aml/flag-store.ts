import * as Sentry from '@sentry/node';
import prisma from '../../prisma';
import { AppError } from '../../middleware/error-handler';
import { FLAG_DEDUPE_WINDOW_HOURS } from './thresholds';

export type AmlFlagType =
  | 'HARD_LIMIT_EXCEEDED'
  | 'SOFT_LIMIT_EXCEEDED'
  | 'DAILY_CUMULATIVE_EXCEEDED'
  | 'VELOCITY_EXCEEDED'
  | 'PAIR_FREQUENCY'
  | 'NEW_ACCOUNT_HIGH_VALUE'
  | 'BURST_SILENCE'
  | 'FAILURE_CLUSTERING'
  | 'PAYOUT_CONCENTRATION'
  | 'COLLUSION_RING'
  | 'MONEY_FUNNEL'
  | 'REPUTATION_RING'
  | 'GEO_ANOMALY'
  | 'SYNC_RATING_ATTACK'
  | 'BID_CYCLE_RING';

export type AmlFlagSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AmlFlagStatus = 'OPEN' | 'DISMISSED' | 'MARKED_FOR_FREEZE' | 'RESOLVED';

export interface RecordFlagInput {
  userId: string;
  journeyId?: string | null;
  escrowId?: string | null;
  type: AmlFlagType;
  severity: AmlFlagSeverity;
  metadata?: Record<string, unknown>;
}

export interface RecordFlagResult {
  flagId: string;
  merged: boolean;
}

// BID-ATOMICITY G4 — the dedupe window is find-then-create over a
// predicate no table constraint can express (a rolling time window has
// no unique-index shape, partial or otherwise), so the raceable window
// is closed with a per-(userId, type, journeyId) transaction-scoped
// advisory lock instead: two detectors flagging the same subject
// concurrently serialize, the second sees the first's committed row and
// merges instead of duplicating. The lock dies with the transaction
// (job-lock.ts rationale). Unit-test mocks without $transaction fall
// back to the plain sequential behaviour, unchanged.
async function withFlagDedupeLock<T>(
  input: RecordFlagInput,
  fn: (db: any) => Promise<T>,
): Promise<T> {
  const client: any = prisma;
  if (typeof client.$transaction !== 'function') {
    return fn(client);
  }
  return client.$transaction(async (tx: any) => {
    if (typeof tx.$queryRaw === 'function') {
      const lockKey = `aml-flag:${input.userId}:${input.type}:${input.journeyId ?? ''}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS locked`;
    }
    return fn(tx);
  });
}

/**
 * Insert an AmlFlag row. Idempotent on (userId, type, journeyId) within
 * FLAG_DEDUPE_WINDOW_HOURS — duplicates merge by updating metadata.lastDetectedAt
 * rather than creating a new row.
 *
 * CRITICAL severity also flips User.isFlagged + User.flagReason for downstream
 * admin dashboards / freeze flow.
 */
export async function recordFlag(input: RecordFlagInput): Promise<RecordFlagResult> {
  const cutoff = new Date(Date.now() - FLAG_DEDUPE_WINDOW_HOURS * 60 * 60 * 1000);
  const result = await withFlagDedupeLock(input, async (db) => {
    const existing = await db.amlFlag.findFirst({
      where: {
        userId: input.userId,
        type: input.type,
        journeyId: input.journeyId ?? null,
        detectedAt: { gte: cutoff },
      },
      orderBy: { detectedAt: 'desc' },
    });

    if (existing) {
      const mergedMeta = {
        ...(existing.metadata ?? {}),
        ...(input.metadata ?? {}),
        lastDetectedAt: new Date().toISOString(),
      };
      await db.amlFlag.update({
        where: { id: existing.id },
        data: { metadata: mergedMeta },
      });
      return { flagId: existing.id as string, merged: true };
    }

    const row = await db.amlFlag.create({
      data: {
        userId: input.userId,
        journeyId: input.journeyId ?? null,
        escrowId: input.escrowId ?? null,
        type: input.type,
        severity: input.severity,
        metadata: input.metadata ?? null,
      },
    });
    return { flagId: row.id as string, merged: false };
  });

  if (!result.merged && input.severity === 'CRITICAL') {
    try {
      await prisma.user.update({
        where: { id: input.userId },
        data: { isFlagged: true, flagReason: input.type },
      });
    } catch (err) {
      // Best-effort: a User update failure must not block flag recording.
      if (process.env.SENTRY_DSN) Sentry.captureException(err, { extra: { userId: input.userId } });
    }
  }

  return result;
}

export interface GetOpenFlagsInput {
  userId?: string;
  status?: AmlFlagStatus;
  severity?: AmlFlagSeverity;
  type?: AmlFlagType;
  since?: Date;
  limit?: number;
}

export async function getOpenFlags(input: GetOpenFlagsInput = {}): Promise<{
  flags: any[];
  total: number;
}> {
  const where: any = {};
  if (input.userId) where.userId = input.userId;
  where.status = input.status ?? 'OPEN';
  if (input.severity) where.severity = input.severity;
  if (input.type) where.type = input.type;
  if (input.since) where.detectedAt = { gte: input.since };

  const [flags, total] = await Promise.all([
    prisma.amlFlag.findMany({
      where,
      orderBy: [{ severity: 'desc' }, { detectedAt: 'desc' }],
      take: input.limit ?? 50,
    }),
    prisma.amlFlag.count({ where }),
  ]);
  return { flags, total };
}

export interface ResolveFlagInput {
  flagId: string;
  resolvedBy: string;
  resolutionNotes?: string;
  status: 'DISMISSED' | 'MARKED_FOR_FREEZE' | 'RESOLVED';
  confirmCriticalDismiss?: boolean;
}

/**
 * Admin action. CRITICAL → DISMISSED requires `confirmCriticalDismiss: true`
 * (the route handler enforces this and returns 400 otherwise).
 */
export async function resolveFlag(input: ResolveFlagInput): Promise<void> {
  const flag = await prisma.amlFlag.findUnique({ where: { id: input.flagId } });
  if (!flag) {
    throw new AppError(404, 'AML_FLAG_NOT_FOUND', 'errors.amlFlagNotFound');
  }
  if (
    flag.severity === 'CRITICAL' &&
    input.status === 'DISMISSED' &&
    !input.confirmCriticalDismiss
  ) {
    throw new AppError(
      400,
      'CRITICAL_DISMISS_REQUIRES_CONFIRM',
      'errors.criticalDismissRequiresConfirm',
    );
  }
  await prisma.amlFlag.update({
    where: { id: input.flagId },
    data: {
      status: input.status,
      resolvedAt: new Date(),
      resolvedBy: input.resolvedBy,
      resolutionNotes: input.resolutionNotes ?? null,
    },
  });
}
