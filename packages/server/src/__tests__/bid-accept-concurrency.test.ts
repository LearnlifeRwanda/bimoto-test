// BID-ATOMICITY G5 — bid acceptance under GENUINE concurrency, not just
// in sequence: one journey, one winner, one escrow, no matter who races
// whom.
//
// The prisma mock is a stateful in-memory store whose journey.updateMany
// and bid.updateMany honor their status predicates exactly as Postgres
// does (the affected-row count is computed against current state,
// atomically — JS's single thread stands in for the row lock), and whose
// escrow.create enforces the Escrow_journeyId_key unique. Barriers hold
// both racing callers at their outside-transaction journey read so BOTH
// pass the stale guards before EITHER claims — the worst-case
// interleaving that used to end with two ACCEPTED bids, the journey
// pointing at one driver and the escrow (the money) bound to the other.
// escrow.service and escrow-audit.service run UNMOCKED so the escrow row
// and its CREATED_PENDING audit entry are created by the real code
// inside the claim boundary.

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

jest.mock('../prisma', () => {
  const state = {
    journeys: new Map<string, any>(),
    bids: new Map<string, any>(),
    escrows: new Map<string, any>(), // keyed by journeyId (the unique)
    auditRows: [] as any[],
    // Set per-test: gate on the outside-transaction journey read (the
    // acceptBidCore stale guard read has no `select`; auto-accept's
    // eligibility pre-filter passes `select` and is NOT gated).
    journeyReadGate: null as (() => Promise<void>) | null,
  };

  const db: any = {
    __state: state,
    $transaction: (fn: (tx: any) => Promise<any>) => fn(db),
    // Savepoint statements from the audit append retry — no-ops here;
    // nothing in these tests conflicts inside one transaction.
    $executeRawUnsafe: jest.fn(async () => 0),
    journey: {
      findUnique: jest.fn(async ({ where, select }: any) => {
        const row = state.journeys.get(where.id);
        const snapshot = row ? { ...row } : null;
        if (!select && state.journeyReadGate) await state.journeyReadGate();
        return snapshot;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = state.journeys.get(where.id);
        if (!row || (where.status !== undefined && row.status !== where.status)) {
          return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
      }),
      count: jest.fn(async () => 0),
    },
    bid: {
      findUnique: jest.fn(async ({ where }: any) => {
        const row = state.bids.get(where.id);
        return row ? { ...row } : null;
      }),
      // LIVE-WIRE G2 — acceptBidCore reads the losing bids inside the
      // claim transaction, before flipping them to DECLINED, so the
      // drivers this accept closed out can be told. Same predicate
      // shape as the updateMany below.
      findMany: jest.fn(async ({ where }: any) => {
        const rows: any[] = [];
        for (const row of state.bids.values()) {
          if (where.id?.not !== undefined && row.id === where.id.not) continue;
          if (where.journeyId !== undefined && row.journeyId !== where.journeyId) continue;
          if (where.status !== undefined && row.status !== where.status) continue;
          rows.push({ id: row.id, driverId: row.driverId });
        }
        return rows;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of state.bids.values()) {
          if (where.id?.not !== undefined) {
            if (row.id === where.id.not) continue;
            if (where.journeyId !== undefined && row.journeyId !== where.journeyId) continue;
          } else if (where.id !== undefined && row.id !== where.id) {
            continue;
          }
          if (where.status !== undefined && row.status !== where.status) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      }),
    },
    escrow: {
      // SETTLE-UP G2 — acceptBidCore now reads the journey's escrow
      // inside the claim transaction and adopts it when one survives.
      // On this file's journeys none does, so every accept still takes
      // the create branch; the lookup exists so the mock answers the
      // same shape Prisma does instead of throwing on a missing method.
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.journeyId !== undefined) {
          const row = state.escrows.get(where.journeyId);
          return row ? { ...row } : null;
        }
        for (const row of state.escrows.values()) {
          if (row.id === where.id) return { ...row };
        }
        return null;
      }),
      create: jest.fn(async ({ data }: any) => {
        if (state.escrows.has(data.journeyId)) {
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          err.meta = { target: ['journeyId'] };
          throw err;
        }
        const row = { id: `esc-${data.journeyId}`, status: 'PENDING', ...data };
        state.escrows.set(data.journeyId, row);
        return { ...row };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of state.escrows.values()) {
          if (where.id !== undefined && row.id !== where.id) continue;
          if (where.status !== undefined && row.status !== where.status) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
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
        const dup = state.auditRows.some(
          (r: any) =>
            r.escrowId === data.escrowId && r.sequenceNumber === data.sequenceNumber,
        );
        if (dup) {
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          err.meta = { target: ['escrowId', 'sequenceNumber'] };
          throw err;
        }
        state.auditRows.push({ ...data });
        return { ...data };
      }),
    },
    driverProfile: {
      findUnique: jest.fn(async ({ where }: any) => ({
        userId: where.userId,
        totalRides: 20,
        vehicleType: 'MOTO',
        verificationStatus: 'VERIFIED',
      })),
    },
    user: {
      findUnique: jest.fn(async ({ where }: any) => ({
        id: where.id,
        nickname: 'Aljo',
        phone: '+250788111111',
        language: 'rw',
        completedRides: 5,
      })),
    },
    leg: { findMany: jest.fn(async () => []) },
    feeWaiver: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
  };

  return { __esModule: true, default: db };
});

jest.mock('../services/payment', () => {
  class FlutterwaveError extends Error {
    code: string;
    retryable: boolean;
    constructor(code: string, retryable = false) {
      super(code);
      this.code = code;
      this.retryable = retryable;
    }
  }
  return {
    __esModule: true,
    chargeMomo: jest.fn().mockResolvedValue({ status: 'PENDING', flwTxId: null }),
    FlutterwaveError,
  };
});

// G6(a) — the SIBLING module, same class. The census was scoped to
// notification.service; this one is a hand-written enumeration of a
// notification module too, and leaving it is how the next instance hides.
jest.mock('../services/recipient-sms-notification.service', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('./helpers/notification-service-mock').autoStubbedModule({
    notifyRecipientDriverEnRoute: jest.fn(),
  }),
);

jest.mock('../services/journey-state-transitions', () => ({
  onJourneyExitsRequested: jest.fn(),
}));

jest.mock('../config', () => ({
  config: {
    SKIP_DRIVER_VERIFICATION: true,
    DATABASE_URL: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16-chars',
    ENCRYPTION_KEY: 'a'.repeat(64),
    PORT: 3000,
    CLIENT_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
  },
}));

import prisma from '../prisma';
import * as bidService from '../services/bid.service';
import { tryAutoAcceptBid } from '../services/customer-modes/auto-accept';
// CUTGUARD v2 G4 — the actor is now a TYPE (services/session-actor.ts).
// A test stands in for a session, so it says so with an explicit cast at
// the call rather than passing a bare string, which is what made the
// tautology writable in the first place.
import { customerActor, type SessionUserId } from '../services/session-actor';

const db = prisma as any;
const state = db.__state;

const CUSTOMER = 'c1';

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

function seedJourney(overrides: Record<string, unknown> = {}) {
  state.journeys.set('j1', {
    id: 'j1',
    customerId: CUSTOMER,
    status: 'REQUESTED',
    type: 'PASSENGER',
    bookingMode: 'IMMEDIATE',
    requestMode: 'WAIT_AND_COMPARE',
    priceCeilingRwf: null,
    discoveryStartedAt: new Date(),
    driverId: null,
    ...overrides,
  });
}

function seedBid(id: string, driverId: string, price: number) {
  state.bids.set(id, {
    id,
    journeyId: 'j1',
    driverId,
    price,
    etaMinutes: 5,
    status: 'PENDING',
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  state.journeys.clear();
  state.bids.clear();
  state.escrows.clear();
  state.auditRows.length = 0;
  state.journeyReadGate = null;
});

function assertSingleWinnerEndState() {
  const journey = state.journeys.get('j1');
  expect(journey.status).toBe('MATCHED');

  // Exactly one ACCEPTED bid — and it is the driver the journey points at.
  const bids = [...state.bids.values()];
  const accepted = bids.filter((b: any) => b.status === 'ACCEPTED');
  expect(accepted).toHaveLength(1);
  expect(journey.driverId).toBe(accepted[0].driverId);
  expect(journey.agreedPrice).toBe(accepted[0].price);

  // Every rival bid is DECLINED — never flipped back by a losing accept.
  for (const b of bids) {
    if (b.id !== accepted[0].id) expect(b.status).toBe('DECLINED');
  }

  // Exactly one escrow, bound to the SAME driver the journey points at.
  expect(state.escrows.size).toBe(1);
  const escrow = state.escrows.get('j1');
  expect(escrow.driverId).toBe(journey.driverId);
  expect(escrow.amount).toBe(accepted[0].price);

  // One CREATED_PENDING audit entry, for that escrow.
  const created = state.auditRows.filter((r: any) => r.action === 'CREATED_PENDING');
  expect(created).toHaveLength(1);
  expect(created[0].escrowId).toBe(escrow.id);
  return { journey, accepted: accepted[0], escrow };
}

describe('two customers-phone accepts racing on two different bids', () => {
  test('one winner, one MATCHED journey, one escrow bound to the winner; loser gets BID_NOT_PENDING and mutates nothing', async () => {
    seedJourney();
    seedBid('b1', 'd1', 2000);
    seedBid('b2', 'd2', 2400);
    // Hold both callers at the stale outside-transaction read so both
    // see REQUESTED + PENDING before either claims.
    state.journeyReadGate = makeBarrier(2);

    const results = await Promise.allSettled([
      bidService.acceptBid('j1', customerActor(CUSTOMER as SessionUserId), 'b1'),
      bidService.acceptBid('j1', customerActor(CUSTOMER as SessionUserId), 'b2'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The loser gets the same 400 a sequential second accept gets —
    // never a 500.
    expect((rejected[0].reason as any).code).toBe('BID_NOT_PENDING');
    expect((rejected[0].reason as any).statusCode).toBe(400);

    assertSingleWinnerEndState();
  });

  test('double-tap on the SAME bid: second tap loses cleanly', async () => {
    seedJourney();
    seedBid('b1', 'd1', 2000);
    state.journeyReadGate = makeBarrier(2);

    const results = await Promise.allSettled([
      bidService.acceptBid('j1', customerActor(CUSTOMER as SessionUserId), 'b1'),
      bidService.acceptBid('j1', customerActor(CUSTOMER as SessionUserId), 'b1'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    )!;
    expect((rejected.reason as any).code).toBe('BID_NOT_PENDING');

    const { accepted } = assertSingleWinnerEndState();
    expect(accepted.id).toBe('b1');
  });
});

describe('manual accept racing auto-accept', () => {
  test('one winner whichever path wins; escrow bound to that winner; loser is a calm no-op', async () => {
    // NEED_TO_GO journey whose ceiling admits the auto-accept bid.
    seedJourney({ requestMode: 'NEED_TO_GO', priceCeilingRwf: 2600 });
    seedBid('b1', 'd1', 2400); // the auto-accept candidate
    seedBid('b2', 'd2', 2000); // the customer's manual pick
    state.bids.get('b1').createdAt = new Date();
    // Gate the two acceptBidCore outside reads (no `select`); the
    // auto-accept eligibility pre-filter (with `select`) passes through.
    state.journeyReadGate = makeBarrier(2);

    const [autoResult, manualResult] = await Promise.allSettled([
      tryAutoAcceptBid(db, 'j1', 'b1'),
      bidService.acceptBid('j1', customerActor(CUSTOMER as SessionUserId), 'b2'),
    ]);

    const { accepted } = assertSingleWinnerEndState();

    if (manualResult.status === 'fulfilled') {
      // Manual won: auto-accept must have reported a calm race-lost —
      // resolved, not thrown.
      expect(accepted.id).toBe('b2');
      expect(autoResult.status).toBe('fulfilled');
      expect((autoResult as PromiseFulfilledResult<any>).value).toEqual({
        triggered: false,
        bidId: null,
        reason: 'race-lost',
      });
    } else {
      // Auto won: the manual tap gets the sequential loser's 400.
      expect(accepted.id).toBe('b1');
      expect((manualResult.reason as any).code).toBe('BID_NOT_PENDING');
      expect(autoResult.status).toBe('fulfilled');
      expect((autoResult as PromiseFulfilledResult<any>).value).toEqual({
        triggered: true,
        bidId: 'b1',
        reason: 'auto-accepted',
      });
    }
  });
});
