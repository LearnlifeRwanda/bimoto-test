// TEAM-ANSWERS G3 — the driver files an incident report, never a score.
//
// Pins the guards on POST /api/journeys/:id/report and the service
// underneath it, and — the load-bearing one — that filing a report
// writes NOTHING about the reported rider: no aggregate, no counter, no
// touch of any customer row.

jest.mock('../prisma', () => {
  const journeyRows = new Map<string, any>();
  const reportRows: any[] = [];
  const client: any = {
    journey: {
      findUnique: jest.fn(async ({ where }: any) => journeyRows.get(where.id) ?? null),
    },
    rideReport: {
      findUnique: jest.fn(async ({ where }: any) => {
        const key = where.journeyId_reporterId;
        return (
          reportRows.find(
            (r) => r.journeyId === key.journeyId && r.reporterId === key.reporterId,
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `rr-${reportRows.length + 1}`, createdAt: new Date(), ...data };
        reportRows.push(row);
        return row;
      }),
    },
    // Present so the test can assert nothing ever writes here.
    user: { update: jest.fn(), findUnique: jest.fn() },
    driverProfile: { update: jest.fn(), findUnique: jest.fn() },
    rating: { create: jest.fn(), aggregate: jest.fn(), findUnique: jest.fn() },
  };
  client.__rows = { journeyRows, reportRows };
  return { __esModule: true, default: client };
});

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import journeyRoutes from '../routes/journey.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import * as rideReportService from '../services/ride-report.service';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/journeys', journeyRoutes);
app.use(errorHandler);

const JOURNEY_ID = '33333333-3333-3333-3333-333333333333';
const driverCookie = `accessToken=${generateAccessToken({ userId: 'd1', role: 'DRIVER' })}`;
const otherDriverCookie = `accessToken=${generateAccessToken({ userId: 'd2', role: 'DRIVER' })}`;
const customerCookie = `accessToken=${generateAccessToken({ userId: 'c1', role: 'CUSTOMER' })}`;

const store = (prisma as any).__rows as {
  journeyRows: Map<string, any>;
  reportRows: any[];
};

function seedJourney(status = 'AWAITING_CONFIRMATION') {
  store.journeyRows.set(JOURNEY_ID, {
    id: JOURNEY_ID,
    customerId: 'c1',
    driverId: 'd1',
    status,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  store.journeyRows.clear();
  store.reportRows.length = 0;
  seedJourney();
});

describe('POST /api/journeys/:id/report', () => {
  test('the driver of the ride files a report with a reason and details', async () => {
    const res = await request(app)
      .post(`/api/journeys/${JOURNEY_ID}/report`)
      .set('Cookie', driverCookie)
      .send({ reason: 'NO_SHOW_OR_LATE', details: 'waited twenty minutes at the stage' });

    expect(res.status).toBe(201);
    expect(store.reportRows).toHaveLength(1);
    expect(store.reportRows[0]).toEqual(
      expect.objectContaining({
        journeyId: JOURNEY_ID,
        reporterId: 'd1',
        reason: 'NO_SHOW_OR_LATE',
        details: 'waited twenty minutes at the stage',
      }),
    );
  });

  test('details are optional — a reason alone files', async () => {
    const res = await request(app)
      .post(`/api/journeys/${JOURNEY_ID}/report`)
      .set('Cookie', driverCookie)
      .send({ reason: 'OTHER' });

    expect(res.status).toBe(201);
    expect(store.reportRows[0].details).toBeNull();
  });

  test('NO SCORE: filing writes nothing about the reported rider', async () => {
    await request(app)
      .post(`/api/journeys/${JOURNEY_ID}/report`)
      .set('Cookie', driverCookie)
      .send({ reason: 'RUDE_BEHAVIOUR' });

    // The whole point of the substitution: no number lands on a person.
    expect((prisma as any).user.update).not.toHaveBeenCalled();
    expect((prisma as any).driverProfile.update).not.toHaveBeenCalled();
    expect((prisma as any).rating.create).not.toHaveBeenCalled();
    expect((prisma as any).rating.aggregate).not.toHaveBeenCalled();
    // …and the row itself carries no score-shaped field.
    expect(Object.keys(store.reportRows[0])).toEqual(
      expect.not.arrayContaining(['stars', 'score', 'rating']),
    );
  });

  test('a customer cannot file one — this is the driver-side channel', async () => {
    const res = await request(app)
      .post(`/api/journeys/${JOURNEY_ID}/report`)
      .set('Cookie', customerCookie)
      .send({ reason: 'OTHER' });

    expect(res.status).toBe(403);
    expect(store.reportRows).toHaveLength(0);
  });

  test('a different driver cannot report someone else\'s ride', async () => {
    const res = await request(app)
      .post(`/api/journeys/${JOURNEY_ID}/report`)
      .set('Cookie', otherDriverCookie)
      .send({ reason: 'OTHER' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_JOURNEY_DRIVER');
  });

  test('a ride still in progress cannot be reported yet', async () => {
    seedJourney('IN_PROGRESS');

    const res = await request(app)
      .post(`/api/journeys/${JOURNEY_ID}/report`)
      .set('Cookie', driverCookie)
      .send({ reason: 'OTHER' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('JOURNEY_NOT_ENDED');
  });

  test.each(rideReportService.REPORTABLE_JOURNEY_STATUSES)(
    'a ride in %s can be reported',
    async (status) => {
      seedJourney(status);
      const res = await request(app)
        .post(`/api/journeys/${JOURNEY_ID}/report`)
        .set('Cookie', driverCookie)
        .send({ reason: 'OTHER' });
      expect(res.status).toBe(201);
    },
  );

  test('an unknown reason key is refused by the validator', async () => {
    const res = await request(app)
      .post(`/api/journeys/${JOURNEY_ID}/report`)
      .set('Cookie', driverCookie)
      .send({ reason: 'HE_LOOKED_AT_ME_FUNNY' });

    expect(res.status).toBe(400);
    expect(store.reportRows).toHaveLength(0);
  });

  test('one report per journey per driver — the repeat is 409, and writes nothing', async () => {
    await request(app)
      .post(`/api/journeys/${JOURNEY_ID}/report`)
      .set('Cookie', driverCookie)
      .send({ reason: 'OTHER' });

    const second = await request(app)
      .post(`/api/journeys/${JOURNEY_ID}/report`)
      .set('Cookie', driverCookie)
      .send({ reason: 'UNSAFE_REQUEST' });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_REPORTED');
    expect(store.reportRows).toHaveLength(1);
  });
});
