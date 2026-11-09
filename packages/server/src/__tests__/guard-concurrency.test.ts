// BID-ATOMICITY G5 — the guards around money under GENUINE concurrency:
//
//   * N concurrent AML-capped charges that are jointly over the daily
//     cumulative cap → the excess is rejected, never all admitted. The
//     mock's $queryRaw implements pg_advisory_xact_lock as a real keyed
//     in-process mutex held to transaction end, so the test proves the
//     checks serialize (max one in the critical section) and the
//     admitted total never breaches the cap.
//
//   * Two admins deciding one conflict at the same instant → exactly one
//     decision: one AdminAction row, one escrow release, one credit; the
//     loser gets ALREADY_DECIDED (409 at the route) with no side-effects.

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

jest.mock('../prisma', () => {
  const state = {
    escrows: new Map<string, any>(), // keyed by escrow id
    journeys: new Map<string, any>(),
    adminActionRows: [] as any[],
    auditRows: [] as any[],
    balances: new Map<string, { driverId: string; pendingAmount: number }>(),
    users: new Map<string, { completedShifts: number }>(),
    profiles: new Map<string, { totalRides: number }>(),
    amlFlags: [] as any[],
    lock: {
      tails: new Map<string, Promise<void>>(),
      // Per-key concurrency accounting: distinct keys (e.g. the AML
      // subject lock and the nested flag-dedupe lock) may legitimately
      // overlap; what must never overlap is two holders of ONE key.
      active: new Map<string, number>(),
      maxActive: new Map<string, number>(),
    },
  };

  const models: any = {
    escrow: {
      findMany: jest.fn(async ({ where }: any) =>
        [...state.escrows.values()]
          .filter((e: any) => {
            if (where.customerId !== undefined && e.customerId !== where.customerId) return false;
            if (where.driverId !== undefined && e.driverId !== where.driverId) return false;
            if (where.createdAt?.gte && e.createdAt < where.createdAt.gte) return false;
            return true;
          })
          .map((e: any) => ({ ...e })),
      ),
      findUnique: jest.fn(async ({ where }: any) => {
        const row = [...state.escrows.values()].find(
          (e: any) => e.id === where.id || e.journeyId === where.journeyId,
        );
        return row ? { ...row } : null;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of state.escrows.values()) {
          if (where.journeyId !== undefined && row.journeyId !== where.journeyId) continue;
          if (where.id !== undefined && row.id !== where.id) continue;
          if (where.status !== undefined && row.status !== where.status) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      }),
    },
    journey: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const row = state.journeys.get(where.id);
        if (!row) return null;
        const out: any = { ...row };
        if (include?.escrow) {
          const escrow = [...state.escrows.values()].find(
            (e: any) => e.journeyId === row.id,
          );
          out.escrow = escrow ? { ...escrow } : null;
        }
        return out;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = state.journeys.get(where.id);
        Object.assign(row, data);
        return { ...row };
      }),
    },
    adminAction: {
      findFirst: jest.fn(async ({ where }: any = {}) => {
        const matching = state.adminActionRows.filter((r: any) => {
          if (!where) return true;
          if (where.action && r.action !== where.action) return false;
          if (where.targetType && r.targetType !== where.targetType) return false;
          if (where.targetId && r.targetId !== where.targetId) return false;
          return true;
        });
        return matching.length ? matching[matching.length - 1] : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `aa-${state.adminActionRows.length + 1}`, ...data };
        state.adminActionRows.push(row);
        return row;
      }),
    },
    escrowAuditLog: {
      findFirst: jest.fn(async ({ where }: any) => {
        const rows = state.auditRows
          .filter((r: any) => r.escrowId === where.escrowId)
          .sort((a: any, b: any) => a.sequenceNumber - b.sequenceNumber);
        return rows.length ? { ...rows[rows.length - 1] } : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        state.auditRows.push({ ...data });
        return { ...data };
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
        if (data.completedShifts?.increment !== undefined) {
          const u = state.users.get(where.id) ?? { completedShifts: 0 };
          u.completedShifts += data.completedShifts.increment;
          state.users.set(where.id, u);
          return u;
        }
        return { id: where.id, ...data };
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
    amlFlag: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `flag-${state.amlFlags.length + 1}`, ...data };
        state.amlFlags.push(row);
        return row;
      }),
      update: jest.fn(async () => ({})),
    },
  };

  // pg_advisory_xact_lock as a REAL keyed in-process mutex: acquired in
  // FIFO order per key, held until the surrounding $transaction settles
  // (commit or throw), exactly like a transaction-scoped advisory lock.
  const db: any = {
    __state: state,
    ...models,
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      const releases: Array<() => void> = [];
      const tx: any = {
        ...models,
        $executeRawUnsafe: jest.fn(async () => 0),
        $queryRaw: async (_strings: TemplateStringsArray, ...values: any[]) => {
          const key = values.join('|');
          const prevTail = state.lock.tails.get(key) ?? Promise.resolve();
          let release!: () => void;
          const held = new Promise<void>((r) => (release = r));
          state.lock.tails.set(key, prevTail.then(() => held));
          await prevTail;
          const now = (state.lock.active.get(key) ?? 0) + 1;
          state.lock.active.set(key, now);
          state.lock.maxActive.set(
            key,
            Math.max(state.lock.maxActive.get(key) ?? 0, now),
          );
          releases.push(() => {
            state.lock.active.set(key, (state.lock.active.get(key) ?? 1) - 1);
            release();
          });
          return [{ acquired: true }];
        },
      };
      try {
        return await fn(tx);
      } finally {
        releases.forEach((r) => r());
      }
    },
  };

  return { __esModule: true, default: db };
});

import prisma from '../prisma';
import { assertAmlCheck, AmlError } from '../services/aml';
import { HARD_DAILY_CUMULATIVE_RWF } from '../services/aml/thresholds';
import { journeyReconciliationModule } from '../services/admin/conflict-resolver/conflicts/journey-reconciliation';

const db = prisma as any;
const state = db.__state;

const CUSTOMER = 'aml-c1';

beforeEach(() => {
  jest.clearAllMocks();
  state.escrows.clear();
  state.journeys.clear();
  state.adminActionRows.length = 0;
  state.auditRows.length = 0;
  state.balances.clear();
  state.users.clear();
  state.profiles.clear();
  state.amlFlags.length = 0;
  state.lock.tails.clear();
  state.lock.active.clear();
  state.lock.maxActive.clear();
});

// Mirrors the production CHARGE ordering: the escrow row is committed
// BEFORE the AML check runs (acceptBid creates the escrow, then charges).
function commitEscrowRow(id: string, amount: number) {
  state.escrows.set(id, {
    id,
    journeyId: `j-${id}`,
    customerId: CUSTOMER,
    driverId: 'aml-d1',
    amount,
    driverPayout: amount - 100,
    status: 'PENDING',
    createdAt: new Date(),
  });
}

async function attemptCharge(escrowId: string, amount: number): Promise<boolean> {
  try {
    await assertAmlCheck({
      userId: CUSTOMER,
      amount,
      action: 'CHARGE',
      escrowId,
    });
    return true;
  } catch (err) {
    if (err instanceof AmlError && err.code === 'AML_HARD_LIMIT_EXCEEDED') {
      return false;
    }
    throw err;
  }
}

describe('N concurrent AML-capped charges jointly over the daily cap', () => {
  test('worst case — all escrow rows committed before any check: excess rejected, checks serialized', async () => {
    // Three charges, each fine alone, jointly over the 10M cap.
    const amount = Math.ceil(HARD_DAILY_CUMULATIVE_RWF * 0.4); // 4M each, 12M joint
    commitEscrowRow('e1', amount);
    commitEscrowRow('e2', amount);
    commitEscrowRow('e3', amount);

    const results = await Promise.all([
      attemptCharge('e1', amount),
      attemptCharge('e2', amount),
      attemptCharge('e3', amount),
    ]);

    // The invariant: the admitted total never breaches the cap.
    const admitted = results.filter(Boolean).length * amount;
    expect(admitted).toBeLessThan(HARD_DAILY_CUMULATIVE_RWF);
    // Every rejection wrote its CRITICAL flag.
    const rejections = results.filter((r) => !r).length;
    expect(rejections).toBeGreaterThan(0);
    expect(
      state.amlFlags.filter((f: any) => f.type === 'DAILY_CUMULATIVE_EXCEEDED'),
    ).toHaveLength(rejections);
    // The advisory lock really serialized the sum-and-decide sections.
    for (const [key, max] of state.lock.maxActive) {
      expect({ key, max }).toEqual({ key, max: 1 });
    }
  });

  test('staggered arrivals: the first under-cap charge is admitted, the excess rejected', async () => {
    const amount = Math.ceil(HARD_DAILY_CUMULATIVE_RWF * 0.4);
    const results: boolean[] = [];
    for (const id of ['e1', 'e2', 'e3']) {
      commitEscrowRow(id, amount);
      results.push(await attemptCharge(id, amount));
    }
    expect(results).toEqual([true, false, false]);
  });

  test('sanity: a jointly-under-cap set is fully admitted — the lock never over-blocks legitimate traffic', async () => {
    const amount = Math.ceil(HARD_DAILY_CUMULATIVE_RWF * 0.2); // 2M each, 4M joint
    commitEscrowRow('e1', amount);
    commitEscrowRow('e2', amount);

    const results = await Promise.all([
      attemptCharge('e1', amount),
      attemptCharge('e2', amount),
    ]);
    expect(results).toEqual([true, true]);
  });
});

describe('two admins deciding one conflict at the same instant', () => {
  test('one decision, one release, one credit; the loser gets ALREADY_DECIDED and no side-effects', async () => {
    state.journeys.set('j-conf', {
      id: 'j-conf',
      status: 'DISPUTED',
      customerId: 'cust-1',
    });
    state.escrows.set('esc-conf', {
      id: 'esc-conf',
      journeyId: 'j-conf',
      customerId: 'cust-1',
      driverId: 'drv-1',
      amount: 2000,
      driverPayout: 1800,
      status: 'HELD',
      createdAt: new Date(),
    });

    const decide = (adminId: string) =>
      journeyReconciliationModule.decide(
        {
          id: 'j-conf',
          decision: 'RESOLVED_PAY' as any,
          reason: 'driver completed the ride; recipient confirmed by phone',
          adminId,
        },
        db,
      );

    const [a, b] = await Promise.allSettled([decide('admin-1'), decide('admin-2')]);

    // Exactly one winner.
    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as any).code).toBe('ALREADY_DECIDED');

    // One AdminAction, one settlement, one credit — never two.
    expect(state.adminActionRows).toHaveLength(1);
    expect(state.escrows.get('esc-conf').status).toBe('RELEASED');
    expect(state.auditRows.filter((r: any) => r.action === 'RELEASED')).toHaveLength(1);
    expect(state.balances.get('drv-1')).toEqual({
      driverId: 'drv-1',
      pendingAmount: 1800,
    });
    expect(state.users.get('drv-1')).toEqual({ completedShifts: 1 });
    expect(state.journeys.get('j-conf').status).toBe('COMPLETED');
    // The claim's advisory lock serialized the two decides.
    for (const [key, max] of state.lock.maxActive) {
      expect({ key, max }).toEqual({ key, max: 1 });
    }
  });
});
