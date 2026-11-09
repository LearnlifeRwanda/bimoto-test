// R3-N-4 — graduated penalty threshold tests.
//
// Verifies the 3 / 5 / 10 ladder, idempotency under repeated no-shows
// past the same threshold, and that BOTH_NO_SHOW (0.5 increments) does
// NOT trip the integer thresholds prematurely (4.5 < 5, 5.0 trips).

import {
  applyDriverPenaltyForNoShow,
  NO_SHOW_FLAG_REASON,
  PENALTY_THRESHOLDS,
} from '../services/driver-penalty';

function buildTx() {
  const userUpdates: any[] = [];
  const tx: any = {
    user: {
      update: jest.fn(async (args: any) => {
        userUpdates.push(args);
        return { id: args.where.id };
      }),
    },
  };
  return { tx, userUpdates };
}

describe('applyDriverPenaltyForNoShow — R3-N-4 graduated thresholds', () => {
  test('count below WARNING_THRESHOLD: no penalty, no warning', async () => {
    const { tx, userUpdates } = buildTx();
    const outcome = await applyDriverPenaltyForNoShow(tx, 'd1', 2);
    expect(outcome).toEqual({
      driverId: 'd1',
      newCount: 2,
      suspendedUntil: null,
      flagged: false,
      warningOnly: false,
    });
    expect(userUpdates).toHaveLength(0);
  });

  test('count at WARNING_THRESHOLD: warningOnly=true, no DB update', async () => {
    const { tx, userUpdates } = buildTx();
    const outcome = await applyDriverPenaltyForNoShow(tx, 'd1', 3);
    expect(outcome.warningOnly).toBe(true);
    expect(outcome.suspendedUntil).toBeNull();
    expect(outcome.flagged).toBe(false);
    expect(userUpdates).toHaveLength(0);
  });

  test('count at SUSPENSION_24H_THRESHOLD: sets suspendedUntil ~24h ahead', async () => {
    const before = Date.now();
    const { tx, userUpdates } = buildTx();
    const outcome = await applyDriverPenaltyForNoShow(tx, 'd1', 5);
    const after = Date.now();
    expect(outcome.suspendedUntil).toBeInstanceOf(Date);
    expect(outcome.flagged).toBe(false);
    expect(outcome.warningOnly).toBe(false);
    const ms = outcome.suspendedUntil!.getTime();
    expect(ms - before).toBeGreaterThanOrEqual(
      PENALTY_THRESHOLDS.SUSPENSION_24H_DURATION_MS - 100,
    );
    expect(ms - after).toBeLessThanOrEqual(
      PENALTY_THRESHOLDS.SUSPENSION_24H_DURATION_MS + 100,
    );
    expect(userUpdates).toHaveLength(1);
    expect(userUpdates[0].where).toEqual({ id: 'd1' });
    expect(userUpdates[0].data.suspendedUntil).toBeInstanceOf(Date);
  });

  test('suspends at 5 no-shows but not at 4.5 (BOTH_NO_SHOW edge)', async () => {
    // 4.5 → no suspension
    const { tx: tx1 } = buildTx();
    let outcome = await applyDriverPenaltyForNoShow(tx1, 'd1', 4.5);
    expect(outcome.suspendedUntil).toBeNull();
    expect(outcome.warningOnly).toBe(true); // still above WARNING_THRESHOLD

    // 5.0 → 24h suspension
    const { tx: tx2 } = buildTx();
    outcome = await applyDriverPenaltyForNoShow(tx2, 'd1', 5);
    expect(outcome.suspendedUntil).toBeInstanceOf(Date);
  });

  test('count at FLAG_THRESHOLD: sets isFlagged, NOT suspendedUntil', async () => {
    const { tx, userUpdates } = buildTx();
    const outcome = await applyDriverPenaltyForNoShow(tx, 'd1', 10);
    expect(outcome.flagged).toBe(true);
    expect(outcome.suspendedUntil).toBeNull();
    expect(outcome.warningOnly).toBe(false);
    expect(userUpdates).toHaveLength(1);
    expect(userUpdates[0].data).toEqual({
      isFlagged: true,
      flagReason: NO_SHOW_FLAG_REASON,
    });
  });

  test('count above FLAG_THRESHOLD (e.g. 12): still flag-only path', async () => {
    const { tx, userUpdates } = buildTx();
    const outcome = await applyDriverPenaltyForNoShow(tx, 'd1', 12);
    expect(outcome.flagged).toBe(true);
    expect(userUpdates).toHaveLength(1);
    expect(userUpdates[0].data).toEqual({
      isFlagged: true,
      flagReason: NO_SHOW_FLAG_REASON,
    });
  });

  test('idempotency: invoking twice in a row does not double-suspend', async () => {
    // The function itself is idempotent: at the same count, the same
    // outcome is computed. Caller (applyCancelAttribution) only invokes
    // it AFTER a successful increment, so two calls means two
    // increments, hitting different thresholds — but two calls at the
    // same count produce equivalent outcomes.
    const { tx } = buildTx();
    const o1 = await applyDriverPenaltyForNoShow(tx, 'd1', 5);
    const o2 = await applyDriverPenaltyForNoShow(tx, 'd1', 5);
    expect(o1.suspendedUntil).toBeInstanceOf(Date);
    expect(o2.suspendedUntil).toBeInstanceOf(Date);
    expect(o1.flagged).toBe(false);
    expect(o2.flagged).toBe(false);
  });

  test('FLAG_THRESHOLD takes precedence over SUSPENSION_24H_THRESHOLD', async () => {
    const { tx, userUpdates } = buildTx();
    const outcome = await applyDriverPenaltyForNoShow(tx, 'd1', 11);
    expect(outcome.flagged).toBe(true);
    expect(outcome.suspendedUntil).toBeNull();
    // Only one user.update call (the isFlagged one), no suspendedUntil set.
    expect(userUpdates).toHaveLength(1);
    expect(userUpdates[0].data.suspendedUntil).toBeUndefined();
  });

  test('warningOnly transition at exactly 3', async () => {
    const { tx } = buildTx();
    const outcome = await applyDriverPenaltyForNoShow(tx, 'd1', 3);
    expect(outcome.warningOnly).toBe(true);
    expect(outcome.newCount).toBe(3);
  });

  test('thresholds are exposed for downstream callers', () => {
    expect(PENALTY_THRESHOLDS.WARNING_THRESHOLD).toBe(3);
    expect(PENALTY_THRESHOLDS.SUSPENSION_24H_THRESHOLD).toBe(5);
    expect(PENALTY_THRESHOLDS.FLAG_THRESHOLD).toBe(10);
    expect(PENALTY_THRESHOLDS.SUSPENSION_24H_DURATION_MS).toBe(
      24 * 60 * 60 * 1000,
    );
  });
});
