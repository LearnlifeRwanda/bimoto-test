// __TESTS__/COUNTER-FLAG-AND-LIFECYCLE.TEST.TS
//
// COUNTER-READY G5 — the dormant switch, and the counter's whole life.
//
// TWO THINGS ARE PINNED HERE, and the first is the reason this feature
// can ship at all.
//
//   THE FLAG MATRIX. With COUNTER_BID_ENABLED off, BOTH endpoints answer
//   403 COUNTER_DISABLED and NOTHING is written — not a column, not an
//   event, not a notification. With it on, the same calls work. The
//   both-ways form is deliberate: a test that only proved the enabled
//   arm would let a future edit make the disabled arm half-work, and a
//   half-working dormant feature is the one thing this design cannot
//   afford during the baseline weeks.
//
//   THE LIFECYCLE. One counter per bid ever; the price bounds and the
//   equal-to-the-offer refusal; a non-PENDING bid; and — the one that
//   carries the passenger's interest — that a DECLINE leaves the bid
//   PENDING at its ORIGINAL price, so his offer is still hers to take.
//
// The accept path's money is pinned separately, against the REAL
// acceptBid, in counter-accept-money-path.test.ts. Here accept is
// stubbed, because what this file is about is the gate and the columns.

// NOT a jest.mock of ../config: the real config object is what the
// service reads, and every other field on it (JWT_SECRET, the pool
// settings) is load-bearing for the supertest rig. The flag is flipped
// on the real object instead, which is also closer to the truth — the
// founder flips one env var on a running server, not the whole config.

// EXPORT-AND-LEDGER G6(a) — the Proxy auto-stub, mandatory for any
// notification.service mock. Named overrides for the three helpers this
// file asserts on; every other export is a jest.fn() by construction, so
// a notify* added tomorrow to a path under test cannot break this file.
jest.mock('../services/notification.service', () =>
  require('./helpers/notification-service-mock').autoStubbedModule({
    notifyBidCountered: jest.fn(),
    notifyCounterAccepted: jest.fn(),
    notifyCounterDeclined: jest.fn(),
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

jest.mock('../prisma', () => {
  const journeyRows = new Map<string, any>();
  const bidRows = new Map<string, any>();
  const matches = (row: any, where: any) =>
    Object.entries(where).every(([k, v]) => k === 'id' || row[k] === v);
  const client: any = {
    journey: {
      findUnique: jest.fn(async ({ where }: any) => journeyRows.get(where.id) ?? null),
    },
    bid: {
      findUnique: jest.fn(async ({ where }: any) => bidRows.get(where.id) ?? null),
      // Honours every predicate the way Postgres does — the whole point
      // of the predicated-claim design is that the WHERE decides.
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = bidRows.get(where.id);
        if (!row || !matches(row, where)) return { count: 0 };
        bidRows.set(where.id, { ...row, ...data });
        return { count: 1 };
      }),
    },
  };
  client.__rows = { journeyRows, bidRows };
  return { __esModule: true, default: client };
});

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import { config } from '../config';
import bidRoutes from '../routes/bid.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import {
  notifyBidCountered,
  notifyCounterDeclined,
} from '../services/notification.service';
import { MIN_PRICE_RWF, MAX_PRICE_RWF } from '@bimoto/shared';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/journeys', bidRoutes);
app.use(errorHandler);

const JOURNEY = 'aaaaaaaa-0000-0000-0000-000000000001';
const OTHER_JOURNEY = 'aaaaaaaa-0000-0000-0000-000000000002';
const BID = 'bbbbbbbb-0000-0000-0000-000000000001';
const OTHER_BID = 'bbbbbbbb-0000-0000-0000-000000000002';
const BID_PRICE = 2000;

const customerCookie = `accessToken=${generateAccessToken({ userId: 'c1', role: 'CUSTOMER' })}`;
const strangerCookie = `accessToken=${generateAccessToken({ userId: 'c9', role: 'CUSTOMER' })}`;
const driverCookie = `accessToken=${generateAccessToken({ userId: 'd1', role: 'DRIVER' })}`;
const otherDriverCookie = `accessToken=${generateAccessToken({ userId: 'd7', role: 'DRIVER' })}`;

const rows = (prisma as any).__rows as {
  journeyRows: Map<string, any>;
  bidRows: Map<string, any>;
};

const freshBid = (over: Record<string, unknown> = {}) => ({
  id: BID,
  journeyId: JOURNEY,
  driverId: 'd1',
  status: 'PENDING',
  price: BID_PRICE,
  counterAmountRwf: null,
  counterAt: null,
  counterOutcome: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  (config as any).COUNTER_BID_ENABLED = false;
  rows.journeyRows.clear();
  rows.bidRows.clear();
  rows.journeyRows.set(JOURNEY, { id: JOURNEY, customerId: 'c1', status: 'REQUESTED' });
  rows.journeyRows.set(OTHER_JOURNEY, { id: OTHER_JOURNEY, customerId: 'c1', status: 'REQUESTED' });
  rows.bidRows.set(BID, freshBid());
  rows.bidRows.set(OTHER_BID, {
    ...freshBid({ id: OTHER_BID, journeyId: OTHER_JOURNEY, driverId: 'd2', price: 3000 }),
  });
});

const counter = (amount: number, cookie = customerCookie) =>
  request(app)
    .post(`/api/journeys/${JOURNEY}/bids/${BID}/counter`)
    .set('Cookie', cookie)
    .send({ counterAmountRwf: amount });

const respond = (action: string, cookie = driverCookie) =>
  request(app)
    .post(`/api/journeys/${JOURNEY}/bids/${BID}/counter/respond`)
    .set('Cookie', cookie)
    .send({ action });

// ─────────────────────────────────────────────────────────────────────
describe('the dormant switch — COUNTER_BID_ENABLED off', () => {
  test('and off is what a server that was told nothing defaults to', () => {
    // The default is the safe direction, and it is asserted rather than
    // assumed: an APK 14 pilot server with no COUNTER_BID_ENABLED in its
    // environment is asleep.
    const { config: fresh } = jest.requireActual('../config');
    expect(fresh.COUNTER_BID_ENABLED).toBe(false);
  });

  test('the counter endpoint answers 403 COUNTER_DISABLED', async () => {
    const res = await counter(1500);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COUNTER_DISABLED');
  });

  test('the respond endpoint answers 403 COUNTER_DISABLED', async () => {
    // Even with a counter already on the row — a flag turned back off
    // must refuse, not half-work.
    rows.bidRows.set(BID, freshBid({ counterAmountRwf: 1500, counterAt: new Date() }));
    const res = await respond('accept');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COUNTER_DISABLED');
  });

  test('nothing is written and nobody is told', async () => {
    await counter(1500);
    const bid = rows.bidRows.get(BID);
    expect(bid.counterAmountRwf).toBeNull();
    expect(bid.counterAt).toBeNull();
    expect(bid.counterOutcome).toBeNull();
    expect(bid.status).toBe('PENDING');
    expect(notifyBidCountered).not.toHaveBeenCalled();
    expect((prisma as any).bid.updateMany).not.toHaveBeenCalled();
  });

  test('the refusal happens before ANY read — not even the journey is fetched', async () => {
    // The gate is the first line of the service, so a dormant server
    // does no database work for a counter attempt at all.
    await counter(1500);
    expect((prisma as any).journey.findUnique).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('the same calls with COUNTER_BID_ENABLED on', () => {
  beforeEach(() => {
    (config as any).COUNTER_BID_ENABLED = true;
  });

  test('the passenger counters once and the columns are written', async () => {
    const res = await counter(1500);
    expect(res.status).toBe(200);
    const bid = rows.bidRows.get(BID);
    expect(bid.counterAmountRwf).toBe(1500);
    expect(bid.counterAt).toBeInstanceOf(Date);
    expect(bid.counterOutcome).toBeNull();
    // The offer itself has not moved: still PENDING, still HIS price.
    expect(bid.status).toBe('PENDING');
    expect(bid.price).toBe(BID_PRICE);
  });

  test('the motari is told, with both numbers', async () => {
    await counter(1500);
    expect(notifyBidCountered).toHaveBeenCalledTimes(1);
    expect(notifyBidCountered).toHaveBeenCalledWith(
      'd1', JOURNEY, BID, 1500, BID_PRICE,
    );
  });

  // ── one per bid, ever ──────────────────────────────────────────────
  test('409: a second counter on the same bid', async () => {
    await counter(1500);
    const res = await counter(1400);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COUNTER_ALREADY_EXISTS');
    // The FIRST counter is the one that stands.
    expect(rows.bidRows.get(BID).counterAmountRwf).toBe(1500);
  });

  test('409 too after the motari declined — a decline does not buy a second try', async () => {
    await counter(1500);
    await respond('decline');
    const res = await counter(1400);
    expect(res.status).toBe(409);
    expect(rows.bidRows.get(BID).counterAmountRwf).toBe(1500);
  });

  // ── the price bounds, and the number that is not a counter ─────────
  test('422: below MIN_PRICE_RWF', async () => {
    const res = await counter(MIN_PRICE_RWF - 1);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('COUNTER_OUT_OF_BOUNDS');
    expect(rows.bidRows.get(BID).counterAmountRwf).toBeNull();
  });

  test('422: above MAX_PRICE_RWF', async () => {
    const res = await counter(MAX_PRICE_RWF + 1);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('COUNTER_OUT_OF_BOUNDS');
  });

  test('the bounds themselves are inclusive, as wishPrice reads them', async () => {
    const res = await counter(MIN_PRICE_RWF);
    expect(res.status).toBe(200);
  });

  test('422: the same number he already offered', async () => {
    const res = await counter(BID_PRICE);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('COUNTER_EQUALS_BID_PRICE');
    expect(rows.bidRows.get(BID).counterAmountRwf).toBeNull();
  });

  // ── who may counter what ───────────────────────────────────────────
  test('403: not this passenger\'s journey', async () => {
    const res = await counter(1500, strangerCookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_JOURNEY_CUSTOMER');
  });

  test('404: a bid id from another journey', async () => {
    const res = await request(app)
      .post(`/api/journeys/${JOURNEY}/bids/${OTHER_BID}/counter`)
      .set('Cookie', customerCookie)
      .send({ counterAmountRwf: 1500 });
    expect(res.status).toBe(404);
    expect(rows.bidRows.get(OTHER_BID).counterAmountRwf).toBeNull();
  });

  test('400: the bid is not PENDING', async () => {
    rows.bidRows.set(BID, freshBid({ status: 'WITHDRAWN' }));
    const res = await counter(1500);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BID_NOT_PENDING');
  });

  // ── the motari's answer ────────────────────────────────────────────
  test('decline: the counter closes and the OFFER SURVIVES at his price', async () => {
    await counter(1500);
    const res = await respond('decline');

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('DECLINED');
    const bid = rows.bidRows.get(BID);
    expect(bid.counterOutcome).toBe('DECLINED');
    // The whole point: she can still accept what he first offered.
    expect(bid.status).toBe('PENDING');
    expect(bid.price).toBe(BID_PRICE);
  });

  test('decline tells her, and tells her the price that still stands', async () => {
    await counter(1500);
    await respond('decline');
    expect(notifyCounterDeclined).toHaveBeenCalledTimes(1);
    expect(notifyCounterDeclined).toHaveBeenCalledWith('c1', JOURNEY, BID, BID_PRICE);
  });

  test('409: answering a counter twice', async () => {
    await counter(1500);
    await respond('decline');
    const res = await respond('accept');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COUNTER_ALREADY_ANSWERED');
  });

  test('404: responding when there is no counter', async () => {
    const res = await respond('decline');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COUNTER_NOT_FOUND');
  });

  test('403: another motari answering somebody else\'s counter', async () => {
    await counter(1500);
    const res = await respond('decline', otherDriverCookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_BID_OWNER');
    expect(rows.bidRows.get(BID).counterOutcome).toBeNull();
  });

  test('400: an action that is neither accept nor decline', async () => {
    await counter(1500);
    const res = await respond('maybe');
    expect(res.status).toBe(400);
    expect(rows.bidRows.get(BID).counterOutcome).toBeNull();
  });
});
