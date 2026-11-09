// R3-PAYMENT-CARD-ACCEPT-BID — route-level tests for
// POST /api/journeys/:id/accept-bid-card. Asserts the happy path returns
// the cardCheckout payload, the conflict-warning path returns retryUrl,
// auth + schema guards fire, and — the smallest-wrongness gate — the
// 'bid-accepted' socket event is NOT emitted (it must wait for card
// verification via the webhook).

jest.mock('../services/bid.service', () => ({
  acceptBidForCard: jest.fn(),
}));

jest.mock('../socket', () => ({
  emitToJourney: jest.fn(),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import bidRoutes from '../routes/bid.routes';
import { generateAccessToken } from '../utils/jwt';
import { errorHandler } from '../middleware/error-handler';
import * as bidService from '../services/bid.service';
import { emitToJourney } from '../socket';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/journeys', bidRoutes);
app.use(errorHandler);

const customerCookie = `accessToken=${generateAccessToken({ userId: 'c1', role: 'CUSTOMER' })}`;
const driverCookie = `accessToken=${generateAccessToken({ userId: 'd1', role: 'DRIVER' })}`;

const mockedAcceptBidForCard = bidService.acceptBidForCard as jest.MockedFunction<
  typeof bidService.acceptBidForCard
>;
const mockedEmit = emitToJourney as jest.MockedFunction<typeof emitToJourney>;

const validBidId = '11111111-1111-1111-1111-111111111111';

beforeEach(() => jest.clearAllMocks());

describe('POST /api/journeys/:id/accept-bid-card', () => {
  test('happy path: 200 with cardCheckout { escrowId, txRef, amount }', async () => {
    mockedAcceptBidForCard.mockResolvedValue({
      journey: { id: 'j1', status: 'MATCHED' },
      bid: { id: 'b1', status: 'ACCEPTED' },
      escrowStatus: 'PENDING',
      paymentMethod: 'card',
      cardCheckout: { escrowId: 'esc1', txRef: 'bimoto-j1abc-123', amount: 2000 },
    } as any);

    const res = await request(app)
      .post('/api/journeys/j1/accept-bid-card')
      .set('Cookie', customerCookie)
      .send({ bidId: validBidId });

    expect(res.status).toBe(200);
    expect(res.body.cardCheckout).toEqual({
      escrowId: 'esc1',
      txRef: 'bimoto-j1abc-123',
      amount: 2000,
    });
    // CUTGUARD v2 G4 — the actor is a customer ACTOR built from the
    // session (`customerActor(sessionUserId(req))`), not a bare string.
    // `c1` is the cookie's user id; the type is what stops a future edit
    // handing this a value read off a fetched row instead.
    expect(mockedAcceptBidForCard).toHaveBeenCalledWith(
      'j1',
      { kind: 'customer', customerId: 'c1' },
      validBidId,
      // CUTGUARD v2 amendment 2 — the route now declares which generation
      // it is answering. `false` here is not an accident of the fixture:
      // this app mounts bidRoutes WITHOUT appVersionMiddleware, so
      // `req.appVersion` is undefined and `undefined >= 14` is false. A
      // route wired up without the middleware answers LEGACY, which is
      // the safe-by-default direction holding even against a mounting
      // mistake. Its own test is below.
      { acknowledgeConflict: false, customerSavingsPreview: false },
    );
  });

  test('conflict warning: 200 with conflictWarning + retryUrl', async () => {
    mockedAcceptBidForCard.mockResolvedValue({
      matched: false,
      conflictWarning: { conflictingRides: [{ id: 'other' }] },
    } as any);

    const res = await request(app)
      .post('/api/journeys/j1/accept-bid-card')
      .set('Cookie', customerCookie)
      .send({ bidId: validBidId });

    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(false);
    expect(res.body.conflictWarning.conflictingRides[0].id).toBe('other');
    expect(res.body.retryUrl).toBe('/api/scheduled-rides/j1/conflict-acknowledge');
  });

  test('403 for non-customer role', async () => {
    const res = await request(app)
      .post('/api/journeys/j1/accept-bid-card')
      .set('Cookie', driverCookie)
      .send({ bidId: validBidId });

    expect(res.status).toBe(403);
    expect(mockedAcceptBidForCard).not.toHaveBeenCalled();
  });

  test('400 on schema validation failure (bidId not a uuid)', async () => {
    const res = await request(app)
      .post('/api/journeys/j1/accept-bid-card')
      .set('Cookie', customerCookie)
      .send({ bidId: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(mockedAcceptBidForCard).not.toHaveBeenCalled();
  });

  test('400 with BID_NOT_PENDING when the bid was already accepted', async () => {
    const { AppError } = await import('../middleware/error-handler');
    mockedAcceptBidForCard.mockRejectedValue(
      new AppError(400, 'BID_NOT_PENDING', 'errors.bidNotPending'),
    );

    const res = await request(app)
      .post('/api/journeys/j1/accept-bid-card')
      .set('Cookie', customerCookie)
      .send({ bidId: validBidId });

    expect(res.status).toBe(400);
    expect(res.body.error?.code ?? res.body.code).toBe('BID_NOT_PENDING');
  });

  test("does NOT emit 'bid-accepted' on success (smallest-wrongness gate)", async () => {
    mockedAcceptBidForCard.mockResolvedValue({
      journey: { id: 'j1', status: 'MATCHED' },
      bid: { id: 'b1', status: 'ACCEPTED' },
      escrowStatus: 'PENDING',
      paymentMethod: 'card',
      cardCheckout: { escrowId: 'esc1', txRef: 'bimoto-j1abc-123', amount: 2000 },
    } as any);

    await request(app)
      .post('/api/journeys/j1/accept-bid-card')
      .set('Cookie', customerCookie)
      .send({ bidId: validBidId });

    expect(mockedEmit).not.toHaveBeenCalled();
  });
});
