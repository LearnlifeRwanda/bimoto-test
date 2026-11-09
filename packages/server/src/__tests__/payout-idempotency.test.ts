// PAYOUT-IDEMPOTENCY G5 — the invariant under GENUINE concurrency, not
// just in sequence: at most one un-settled PENDING DriverPayoutBatch per
// driver, so two simultaneous firePreferenceChangeBatch calls (a driver
// double-tapping "end shift") produce exactly one batch and one gateway
// transfer, with the loser returning the no-op shape.
//
// The prisma mock is a stateful in-memory table that enforces the
// partial unique index DriverPayoutBatch_driverId_pending_key exactly as
// Postgres does (verified against a real Postgres 16: the violation
// surfaces as PrismaClientKnownRequestError P2002 with target
// ["driverId"]). Barriers hold both concurrent calls at each in-flight
// read so BOTH pass the checks on a pre-insert snapshot before EITHER
// create runs — the worst-case interleaving the old read-then-write
// guard lost, forcing the constraint (not luck) to decide the winner.

jest.mock('../services/payment', () => ({
  transferToWallet: jest.fn(),
  FlutterwaveError: class FlutterwaveError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));

jest.mock('../services/aml', () => ({
  assertAmlCheck: jest.fn().mockResolvedValue(undefined),
  AmlError: class AmlError extends Error {},
}));

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

jest.mock('../prisma', () => {
  interface BatchRow {
    id: string;
    driverId: string;
    amount: number;
    txRef: string | null;
    status: string;
    trigger: string;
    paidOutAt: Date | null;
    flwTransferId?: string | null;
    failureReason?: string | null;
  }

  const state = {
    table: [] as BatchRow[],
    balances: {} as Record<string, { driverId: string; pendingAmount: number }>,
    // Set per-test to hold concurrent callers at the in-flight reads.
    fastPathGate: null as (() => Promise<void>) | null,
    inTxGate: null as (() => Promise<void>) | null,
    findFirstCalls: 0,
    frozenAt: null as Date | null,
  };

  const pendingRowFor = (driverId: string) =>
    state.table.find((r) => r.driverId === driverId && r.status === 'PENDING');

  const uniqueViolation = () => {
    // Shape observed from a real partial-index rejection through Prisma 5.
    const err: any = new Error(
      'Unique constraint failed on the fields: (`driverId`)',
    );
    err.code = 'P2002';
    err.meta = { modelName: 'DriverPayoutBatch', target: ['driverId'] };
    return err;
  };

  const db: any = {
    __state: state,
    $transaction: (fn: (tx: any) => Promise<any>) => fn(db),
    driverPayoutBatch: {
      findFirst: jest.fn(async ({ where }: any) => {
        state.findFirstCalls += 1;
        // Snapshot BEFORE waiting at the barrier: both racers decide on
        // the pre-insert state, like two READ COMMITTED transactions.
        const snapshot = pendingRowFor(where.driverId);
        const isFastPath = state.findFirstCalls <= 2;
        if (isFastPath && state.fastPathGate) await state.fastPathGate();
        if (!isFastPath && state.inTxGate) await state.inTxGate();
        return snapshot ? { id: snapshot.id } : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        if (data.status === 'PENDING' && pendingRowFor(data.driverId)) {
          throw uniqueViolation();
        }
        const row: BatchRow = {
          id: data.id,
          driverId: data.driverId,
          amount: data.amount,
          txRef: data.txRef,
          status: data.status,
          trigger: data.trigger,
          paidOutAt: null,
        };
        state.table.push(row);
        return row;
      }),
      findUnique: jest.fn(
        async ({ where }: any) =>
          state.table.find((r) => r.id === where.id) ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const row = state.table.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
      // G3 predicated flip: honors the status predicate like Postgres.
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = state.table.find((r) => r.id === where.id);
        if (!row || (where.status !== undefined && row.status !== where.status)) {
          return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    driverBalance: {
      findUnique: jest.fn(
        async ({ where }: any) => state.balances[where.driverId] ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const b = state.balances[where.driverId];
        if (b && typeof data.pendingAmount === 'number') {
          b.pendingAmount = data.pendingAmount;
        }
        return b;
      }),
      // G3 conditional decrement: honors the gte guard like Postgres.
      updateMany: jest.fn(async ({ where, data }: any) => {
        const b = state.balances[where.driverId];
        if (!b) return { count: 0 };
        const gte = where.pendingAmount?.gte;
        if (gte !== undefined && b.pendingAmount < gte) return { count: 0 };
        b.pendingAmount -= data.pendingAmount.decrement;
        return { count: 1 };
      }),
      upsert: jest.fn(),
    },
    user: {
      findUnique: jest.fn(async () => ({
        id: 'driver-1',
        frozenAt: state.frozenAt,
        phoneEncrypted: encrypt('+250780000001'),
      })),
    },
  };

  return { __esModule: true, default: db };
});

import prisma from '../prisma';
import { encrypt } from '../utils/crypto';
import { firePreferenceChangeBatch } from '../services/payout.service';
import { transferToWallet } from '../services/payment';

const db = prisma as any;
const state = db.__state;
const transferMock = transferToWallet as jest.Mock;
const DRIVER = 'd1e2f3a4-aaaa-bbbb-cccc-000000000001';

// Barrier: the returned gate resolves only once `n` callers have arrived,
// so every caller observes state from BEFORE any of them proceeded.
function makeBarrier(n: number): () => Promise<void> {
  let arrived = 0;
  let release: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    arrived += 1;
    if (arrived >= n) release();
    return gate;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  state.table.length = 0;
  state.balances = { [DRIVER]: { driverId: DRIVER, pendingAmount: 5000 } };
  state.fastPathGate = null;
  state.inTxGate = null;
  state.findFirstCalls = 0;
  state.frozenAt = null;
  transferMock.mockResolvedValue({ flwTransferId: 'sim-flw-1', status: 'SUCCESS' });
});

describe('two simultaneous firePreferenceChangeBatch calls for one driver', () => {
  test('exactly one batch, one transfer; loser gets the no-op shape, no throw', async () => {
    // Hold both calls at the fast-path check AND at the in-transaction
    // re-check, so both observe "no batch in flight" and both attempt the
    // insert — the database constraint decides.
    state.fastPathGate = makeBarrier(2);
    state.inTxGate = makeBarrier(2);

    const [a, b] = await Promise.all([
      firePreferenceChangeBatch(DRIVER, 'SHIFT_END'),
      firePreferenceChangeBatch(DRIVER, 'SHIFT_END'),
    ]);

    const results = [a, b];
    const winners = results.filter((r) => r.batchId !== null);
    const losers = results.filter((r) => r.batchId === null);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    // The loser is indistinguishable from "nothing to pay" — the shape a
    // double-tapping driver's second request maps to 200, not 500.
    expect(losers[0]).toEqual({ batchId: null, amount: 0 });

    // Exactly one row ever hit the table, and exactly one gateway call.
    expect(state.table).toHaveLength(1);
    expect(transferMock).toHaveBeenCalledTimes(1);
    expect(winners[0].amount).toBe(5000);

    // Both racers really did attempt the create — the constraint, not the
    // read-check, picked the winner.
    expect(db.driverPayoutBatch.create).toHaveBeenCalledTimes(2);
  });

  test('loser returns no-op even when its stale read passed every check', async () => {
    // No barriers: simulate the pure constraint path by pre-inserting the
    // winner's row while forcing both read checks (fast path + in-tx) to
    // report "nothing in flight" — a maximally stale read. Once-values so
    // the factory implementation is restored for other tests.
    (db.driverPayoutBatch.findFirst as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    state.table.push({
      id: 'existing-batch',
      driverId: DRIVER,
      amount: 5000,
      txRef: 'existing-ref',
      status: 'PENDING',
      trigger: 'SHIFT_END',
      paidOutAt: null,
    });

    const result = await firePreferenceChangeBatch(DRIVER, 'SHIFT_END');
    expect(result).toEqual({ batchId: null, amount: 0 });
    expect(transferMock).not.toHaveBeenCalled();
  });
});

describe('legitimate repeat payouts', () => {
  test('a second end-shift payout works after the first batch settles', async () => {
    const first = await firePreferenceChangeBatch(DRIVER, 'SHIFT_END');
    expect(first.batchId).not.toBeNull();
    // transfer SUCCESS → markBatchPaidOut flipped the row to SUCCESS and
    // drained the balance inside the mock table.
    expect(state.table[0].status).toBe('SUCCESS');
    expect(state.balances[DRIVER].pendingAmount).toBe(0);

    // The driver earns again after the first payout settles.
    state.balances[DRIVER].pendingAmount = 3000;

    const second = await firePreferenceChangeBatch(DRIVER, 'SHIFT_END');
    expect(second.batchId).not.toBeNull();
    expect(second.batchId).not.toBe(first.batchId);
    expect(second.amount).toBe(3000);

    // Two distinct batches, two distinct references, two transfers — a
    // per-day key would have refused this genuine second payout.
    expect(state.table).toHaveLength(2);
    expect(state.table[0].txRef).not.toBe(state.table[1].txRef);
    expect(transferMock).toHaveBeenCalledTimes(2);
  });
});

describe('gateway reference (txRef) is batch-derived', () => {
  test('reference equals the stored txRef, embeds the batch id, fits the gateway cap', async () => {
    const result = await firePreferenceChangeBatch(DRIVER, 'SHIFT_END');
    const row = state.table[0];

    // The reference presented to the gateway IS the persisted txRef — any
    // future retry that reads the batch presents the identical reference.
    expect(transferMock).toHaveBeenCalledWith(
      expect.objectContaining({ reference: row.txRef }),
    );

    // Derived from the batch, not the clock: the batch id is the tail.
    expect(row.txRef).toBe(
      `bimoto-payout-${DRIVER.slice(0, 8)}-shift_end-${result.batchId}`,
    );
    expect(row.id).toBe(result.batchId);

    // Longest trigger is PREFERENCE_CHANGE (17 chars) → 77 chars max,
    // under Flutterwave's 100-char transfer-reference limit.
    const worstCase = `bimoto-payout-${DRIVER.slice(0, 8)}-preference_change-${result.batchId}`;
    expect(worstCase).toHaveLength(77);
    expect(worstCase.length).toBeLessThanOrEqual(100);
  });

  test('two separate payouts present two different references', async () => {
    await firePreferenceChangeBatch(DRIVER, 'SHIFT_END');
    state.balances[DRIVER].pendingAmount = 2000;
    await firePreferenceChangeBatch(DRIVER, 'SHIFT_END');

    const refs = transferMock.mock.calls.map((c) => c[0].reference);
    expect(refs).toHaveLength(2);
    expect(new Set(refs).size).toBe(2);
  });
});
