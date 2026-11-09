// __TESTS__/JOURNEY-ROUTES-CREATE-CHILD.TEST.TS
//
// R3-CHILD — exercises the createJourney route + service path with
// child-passenger inputs. Mocks journeyService.createJourney for the
// happy path (we just need the 201 surface) and lets the service run
// for the validation path so we can assert real blockCodes flow back
// out as 422 responses.

jest.mock('../prisma', () => {
  const journeyCreate = jest.fn();
  return {
    __esModule: true,
    default: {
      user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      journey: { create: journeyCreate, count: jest.fn().mockResolvedValue(0) },
      // R3-LEGS — createJourney now wraps journey.create + legs.createMany
      // in $transaction so they commit atomically. The mock invokes the
      // callback with a tx that proxies journey.create through to the
      // top-level mock, preserving the existing assertions.
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

const baseBody = {
  type: 'PASSENGER',
  pickupLat: -1.95,
  pickupLng: 30.06,
  pickupName: 'Pickup',
  destinationLat: -1.96,
  destinationLng: 30.07,
  destinationName: 'Drop',
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

describe('POST /api/journeys — R3-CHILD validation', () => {
  it('201 when no child declared (preserves the pre-R3-CHILD path)', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send(baseBody);
    expect(res.status).toBe(201);
    expect(res.body.hasChildPassenger).toBe(false);
  });

  it('201 with all child fields persisted on a valid MOTO + age 13 + helmet booking', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({
        ...baseBody,
        vehiclePreference: 'MOTO',
        hasChildPassenger: true,
        childAgeYears: 13,
        childPassengerHelmetConfirmed: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.hasChildPassenger).toBe(true);
    expect(res.body.childAgeYears).toBe(13);
    expect(res.body.childPassengerHelmetConfirmed).toBe(true);
  });

  it('422 CHILD_TOO_YOUNG_FOR_MOTO when child is under the moto age threshold', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({
        ...baseBody,
        vehiclePreference: 'MOTO',
        hasChildPassenger: true,
        childAgeYears: 11,
        childPassengerHelmetConfirmed: true,
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CHILD_TOO_YOUNG_FOR_MOTO');
  });

  it('422 HELMET_CONFIRMATION_REQUIRED on MOTO + age 12 without helmet', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({
        ...baseBody,
        vehiclePreference: 'MOTO',
        hasChildPassenger: true,
        childAgeYears: 12,
        childPassengerHelmetConfirmed: false,
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('HELMET_CONFIRMATION_REQUIRED');
  });

  it('422 CHILD_AGE_REQUIRED when hasChildPassenger=true but age missing', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({
        ...baseBody,
        vehiclePreference: 'BIKE',
        hasChildPassenger: true,
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CHILD_AGE_REQUIRED');
  });

  it('422 UNACCOMPANIED_MINOR_NOT_ALLOWED when an unaccompanied minor is requested', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({
        ...baseBody,
        vehiclePreference: 'BIKE',
        hasChildPassenger: true,
        childAgeYears: 16,
        childIsUnaccompaniedMinor: true,
        childGuardianPhone: '+250788000000',
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UNACCOMPANIED_MINOR_NOT_ALLOWED');
  });

  it('201 BIKE + age 5 + no helmet (bicycles are not in the helmet age band)', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({
        ...baseBody,
        vehiclePreference: 'BIKE',
        hasChildPassenger: true,
        childAgeYears: 5,
      });
    expect(res.status).toBe(201);
    expect(res.body.hasChildPassenger).toBe(true);
    expect(res.body.childAgeYears).toBe(5);
  });
});
