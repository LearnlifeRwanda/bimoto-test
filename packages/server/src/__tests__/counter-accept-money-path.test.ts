// __TESTS__/COUNTER-ACCEPT-MONEY-PATH.TEST.TS
//
// COUNTER-READY G5 — THE MONEY PATH IS NOT FORKED.
//
// This is the invariant the whole feature stands on: a counter that the
// motari accepts is charged by the SAME transaction every accept has
// always used, at the AGREED number. Not a sibling that looks like it,
// not a copy that drifts on the next commission change — the same
// acceptBidCore, the same escrow creation inside the same claim, the
// same chargeMomo.
//
// SO acceptBid IS NOT STUBBED HERE. It runs for real. What is stubbed is
// the layer BELOW it — escrow.service and the payment gateway — because
// those are the instruments: whatever createEscrowTx and chargeMomo are
// handed IS what the system decided to charge, and where the call came
// from is a fact about which code path produced it.
//
// The proof is a COMPARISON. The same fixture is driven twice:
//   1. the passenger's own accept of the bid at its original price;
//   2. the motari accepting her counter.
// Both are asserted to reach the identical instruments with the
// identical call shape, differing in exactly one thing — the number. A
// forked money path could not produce that, and a future fork would
// break this file rather than ship quietly.

jest.mock('../services/notification.service', () =>
  require('./helpers/notification-service-mock').autoStubbedModule({
    notifyCounterAccepted: jest.fn(),
  }),
);

jest.mock('../services/bid-outcome', () => ({
  announceBidDeclined: jest.fn(),
  announceBidOutcome: jest.fn(),
}));

jest.mock('../socket', () => ({
  emitToJourney: jest.fn(),
  emitToUser: jest.fn(),
}));

jest.mock('../services/journey-state-transitions', () => ({
  onJourneyExitsRequested: jest.fn(),
}));

jest.mock('../services/recipient-sms-notification.service', () => ({
  notifyRecipientDriverEnRoute: jest.fn(),
}));

jest.mock('../services/user-phone', () => ({
  decryptedPhone: jest.fn(() => '+250780000000'),
  decryptedPhoneOrNull: jest.fn(() => '+250780000000'),
}));

jest.mock('../services/fee-waiver', () => ({
  getActiveWaiversForDrivers: jest.fn(async () => new Map()),
}));

jest.mock('../services/fee-waiver/apply', () => ({
  applyWaiver: jest.fn(async (_driverId: string, commission: any) => ({
    charged: commission.totalCommissionAmount,
    waived: 0,
    effectiveDriverPayout: commission.driverPayout,
    waiverId: null,
  })),
  resolveWaiverCommission: jest.fn((_w: any, commission: any) => ({
    charged: commission.totalCommissionAmount,
    waived: 0,
    effectiveDriverPayout: commission.driverPayout,
    waiverId: null,
  })),
}));

// THE INSTRUMENTS. Whatever these are handed is what the system charged.
jest.mock('../services/escrow.service', () => ({
  createEscrowTx: jest.fn(async (_tx: any, journeyId: string, _c: string, _d: string, amount: number) => ({
    id: `escrow-${journeyId}`,
    status: 'PENDING',
    txRef: `tx-${journeyId}`,
    amount,
  })),
  adoptEscrowTx: jest.fn(),
  markEscrowChargeSucceeded: jest.fn(),
  markEscrowChargeFailed: jest.fn(),
}));

jest.mock('../services/payment', () => ({
  chargeMomo: jest.fn(async () => ({ status: 'PENDING', flwTxId: null, walletNameOnReceipt: null })),
  FlutterwaveError: class FlutterwaveError extends Error {
    code = 'X';
    retryable = false;
  },
}));

jest.mock('../services/payment/name-match', () => ({
  recordNameMismatchIfDifferent: jest.fn(async () => null),
}));

jest.mock('../prisma', () => {
  const journeyRows = new Map<string, any>();
  const bidRows = new Map<string, any>();
  const matches = (row: any, where: any) =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'id' || k === 'journeyId') return true;
      if (k === 'not') return true;
      return row[k] === v;
    });
  const bidApi = {
    findUnique: jest.fn(async ({ where }: any) => bidRows.get(where.id) ?? null),
    findMany: jest.fn(async () => []),
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (where.id && typeof where.id === 'string') {
        const row = bidRows.get(where.id);
        if (!row || !matches(row, where)) return { count: 0 };
        bidRows.set(where.id, { ...row, ...data });
        return { count: 1 };
      }
      return { count: 0 };
    }),
  };
  const journeyApi = {
    findUnique: jest.fn(async ({ where }: any) => journeyRows.get(where.id) ?? null),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const row = journeyRows.get(where.id);
      if (!row || (where.status !== undefined && row.status !== where.status)) {
        return { count: 0 };
      }
      journeyRows.set(where.id, { ...row, ...data });
      return { count: 1 };
    }),
    count: jest.fn(async () => 0),
  };
  const client: any = {
    journey: journeyApi,
    bid: bidApi,
    driverProfile: { findUnique: jest.fn(async () => ({ userId: 'd1', totalRides: 10 })) },
    user: { findUnique: jest.fn(async () => ({ id: 'c1', nickname: 'Ada', language: 'en', completedRides: 3 })) },
    leg: { findMany: jest.fn(async () => []) },
    vehicleChangeLog: { findMany: jest.fn(async () => []) },
    escrow: { findUnique: jest.fn(async () => null) },
    // The transaction body runs against the same in-memory rows, so the
    // predicated claims inside acceptBidCore behave as they do in
    // Postgres: the WHERE decides, and the count is the verdict.
    $transaction: jest.fn(async (fn: any) => fn(client)),
  };
  client.__rows = { journeyRows, bidRows };
  return { __esModule: true, default: client };
});

import prisma from '../prisma';
import { config } from '../config';
import * as bidService from '../services/bid.service';
import * as escrowService from '../services/escrow.service';
import { chargeMomo } from '../services/payment';
import { notifyCounterAccepted } from '../services/notification.service';
// CUTGUARD v2 G4 — the actor is now a TYPE (services/session-actor.ts).
// A test stands in for a session, so it says so with an explicit cast at
// the call rather than passing a bare string, which is what made the
// tautology writable in the first place.
import { customerActor, type SessionUserId } from '../services/session-actor';

const JOURNEY = 'aaaaaaaa-0000-0000-0000-000000000001';
const BID = 'bbbbbbbb-0000-0000-0000-000000000001';
const ORIGINAL = 2000;
const COUNTERED = 1500;

const rows = (prisma as any).__rows as {
  journeyRows: Map<string, any>;
  bidRows: Map<string, any>;
};

function seed(bidOver: Record<string, unknown> = {}) {
  rows.journeyRows.clear();
  rows.bidRows.clear();
  rows.journeyRows.set(JOURNEY, {
    id: JOURNEY, customerId: 'c1', status: 'REQUESTED',
    bookingMode: 'IMMEDIATE', scheduledFor: null, type: 'PASSENGER',
  });
  rows.bidRows.set(BID, {
    id: BID, journeyId: JOURNEY, driverId: 'd1', status: 'PENDING',
    price: ORIGINAL, etaMinutes: 7,
    counterAmountRwf: null, counterAt: null, counterOutcome: null,
    ...bidOver,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (config as any).COUNTER_BID_ENABLED = true;
  seed();
});

/** What the instruments were handed, in one comparable shape. */
function instrumentReading() {
  const escrowCall = (escrowService.createEscrowTx as jest.Mock).mock.calls[0];
  const chargeCall = (chargeMomo as jest.Mock).mock.calls[0];
  return {
    escrowCalls: (escrowService.createEscrowTx as jest.Mock).mock.calls.length,
    escrowJourneyId: escrowCall?.[1],
    escrowCustomerId: escrowCall?.[2],
    escrowDriverId: escrowCall?.[3],
    escrowAmount: escrowCall?.[4],
    chargeCalls: (chargeMomo as jest.Mock).mock.calls.length,
    chargeAmount: chargeCall?.[0]?.amount,
    chargeTxRef: chargeCall?.[0]?.txRef,
    agreedPrice: rows.journeyRows.get(JOURNEY).agreedPrice,
    journeyStatus: rows.journeyRows.get(JOURNEY).status,
    bidStatus: rows.bidRows.get(BID).status,
    driverId: rows.journeyRows.get(JOURNEY).driverId,
  };
}

describe('accepting a counter runs the ORDINARY accept, at the agreed price', () => {
  test('the journey is MATCHED and the escrow is created for the COUNTERED number', async () => {
    seed({ counterAmountRwf: COUNTERED, counterAt: new Date() });

    const result = await bidService.respondToCounter(JOURNEY, 'd1' as SessionUserId, BID, 'accept');

    expect(result.matched).toBe(true);
    const reading = instrumentReading();
    expect(reading.journeyStatus).toBe('MATCHED');
    expect(reading.driverId).toBe('d1');
    // The number the passenger asked for is the number that moves.
    expect(reading.agreedPrice).toBe(COUNTERED);
    expect(reading.escrowAmount).toBe(COUNTERED);
    expect(reading.chargeAmount).toBe(COUNTERED);
    // ONE escrow, ONE charge. A forked path would show two, or none.
    expect(reading.escrowCalls).toBe(1);
    expect(reading.chargeCalls).toBe(1);
    // …and it charges the escrow this accept created, not some other.
    expect(reading.chargeTxRef).toBe(`tx-${JOURNEY}`);
  });

  test('the bid row carries the agreed price and the ACCEPTED outcome', async () => {
    seed({ counterAmountRwf: COUNTERED, counterAt: new Date() });
    await bidService.respondToCounter(JOURNEY, 'd1' as SessionUserId, BID, 'accept');

    const bid = rows.bidRows.get(BID);
    expect(bid.price).toBe(COUNTERED);
    expect(bid.counterOutcome).toBe('ACCEPTED');
    expect(bid.status).toBe('ACCEPTED');
  });

  test('the passenger is told, at the number she will actually be charged', async () => {
    seed({ counterAmountRwf: COUNTERED, counterAt: new Date() });
    await bidService.respondToCounter(JOURNEY, 'd1' as SessionUserId, BID, 'accept');
    expect(notifyCounterAccepted).toHaveBeenCalledWith('c1', JOURNEY, BID, COUNTERED);
  });

  // THE COMPARISON — the same instruments, the same shape, one number.
  test('IT IS THE SAME CODE PATH — identical to the passenger\'s own accept but for the price', async () => {
    // Arm 1: she accepts his original offer, the way she always has.
    seed();
    await bidService.acceptBid(JOURNEY, customerActor('c1' as SessionUserId), BID, {});
    const plainAccept = instrumentReading();

    jest.clearAllMocks();

    // Arm 2: he accepts her counter.
    seed({ counterAmountRwf: COUNTERED, counterAt: new Date() });
    await bidService.respondToCounter(JOURNEY, 'd1' as SessionUserId, BID, 'accept');
    const counterAccept = instrumentReading();

    // Everything the money touches is the same call, from the same
    // place, with the same participants and the same cardinality…
    expect(counterAccept.escrowCalls).toBe(plainAccept.escrowCalls);
    expect(counterAccept.chargeCalls).toBe(plainAccept.chargeCalls);
    expect(counterAccept.escrowJourneyId).toBe(plainAccept.escrowJourneyId);
    expect(counterAccept.escrowCustomerId).toBe(plainAccept.escrowCustomerId);
    expect(counterAccept.escrowDriverId).toBe(plainAccept.escrowDriverId);
    expect(counterAccept.chargeTxRef).toBe(plainAccept.chargeTxRef);
    expect(counterAccept.journeyStatus).toBe(plainAccept.journeyStatus);
    expect(counterAccept.bidStatus).toBe(plainAccept.bidStatus);
    expect(counterAccept.driverId).toBe(plainAccept.driverId);

    // …and the ONE difference is the number under discussion.
    expect(plainAccept.agreedPrice).toBe(ORIGINAL);
    expect(plainAccept.escrowAmount).toBe(ORIGINAL);
    expect(plainAccept.chargeAmount).toBe(ORIGINAL);
    expect(counterAccept.agreedPrice).toBe(COUNTERED);
    expect(counterAccept.escrowAmount).toBe(COUNTERED);
    expect(counterAccept.chargeAmount).toBe(COUNTERED);
  });
});

describe('the race the two-step is built for', () => {
  test('sequentially: a bid already matched answers 400 BID_NOT_PENDING, and charges nothing', async () => {
    // The passenger's own accept of the ORIGINAL price committed before
    // he opened his phone. The service's read sees a non-PENDING bid and
    // refuses at the guard, long before the flip.
    seed({ counterAmountRwf: COUNTERED, counterAt: new Date(), status: 'ACCEPTED' });

    await expect(
      bidService.respondToCounter(JOURNEY, 'd1' as SessionUserId, BID, 'accept'),
    ).rejects.toMatchObject({ statusCode: 400, code: 'BID_NOT_PENDING' });

    expect(escrowService.createEscrowTx).not.toHaveBeenCalled();
    expect(chargeMomo).not.toHaveBeenCalled();
    // The price of a bid somebody else already bought is untouched —
    // the exact defect the `status: PENDING` term of the flip predicate
    // (and this guard in front of it) exists to prevent.
    expect(rows.bidRows.get(BID).price).toBe(ORIGINAL);
    expect(rows.bidRows.get(BID).counterOutcome).toBeNull();
  });

  test('in a true race: the flip misses and he is told, cleanly, that it is gone', async () => {
    // PENDING when the service read it, claimed by a rival accept in the
    // window before the flip. The predicate is the arbiter: count 0.
    seed({ counterAmountRwf: COUNTERED, counterAt: new Date() });
    (prisma as any).bid.updateMany.mockImplementationOnce(async () => ({ count: 0 }));

    await expect(
      bidService.respondToCounter(JOURNEY, 'd1' as SessionUserId, BID, 'accept'),
    ).rejects.toMatchObject({ statusCode: 409, code: 'COUNTER_NO_LONGER_OPEN' });

    expect(escrowService.createEscrowTx).not.toHaveBeenCalled();
    expect(chargeMomo).not.toHaveBeenCalled();
    expect(rows.bidRows.get(BID).price).toBe(ORIGINAL);
    expect(rows.bidRows.get(BID).counterOutcome).toBeNull();
  });

  test('a failed acceptance puts the original price back — her counter survives it', async () => {
    seed({ counterAmountRwf: COUNTERED, counterAt: new Date() });
    // The journey moves off REQUESTED between the flip and the claim, so
    // acceptBidCore's journey claim finds nothing and throws.
    (prisma as any).journey.updateMany.mockImplementationOnce(async () => ({ count: 0 }));

    await expect(
      bidService.respondToCounter(JOURNEY, 'd1' as SessionUserId, BID, 'accept'),
    ).rejects.toMatchObject({ code: 'BID_NOT_PENDING' });

    const bid = rows.bidRows.get(BID);
    expect(bid.price).toBe(ORIGINAL);
    expect(bid.status).toBe('PENDING');
    // Still open, still hers: the offer is back on her screen unchanged.
    expect(bid.counterAmountRwf).toBe(COUNTERED);
    expect(bid.counterOutcome).toBeNull();
    expect(chargeMomo).not.toHaveBeenCalled();
  });
});
