// TEAM-ANSWERS G5 — the passenger says done (OPEN DECISIONS item 16b).
//
// POST /api/journeys/:id/confirm has existed since R3 and been
// unreachable since DEADWOOD #163 deleted ConfirmPage; only the 2-hour
// auto-confirm job ever called it. This dispatch gives it a caller.
//
// Nothing about the endpoint changed, and this suite is the proof of
// that as much as of the wiring: it pins the guards as they already
// stood, that the release is INVOKED through the one existing service,
// and that a second confirm cannot drive a second release.

jest.mock('../services/journey.service', () => ({
  confirmJourney: jest.fn(),
}));

jest.mock('../socket', () => ({
  emitToJourney: jest.fn(),
  emitToAdmins: jest.fn(),
  getIO: jest.fn(() => null),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import journeyRoutes from '../routes/journey.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import * as journeyService from '../services/journey.service';
import { emitToJourney } from '../socket';
import { SOCKET_EVENTS } from '@bimoto/shared';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/journeys', journeyRoutes);
app.use(errorHandler);

const JOURNEY = '44444444-4444-4444-4444-444444444444';
const customerCookie = `accessToken=${generateAccessToken({ userId: 'c1', role: 'CUSTOMER' })}`;
const driverCookie = `accessToken=${generateAccessToken({ userId: 'd1', role: 'DRIVER' })}`;

const mockedConfirm = journeyService.confirmJourney as jest.MockedFunction<
  typeof journeyService.confirmJourney
>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedConfirm.mockResolvedValue({ id: JOURNEY, status: 'COMPLETED' } as any);
});

describe('POST /api/journeys/:id/confirm — now with a caller', () => {
  test('the passenger confirms; the existing service is invoked, unmodified', async () => {
    const res = await request(app)
      .post(`/api/journeys/${JOURNEY}/confirm`)
      .set('Cookie', customerCookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
    // One call, the same two arguments the auto-confirm job passes.
    expect(mockedConfirm).toHaveBeenCalledTimes(1);
    expect(mockedConfirm).toHaveBeenCalledWith(JOURNEY, 'c1');
    expect(emitToJourney).toHaveBeenCalledWith(
      JOURNEY,
      SOCKET_EVENTS.JOURNEY_CONFIRMED,
      expect.objectContaining({ id: JOURNEY }),
    );
  });

  test('a driver cannot confirm arrival on the passenger\'s behalf', async () => {
    const res = await request(app)
      .post(`/api/journeys/${JOURNEY}/confirm`)
      .set('Cookie', driverCookie);

    expect(res.status).toBe(403);
    expect(mockedConfirm).not.toHaveBeenCalled();
  });

  test('an unauthenticated tap confirms nothing', async () => {
    const res = await request(app).post(`/api/journeys/${JOURNEY}/confirm`);

    expect(res.status).toBe(401);
    expect(mockedConfirm).not.toHaveBeenCalled();
  });

  test('a second confirm cannot drive a second release', async () => {
    await request(app).post(`/api/journeys/${JOURNEY}/confirm`).set('Cookie', customerCookie);

    // Existing semantics, untouched: the journey is COMPLETED now, and
    // the journey state machine has no CONFIRM edge out of COMPLETED.
    mockedConfirm.mockRejectedValueOnce(
      new Error('Invalid journey transition: COMPLETED + CONFIRM'),
    );

    const second = await request(app)
      .post(`/api/journeys/${JOURNEY}/confirm`)
      .set('Cookie', customerCookie);

    expect(second.status).toBeGreaterThanOrEqual(400);
    // The confirmed event — the one the client acts on — fired once.
    expect(
      (emitToJourney as jest.Mock).mock.calls.filter(
        (c) => c[1] === SOCKET_EVENTS.JOURNEY_CONFIRMED,
      ),
    ).toHaveLength(1);
  });
});
