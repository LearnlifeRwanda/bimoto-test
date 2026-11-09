// __TESTS__/JOURNEY-ROUTES-PARCEL-CATEGORY.TEST.TS
//
// PARCEL-CATEGORY G5 — the send-a-package flow asks what is in the box,
// and the answer survives the round trip.
//
// Faustin settled the field on 24 August: the send-a-package form must
// ask the same contents question the drop-a-package flow already asks —
// Food, Documents, Electronics, Fragile, Other — and the motari must see
// the answer before he accepts.
//
// What this file pins is the SERVER half: the write→read round trip, the
// category × journey-type rule and its predicate, and the two things
// that must NOT change (goodsFragile stays an independent boolean, and
// a body with no category still stores NULL rather than a default the
// server invented).

jest.mock('../prisma', () => {
  const journeyCreate = jest.fn();
  return {
    __esModule: true,
    default: {
      user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      journey: { create: journeyCreate, count: jest.fn().mockResolvedValue(0) },
      leg: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn(async (cb: any) => {
        const tx = {
          journey: { create: journeyCreate },
          leg: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
        };
        return cb(tx);
      }),
    },
  };
});

jest.mock('../services/discovery/supply-broadcast', () => ({
  scheduleCascadeBroadcasts: jest.fn(),
}));

jest.mock('../services/discovery/urgent-broadcast', () => ({
  broadcastUrgentImmediately: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/customer-modes/suggest-up-scheduler', () => ({
  scheduleSuggestUpEmits: jest.fn(),
}));

jest.mock('../socket', () => ({
  emitToJourney: jest.fn(),
  getIO: () => {
    throw new Error('not initialized');
  },
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import journeyRoutes from '../routes/journey.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import prisma from '../prisma';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/journeys', journeyRoutes);
app.use(errorHandler);

const customerCookie = `accessToken=${generateAccessToken({ userId: 'c1', role: 'CUSTOMER' })}`;

/** An ordinary GoodsRequestPage parcel booking. */
const parcelBody = {
  type: 'GOODS',
  pickupLat: -1.95,
  pickupLng: 30.06,
  pickupName: 'Kimironko Market',
  destinationLat: -1.96,
  destinationLng: 30.07,
  destinationName: 'Kigali Convention Centre',
  goodsDescription: 'A wrapped box of medicine',
  goodsSizeCategory: 'MEDIUM',
  recipientName: 'Alice',
  recipientPhone: '0788000000',
};

/** The same trip, with a person in it instead of a parcel. */
const rideBody = {
  type: 'PASSENGER',
  pickupLat: -1.95,
  pickupLng: 30.06,
  pickupName: 'Kimironko Market',
  destinationLat: -1.96,
  destinationLng: 30.07,
  destinationName: 'Kigali Convention Centre',
};

/** Faustin's list, verbatim. */
const CATEGORIES = ['FOOD', 'DOCUMENTS', 'ELECTRONICS', 'FRAGILE', 'OTHER'] as const;

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', isFlagged: false });
  (prisma.journey.create as jest.Mock).mockImplementation(({ data }: any) =>
    Promise.resolve({
      id: 'j1',
      ...data,
      createdAt: new Date(),
      discoveryStartedAt: new Date(),
    }),
  );
});

describe('POST /api/journeys — the contents answer makes the round trip', () => {
  it.each(CATEGORIES)('201 and persists %s, exactly as sent', async (parcelCategory) => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({ ...parcelBody, parcelCategory });

    expect(res.status).toBe(201);
    expect(res.body.parcelCategory).toBe(parcelCategory);
    // What actually reached the column, not just what came back.
    const written = (prisma.journey.create as jest.Mock).mock.calls[0][0].data;
    expect(written.parcelCategory).toBe(parcelCategory);
  });

  it('refuses a category outside the five — the list is the enum, not a free string', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({ ...parcelBody, parcelCategory: 'LIVESTOCK' });

    expect(res.status).toBe(400);
  });

  it('a parcel booked without a category stores NULL, not a server-invented OTHER', async () => {
    // The CLIENT defaults to OTHER on submit (the leg-flow convention).
    // The server must not, or NULL stops meaning "was never asked" and
    // every parcel that predates the question starts claiming an answer
    // it never gave.
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send(parcelBody);

    expect(res.status).toBe(201);
    expect(res.body.parcelCategory).toBeNull();
  });

  it('an explicit null is accepted and stored as null', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({ ...parcelBody, parcelCategory: null });

    expect(res.status).toBe(201);
    expect(res.body.parcelCategory).toBeNull();
  });
});

describe('the category × journey-type rule', () => {
  it('REFUSES a category on a passenger journey — a person has no contents', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({ ...rideBody, parcelCategory: 'FOOD' });

    expect(res.status).toBe(422);
    expect(res.body.error?.code ?? res.body.code).toBe(
      'PARCEL_CATEGORY_ON_PASSENGER_JOURNEY',
    );
    expect(prisma.journey.create).not.toHaveBeenCalled();
  });

  // THE PREDICATE, pinned. The rule gates on isCarryingPassenger, not on
  // `type === 'GOODS'`: JourneyType has four members and THREE of them
  // are parcel runs. A GOODS-only test would gate on GOODS alone, and
  // the two messenger tiers — real parcels, carrying real cargo — would
  // be refused an answer they are entitled to give.
  it.each(['GOODS', 'PRIORITY_MESSENGER', 'URGENT_MESSENGER'])(
    'ACCEPTS a category on %s — all three types carry cargo',
    async (type) => {
      const res = await request(app)
        .post('/api/journeys')
        .set('Cookie', customerCookie)
        .send({ ...parcelBody, type, parcelCategory: 'ELECTRONICS' });

      expect(res.status).toBe(201);
      expect(res.body.parcelCategory).toBe('ELECTRONICS');
    },
  );

  it('a passenger journey that declares NO category is untouched — additive by construction', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send(rideBody);

    expect(res.status).toBe(201);
    expect(res.body.parcelCategory).toBeNull();
  });

  it('a passenger journey sending an explicit null is not refused', async () => {
    // Refusing this would break the offline outbox replaying a body a
    // newer client wrote with an unanswered field.
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({ ...rideBody, parcelCategory: null });

    expect(res.status).toBe(201);
  });
});

describe('goodsFragile is not the category, and the category is not goodsFragile', () => {
  it('FRAGILE the category leaves the fragile boolean alone', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({ ...parcelBody, parcelCategory: 'FRAGILE' });

    expect(res.status).toBe(201);
    expect(res.body.parcelCategory).toBe('FRAGILE');
    // Nothing inferred the boolean from the category. The redundancy for
    // a sender who picks FRAGILE is accepted and field-specified; what
    // is NOT accepted is one field quietly writing the other.
    expect(res.body.goodsFragile).toBe(false);
  });

  it('the fragile boolean leaves the category alone', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({ ...parcelBody, goodsFragile: true });

    expect(res.status).toBe(201);
    expect(res.body.goodsFragile).toBe(true);
    expect(res.body.parcelCategory).toBeNull();
  });

  it('a fragile electronics parcel is both, and neither overwrites the other', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({ ...parcelBody, parcelCategory: 'ELECTRONICS', goodsFragile: true });

    expect(res.status).toBe(201);
    expect(res.body.parcelCategory).toBe('ELECTRONICS');
    expect(res.body.goodsFragile).toBe(true);
  });
});
