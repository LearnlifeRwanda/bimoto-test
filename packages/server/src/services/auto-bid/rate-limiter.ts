// SERVICES/AUTO-BID/RATE-LIMITER.TS
//
// Rolling 1-hour rate limiter for driver auto-bids. A driver is
// capped at MAX_AUTO_BIDS_PER_DRIVER_PER_HOUR auto-bids inside a
// rolling RATE_LIMIT_WINDOW_MINUTES window — NOT a calendar hour.
// Example: 30 bids fired between 14:30 and 15:00 are throttled
// until 15:30, with one entry dropping off the window each minute.
//
// Implementation: in-memory Map<driverId, Date[]>. Pilot scale is
// well within memory; post-pilot, swap with Redis.
//
// Memory hygiene (Dispatch Q): startRateLimiterCleanup() runs a
// periodic interval that walks all buckets, filters stale timestamps
// older than the window, and deletes buckets that have no fresh
// entries. Without this, an inactive driver's stale timestamps sit in
// the Map forever (lazy prune in checkRateLimit/recordAutoBid only
// fires when those functions are called for that driver).

import {
  MAX_AUTO_BIDS_PER_DRIVER_PER_HOUR,
  RATE_LIMIT_WINDOW_MINUTES,
} from './config';

const buckets = new Map<string, Date[]>();

const RATE_LIMITER_CLEANUP_INTERVAL_MS = parseInt(
  process.env.K2_RATE_CLEANUP_INTERVAL_MS ?? '1800000',
  10,
);

let cleanupTimer: NodeJS.Timeout | null = null;

function pruneOld(timestamps: Date[], cutoff: Date): Date[] {
  // Drop entries strictly older than the rolling window cutoff.
  let i = 0;
  while (i < timestamps.length && timestamps[i] < cutoff) i++;
  if (i === 0) return timestamps;
  return timestamps.slice(i);
}

export interface RateLimiterCleanupStats {
  prunedBuckets: number;
  shrunkBuckets: number;
  remainingBuckets: number;
}

export function runRateLimiterCleanup(
  now: Date = new Date(),
): RateLimiterCleanupStats {
  const cutoff = new Date(
    now.getTime() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  );
  let prunedBuckets = 0;
  let shrunkBuckets = 0;
  for (const [driverId, timestamps] of buckets.entries()) {
    const fresh = pruneOld(timestamps, cutoff);
    if (fresh.length === 0) {
      buckets.delete(driverId);
      prunedBuckets++;
    } else if (fresh !== timestamps) {
      buckets.set(driverId, fresh);
      shrunkBuckets++;
    }
  }
  return {
    prunedBuckets,
    shrunkBuckets,
    remainingBuckets: buckets.size,
  };
}

export function startRateLimiterCleanup(): void {
  if (cleanupTimer !== null) return;
  cleanupTimer = setInterval(() => {
    const stats = runRateLimiterCleanup();
    if (stats.prunedBuckets > 0 || stats.shrunkBuckets > 0) {
      console.log(
        `[K2] rate-limiter-cleanup pruned=${stats.prunedBuckets} shrunk=${stats.shrunkBuckets} remaining=${stats.remainingBuckets}`,
      );
    }
  }, RATE_LIMITER_CLEANUP_INTERVAL_MS);
  // Don't keep the process alive just for cleanup.
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
}

export function stopRateLimiterCleanup(): void {
  if (cleanupTimer !== null) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

export interface RateLimitState {
  allowed: boolean;
  currentCount: number;
  windowResetsAt: Date;
}

export function checkRateLimit(
  driverId: string,
  now: Date = new Date(),
): RateLimitState {
  const cutoff = new Date(
    now.getTime() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  );
  const existing = buckets.get(driverId) ?? [];
  const fresh = pruneOld(existing, cutoff);
  if (fresh !== existing) buckets.set(driverId, fresh);

  // The window "resets" (i.e. one entry drops off) when the oldest
  // timestamp ages out. If the bucket is empty, return the cutoff
  // itself (caller can interpret as "no waiting needed").
  const windowResetsAt =
    fresh.length === 0
      ? cutoff
      : new Date(fresh[0].getTime() + RATE_LIMIT_WINDOW_MINUTES * 60 * 1000);

  return {
    allowed: fresh.length < MAX_AUTO_BIDS_PER_DRIVER_PER_HOUR,
    currentCount: fresh.length,
    windowResetsAt,
  };
}

export function recordAutoBid(driverId: string, now: Date = new Date()): void {
  const cutoff = new Date(
    now.getTime() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  );
  const existing = buckets.get(driverId) ?? [];
  const fresh = pruneOld(existing, cutoff);
  fresh.push(now);
  buckets.set(driverId, fresh);
}

export function _resetForTests(): void {
  buckets.clear();
  stopRateLimiterCleanup();
}

export function _bucketCountForTests(): number {
  return buckets.size;
}

export function _seedBucketForTests(driverId: string, timestamps: Date[]): void {
  buckets.set(driverId, [...timestamps]);
}
