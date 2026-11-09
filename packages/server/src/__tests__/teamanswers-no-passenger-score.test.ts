// TEAM-ANSWERS G2 — THE IMPOSSIBILITY TEST.
//
// The founder decision recorded on 18 August: passengers are never
// scored. That is a statement about the DATA, not the display — so what
// is pinned here is that a Rating row whose ratee is a customer cannot
// be created, at either level:
//
//   • at the ROUTE — POST /api/journeys/:id/rate is customerOnly, and
//     even a caller who passes that guard is refused unless they are
//     this journey's passenger;
//   • at the SERVICE — createRating refuses any ratee that is not the
//     journey's driver, whatever the route hands it.
//
// The route guard alone would not be enough: customerOnly admits role
// BOTH, and a BOTH user can be the driver on the very journey they are
// posting about. The service guard is the one that makes it impossible.

jest.mock('../services/rating.service', () => ({
  createRating: jest.fn(),
}));

jest.mock('../services/journey.service', () => ({
  getJourneyById: jest.fn(),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import ratingRoutes from '../routes/rating.routes';
import { generateAccessToken } from '../utils/jwt';
import { errorHandler } from '../middleware/error-handler';
import * as ratingService from '../services/rating.service';
import * as journeyService from '../services/journey.service';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/journeys', ratingRoutes);
app.use(errorHandler);

const JOURNEY_ID = '22222222-2222-2222-2222-222222222222';
const customerCookie = `accessToken=${generateAccessToken({ userId: 'c1', role: 'CUSTOMER' })}`;
const driverCookie = `accessToken=${generateAccessToken({ userId: 'd1', role: 'DRIVER' })}`;
const bothCookie = `accessToken=${generateAccessToken({ userId: 'd1', role: 'BOTH' })}`;

const mockedCreateRating = ratingService.createRating as jest.MockedFunction<
  typeof ratingService.createRating
>;
const mockedGetJourney = journeyService.getJourneyById as jest.MockedFunction<any>;

const COMPLETED_RIDE = {
  id: JOURNEY_ID,
  customerId: 'c1',
  driverId: 'd1',
  status: 'COMPLETED',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetJourney.mockResolvedValue(COMPLETED_RIDE as any);
  mockedCreateRating.mockResolvedValue({ id: 'r1' } as any);
});

describe('POST /api/journeys/:id/rate — one direction only', () => {
  test('the passenger can rate the driver, and the ratee is the driver', async () => {
    const res = await request(app)
      .post(`/api/journeys/${JOURNEY_ID}/rate`)
      .set('Cookie', customerCookie)
      .send({ journeyId: JOURNEY_ID, stars: 5 });

    expect(res.status).toBe(201);
    // Positional: (journeyId, raterId, ratedId, stars, comment, reason)
    expect(mockedCreateRating).toHaveBeenCalledWith(
      JOURNEY_ID,
      'c1',
      'd1',
      5,
      undefined,
      undefined,
    );
  });

  test('an optional low-star reason reaches the service', async () => {
    const res = await request(app)
      .post(`/api/journeys/${JOURNEY_ID}/rate`)
      .set('Cookie', customerCookie)
      .send({
        journeyId: JOURNEY_ID,
        stars: 1,
        reason: 'UNSAFE_DRIVING',
        comment: 'took the wrong turning twice',
      });

    expect(res.status).toBe(201);
    expect(mockedCreateRating).toHaveBeenCalledWith(
      JOURNEY_ID,
      'c1',
      'd1',
      1,
      'took the wrong turning twice',
      'UNSAFE_DRIVING',
    );
  });

  test('stars alone still work — nothing about the reason is required', async () => {
    const res = await request(app)
      .post(`/api/journeys/${JOURNEY_ID}/rate`)
      .set('Cookie', customerCookie)
      .send({ journeyId: JOURNEY_ID, stars: 1 });

    expect(res.status).toBe(201);
  });

  test('an unknown reason key is refused by the validator, not stored', async () => {
    const res = await request(app)
      .post(`/api/journeys/${JOURNEY_ID}/rate`)
      .set('Cookie', customerCookie)
      .send({ journeyId: JOURNEY_ID, stars: 1, reason: 'BECAUSE_I_FELT_LIKE_IT' });

    expect(res.status).toBe(400);
    expect(mockedCreateRating).not.toHaveBeenCalled();
  });

  test('THE NARROWING: a DRIVER is refused at the route by customerOnly', async () => {
    const res = await request(app)
      .post(`/api/journeys/${JOURNEY_ID}/rate`)
      .set('Cookie', driverCookie)
      .send({ journeyId: JOURNEY_ID, stars: 1 });

    expect(res.status).toBe(403);
    expect(mockedCreateRating).not.toHaveBeenCalled();
  });

  test('THE NARROWING: a BOTH-role user who is this journey\'s DRIVER passes customerOnly and is still refused', async () => {
    const res = await request(app)
      .post(`/api/journeys/${JOURNEY_ID}/rate`)
      .set('Cookie', bothCookie)
      .send({ journeyId: JOURNEY_ID, stars: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_JOURNEY_PARTICIPANT');
    expect(mockedCreateRating).not.toHaveBeenCalled();
  });

  test('a journey with no driver yet cannot be rated', async () => {
    mockedGetJourney.mockResolvedValue({ ...COMPLETED_RIDE, driverId: null } as any);

    const res = await request(app)
      .post(`/api/journeys/${JOURNEY_ID}/rate`)
      .set('Cookie', customerCookie)
      .send({ journeyId: JOURNEY_ID, stars: 5 });

    expect(res.status).toBe(403);
    expect(mockedCreateRating).not.toHaveBeenCalled();
  });
});
