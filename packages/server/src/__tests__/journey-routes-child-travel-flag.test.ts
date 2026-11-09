// __TESTS__/JOURNEY-ROUTES-CHILD-TRAVEL-FLAG.TEST.TS
//
// TEAM-SAID G1 — the child-travel advisory is a flag, not a flow.
//
// The team confirmed the child-passenger declaration stays off for the
// pilot (item 9, 6 of 7) and asked for one honest signal in its place:
// a passenger warns the motari that a child is coming. The advisory
// must reach the motari, and it must not become the thing it replaced.
//
// So the load-bearing assertions here are the negative ones. A booking
// that carries travellingWithChild must:
//   - never set hasChildPassenger (which is what the fare premium and
//     the acknowledgment modal read);
//   - never raise any code in the child 422 taxonomy, including on the
//     exact inputs that DO raise them through hasChildPassenger — a
//     MOTO with no age, no guardian, no helmet confirmation;
//   - carry no fare consequence at all.
//
// This file mirrors journey-routes-create-child.test.ts, deliberately:
// the two flows are tested side by side so a change that merges them
// turns one of the two files red.

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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHILD_PASSENGER_MULTIPLIER,
  childPassengerMultiplier,
} from '../services/fair-price.service';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/journeys', journeyRoutes);
app.use(errorHandler);

const customerCookie = `accessToken=${generateAccessToken({ userId: 'c1', role: 'CUSTOMER' })}`;

const baseBody = {
  type: 'PASSENGER',
  pickupLat: -1.95,
  pickupLng: 30.06,
  pickupName: 'Pickup',
  destinationLat: -1.96,
  destinationLng: 30.07,
  destinationName: 'Drop',
};

/** Every code the R3-CHILD booking validator can raise. */
const CHILD_422_CODES = [
  'CHILD_AGE_REQUIRED',
  'CHILD_TOO_YOUNG_FOR_MOTO',
  'HELMET_CONFIRMATION_REQUIRED',
  'UNACCOMPANIED_MINOR_NOT_ALLOWED',
  'GUARDIAN_PHONE_REQUIRED',
];

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

describe('POST /api/journeys — the child-travel advisory travels', () => {
  it('201 and the flag is persisted when the passenger ticks the box', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({ ...baseBody, vehiclePreference: 'MOTO', travellingWithChild: true });

    expect(res.status).toBe(201);
    expect(res.body.travellingWithChild).toBe(true);
  });

  it('a booking that never answers stores null, not false', async () => {
    // "Was never asked" and "answered no" are different facts, and the
    // motari's screen must not claim the passenger said anything.
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send(baseBody);

    expect(res.status).toBe(201);
    expect(res.body.travellingWithChild).toBeNull();
  });
});

describe('the advisory never enters the child-passenger flow', () => {
  it('does not set hasChildPassenger — the field the premium reads', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({ ...baseBody, vehiclePreference: 'MOTO', travellingWithChild: true });

    expect(res.status).toBe(201);
    expect(res.body.hasChildPassenger).toBe(false);
    expect(res.body.childAgeYears).toBeNull();
    expect(res.body.childGuardianPhone).toBeNull();
    expect(res.body.childIsUnaccompaniedMinor).toBe(false);
    expect(res.body.childPassengerHelmetConfirmed).toBe(false);
  });

  it('raises no child 422 on the exact input that DOES raise one via hasChildPassenger', async () => {
    // A MOTO with no age and no helmet confirmation is
    // CHILD_AGE_REQUIRED through the declaration flow (see
    // journey-routes-create-child.test.ts). Through the advisory it is
    // simply a booking.
    const viaFlag = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({ ...baseBody, vehiclePreference: 'MOTO', travellingWithChild: true });
    expect(viaFlag.status).toBe(201);

    const viaFlow = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({ ...baseBody, vehiclePreference: 'MOTO', hasChildPassenger: true });
    expect(viaFlow.status).toBe(422);
    expect(CHILD_422_CODES).toContain(viaFlow.body.error.code);
  });

  it('raises no child 422 under any vehicle the flow gates on', async () => {
    for (const vehiclePreference of ['MOTO', 'BIKE', 'E_MOTO', 'E_BIKE']) {
      const res = await request(app)
        .post('/api/journeys')
        .set('Cookie', customerCookie)
        .send({ ...baseBody, vehiclePreference, travellingWithChild: true });

      expect(res.status).toBe(201);
      expect(CHILD_422_CODES).not.toContain(res.body?.error?.code);
    }
  });
});

describe('the advisory carries no price', () => {
  it('the child premium keys on hasChildPassenger alone, and it is untouched', () => {
    // childPassengerMultiplier is the ONLY child input to the fare
    // (getFairPriceRange composes vehicle × urgency × child × parcel).
    // It takes hasChildPassenger and nothing else, so an advisory that
    // never reaches that argument can never move a price.
    expect(childPassengerMultiplier(true)).toBe(CHILD_PASSENGER_MULTIPLIER);
    expect(childPassengerMultiplier(false)).toBe(1.0);
    // The advisory's absence from the declaration is what a journey
    // carrying only travellingWithChild presents to the fare.
    expect(childPassengerMultiplier(undefined)).toBe(1.0);
    expect(childPassengerMultiplier(null)).toBe(1.0);
  });

  // The structural half of the claim: "shares none of its pricing,
  // acknowledgment or 422 paths" is a statement about the source, so
  // it is asserted against the source. If someone later wires the
  // advisory into the fare or into the child-safety validator, this
  // turns red at the moment they do it rather than in Kigali.
  const FORBIDDEN_READERS = [
    'services/fair-price.service.ts',
    'services/child-safety/booking-validator.ts',
    'services/child-safety/legal-thresholds.ts',
  ];

  it.each(FORBIDDEN_READERS)('%s never reads travellingWithChild', (rel) => {
    const source = readFileSync(join(__dirname, '..', rel), 'utf8');
    expect(source).not.toContain('travellingWithChild');
  });
});
