import prisma from '../prisma';
import { dbErrorCode, isDbConnectionError, isDbUnreachableError } from './db-errors';

// DB-RESILIENCE G2 — retry connection-establishment failures, and only
// those. Built for the pilot-Mac sleep incident: the machine sleeps,
// every socket in Prisma's pool dies while Postgres stays healthy, and
// on wake the pool hands out dead connections forever. The heal is
// twofold: tear the dead pool down ($disconnect — the next query
// reconnects fresh) and re-attempt the operation with backoff.
//
// Only errors where the statement provably never reached the server
// (see db-errors.ts) are retried, so a retry can never double-execute
// anything. Between attempts no query, transaction, or pool slot is
// held: the failed attempt's promise has settled before we wait, and
// the wait itself is a plain timer.

export interface DbRetryOptions {
  /** Total attempts including the first (default 5). */
  maxAttempts?: number;
  /** First backoff delay; doubles per attempt, ±25% jitter (default 500ms). */
  baseDelayMs?: number;
  /** Backoff ceiling (default 5000ms). */
  maxDelayMs?: number;
  /**
   * Extra veto on top of the connection-error check. Used by the job
   * lock to retry the connection but never the job body: once fn has
   * started, a retry would re-run it.
   */
  shouldRetry?: (err: unknown) => boolean;
}

// ---- connection health state (read by /api/health, DB-RESILIENCE G5) ----

let lastSuccessAt: Date | null = null;
let lastErrorAt: Date | null = null;
let lastErrorCode: string | null = null;
let lastErrorMessage: string | null = null;
let consecutiveConnectionFailures = 0;
let unreachableSince: Date | null = null;

export interface DbHealthSnapshot {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  consecutiveConnectionFailures: number;
  unreachableSince: string | null;
}

export function getDbHealthSnapshot(): DbHealthSnapshot {
  return {
    lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
    lastErrorAt: lastErrorAt?.toISOString() ?? null,
    lastErrorCode,
    lastErrorMessage,
    consecutiveConnectionFailures,
    unreachableSince: unreachableSince?.toISOString() ?? null,
  };
}

export function recordDbSuccess(context: string): void {
  lastSuccessAt = new Date();
  if (consecutiveConnectionFailures > 0) {
    console.log(
      `[DB-RESILIENCE] ${lastSuccessAt.toISOString()} database recovered at ${context} ` +
        `after ${consecutiveConnectionFailures} consecutive connection failure(s)` +
        (unreachableSince ? ` (unreachable since ${unreachableSince.toISOString()})` : ''),
    );
  }
  consecutiveConnectionFailures = 0;
  unreachableSince = null;
}

export function recordDbFailure(context: string, err: unknown): void {
  lastErrorAt = new Date();
  lastErrorCode = dbErrorCode(err);
  lastErrorMessage = err instanceof Error ? err.message : String(err);
  // P1017 counts toward the outage window too: it is what dead pooled
  // sockets throw before fresh connection attempts start failing P1001.
  if (isDbUnreachableError(err)) {
    consecutiveConnectionFailures += 1;
    if (!unreachableSince) unreachableSince = lastErrorAt;
  }
}

// ---- pool reset ----

// $disconnect drops every pooled socket (dead ones included); Prisma
// reconnects automatically on the next query. Rate-limited so a burst
// of concurrently-retrying operations shares one reset instead of
// thrashing the engine.
let lastPoolResetAt = 0;

async function resetConnectionPool(): Promise<void> {
  const now = Date.now();
  if (now - lastPoolResetAt < 1000) return;
  lastPoolResetAt = now;
  try {
    await prisma.$disconnect();
  } catch {
    // Best-effort: a failed disconnect must never mask the real error.
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs fn(), retrying with exponential backoff + jitter when — and only
 * when — it fails with a connection-establishment error (P1001/P1002).
 * Every other error propagates on the first throw. The dead connection
 * pool is torn down before each retry so the re-attempt gets fresh
 * sockets. No pool slot is held while waiting between attempts.
 */
export async function withDbRetry<T>(
  context: string,
  fn: () => Promise<T>,
  opts: DbRetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 5000;

  for (let attempt = 1; ; attempt++) {
    try {
      const result = await fn();
      recordDbSuccess(context);
      return result;
    } catch (err) {
      recordDbFailure(context, err);
      if (!isDbConnectionError(err) || (opts.shouldRetry && !opts.shouldRetry(err))) {
        // Not (safely) retryable — but if the database is unreachable
        // (P1017 from a dead pooled socket included), still tear the
        // pool down so the NEXT operation gets fresh sockets instead of
        // the pool handing out dead connections forever. The operation
        // itself fails exactly as before.
        if (isDbUnreachableError(err)) {
          console.error(
            `[DB-RESILIENCE] ${new Date().toISOString()} connection error at ${context} ` +
              `(not retried): ${dbErrorCode(err) ?? 'unknown'} ${(err as Error).message}`,
          );
          await resetConnectionPool();
        }
        throw err;
      }
      const now = new Date().toISOString();
      const code = dbErrorCode(err) ?? 'unknown';
      console.error(
        `[DB-RESILIENCE] ${now} connection error at ${context} ` +
          `(attempt ${attempt}/${maxAttempts}): ${code} ${(err as Error).message}`,
      );
      if (attempt >= maxAttempts) {
        console.error(
          `[DB-RESILIENCE] ${new Date().toISOString()} giving up on ${context} after ${maxAttempts} attempts`,
        );
        throw err;
      }
      await resetConnectionPool();
      const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const delayMs = Math.round(backoff * (0.75 + Math.random() * 0.5));
      console.log(
        `[DB-RESILIENCE] ${new Date().toISOString()} retrying ${context} in ${delayMs}ms ` +
          `(attempt ${attempt + 1}/${maxAttempts})`,
      );
      await sleep(delayMs);
    }
  }
}
