jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findUnique: jest.fn(), update: jest.fn() },
    journeyReconciliationResponse: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    user: { update: jest.fn() },
    escrow: { findUnique: jest.fn() },
  },
}));

jest.mock('../services/journey.service', () => ({
  recordReconciliationResponse: jest.fn(),
}));

jest.mock('../services/journey-resilience', () => ({
  getReconciliationStatus: jest.fn(),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import journeyRoutes from '../routes/journey.routes';
import * as journeyService from '../services/journey.service';
import * as resilience from '../services/journey-resilience';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/journeys', journeyRoutes);
app.use(errorHandler);

const customerCookie = `accessToken=${generateAccessToken({ userId: 'c1', role: 'CUSTOMER' })}`;

beforeEach(() => jest.clearAllMocks());

describe('POST /api/journeys/:id/reconcile', () => {
  test('records response and returns verdict on second submission', async () => {
    (journeyService.recordReconciliationResponse as jest.Mock).mockResolvedValue({
      rowId: 'r1',
      bothPartiesResponded: true,
      verdict: 'BOTH_ARRIVED',
    });
    const res = await request(app)
      .post('/api/journeys/j1/reconcile')
      .set('Cookie', customerCookie)
      .send({ response: 'ARRIVED_SAFELY', gpsLat: -1.95, gpsLng: 29.89 });
    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('BOTH_ARRIVED');
    expect(journeyService.recordReconciliationResponse).toHaveBeenCalledWith({
      journeyId: 'j1',
      respondingUserId: 'c1',
      response: 'ARRIVED_SAFELY',
      gpsLat: -1.95,
      gpsLng: 29.89,
    });
  });

  test('idempotent on duplicate from same user (passes through to upsert primitive)', async () => {
    (journeyService.recordReconciliationResponse as jest.Mock).mockResolvedValue({
      rowId: 'r1',
      bothPartiesResponded: false,
    });
    const res1 = await request(app)
      .post('/api/journeys/j1/reconcile')
      .set('Cookie', customerCookie)
      .send({ response: 'ARRIVED_SAFELY' });
    const res2 = await request(app)
      .post('/api/journeys/j1/reconcile')
      .set('Cookie', customerCookie)
      .send({ response: 'ARRIVED_SAFELY' });
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(journeyService.recordReconciliationResponse).toHaveBeenCalledTimes(2);
  });

  test('400 on invalid response value', async () => {
    const res = await request(app)
      .post('/api/journeys/j1/reconcile')
      .set('Cookie', customerCookie)
      .send({ response: 'NOT_A_VALID_VALUE' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/journeys/:id/reconciliation-status', () => {
  test('returns own + other party shape', async () => {
    (resilience.getReconciliationStatus as jest.Mock).mockResolvedValue({
      ownResponse: { respondingUserId: 'c1', response: 'ARRIVED_SAFELY' },
      otherPartyResponse: { respondingUserId: 'd1', response: 'ARRIVED_SAFELY' },
      verdict: 'BOTH_ARRIVED',
      journey: { id: 'j1' },
    });
    const res = await request(app)
      .get('/api/journeys/j1/reconciliation-status')
      .set('Cookie', customerCookie);
    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('BOTH_ARRIVED');
    expect(res.body.ownResponse.respondingUserId).toBe('c1');
    expect(res.body.otherPartyResponse.respondingUserId).toBe('d1');
  });
});
