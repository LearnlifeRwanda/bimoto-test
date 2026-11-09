// SETTLE-UP G2 — adopt, don't create.
//
// G1 reproduced the dead end on a live stack: when a MACHINE releases a
// failed journey (webhook, reconciler, unpaid-match reaper) the journey
// returns to REQUESTED while its FAILED escrow keeps owning journeyId,
// and the next accept died on P2002 — HTTP 500 on the customer's screen.
//
// These tests pin the fix and, more importantly, pin that the fix did not
// cost #143's single-winner property. The prisma mock is the
// bid-accept-concurrency harness in miniature: journey/bid/escrow
// updateMany honour their status predicates against current state
// (JS's single thread standing in for the row lock), escrow.create
// enforces the journeyId unique, and escrowAuditLog.create enforces the
// (escrowId, sequenceNumber) unique so a forked chain would throw rather
// than pass. escrow.service and escrow-audit.service run UNMOCKED — the
// adopt, the revival and the audit append are the real code.

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
    journeyReadGate: null as (() => Promise<void>) | null,
  };
  const escrowById = (id: string) =>
    [...state.escrows.values()].find((r: any) => r.id === id) ?? null;

  const db: any = {
    __state: state,
    $transaction: (fn: (tx: any) => Promise<any>) => fn(db),
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
      findUnique: jest.fn(async ({ where }: any) => {
        const row =
          where.journeyId !== undefined
            ? state.escrows.get(where.journeyId)
            : escrowById(where.id);
        return row ? { ...row } : null;
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
        const row = where.id !== undefined ? escrowById(where.id) : null;
        if (!row) return { count: 0 };
        if (where.status !== undefined && row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
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
          (r: any) => r.escrowId === data.escrowId && r.sequenceNumber === data.sequenceNumber,
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
    feeWaiver: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
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

// G6(a) — the sibling module, same class (see bid-accept-concurrency).
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
// CUTGUARD v2 G4 — the actor is now a TYPE (services/session-actor.ts).
// A test stands in for a session, so it says so with an explicit cast at
// the call rather than passing a bare string, which is what made the
// tautology writable in the first place.
import { customerActor, type SessionUserId } from '../services/session-actor';

const db = prisma as any;
const state = db.__state;
const CUSTOMER = 'c1';
const ESCROW_ID = 'esc-j1';

// The state a machine release leaves behind: journey back on the market,
// its FAILED escrow still owning journeyId, chain two entries deep.
function seedReleasedJourneyWithFailedEscrow() {
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
  });
  state.escrows.set('j1', {
    id: ESCROW_ID,
    journeyId: 'j1',
    customerId: CUSTOMER,
    driverId: 'd0',
    amount: 2000,
    commission: 200,
    driverPayout: 1800,
    status: 'FAILED',
    txRef: 'bimoto-j1-dead',
  });
  state.auditRows.push(
    { escrowId: ESCROW_ID, sequenceNumber: 0, action: 'CREATED_PENDING', amount: 2000 },
    { escrowId: ESCROW_ID, sequenceNumber: 1, action: 'CHARGE_FAILED', amount: 2000 },
  );
}

function seedBid(id: string, driverId: string, price: number) {
  state.bids.set(id, { id, journeyId: 'j1', driverId, price, etaMinutes: 5, status: 'PENDING' });
}

// The chain is linear when its sequence numbers are 0..n-1 with no gap and
// no repeat — the shape a fork would break.
function assertLinearChain() {
  const seqs = state.auditRows
    .filter((r: any) => r.escrowId === ESCROW_ID)
    .map((r: any) => r.sequenceNumber)
    .sort((a: number, b: number) => a - b);
  expect(seqs).toEqual(seqs.map((_: number, i: number) => i));
}

beforeEach(() => {
  jest.clearAllMocks();
  state.journeys.clear();
  state.bids.clear();
  state.escrows.clear();
  state.auditRows.length = 0;
  state.journeyReadGate = null;
});

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

describe('accepting a bid on a machine-released journey', () => {
  test('adopts the surviving FAILED escrow instead of creating a second one', async () => {
    seedReleasedJourneyWithFailedEscrow();
    seedBid('b1', 'd1', 2100);

    const res: any = await bidService.acceptBid('j1', customerActor(CUSTOMER as SessionUserId), 'b1');

    // The customer is matched again — no P2002, no 500.
    expect(res.journey.status).toBe('MATCHED');
    expect(res.journey.driverId).toBe('d1');

    // ONE escrow row, and it is the row that was already there.
    expect(state.escrows.size).toBe(1);
    expect(db.escrow.create).not.toHaveBeenCalled();
    const escrow = state.escrows.get('j1');
    expect(escrow.id).toBe(ESCROW_ID);

    // Revived through the state machine's only edge out of FAILED...
    expect(escrow.status).toBe('PENDING');
    // ...carrying the NEW bid's truth, not the dead attempt's.
    expect(escrow.amount).toBe(2100);
    expect(escrow.driverId).toBe('d1');
    expect(escrow.txRef).not.toBe('bimoto-j1-dead');
    expect(res.journey.agreedPrice).toBe(escrow.amount);

    // The supersession is on the chain, not erased from the row.
    const adopted = state.auditRows.filter((r: any) => r.action === 'ADOPTED_ON_REACCEPT');
    expect(adopted).toHaveLength(1);
    expect(adopted[0].metadata).toMatchObject({
      supersededAmount: 2000,
      supersededDriverId: 'd0',
      supersededTxRef: 'bimoto-j1-dead',
    });
    assertLinearChain();
  });

  test('two accepts racing on the adopt: one wins, one loses cleanly, one escrow', async () => {
    seedReleasedJourneyWithFailedEscrow();
    seedBid('b1', 'd1', 2100);
    seedBid('b2', 'd2', 2400);
    // Both callers observe REQUESTED + FAILED before either claims.
    state.journeyReadGate = makeBarrier(2);

    const results = await Promise.allSettled([
      bidService.acceptBid('j1', customerActor(CUSTOMER as SessionUserId), 'b1'),
      bidService.acceptBid('j1', customerActor(CUSTOMER as SessionUserId), 'b2'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    )!;
    // The loser gets the same 400 a sequential second accept gets — the
    // adopt never turns a lost race into a 500.
    expect((rejected.reason as any).code).toBe('BID_NOT_PENDING');

    // One escrow, still the original row, bound to whoever won.
    expect(state.escrows.size).toBe(1);
    const escrow = state.escrows.get('j1');
    const journey = state.journeys.get('j1');
    expect(escrow.id).toBe(ESCROW_ID);
    expect(escrow.driverId).toBe(journey.driverId);
    expect(escrow.amount).toBe(journey.agreedPrice);

    // Exactly one ACCEPTED bid, and exactly one adoption on the chain.
    const accepted = [...state.bids.values()].filter((b: any) => b.status === 'ACCEPTED');
    expect(accepted).toHaveLength(1);
    expect(accepted[0].driverId).toBe(journey.driverId);
    expect(
      state.auditRows.filter((r: any) => r.action === 'ADOPTED_ON_REACCEPT'),
    ).toHaveLength(1);
    assertLinearChain();
  });

  test('a settled escrow is never adopted: HELD refuses with 409 and is not touched', async () => {
    seedReleasedJourneyWithFailedEscrow();
    // The money is already held — the one shape adoption must refuse.
    state.escrows.get('j1').status = 'HELD';
    seedBid('b1', 'd1', 2100);

    await expect(bidService.acceptBid('j1', customerActor(CUSTOMER as SessionUserId), 'b1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'ESCROW_NOT_ADOPTABLE',
    });

    const escrow = state.escrows.get('j1');
    expect(escrow.status).toBe('HELD');
    expect(escrow.amount).toBe(2000);
    expect(escrow.driverId).toBe('d0');
    expect(
      state.auditRows.filter((r: any) => r.action === 'ADOPTED_ON_REACCEPT'),
    ).toHaveLength(0);
  });
});
