// AUDIT CHAIN
//
// HAZARD: this module swallows NO errors, with one precise exception —
// a P2002 unique violation on the (escrowId, sequenceNumber) index is a
// LOST APPEND RACE, not a failure, and is retried (bounded, savepoint-
// scoped) so concurrent appends serialize; see BID-ATOMICITY G3 below.
// Every other thrown error during append (DB unavailable, exhausted
// retries) propagates up to the caller's transaction; the transaction
// rolls back; chain integrity is preserved (no partial writes).
//
// Callers MUST wrap audit appends inside their own prisma.$transaction
// so audit failures roll back the underlying business action. Callers
// MAY add Sentry capture in their catch block — the audit service
// deliberately does not, to avoid double-capture noise when the
// error-handler middleware also captures.

import crypto from 'crypto';
import prisma from '../prisma';

function computeHash(data: {
  sequenceNumber: number;
  action: string;
  escrowId: string;
  amount: number;
  timestamp: string;
  previousHash: string;
}): string {
  const payload = JSON.stringify({
    seq: data.sequenceNumber,
    act: data.action,
    eid: data.escrowId,
    amt: data.amount,
    ts: data.timestamp,
    prev: data.previousHash,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

// BID-ATOMICITY G3 — bounded serialization retry. The unique index
// EscrowAuditLog_escrowId_sequenceNumber_key makes the second of two
// racing appends fail with P2002; that is a LEGITIMATE concurrent append
// (a webhook racing the reconciler, an admin decision racing a
// settlement), so the loser must re-read the new chain tail, recompute
// its sequence + hashes and try again — bounded, so a pathological storm
// still surfaces as an error instead of spinning.
const MAX_APPEND_ATTEMPTS = 5;

// Inside a Postgres transaction a failed statement poisons the whole
// transaction, so the retry MUST wrap each attempt in a savepoint and
// roll back to it on P2002 — otherwise every later statement (including
// the caller's own writes) fails with "current transaction is aborted".
const APPEND_SAVEPOINT = 'bimoto_audit_append';

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown })?.code === 'P2002';
}

async function appendOnce(db: any, entry: {
  escrowId: string;
  action: string;
  amount: number;
  triggeredBy: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const lastEntry = await db.escrowAuditLog.findFirst({
    where: { escrowId: entry.escrowId },
    orderBy: { sequenceNumber: 'desc' },
  });

  const sequenceNumber = lastEntry ? lastEntry.sequenceNumber + 1 : 0;
  const previousHash = lastEntry ? lastEntry.entryHash : 'GENESIS';
  const timestamp = new Date().toISOString();

  const entryHash = computeHash({
    sequenceNumber,
    action: entry.action,
    escrowId: entry.escrowId,
    amount: entry.amount,
    timestamp,
    previousHash,
  });

  await db.escrowAuditLog.create({
    data: {
      escrowId: entry.escrowId,
      sequenceNumber,
      action: entry.action,
      previousHash,
      entryHash,
      amount: entry.amount,
      triggeredBy: entry.triggeredBy,
      metadata: (entry.metadata ?? undefined) as any,
      createdAt: new Date(timestamp),
    },
  });
}

export async function appendAuditEntryTx(
  tx: any,
  escrowId: string,
  action: string,
  amount: number,
  triggeredBy: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  // Savepoints need raw SQL on the SAME connection the transaction runs
  // on — Prisma's interactive transaction client guarantees that. Test
  // harnesses mock tx with model objects only; without $executeRawUnsafe
  // there is nothing to roll back to, so those fall back to the
  // pre-retry single-attempt behaviour (an error propagates and rolls
  // back the caller's transaction, exactly as before this dispatch).
  const canRetry = typeof tx.$executeRawUnsafe === 'function';
  for (let attempt = 1; ; attempt += 1) {
    if (canRetry) await tx.$executeRawUnsafe(`SAVEPOINT ${APPEND_SAVEPOINT}`);
    try {
      await appendOnce(tx, { escrowId, action, amount, triggeredBy, metadata });
      if (canRetry) await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${APPEND_SAVEPOINT}`);
      return;
    } catch (err) {
      if (!canRetry || !isUniqueViolation(err) || attempt >= MAX_APPEND_ATTEMPTS) {
        throw err;
      }
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${APPEND_SAVEPOINT}`);
      // Loop: re-read the (now longer) chain, recompute, try again.
    }
  }
}

export async function appendAuditEntry(
  escrowId: string,
  action: string,
  amount: number,
  triggeredBy: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  // No enclosing transaction here, so a failed insert poisons nothing —
  // a plain bounded loop suffices.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await appendOnce(prisma, { escrowId, action, amount, triggeredBy, metadata });
      return;
    } catch (err) {
      if (!isUniqueViolation(err) || attempt >= MAX_APPEND_ATTEMPTS) {
        throw err;
      }
    }
  }
}

export async function verifyAuditChain(escrowId: string): Promise<{
  valid: boolean;
  entries: number;
  brokenAt?: number;
}> {
  const entries = await prisma.escrowAuditLog.findMany({
    where: { escrowId },
    orderBy: { sequenceNumber: 'asc' },
  });

  if (entries.length === 0) return { valid: true, entries: 0 };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const expectedPrevHash = i === 0 ? 'GENESIS' : entries[i - 1].entryHash;

    if (entry.previousHash !== expectedPrevHash) {
      return { valid: false, entries: entries.length, brokenAt: i };
    }

    const recomputedHash = computeHash({
      sequenceNumber: entry.sequenceNumber,
      action: entry.action,
      escrowId: entry.escrowId,
      amount: entry.amount,
      timestamp: entry.createdAt.toISOString(),
      previousHash: entry.previousHash,
    });

    if (recomputedHash !== entry.entryHash) {
      return { valid: false, entries: entries.length, brokenAt: i };
    }
  }

  return { valid: true, entries: entries.length };
}
