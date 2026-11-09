jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findMany: jest.fn(), findUnique: jest.fn() },
  },
}));

jest.mock('../services/bid.service', () => ({
  acceptBid: jest.fn(),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import scheduledRideRoutes from '../routes/scheduled-ride.routes';
import { generateAccessToken } from '../utils/jwt';
import { AppError, errorHandler } from '../middleware/error-handler';
import * as bidService from '../services/bid.service';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/scheduled-rides', scheduledRideRoutes);
app.use(errorHandler);

const driverCookie = `accessToken=${generateAccessToken({ userId: 'd1', role: 'DRIVER' })}`;
const customerCookie = `accessToken=${generateAccessToken({ userId: 'c1', role: 'CUSTOMER' })}`;
const otherDriverCookie = `accessToken=${generateAccessToken({ userId: 'd2', role: 'DRIVER' })}`;

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => jest.clearAllMocks());

describe('GET /api/scheduled-rides', () => {
  test('401 when unauthenticated', async () => {
    const res = await request(app).get('/api/scheduled-rides');
    expect(res.status).toBe(401);
  });

  test('403 for customer role', async () => {
    const res = await request(app)
      .get('/api/scheduled-rides')
      .set('Cookie', customerCookie);
    expect(res.status).toBe(403);
  });

  // FIELD-FIT G2 — the query used to be `driverId: me` alone, which made
  // the page permanently empty (a SCHEDULED journey has no driver until
  // a bid is accepted, and bidding opens 60 min before pickup). It now
  // matches rides this driver is assigned to OR holds a live bid on. The
  // invariant these tests actually protect — one driver never sees
  // another driver's rides — is unchanged and asserted below.
  test('scopes to rides this driver is assigned to or has a live bid on', async () => {
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([
      { id: 'j1', driverId: 'd1', status: 'MATCHED', bids: [] },
    ]);
    const res = await request(app)
      .get('/api/scheduled-rides')
      .set('Cookie', driverCookie);
    expect(res.status).toBe(200);
    const call = (mockPrisma.journey.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.bookingMode).toBe('SCHEDULED');
    expect(call.where.OR).toEqual([
      { driverId: 'd1' },
      { bids: { some: { driverId: 'd1', status: { in: ['PENDING', 'ACCEPTED'] } } } },
    ]);
    // Only this driver's own bid is joined onto the row.
    expect(call.include.bids.where.driverId).toBe('d1');
  });

  test('labels an assigned ride ASSIGNED and a bid-only ride BID_PENDING', async () => {
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([
      { id: 'j1', driverId: 'd1', status: 'MATCHED', bids: [{ id: 'b1', price: 1500 }] },
      { id: 'j2', driverId: null, status: 'REQUESTED', bids: [{ id: 'b2', price: 900 }] },
    ]);
    const res = await request(app)
      .get('/api/scheduled-rides')
      .set('Cookie', driverCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ id: 'j1', commitment: 'ASSIGNED', myBid: { id: 'b1', price: 1500 } }),
      expect.objectContaining({ id: 'j2', commitment: 'BID_PENDING', myBid: { id: 'b2', price: 900 } }),
    ]);
    // The raw bids array never reaches the client — myBid replaces it.
    expect(res.body[0].bids).toBeUndefined();
  });

  test('excludes COMPLETED rides via status filter', async () => {
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([]);
    await request(app).get('/api/scheduled-rides').set('Cookie', driverCookie);
    const call = (mockPrisma.journey.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.status.in).toEqual(['SCHEDULED', 'REQUESTED', 'MATCHED']);
  });

  test('excludes past rides via scheduledFor > now', async () => {
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([]);
    await request(app).get('/api/scheduled-rides').set('Cookie', driverCookie);
    const call = (mockPrisma.journey.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.scheduledFor.gt).toBeInstanceOf(Date);
  });

  test('different drivers see different result sets', async () => {
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([]);
    await request(app).get('/api/scheduled-rides').set('Cookie', otherDriverCookie);
    const call = (mockPrisma.journey.findMany as jest.Mock).mock.calls[0][0];
    // Every arm of the scope names d2 — neither assignment nor bid
    // ownership may leak another driver's rides in.
    expect(call.where.OR).toEqual([
      { driverId: 'd2' },
      { bids: { some: { driverId: 'd2', status: { in: ['PENDING', 'ACCEPTED'] } } } },
    ]);
    expect(JSON.stringify(call)).not.toContain('d1');
  });
});

describe('GET /api/scheduled-rides/customer', () => {
  test('403 for driver role', async () => {
    const res = await request(app)
      .get('/api/scheduled-rides/customer')
      .set('Cookie', driverCookie);
    expect(res.status).toBe(403);
  });

  test('returns customer\'s scheduled rides only', async () => {
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([]);
    const res = await request(app)
      .get('/api/scheduled-rides/customer')
      .set('Cookie', customerCookie);
    expect(res.status).toBe(200);
    const call = (mockPrisma.journey.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.customerId).toBe('c1');
  });
});

describe('POST /api/scheduled-rides/:id/conflict-acknowledge', () => {
  // CUTGUARD v2 G4 (U-1) — this block used to encode the DEFECT as the
  // contract. It sent `driverCookie` and asserted
  //
  //     expect(bidService.acceptBid).toHaveBeenCalledWith('j1', 'c1', 'b1', …)
  //
  // where 'c1' was the JOURNEY'S OWN customerId, read from a row the
  // handler had just fetched and handed back as the actor. acceptBidCore
  // then compared it against `journey.customerId` — itself — so the 403
  // could not fire, and a stranger motari matched a passenger at a price
  // she never accepted with her money HELD. The test passed the whole
  // time, because it was asserting that the tautology happened.
  //
  // The contract now: the acknowledgment is the PASSENGER'S (the
  // soft-block warns HER that this motari has a conflicting commitment),
  // the route is customerOnly, and the actor comes from the session.

  test('the stranger motari is refused — 403, and acceptBid is never reached', async () => {
    // The live exploit, inverted. d2 has a perfectly good session and no
    // relationship to this journey whatsoever.
    const res = await request(app)
      .post('/api/scheduled-rides/j1/conflict-acknowledge')
      .set('Cookie', otherDriverCookie)
      .send({ bidId: 'b1' });

    expect(res.status).toBe(403);
    expect(bidService.acceptBid).not.toHaveBeenCalled();
  });

  test('the matched motari is refused too — being ON the ride is not owning it', async () => {
    const res = await request(app)
      .post('/api/scheduled-rides/j1/conflict-acknowledge')
      .set('Cookie', driverCookie)
      .send({ bidId: 'b1' });

    expect(res.status).toBe(403);
    expect(bidService.acceptBid).not.toHaveBeenCalled();
  });

  test('400 when bidId missing', async () => {
    const res = await request(app)
      .post('/api/scheduled-rides/j1/conflict-acknowledge')
      .set('Cookie', customerCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  test('the passenger is served — 200, with HER id as the actor', async () => {
    (bidService.acceptBid as jest.Mock).mockResolvedValue({ matched: true, journey: {}, bid: {} });
    const res = await request(app)
      .post('/api/scheduled-rides/j1/conflict-acknowledge')
      .set('Cookie', customerCookie)
      .send({ bidId: 'b1' });

    expect(res.status).toBe(200);
    // The load-bearing assertion: a customer ACTOR built from the
    // session, not a string read off a row. `c1` here is the session
    // user id — the cookie's — and the route no longer fetches the
    // journey at all, so there is no record for it to read one from.
    expect(bidService.acceptBid).toHaveBeenCalledWith(
      'j1',
      { kind: 'customer', customerId: 'c1' },
      'b1',
      // CUTGUARD v2 amendment 2 — this route answers the passenger
      // directly and fans out to the journey room, exactly like
      // POST /accept-bid, so it declares her generation too. It did not,
      // until the route-side guard rule (S5) said so: a v14 passenger who
      // came through the conflict dialog silently lost the savings line
      // the same passenger kept on the direct path.
      { acknowledgeConflict: true, customerSavingsPreview: false },
    );
    expect(mockPrisma.journey.findUnique).not.toHaveBeenCalled();
  });

  test('404 for a journey that does not exist — answered by acceptBidCore', async () => {
    // The route used to pre-fetch the journey to steal its customerId,
    // and answered 404 itself. It no longer needs the row for anything,
    // so the not-found answer comes from the one place that must look it
    // up anyway.
    (bidService.acceptBid as jest.Mock).mockRejectedValue(
      new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound'),
    );
    const res = await request(app)
      .post('/api/scheduled-rides/j1/conflict-acknowledge')
      .set('Cookie', customerCookie)
      .send({ bidId: 'b1' });

    expect(res.status).toBe(404);
  });
});
