// ESCROW-CREDIT G5 — balance writes under GENUINE concurrency: a
// creditDriverBalance increment landing in the middle of markBatchPaidOut
// must survive settlement, and a webhook-settled SUCCESS batch must be
// un-flippable by a stale reconciler.
//
// The prisma mock is a stateful in-memory store whose updateMany honors
// status predicates and the pendingAmount gte guard as Postgres does, and
// whose decrements/increments compose instead of overwriting. A gate
// inside driverBalance.updateMany holds the settlement between its batch
// flip and its balance deduction — exactly the window where the old
// read-compute-overwrite destroyed concurrent credits — while the credit
// lands.

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

jest.mock('../prisma', () => {
  const state = {
    batches: new Map<string, any>(),
    balances: new Map<string, { driverId: string; pendingAmount: number }>(),
    // Set per-test: holds the settlement's balance deduction until released.
    decrementGate: null as (() => Promise<void>) | null,
  };

  const db: any = {
    __state: state,
    $transaction: (fn: (tx: any) => Promise<any>) => fn(db),
    driverPayoutBatch: {
      findUnique: jest.fn(async ({ where }: any) => {
        const row = state.batches.get(where.id);
        return row ? { ...row } : null;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = state.batches.get(where.id);
        if (!row || (where.status !== undefined && row.status !== where.status)) {
          return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = state.batches.get(where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
    },
    driverBalance: {
      findUnique: jest.fn(async ({ where }: any) => {
        const b = state.balances.get(where.driverId);
        return b ? { ...b } : null;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        // Hold HERE — after the batch flip, before the deduction — while a
        // concurrent credit lands.
        if (state.decrementGate) await state.decrementGate();
        const b = state.balances.get(where.driverId);
        if (!b) return { count: 0 };
        const gte = where.pendingAmount?.gte;
        if (gte !== undefined && b.pendingAmount < gte) return { count: 0 };
        b.pendingAmount -= data.pendingAmount.decrement;
        return { count: 1 };
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const b = state.balances.get(where.driverId);
        if (!b) {
          state.balances.set(where.driverId, { ...create });
          return create;
        }
        b.pendingAmount += update.pendingAmount.increment;
        return b;
      }),
    },
  };

  return { __esModule: true, default: db };
});

import prisma from '../prisma';
import {
  markBatchPaidOut,
  markBatchFailed,
  creditDriverBalance,
} from '../services/payout.service';

const db = prisma as any;
const state = db.__state;
const DRIVER = 'driver-1';

beforeEach(() => {
  jest.clearAllMocks();
  state.batches.clear();
  state.balances.clear();
  state.decrementGate = null;
});

describe('a credit landing during markBatchPaidOut survives settlement', () => {
  test('final balance is exactly the mid-settlement credit, not zero', async () => {
    state.batches.set('b1', { id: 'b1', driverId: DRIVER, amount: 5000, status: 'PENDING' });
    state.balances.set(DRIVER, { driverId: DRIVER, pendingAmount: 5000 });

    // Gate the deduction until we've injected the concurrent credit.
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    state.decrementGate = () => gate;

    const settlement = markBatchPaidOut(DRIVER, 'b1', 'flw-1');

    // Let the settlement reach the gated deduction (batch already SUCCESS),
    // then land a fresh ride credit — the exact window the old
    // read-compute-overwrite lost.
    await new Promise((r) => setImmediate(r));
    expect(state.batches.get('b1').status).toBe('SUCCESS');
    state.decrementGate = null; // the credit itself must not block
    await creditDriverBalance(DRIVER, 700, prisma);
    expect(state.balances.get(DRIVER)!.pendingAmount).toBe(5700);

    releaseGate();
    await settlement;

    // 5000 + 700 - 5000 = 700: the mid-settlement credit survived. The old
    // overwrite wrote max(0, 5000 - 5000) = 0 and erased it.
    expect(state.balances.get(DRIVER)!.pendingAmount).toBe(700);
  });
});

describe('markBatchFailed cannot flip a settled batch', () => {
  test('SUCCESS stays SUCCESS when a stale reconciler reports failure', async () => {
    state.batches.set('b1', {
      id: 'b1',
      driverId: DRIVER,
      amount: 5000,
      status: 'SUCCESS',
      flwTransferId: 'flw-1',
    });

    await markBatchFailed('b1', 'gateway_lost_or_timeout');

    expect(state.batches.get('b1').status).toBe('SUCCESS');
    expect(state.batches.get('b1').failureReason).toBeUndefined();
  });

  test('PENDING still fails normally', async () => {
    state.batches.set('b1', { id: 'b1', driverId: DRIVER, amount: 5000, status: 'PENDING' });

    await markBatchFailed('b1', 'gateway_reported_failure');

    expect(state.batches.get('b1').status).toBe('FAILED');
    expect(state.batches.get('b1').failureReason).toBe('gateway_reported_failure');
  });

  test('markBatchFailed racing markBatchPaidOut: settled batch keeps its money deducted exactly once', async () => {
    state.batches.set('b1', { id: 'b1', driverId: DRIVER, amount: 5000, status: 'PENDING' });
    state.balances.set(DRIVER, { driverId: DRIVER, pendingAmount: 5000 });

    // Both fire concurrently; whichever claims the PENDING row first wins,
    // the other no-ops (markBatchFailed) or 409s (markBatchPaidOut).
    const results = await Promise.allSettled([
      markBatchPaidOut(DRIVER, 'b1', 'flw-1'),
      markBatchFailed('b1', 'gateway_lost_or_timeout'),
    ]);

    const finalStatus = state.batches.get('b1').status;
    if (finalStatus === 'SUCCESS') {
      expect(state.balances.get(DRIVER)!.pendingAmount).toBe(0);
    } else {
      expect(finalStatus).toBe('FAILED');
      // Failed batch leaves the money in the balance for the next sweep.
      expect(state.balances.get(DRIVER)!.pendingAmount).toBe(5000);
      expect(results[0].status).toBe('rejected'); // paid-out loser got its 409
    }
  });
});
