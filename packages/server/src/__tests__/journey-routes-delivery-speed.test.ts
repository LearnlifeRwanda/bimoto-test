// __TESTS__/JOURNEY-ROUTES-DELIVERY-SPEED.TEST.TS
//
// TEAM-SAID G3 — delivery speed is a tier tag, not a price.
//
// Jean settled item 13 on exactly two tiers, and settled express as
// "priced by the same suggest/bid mechanic as every fare" rather than
// by a surcharge. The team asked explicitly to drop predetermined
// surcharges, so the assertion that carries the decision is that
// nothing in the pricing path can see this field at all.

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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

const baseBody = {
  type: 'GOODS',
  pickupLat: -1.95,
  pickupLng: 30.06,
  pickupName: 'Pickup',
  destinationLat: -1.96,
  destinationLng: 30.07,
  destinationName: 'Drop',
  goodsDescription: 'A box',
  recipientName: 'Alice',
  recipientPhone: '0788000000',
};

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

describe('POST /api/journeys — the delivery tier travels', () => {
  it.each(['STANDARD', 'EXPRESS'])('201 and persists %s', async (deliverySpeed) => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({ ...baseBody, deliverySpeed });

    expect(res.status).toBe(201);
    expect(res.body.deliverySpeed).toBe(deliverySpeed);
  });

  it('rejects a third tier — the team settled on exactly two', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({ ...baseBody, deliverySpeed: 'SAME_DAY' });

    expect(res.status).toBe(400);
  });

  it('a parcel booked without a tier stores null, not STANDARD', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send(baseBody);

    expect(res.status).toBe(201);
    expect(res.body.deliverySpeed).toBeNull();
  });
});

describe('express adds no price', () => {
  it('the two journeys differ by the tier alone — no fare field moves', async () => {
    const standard = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({ ...baseBody, deliverySpeed: 'STANDARD', wishPrice: 2000 });

    const express_ = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({ ...baseBody, deliverySpeed: 'EXPRESS', wishPrice: 2000 });

    expect(standard.status).toBe(201);
    expect(express_.status).toBe(201);
    // The suggested fare the customer named is carried through
    // untouched. Nothing marked it up for choosing express.
    expect(express_.body.wishPrice).toBe(2000);
    expect(express_.body.wishPrice).toBe(standard.body.wishPrice);
    expect(express_.body.agreedPrice ?? null).toBe(standard.body.agreedPrice ?? null);
    expect(express_.body.commissionAmount ?? null).toBe(standard.body.commissionAmount ?? null);
  });

  // The structural half. "Express carries no surcharge and no
  // percentage" is a claim about the pricing source, so it is asserted
  // there: if anyone later multiplies a fare by this tier, the line
  // they add turns this red.
  //
  // fair-price.service.ts is the file that holds every multiplier
  // Bimoto applies — vehicle, urgency, child, parcel size — so it is
  // the one place a delivery-speed surcharge could live.
  const PRICING_SOURCES = [
    'services/fair-price.service.ts',
    'services/escrow.service.ts',
    'services/bid.service.ts',
  ];

  it.each(PRICING_SOURCES)('%s never reads deliverySpeed', (rel) => {
    const source = readFileSync(join(__dirname, '..', rel), 'utf8');
    expect(source).not.toContain('deliverySpeed');
  });

  it('no delivery-speed multiplier exists to have been removed', () => {
    // Recorded rather than assumed: the dispatch asked whether a
    // pre-existing speed surcharge had to be dropped. It does not
    // exist and never did — parcel-weight.ts said so in as many words
    // ("Delivery *speed* tiers (standard/express) are a separate, open
    // question and are not represented here"), and the multipliers
    // that DO exist key on JourneyType, a different axis.
    const fairPrice = readFileSync(
      join(__dirname, '..', 'services/fair-price.service.ts'),
      'utf8',
    );
    expect(fairPrice).not.toMatch(/EXPRESS|STANDARD_MULTIPLIER|SPEED_MULTIPLIER/);
    // The urgency multipliers that do exist are untouched and keyed on
    // journey type, not on the new tier.
    expect(fairPrice).toContain('URGENT_MESSENGER');
    expect(fairPrice).toContain('PRIORITY_MESSENGER');
  });
});
