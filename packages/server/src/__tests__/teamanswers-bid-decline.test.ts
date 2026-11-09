// TEAM-ANSWERS G4 — the passenger says no to ONE offer (item 16a).
//
// Before this, the only thing that ever set a bid DECLINED was accepting
// a rival, which mass-declined the rest. A passenger who did not want a
// particular motari's offer could only ignore it.
//
// Pinned here: ownership, cross-journey isolation, that a declined bid
// can never afterwards be accepted, the repeat, and that the motari is
// told exactly once through the channels an accept's losers already
// used.

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
  const client: any = {
    journey: {
      findUnique: jest.fn(async ({ where }: any) => journeyRows.get(where.id) ?? null),
    },
    bid: {
      findUnique: jest.fn(async ({ where }: any) => bidRows.get(where.id) ?? null),
      // Honours the status predicate, like Postgres does.
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = bidRows.get(where.id);
        if (!row || (where.status !== undefined && row.status !== where.status)) {
          return { count: 0 };
        }
        bidRows.set(where.id, { ...row, ...data });
        return { count: 1 };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = { ...bidRows.get(where.id), ...data };
        bidRows.set(where.id, row);
        return row;
      }),
    },
    escrow: { create: jest.fn(), findUnique: jest.fn(async () => null) },
  };
  client.__rows = { journeyRows, bidRows };
  return { __esModule: true, default: client };
});

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import bidRoutes from '../routes/bid.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import * as bidService from '../services/bid.service';
import { announceBidDeclined } from '../services/bid-outcome';
import { emitToJourney } from '../socket';
// CUTGUARD v2 G4 — the actor is now a TYPE (services/session-actor.ts).
// A test stands in for a session, so it says so with an explicit cast at
// the call rather than passing a bare string, which is what made the
// tautology writable in the first place.
import { customerActor, type SessionUserId } from '../services/session-actor';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/journeys', bidRoutes);
app.use(errorHandler);

const JOURNEY = 'aaaaaaaa-0000-0000-0000-000000000001';
const OTHER_JOURNEY = 'aaaaaaaa-0000-0000-0000-000000000002';
const BID = 'bbbbbbbb-0000-0000-0000-000000000001';
const OTHER_BID = 'bbbbbbbb-0000-0000-0000-000000000002';

const customerCookie = `accessToken=${generateAccessToken({ userId: 'c1', role: 'CUSTOMER' })}`;
const strangerCookie = `accessToken=${generateAccessToken({ userId: 'c9', role: 'CUSTOMER' })}`;
const driverCookie = `accessToken=${generateAccessToken({ userId: 'd1', role: 'DRIVER' })}`;

const rows = (prisma as any).__rows as {
  journeyRows: Map<string, any>;
  bidRows: Map<string, any>;
};

beforeEach(() => {
  jest.clearAllMocks();
  rows.journeyRows.clear();
  rows.bidRows.clear();
  rows.journeyRows.set(JOURNEY, { id: JOURNEY, customerId: 'c1', status: 'REQUESTED' });
  rows.journeyRows.set(OTHER_JOURNEY, { id: OTHER_JOURNEY, customerId: 'c1', status: 'REQUESTED' });
  rows.bidRows.set(BID, { id: BID, journeyId: JOURNEY, driverId: 'd1', status: 'PENDING', price: 2000 });
  rows.bidRows.set(OTHER_BID, { id: OTHER_BID, journeyId: OTHER_JOURNEY, driverId: 'd2', status: 'PENDING', price: 3000 });
});

describe('POST /api/journeys/:id/bids/:bidId/decline', () => {
  test('the passenger declines one offer; the bid goes DECLINED', async () => {
    const res = await request(app)
      .post(`/api/journeys/${JOURNEY}/bids/${BID}/decline`)
      .set('Cookie', customerCookie);

    expect(res.status).toBe(200);
    expect(rows.bidRows.get(BID).status).toBe('DECLINED');
  });

  test('nothing else moves — the journey and the rival offers are untouched', async () => {
    rows.bidRows.set('rival', {
      id: 'rival', journeyId: JOURNEY, driverId: 'd7', status: 'PENDING', price: 2500,
    });

    await request(app)
      .post(`/api/journeys/${JOURNEY}/bids/${BID}/decline`)
      .set('Cookie', customerCookie);

    expect(rows.journeyRows.get(JOURNEY).status).toBe('REQUESTED');
    expect(rows.bidRows.get('rival').status).toBe('PENDING');
    expect((prisma as any).escrow.create).not.toHaveBeenCalled();
  });

  test('the motari is told once, through the same channels an accept loser uses', async () => {
    await request(app)
      .post(`/api/journeys/${JOURNEY}/bids/${BID}/decline`)
      .set('Cookie', customerCookie);

    expect(announceBidDeclined).toHaveBeenCalledTimes(1);
    expect(announceBidDeclined).toHaveBeenCalledWith(JOURNEY, { id: BID, driverId: 'd1' });
    // …and NOT into the journey room. That room holds only the
    // passenger while the journey is REQUESTED, and the client's
    // BID_DECLINED handler would have toasted her that her own bid was
    // declined.
    expect(emitToJourney).not.toHaveBeenCalled();
  });

  test('403: not this passenger\'s journey', async () => {
    const res = await request(app)
      .post(`/api/journeys/${JOURNEY}/bids/${BID}/decline`)
      .set('Cookie', strangerCookie);

    expect(res.status).toBe(403);
    expect(rows.bidRows.get(BID).status).toBe('PENDING');
    expect(announceBidDeclined).not.toHaveBeenCalled();
  });

  test('403: a driver cannot decline offers on a ride', async () => {
    const res = await request(app)
      .post(`/api/journeys/${JOURNEY}/bids/${BID}/decline`)
      .set('Cookie', driverCookie);

    expect(res.status).toBe(403);
  });

  test('404: a bid belonging to another journey is not this one to decline', async () => {
    const res = await request(app)
      .post(`/api/journeys/${JOURNEY}/bids/${OTHER_BID}/decline`)
      .set('Cookie', customerCookie);

    expect(res.status).toBe(404);
    expect(rows.bidRows.get(OTHER_BID).status).toBe('PENDING');
  });

  test('409 on the repeat, and the bid is written only once', async () => {
    await request(app)
      .post(`/api/journeys/${JOURNEY}/bids/${BID}/decline`)
      .set('Cookie', customerCookie);
    const writesAfterFirst = ((prisma as any).bid.updateMany as jest.Mock).mock.calls.length;

    const second = await request(app)
      .post(`/api/journeys/${JOURNEY}/bids/${BID}/decline`)
      .set('Cookie', customerCookie);

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_DECLINED');
    expect(((prisma as any).bid.updateMany as jest.Mock).mock.calls.length).toBe(writesAfterFirst);
    expect(announceBidDeclined).toHaveBeenCalledTimes(1);
  });

  test('decline then accept: the accept is refused, no journey moves', async () => {
    await request(app)
      .post(`/api/journeys/${JOURNEY}/bids/${BID}/decline`)
      .set('Cookie', customerCookie);

    // The guard that makes this true predates this dispatch:
    // acceptBidCore refuses a non-PENDING bid up front, and claims the
    // bid with a PENDING-predicated updateMany inside its transaction.
    await expect(bidService.acceptBid(JOURNEY, customerActor('c1' as SessionUserId), BID))
      .rejects.toThrow('errors.bidNotPending');
    expect(rows.journeyRows.get(JOURNEY).status).toBe('REQUESTED');
  });

  test('an already-ACCEPTED bid cannot be declined out from under a match', async () => {
    rows.bidRows.set(BID, { ...rows.bidRows.get(BID), status: 'ACCEPTED' });

    const res = await request(app)
      .post(`/api/journeys/${JOURNEY}/bids/${BID}/decline`)
      .set('Cookie', customerCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BID_NOT_PENDING');
    expect(rows.bidRows.get(BID).status).toBe('ACCEPTED');
  });
});
