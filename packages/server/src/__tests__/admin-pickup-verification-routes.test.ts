// PILOT-INSTRUMENT G3 — admin pickup-verification summary tests.
//
// Verifies:
//   - counts by outcome + mismatchRate over the window
//   - recent list carries journey, jacket, reason, time for
//     MISMATCH/UNSURE only
//   - empty window returns zeros and a null rate
//   - adminOnly guard (customer gets 403, anonymous 401)
//   - the route performs reads only

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: {
      // auth middleware's frozen-check — never frozen in these tests.
      findUnique: jest.fn(async () => ({ frozenAt: null })),
    },
    pickupVerification: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

jest.mock('../config', () => ({
  config: {
    DATABASE_URL: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16-chars',
    ENCRYPTION_KEY: 'a'.repeat(64),
    PORT: 3000,
    CLIENT_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
  },
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import adminPickupVerificationRoutes from '../routes/admin-pickup-verification.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import { _resetAuthStatusCacheForTests } from '../middleware/auth';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/admin/pickup-verifications', adminPickupVerificationRoutes);
app.use(errorHandler);

const adminToken = generateAccessToken({
  userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  role: 'ADMIN',
});
const customerToken = generateAccessToken({
  userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  role: 'CUSTOMER',
});

const groupByMock = (prisma as any).pickupVerification.groupBy as jest.Mock;
const findManyMock = (prisma as any).pickupVerification.findMany as jest.Mock;
const upsertMock = (prisma as any).pickupVerification.upsert as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  ((prisma as any).user.findUnique as jest.Mock).mockResolvedValue({
    frozenAt: null,
  });
  groupByMock.mockResolvedValue([]);
  findManyMock.mockResolvedValue([]);
  _resetAuthStatusCacheForTests();
});

describe('GET /api/admin/pickup-verifications/summary', () => {
  test('returns counts by outcome, total, and the mismatch rate', async () => {
    groupByMock.mockResolvedValue([
      { outcome: 'MATCHED', _count: { _all: 8 } },
      { outcome: 'MISMATCH', _count: { _all: 1 } },
      { outcome: 'UNSURE', _count: { _all: 1 } },
    ]);
    const answeredAt = new Date('2026-07-15T10:00:00Z');
    findManyMock.mockResolvedValue([
      {
        journeyId: '11111111-1111-1111-1111-111111111111',
        outcome: 'MISMATCH',
        reason: 'WRONG_NUMBER',
        updatedAt: answeredAt,
        journey: {
          driver: { driverProfile: { ruraAuthorizationNumber: '4217' } },
        },
      },
      {
        journeyId: '22222222-2222-2222-2222-222222222222',
        outcome: 'UNSURE',
        reason: null,
        updatedAt: answeredAt,
        journey: { driver: null },
      },
    ]);

    const res = await request(app)
      .get('/api/admin/pickup-verifications/summary')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ MATCHED: 8, MISMATCH: 1, UNSURE: 1 });
    expect(res.body.total).toBe(10);
    expect(res.body.mismatchRate).toBeCloseTo(0.2);
    expect(res.body.recent).toEqual([
      {
        journeyId: '11111111-1111-1111-1111-111111111111',
        jacketNumber: '4217',
        outcome: 'MISMATCH',
        reason: 'WRONG_NUMBER',
        answeredAt: answeredAt.toISOString(),
      },
      {
        journeyId: '22222222-2222-2222-2222-222222222222',
        jacketNumber: null,
        outcome: 'UNSURE',
        reason: null,
        answeredAt: answeredAt.toISOString(),
      },
    ]);
    // The recent list queries MISMATCH/UNSURE only.
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          outcome: { in: ['MISMATCH', 'UNSURE'] },
        }),
      }),
    );
  });

  test('empty window returns zero counts and a null rate', async () => {
    const res = await request(app)
      .get('/api/admin/pickup-verifications/summary')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ MATCHED: 0, MISMATCH: 0, UNSURE: 0 });
    expect(res.body.total).toBe(0);
    expect(res.body.mismatchRate).toBeNull();
    expect(res.body.recent).toEqual([]);
  });

  test('honours the since query param', async () => {
    const res = await request(app)
      .get('/api/admin/pickup-verifications/summary?since=2026-07-01T00:00:00Z')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.since).toBe('2026-07-01T00:00:00.000Z');
    expect(groupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { gte: new Date('2026-07-01T00:00:00Z') } },
      }),
    );
  });

  test('rejects an invalid since date (400)', async () => {
    const res = await request(app)
      .get('/api/admin/pickup-verifications/summary?since=not-a-date')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  test('rejects non-admin callers (403)', async () => {
    const res = await request(app)
      .get('/api/admin/pickup-verifications/summary')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
    expect(groupByMock).not.toHaveBeenCalled();
  });

  test('rejects anonymous callers (401)', async () => {
    const res = await request(app).get(
      '/api/admin/pickup-verifications/summary',
    );
    expect(res.status).toBe(401);
  });

  test('read-only: the summary never writes', async () => {
    await request(app)
      .get('/api/admin/pickup-verifications/summary')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
