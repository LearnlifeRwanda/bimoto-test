import { randomUUID } from 'crypto';
import os from 'os';
import type { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { withDbRetry } from './db-resilience';

// PAYOUT-B — cross-process job leadership for the payout jobs.
// PAYOUT-F — plus withJobLease for the long calendar jobs.
//
// All background jobs start via setInterval in src/index.ts with in-memory
// dedupe only, so two overlapping server processes (scale-out, zero-downtime
// deploy) can both fire the same tick. For the payout family that means
// double-paying drivers. withJobLock elects a leader per tick through a
// PostgreSQL advisory lock: the first process to grab the lock runs fn(),
// everyone else gets null and skips the tick.
//
// Two variants, one contract (single runner per job name), different costs:
//
// - withJobLock — advisory xact lock. The lock lives inside an interactive
//   $transaction that stays open for fn's whole runtime, holding one pooled
//   connection and pinning the database's oldest-open-transaction horizon
//   (vacuum cannot clean behind it), and racing LOCK_HOLD_TIMEOUT_MS. Cheap
//   and exactly right for the fast tick jobs (seconds per tick, once a
//   minute); wrong for anything that runs minutes.
//
// - withJobLease — a row in the JobLease table with an expiry. Claiming is
//   one short atomic statement; fn then runs OUTSIDE any transaction, so a
//   multi-minute run holds no connection and no transaction open. Release
//   deletes the row; a crashed holder never releases, and its stale lease
//   is claimable once expiresAt passes (self-healing, worst case one TTL
//   of no runs). Use this for the long calendar jobs (BNR monthly,
//   mobility aggregation, GPS retention). Pick a TTL comfortably above the
//   worst plausible run time — the point is single-runner, not speed.
//
// Why pg_try_advisory_xact_lock inside $transaction, not a session-scoped
// pg_try_advisory_lock + pg_advisory_unlock pair: session locks belong to a
// connection, and Prisma's pooled $queryRaw gives no guarantee that the
// lock and unlock statements run on the same connection — the unlock could
// silently fail (wrong connection) and leak the lock until that pooled
// connection dies. An interactive $transaction pins one connection for the
// whole callback, and a *_xact_ lock releases automatically at commit or
// rollback, so there is no unlock call to misroute and a crashed leader's
// lock dies with its transaction.
//
// The transaction is open for fn's whole runtime, holding one pooled
// connection. That's the point (the lock must outlive fn), and the payout
// jobs tick at most once a minute. fn's own queries run on the normal
// pooled client, NOT inside this transaction — the transaction only
// carries the lock.

// Prisma's default interactive-transaction timeout is 5s; a payout sweep
// doing sequential gateway transfers can legitimately take minutes.
const LOCK_HOLD_TIMEOUT_MS = 10 * 60 * 1000;
const LOCK_MAX_WAIT_MS = 5 * 1000;

const NOT_ACQUIRED = Symbol('job-lock-not-acquired');

/**
 * Runs fn() while holding the advisory lock derived from `name`, or returns
 * null without calling fn if another process currently holds it. Errors
 * thrown by fn propagate to the caller; the lock is released either way.
 */
export async function withJobLock<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  // DB-RESILIENCE G2 — retry the connection, never the operation. A
  // connection-establishment failure (P1001) before fn starts means the
  // tick provably did no work, so re-attempting the transaction is
  // safe. Once fn has started, a retry would re-run arbitrary job work
  // (payout sweeps included), so the fnStarted flag vetoes it and the
  // error propagates exactly as before.
  let fnStarted = false;
  const result = await withDbRetry(
    `job-lock:${name}`,
    () =>
      prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          // hashtext() maps the job name onto the int advisory-lock keyspace.
          const rows: Array<{ acquired: boolean }> = await tx.$queryRaw`
            SELECT pg_try_advisory_xact_lock(hashtext(${name})) AS acquired
          `;
          if (!rows[0]?.acquired) return NOT_ACQUIRED;
          fnStarted = true;
          return fn();
        },
        { maxWait: LOCK_MAX_WAIT_MS, timeout: LOCK_HOLD_TIMEOUT_MS },
      ),
    { shouldRetry: () => !fnStarted },
  );
  return result === NOT_ACQUIRED ? null : (result as T);
}

/**
 * Runs fn() while holding the JobLease row named `name`, or returns null
 * without calling fn if another process holds an unexpired lease. The claim
 * is a single atomic INSERT … ON CONFLICT statement (succeeds if no lease
 * row exists or the existing one has expired); fn runs outside any
 * transaction; the lease is released in a finally either way. A holder that
 * crashes without releasing is healed by expiry: after ttlMs the stale row
 * is claimable again.
 */
export async function withJobLease<T>(
  name: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  // Unique per attempt so release can't delete a lease someone else
  // re-claimed after ours expired mid-run.
  const holder = `${os.hostname()}#${process.pid}#${randomUUID()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  // Atomic claim: insert wins if no row; the conflicting update wins only
  // if the existing lease has expired. RETURNING tells us which happened —
  // zero rows means a live holder exists and we skip.
  // DB-RESILIENCE G2 — the claim and the release are each one statement
  // that is safe to re-attempt after a connection-establishment failure
  // (the statement never reached the server); fn itself is never retried.
  const claimed: Array<{ name: string }> = await withDbRetry(
    `job-lease-claim:${name}`,
    () => prisma.$queryRaw`
      INSERT INTO "JobLease" ("name", "holder", "acquiredAt", "expiresAt")
      VALUES (${name}, ${holder}, ${now}, ${expiresAt})
      ON CONFLICT ("name") DO UPDATE
        SET "holder" = EXCLUDED."holder",
            "acquiredAt" = EXCLUDED."acquiredAt",
            "expiresAt" = EXCLUDED."expiresAt"
        WHERE "JobLease"."expiresAt" < ${now}
      RETURNING "name"
    `,
  );
  if (claimed.length === 0) return null;

  try {
    return await fn();
  } finally {
    // Holder-scoped delete: releases only our own lease (idempotent, so
    // the connection-error retry is safe; a lease that still can't be
    // released heals by expiry).
    await withDbRetry(`job-lease-release:${name}`, () => prisma.$executeRaw`
      DELETE FROM "JobLease" WHERE "name" = ${name} AND "holder" = ${holder}
    `);
  }
}
