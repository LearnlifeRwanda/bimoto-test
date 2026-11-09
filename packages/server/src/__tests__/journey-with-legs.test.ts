// __TESTS__/JOURNEY-WITH-LEGS.TEST.TS
//
// R3-LEGS — exercises the createJourney route with the new optional
// legs[] field, plus the POST /:id/legs/:legId/complete endpoint and
// the §8 backward-compat invariant (a journey created without legs
// has legs: []). Mocks prisma so we can assert createMany payloads
// and updateMany calls without a live DB.

const journeyCreateMock = jest.fn();
const legCreateManyMock = jest.fn();
const legUpdateManyMock = jest.fn();
const journeyFindUniqueMock = jest.fn();

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    journey: {
      create: journeyCreateMock,
      count: jest.fn().mockResolvedValue(0),
      findUnique: journeyFindUniqueMock,
    },
    leg: {
      createMany: legCreateManyMock,
      updateMany: legUpdateManyMock,
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn(async (cb: any) => {
      const tx = {
        journey: { create: journeyCreateMock },
        leg: { createMany: legCreateManyMock },
      };
      return cb(tx);
    }),
  },
}));

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
const driverCookie = `accessToken=${generateAccessToken({ userId: 'd1', role: 'DRIVER' })}`;
const otherDriverCookie = `accessToken=${generateAccessToken({ userId: 'd2', role: 'DRIVER' })}`;

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
  journeyCreateMock.mockImplementation(({ data }: any) =>
    Promise.resolve({
      id: 'j1',
      ...data,
      createdAt: new Date(),
      discoveryStartedAt: new Date(),
    }),
  );
  legCreateManyMock.mockResolvedValue({ count: 0 });
  legUpdateManyMock.mockResolvedValue({ count: 1 });
});

describe('POST /api/journeys — R3-LEGS multi-stop foundation', () => {
  it('§8 backward-compat: journey without legs[] field has legs: [] (no synthetic legs)', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send(baseBody);
    expect(res.status).toBe(201);
    // legCreateMany must not be called for single-leg journeys
    expect(legCreateManyMock).not.toHaveBeenCalled();
  });

  it('§8 backward-compat: journey with empty legs: [] is treated identically', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({ ...baseBody, legs: [] });
    expect(res.status).toBe(201);
    expect(legCreateManyMock).not.toHaveBeenCalled();
  });

  it('201 with a 2-leg sequence: createMany receives 0/1 sequence', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({
        ...baseBody,
        legs: [
          // R3-DELIVERY — goods stops require parcelSize.
          { type: 'GOODS_DROPOFF', lat: -1.951, lng: 30.061, name: 'Post office', parcelSize: 'SMALL' },
          { type: 'PASSENGER_DROPOFF', lat: -1.952, lng: 30.062, name: 'Office' },
        ],
      });
    expect(res.status).toBe(201);
    expect(legCreateManyMock).toHaveBeenCalledTimes(1);
    const payload = legCreateManyMock.mock.calls[0][0].data;
    expect(payload).toHaveLength(2);
    expect(payload[0].sequence).toBe(0);
    expect(payload[1].sequence).toBe(1);
    expect(payload[0].name).toBe('Post office');
    expect(payload[1].name).toBe('Office');
  });

  it('422 WAIT_AT_BOUNDARY when legs[0] is WAIT', async () => {
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({
        ...baseBody,
        legs: [
          { type: 'WAIT', lat: -1.951, lng: 30.061, name: 'Wait' },
          { type: 'PASSENGER_DROPOFF', lat: -1.952, lng: 30.062, name: 'Office' },
        ],
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('WAIT_AT_BOUNDARY');
    expect(legCreateManyMock).not.toHaveBeenCalled();
  });

  it('400 from Zod when legs.length > 20 (.max(20) cap)', async () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => ({
      type: 'GOODS_DROPOFF',
      lat: -1.95,
      lng: 30.06,
      name: `Stop ${i}`,
      parcelSize: 'SMALL',
    }));
    const res = await request(app)
      .post('/api/journeys')
      .set('Cookie', customerCookie)
      .send({ ...baseBody, legs: tooMany });
    // Zod validation fails with 400 (validate middleware), not 422
    expect(res.status).toBe(400);
    expect(legCreateManyMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/journeys/:id/legs/:legId/complete — R3-LEGS driver-side stop completion', () => {
  it('200 + success when caller is the assigned driver', async () => {
    journeyFindUniqueMock.mockResolvedValue({ driverId: 'd1' });
    const res = await request(app)
      .post('/api/journeys/j1/legs/leg1/complete')
      .set('Cookie', driverCookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(legUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'leg1', journeyId: 'j1' },
      data: { status: 'COMPLETED', completedAt: expect.any(Date) },
    });
  });

  it('403 NOT_DRIVER when caller is a different driver', async () => {
    journeyFindUniqueMock.mockResolvedValue({ driverId: 'd1' });
    const res = await request(app)
      .post('/api/journeys/j1/legs/leg1/complete')
      .set('Cookie', otherDriverCookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_DRIVER');
    expect(legUpdateManyMock).not.toHaveBeenCalled();
  });

  it('404 when the journey does not exist', async () => {
    journeyFindUniqueMock.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/journeys/jXX/legs/legXX/complete')
      .set('Cookie', driverCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('JOURNEY_NOT_FOUND');
  });

  it('404 LEG_NOT_FOUND when the leg does not belong to the journey', async () => {
    journeyFindUniqueMock.mockResolvedValue({ driverId: 'd1' });
    legUpdateManyMock.mockResolvedValue({ count: 0 });
    const res = await request(app)
      .post('/api/journeys/j1/legs/legZ/complete')
      .set('Cookie', driverCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LEG_NOT_FOUND');
  });
});

// R3-DELIVERY-NOTIFICATIONS-2 — POST /:id/legs/:legId/activate. Mirrors
// the /complete endpoint's auth + composite-where + 404/403 patterns.
describe('POST /api/journeys/:id/legs/:legId/activate — R3-DELIVERY-NOTIFICATIONS-2 driver-arrived-at-pickup', () => {
  it('200 + success when caller is the assigned driver, flips status to ACTIVE', async () => {
    journeyFindUniqueMock.mockResolvedValue({ driverId: 'd1' });
    const res = await request(app)
      .post('/api/journeys/j1/legs/leg1/activate')
      .set('Cookie', driverCookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(legUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'leg1', journeyId: 'j1' },
      data: { status: 'ACTIVE' },
    });
  });

  it('403 NOT_DRIVER when caller is a different driver', async () => {
    journeyFindUniqueMock.mockResolvedValue({ driverId: 'd1' });
    const res = await request(app)
      .post('/api/journeys/j1/legs/leg1/activate')
      .set('Cookie', otherDriverCookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_DRIVER');
    expect(legUpdateManyMock).not.toHaveBeenCalled();
  });

  it('404 when the journey does not exist', async () => {
    journeyFindUniqueMock.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/journeys/jXX/legs/legXX/activate')
      .set('Cookie', driverCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('JOURNEY_NOT_FOUND');
  });

  it('404 LEG_NOT_FOUND when the leg does not belong to the journey', async () => {
    journeyFindUniqueMock.mockResolvedValue({ driverId: 'd1' });
    legUpdateManyMock.mockResolvedValue({ count: 0 });
    const res = await request(app)
      .post('/api/journeys/j1/legs/legZ/activate')
      .set('Cookie', driverCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LEG_NOT_FOUND');
  });

  it('rejects CUSTOMER role with 403 (driverOnly)', async () => {
    journeyFindUniqueMock.mockResolvedValue({ driverId: 'd1' });
    const res = await request(app)
      .post('/api/journeys/j1/legs/leg1/activate')
      .set('Cookie', customerCookie);
    expect(res.status).toBe(403);
    expect(legUpdateManyMock).not.toHaveBeenCalled();
  });
});
