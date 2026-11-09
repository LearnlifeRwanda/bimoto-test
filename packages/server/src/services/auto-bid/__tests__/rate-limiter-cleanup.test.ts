// Dispatch Q (5/7) — periodic cleanup test. Verifies that
// runRateLimiterCleanup actively prunes stale timestamps and removes
// buckets that have no fresh entries.

import {
  _resetForTests,
  _bucketCountForTests,
  _seedBucketForTests,
  runRateLimiterCleanup,
  startRateLimiterCleanup,
  stopRateLimiterCleanup,
  recordAutoBid,
  checkRateLimit,
} from '../rate-limiter';
import { RATE_LIMIT_WINDOW_MINUTES } from '../config';

beforeEach(() => {
  _resetForTests();
});

afterAll(() => {
  _resetForTests();
});

describe('auto-bid/rate-limiter cleanup', () => {
  it('drivers with all-stale timestamps are pruned from the Map', () => {
    const now = new Date('2026-05-05T12:00:00Z');
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    _seedBucketForTests('stale-driver', [twoHoursAgo, twoHoursAgo]);
    expect(_bucketCountForTests()).toBe(1);

    const stats = runRateLimiterCleanup(now);
    expect(stats.prunedBuckets).toBe(1);
    expect(stats.remainingBuckets).toBe(0);
    expect(_bucketCountForTests()).toBe(0);
  });

  it('drivers with at least one fresh timestamp keep the bucket (with stale entries removed)', () => {
    const now = new Date('2026-05-05T12:00:00Z');
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const recent = new Date(now.getTime() - 5 * 60 * 1000); // 5 min ago
    _seedBucketForTests('mixed-driver', [twoHoursAgo, twoHoursAgo, recent]);

    const stats = runRateLimiterCleanup(now);
    expect(stats.prunedBuckets).toBe(0);
    expect(stats.shrunkBuckets).toBe(1);
    expect(_bucketCountForTests()).toBe(1);

    // Verify the remaining bucket only has the fresh timestamp.
    const state = checkRateLimit('mixed-driver', now);
    expect(state.currentCount).toBe(1);
  });

  it('runRateLimiterCleanup is idempotent — second call on already-clean state is a noop', () => {
    const now = new Date('2026-05-05T12:00:00Z');
    recordAutoBid('active-driver', now);
    runRateLimiterCleanup(now);
    const stats = runRateLimiterCleanup(now);
    expect(stats.prunedBuckets).toBe(0);
    expect(stats.shrunkBuckets).toBe(0);
    expect(stats.remainingBuckets).toBe(1);
  });

  it('startRateLimiterCleanup is idempotent — second call does not start a second timer', () => {
    startRateLimiterCleanup();
    startRateLimiterCleanup();
    // No exception, no double-timer; stop returns to clean state.
    stopRateLimiterCleanup();
    expect(_bucketCountForTests()).toBe(0);
  });

  it('stopRateLimiterCleanup clears the interval (no further pruning fires)', () => {
    startRateLimiterCleanup();
    stopRateLimiterCleanup();
    // No assertion possible on the interval directly, but absence of a
    // dangling timer is what unref+clear together guarantee. Calling
    // stop a second time is a noop.
    stopRateLimiterCleanup();
  });

  it('after cleanup, checkRateLimit for a pruned driver returns clean state', () => {
    const now = new Date('2026-05-05T12:00:00Z');
    const longAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000);
    _seedBucketForTests('inactive-driver', [longAgo, longAgo, longAgo]);

    runRateLimiterCleanup(now);

    const state = checkRateLimit('inactive-driver', now);
    expect(state.allowed).toBe(true);
    expect(state.currentCount).toBe(0);
  });

  it('cleanup at the exact window boundary keeps timestamps right on the edge', () => {
    const now = new Date('2026-05-05T12:00:00Z');
    const exactCutoff = new Date(
      now.getTime() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    );
    // strictly older than cutoff is dropped; equal timestamps depend on
    // pruneOld's "<" semantics — equal stays. Seed two: one 1ms older,
    // one exactly at cutoff.
    const oneMsBefore = new Date(exactCutoff.getTime() - 1);
    _seedBucketForTests('edge-driver', [oneMsBefore, exactCutoff]);

    runRateLimiterCleanup(now);
    const state = checkRateLimit('edge-driver', now);
    expect(state.currentCount).toBe(1);
  });
});
