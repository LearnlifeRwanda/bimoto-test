// MONEY-ATOMIC G3 — two disputes by the SAME customer, genuinely
// interleaved, not in sequence.
//
// disputeJourney's dispute-rate bookkeeping is a read-modify-write:
// increment disputeCount, read the row back, divide by completedRides,
// write disputeRate (and, past the threshold, isFlagged). Before this
// dispatch those were two separately committed statements, and two
// disputes racing each other could both compute a rate and let the later
// one be discarded by the earlier — leaving the number the fraud flag
// reads describing fewer disputes than disputeCount counts. Case 2 below
// reproduces exactly that, from the old shape.
//
// What closes it is the transaction, plus where the lock comes from: the
// first write in the section is `disputeCount: { increment: 1 }` on the
// very row the section then read-modify-writes, and an UPDATE takes an
// exclusive row lock held until the transaction ends. A second dispute
// for the same customer therefore blocks on its own increment and, under
// READ COMMITTED, re-reads the row the first one committed.
//
// The advisory lock the service also takes (the fee-waiver/index.ts and
// aml/limits.ts idiom) is the explicit, order-independent guard on top of
// that: it does not depend on the increment happening to come first, so
// reordering the section — or moving the rate onto a different row —
// cannot silently reopen the race.
//
// The harness models the two things Postgres actually provides here: an
// UPDATE row lock held to end-of-transaction, and writes invisible to
// other transactions until commit.

jest.mock('../prisma', () => {
  // Replaced per-test by installDb(); the service module captures this
  // object once at import time, so the harness mutates it in place.
  const db: any = {};
  return { __esModule: true, default: db };
});

jest.mock('../services/escrow.service', () => ({
  freezeEscrow: jest.fn().mockResolvedValue({}),
  freezeEscrowTx: jest.fn().mockResolvedValue({}),
}));

jest.mock('../services/escrow-audit.service', () => ({
  appendAuditEntry: jest.fn().mockResolvedValue(undefined),
  appendAuditEntryTx: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/journey-validation.service', () => ({
  validateJourneyPlausibility: jest.fn().mockResolvedValue({ valid: true, flags: [] }),
}));

import prisma from '../prisma';
import * as journeyService from '../services/journey.service';

const db = prisma as any;

const tick = () => new Promise((r) => setImmediate(r));

interface Harness {
  /** Committed state. Nothing lands here until a transaction resolves. */
  users: Map<string, any>;
  /** Parks the first caller to reach it; every later caller passes. */
  park: () => Promise<void>;
  /** True once a caller has parked. */
  parked: () => boolean;
  /** Resumes the parked caller. */
  release: () => void;
  /** When true, user.update parks right after applying an increment. */
  parkOnIncrement: boolean;
}

/** Installs an in-memory prisma double onto the mocked module. */
function installDb(): Harness {
  const committedUsers = new Map<string, any>([
    ['c1', { id: 'c1', disputeCount: 0, completedRides: 10, disputeRate: 0, isFlagged: false }],
  ]);
  const journeys = new Map<string, any>([
    ['j1', { id: 'j1', customerId: 'c1', driverId: 'd1', status: 'AWAITING_CONFIRMATION' }],
    ['j2', { id: 'j2', customerId: 'c1', driverId: 'd2', status: 'AWAITING_CONFIRMATION' }],
  ]);

  // One mutex per key, acquired inside a transaction and released when it
  // ends — the shape of both a row lock and pg_advisory_xact_lock.
  const lockTails = new Map<string, Promise<void>>();

  async function acquire(key: string, holds: Array<() => void>) {
    const prev = lockTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => {
      release = r;
    });
    lockTails.set(
      key,
      prev.then(() => mine),
    );
    await prev;
    holds.push(release);
  }

  let parkResolve: (() => void) | null = null;
  let alreadyParked = false;

  const harness: Harness = {
    users: committedUsers,
    parkOnIncrement: false,
    park: async () => {
      if (alreadyParked) return;
      alreadyParked = true;
      await new Promise<void>((r) => {
        parkResolve = r;
      });
    },
    parked: () => parkResolve !== null,
    release: () => {
      const r = parkResolve;
      parkResolve = null;
      if (r) r();
    },
  };

  const makeTx = (holds: Array<() => void>) => {
    // A transaction's own uncommitted writes are visible to itself only.
    const staged = new Map<string, any>();
    const heldRows = new Set<string>();
    const readUser = (id: string) => staged.get(id) ?? committedUsers.get(id);

    const tx: any = {
      journey: {
        update: async ({ where, data }: any) => ({ ...journeys.get(where.id), ...data }),
      },
      escrow: {
        findUnique: async ({ where }: any) => ({
          id: `e-${where.journeyId}`,
          journeyId: where.journeyId,
          status: 'HELD',
          amount: 2000,
        }),
      },
      message: { create: async () => ({}) },
      user: {
        update: async ({ where, data }: any) => {
          if (!heldRows.has(where.id)) {
            await acquire(`row:user:${where.id}`, holds);
            heldRows.add(where.id);
          }
          const current = { ...readUser(where.id) };
          if (data.disputeCount?.increment) {
            current.disputeCount += data.disputeCount.increment;
            staged.set(where.id, current);
            // The window the defect lives in: after the increment, before
            // the rate computed from it is written.
            if (harness.parkOnIncrement) await harness.park();
            return { ...current };
          }
          if (data.disputeRate !== undefined) current.disputeRate = data.disputeRate;
          if (data.isFlagged !== undefined) current.isFlagged = data.isFlagged;
          staged.set(where.id, current);
          return { ...current };
        },
      },
      $queryRaw: async (_strings: TemplateStringsArray, ...values: any[]) => {
        await acquire(`advisory:${String(values[0])}`, holds);
        return [{ locked: 'true' }];
      },
      __commit: () => {
        for (const [id, row] of staged) committedUsers.set(id, row);
      },
    };
    return tx;
  };

  db.journey = {
    findUnique: async ({ where }: any) => {
      const row = journeys.get(where.id);
      return row ? { ...row } : null;
    },
  };
  db.$transaction = async (cb: any) => {
    const holds: Array<() => void> = [];
    const tx = makeTx(holds);
    try {
      const out = await cb(tx);
      tx.__commit();
      return out;
    } finally {
      // Row locks and *_xact_ advisory locks alike release at commit OR
      // rollback.
      for (const release of holds) release();
    }
  };

  return harness;
}

/**
 * Drives the interleaving: the first caller parks mid-write, the second
 * starts and is given every chance to get ahead, then the first resumes.
 */
async function race(h: Harness, first: () => Promise<unknown>, second: () => Promise<unknown>) {
  const a = first();
  while (!h.parked()) await tick();
  const b = second();
  for (let i = 0; i < 20; i += 1) await tick();
  h.release();
  await Promise.all([a, b]);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('MONEY-ATOMIC D-2 — concurrent disputes by one customer', () => {
  test('the two disputes serialize: disputeCount 2, disputeRate 0.2, no lost update', async () => {
    const h = installDb();
    h.parkOnIncrement = true;

    await race(
      h,
      () => journeyService.disputeJourney('j1', 'c1', 'first dispute'),
      () => journeyService.disputeJourney('j2', 'c1', 'second dispute'),
    );

    const user = h.users.get('c1');
    expect(user.disputeCount).toBe(2);
    // 2/10 — the rate the SECOND dispute computed, over the count both
    // disputes contributed to. A lost update leaves 0.1 here while
    // disputeCount says 2, which is case 2 below.
    expect(user.disputeRate).toBeCloseTo(0.2, 10);
    expect(user.isFlagged).toBe(false);
  });

  // The defect, from the shape the service had before this dispatch: the
  // increment and the rate write each committed on their own, so the row
  // lock the increment takes was released the instant it committed and
  // the two rate writes raced. Reproduced against the same harness, so
  // the only difference from case 1 is the code shape.
  test('the pre-fix shape — increment and rate write separately committed — loses the rate', async () => {
    const h = installDb();

    const oldShape = async () => {
      const updatedUser: any = await db.$transaction((tx: any) =>
        tx.user.update({ where: { id: 'c1' }, data: { disputeCount: { increment: 1 } } }),
      );
      const rate = updatedUser.disputeCount / Math.max(updatedUser.completedRides, 1);
      // Between the two statements nothing is held: any other dispute is
      // free to move the row on before this rate lands.
      await h.park();
      await db.$transaction((tx: any) =>
        tx.user.update({ where: { id: 'c1' }, data: { disputeRate: rate } }),
      );
    };

    await race(h, oldShape, oldShape);

    const user = h.users.get('c1');
    // Both disputes counted — the increment is atomic on its own…
    expect(user.disputeCount).toBe(2);
    // …but the rate the fraud flag reads describes only one of them: the
    // first dispute's write landed last and discarded the second's.
    expect(user.disputeRate).toBeCloseTo(0.1, 10);
  });
});
