// ESCROW-CREDIT G5 — the settlement invariant under GENUINE concurrency,
// not just in sequence: one release, one credit, no matter who races whom.
//
// The prisma mock is a stateful in-memory store whose escrow.updateMany
// honors the status predicate exactly as Postgres does (the affected-row
// count is computed against current state, atomically — JS's single thread
// stands in for the row lock). Barriers hold both racing callers at their
// outside-transaction reads so BOTH observe HELD before EITHER claims the
// transition — the worst-case interleaving the old unpredicated update
// double-credited, forcing the predicate (not luck) to pick the winner.

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

jest.mock('../prisma', () => {
  const state = {
    escrows: new Map<string, any>(),
    auditRows: [] as any[],
    balances: new Map<string, { driverId: string; pendingAmount: number }>(),
    users: new Map<string, { completedShifts: number }>(),
    profiles: new Map<string, { totalRides: number }>(),
    // Set per-test: gate on the outside-tx escrow read.
    findUniqueGate: null as (() => Promise<void>) | null,
  };

  const db: any = {
    __state: state,
    $transaction: (fn: (tx: any) => Promise<any>) => fn(db),
    escrow: {
      findUnique: jest.fn(async ({ where }: any) => {
        // Snapshot BEFORE waiting at the barrier: both racers decide on
        // the pre-claim state, like two READ COMMITTED reads.
        const row = state.escrows.get(where.journeyId);
        const snapshot = row ? { ...row } : null;
        if (state.findUniqueGate) await state.findUniqueGate();
        return snapshot;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = state.escrows.get(where.journeyId);
        if (!row || (where.status !== undefined && row.status !== where.status)) {
          return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    escrowAuditLog: {
      findFirst: jest.fn(async ({ where }: any) => {
        const rows = state.auditRows.filter((r: any) => r.escrowId === where.escrowId);
        return rows.length ? rows[rows.length - 1] : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        state.auditRows.push({ ...data });
        return data;
      }),
    },
    driverProfile: {
      update: jest.fn(async ({ where, data }: any) => {
        const p = state.profiles.get(where.userId) ?? { totalRides: 0 };
        p.totalRides += data.totalRides.increment;
        state.profiles.set(where.userId, p);
        return p;
      }),
    },
    user: {
      update: jest.fn(async ({ where, data }: any) => {
        const u = state.users.get(where.id) ?? { completedShifts: 0 };
        u.completedShifts += data.completedShifts.increment;
        state.users.set(where.id, u);
        return u;
      }),
    },
    driverBalance: {
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
import * as escrowService from '../services/escrow.service';

const db = prisma as any;
const state = db.__state;

const DRIVER = 'driver-1';
const CUSTOMER = 'customer-1';

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

function seedHeldEscrow(journeyId: string, payout = 1900) {
  state.escrows.set(journeyId, {
    id: `esc-${journeyId}`,
    journeyId,
    customerId: CUSTOMER,
    driverId: DRIVER,
    amount: payout + 100,
    driverPayout: payout,
    status: 'HELD',
  });
  return state.escrows.get(journeyId);
}

beforeEach(() => {
  jest.clearAllMocks();
  state.escrows.clear();
  state.auditRows.length = 0;
  state.balances.clear();
  state.users.clear();
  state.profiles.clear();
  state.findUniqueGate = null;
});

describe('two confirms racing on the same escrow', () => {
  test('exactly one credit, one audit entry, one counter increment; loser is a silent no-op', async () => {
    seedHeldEscrow('j1');
    // Hold both callers at the outside-transaction read so both see HELD.
    state.findUniqueGate = makeBarrier(2);

    const [a, b] = await Promise.all([
      escrowService.releaseEscrow('j1', CUSTOMER),
      escrowService.releaseEscrow('j1', CUSTOMER),
    ]);

    // One winner returns the released row; the loser returns null, no throw.
    const results = [a, b];
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(1);

    // Both really raced past the check — both attempted the claim.
    expect(db.escrow.updateMany).toHaveBeenCalledTimes(2);

    // The money invariant: ONE credit, ONE audit entry, ONE increment each.
    expect(state.balances.get(DRIVER)).toEqual({ driverId: DRIVER, pendingAmount: 1900 });
    expect(state.auditRows.filter((r: any) => r.action === 'RELEASED')).toHaveLength(1);
    expect(state.users.get(DRIVER)).toEqual({ completedShifts: 1 });
    expect(state.profiles.get(DRIVER)).toEqual({ totalRides: 1 });
    expect(state.escrows.get('j1').status).toBe('RELEASED');
  });
});

describe('manual confirm racing auto-confirm', () => {
  test('exactly one credit whichever path wins', async () => {
    const escrowRow = seedHeldEscrow('j2', 2850);
    // The auto-confirm job settles from a row loaded by its sweep query —
    // stale by construction. Snapshot it now (HELD), as findMany did.
    const staleSweepRow = { ...escrowRow };

    state.findUniqueGate = makeBarrier(1); // manual path's read, no extra hold

    const [manual, auto] = await Promise.all([
      // The exact call confirmJourney makes:
      escrowService.releaseEscrow('j2', CUSTOMER),
      // The exact call auto-confirm.job makes:
      db.$transaction((tx: any) =>
        escrowService.releaseEscrowTx(tx, staleSweepRow, 'SYSTEM', {
          settledVia: 'releaseEscrowTx',
          autoConfirmedSource: 'normal',
        }),
      ),
    ]);

    expect([manual, auto].filter((r) => r !== null)).toHaveLength(1);
    expect(state.balances.get(DRIVER)).toEqual({ driverId: DRIVER, pendingAmount: 2850 });
    expect(state.auditRows.filter((r: any) => r.action === 'RELEASED')).toHaveLength(1);
    expect(state.users.get(DRIVER)).toEqual({ completedShifts: 1 });
    expect(state.profiles.get(DRIVER)).toEqual({ totalRides: 1 });
  });
});

describe('release racing refund', () => {
  test('one transition wins; the loser neither credits nor writes its audit entry', async () => {
    seedHeldEscrow('j3', 1000);
    state.findUniqueGate = makeBarrier(2);

    const [released, refunded] = await Promise.all([
      escrowService.releaseEscrow('j3', CUSTOMER),
      escrowService.refundEscrow('j3', CUSTOMER),
    ]);

    const winners = [released, refunded].filter((r) => r !== null);
    expect(winners).toHaveLength(1);

    const finalStatus = state.escrows.get('j3').status;
    const releaseEntries = state.auditRows.filter((r: any) => r.action === 'RELEASED');
    const refundEntries = state.auditRows.filter((r: any) => r.action === 'REFUNDED');

    if (finalStatus === 'RELEASED') {
      expect(releaseEntries).toHaveLength(1);
      expect(refundEntries).toHaveLength(0);
      expect(state.balances.get(DRIVER)?.pendingAmount).toBe(1000);
    } else {
      expect(finalStatus).toBe('REFUNDED');
      expect(refundEntries).toHaveLength(1);
      expect(releaseEntries).toHaveLength(0);
      // A refund never credits the driver.
      expect(state.balances.get(DRIVER)).toBeUndefined();
    }
  });
});

describe('settlement parity — silence pays what a tap pays', () => {
  test('manual-path and auto-confirm-path settlement leave identical driver state', async () => {
    // Two equivalent journeys for two drivers, settled through the two
    // entry points that exist in production.
    state.escrows.set('j-manual', {
      id: 'esc-manual',
      journeyId: 'j-manual',
      customerId: CUSTOMER,
      driverId: 'driver-m',
      amount: 2000,
      driverPayout: 1900,
      status: 'HELD',
    });
    state.escrows.set('j-auto', {
      id: 'esc-auto',
      journeyId: 'j-auto',
      customerId: CUSTOMER,
      driverId: 'driver-a',
      amount: 2000,
      driverPayout: 1900,
      status: 'HELD',
    });

    // The manual confirm path (journey.service confirmJourney):
    await escrowService.releaseEscrow('j-manual', CUSTOMER);
    // The auto-confirm path (auto-confirm.job):
    await db.$transaction((tx: any) =>
      escrowService.releaseEscrowTx(tx, { ...state.escrows.get('j-auto') }, 'SYSTEM', {
        settledVia: 'releaseEscrowTx',
        autoConfirmedSource: 'normal',
      }),
    );

    // Identical balance, shift counter, ride counter, escrow status.
    expect(state.balances.get('driver-m')?.pendingAmount).toBe(1900);
    expect(state.balances.get('driver-a')?.pendingAmount).toBe(1900);
    expect(state.users.get('driver-m')).toEqual(state.users.get('driver-a'));
    expect(state.profiles.get('driver-m')).toEqual(state.profiles.get('driver-a'));
    expect(state.escrows.get('j-manual').status).toBe('RELEASED');
    expect(state.escrows.get('j-auto').status).toBe('RELEASED');

    // Identical audit shape: one RELEASED entry each, same amount; they
    // differ only in the signer and the settledVia marker, by design.
    const manualEntries = state.auditRows.filter((r: any) => r.escrowId === 'esc-manual' && r.action === 'RELEASED');
    const autoEntries = state.auditRows.filter((r: any) => r.escrowId === 'esc-auto' && r.action === 'RELEASED');
    expect(manualEntries).toHaveLength(1);
    expect(autoEntries).toHaveLength(1);
    expect(manualEntries[0].amount).toBe(autoEntries[0].amount);
    expect(manualEntries[0].triggeredBy).toBe(CUSTOMER);
    expect(autoEntries[0].triggeredBy).toBe('SYSTEM');
    expect(autoEntries[0].metadata).toEqual(
      expect.objectContaining({ settledVia: 'releaseEscrowTx' }),
    );
  });
});
