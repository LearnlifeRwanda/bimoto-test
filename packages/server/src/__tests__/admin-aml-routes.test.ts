jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: { update: jest.fn().mockResolvedValue({}) },
    amlFlag: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  },
}));

import express from 'express';
import { encrypt } from '../utils/crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import adminAmlRoutes from '../routes/admin-aml.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/admin/aml-flags', adminAmlRoutes);
app.use(errorHandler);

const flag = (prisma as any).amlFlag;
const userUpdate = (prisma as any).user.update as jest.Mock;

const adminToken = generateAccessToken({ userId: 'admin-1', role: 'ADMIN' } as any);
const customerToken = generateAccessToken({ userId: 'cust-1', role: 'CUSTOMER' } as any);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('admin AML routes — auth', () => {
  test('GET /api/admin/aml-flags without token → 401', async () => {
    const res = await request(app).get('/api/admin/aml-flags');
    expect(res.status).toBe(401);
  });

  test('GET /api/admin/aml-flags as non-admin → 403', async () => {
    const res = await request(app)
      .get('/api/admin/aml-flags')
      .set('Cookie', [`accessToken=${customerToken}`]);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/aml-flags', () => {
  test('returns flags + total with default OPEN filter', async () => {
    flag.findMany.mockResolvedValue([{ id: 'f1', severity: 'HIGH' }]);
    flag.count.mockResolvedValue(1);
    const res = await request(app)
      .get('/api/admin/aml-flags')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.flags).toHaveLength(1);
    expect(flag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'OPEN' }),
      }),
    );
  });

  test('honors severity + since filters', async () => {
    flag.findMany.mockResolvedValue([]);
    flag.count.mockResolvedValue(0);
    await request(app)
      .get('/api/admin/aml-flags?severity=CRITICAL&since=2026-05-01T00:00:00.000Z')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(flag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          severity: 'CRITICAL',
          detectedAt: { gte: new Date('2026-05-01T00:00:00.000Z') },
        }),
      }),
    );
  });
});

describe('POST /api/admin/aml-flags/:flagId/dismiss', () => {
  test('happy path: HIGH flag dismissed', async () => {
    flag.findUnique.mockResolvedValue({ id: 'f1', severity: 'HIGH' });
    const res = await request(app)
      .post('/api/admin/aml-flags/f1/dismiss')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ notes: 'reviewed' });
    expect(res.status).toBe(200);
    expect(flag.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DISMISSED',
          resolvedBy: 'admin-1',
          resolutionNotes: 'reviewed',
        }),
      }),
    );
  });

  test('CRITICAL dismiss without confirm → 400', async () => {
    flag.findUnique.mockResolvedValue({ id: 'fC', severity: 'CRITICAL' });
    const res = await request(app)
      .post('/api/admin/aml-flags/fC/dismiss')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ notes: 'looks ok' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CRITICAL_DISMISS_REQUIRES_CONFIRM');
  });

  test('CRITICAL dismiss with confirm succeeds', async () => {
    flag.findUnique.mockResolvedValue({ id: 'fC', severity: 'CRITICAL' });
    const res = await request(app)
      .post('/api/admin/aml-flags/fC/dismiss')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ notes: 'verified false positive', confirmCriticalDismiss: true });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/admin/aml-flags/:flagId/mark-for-freeze', () => {
  test('sets User.isFlagged + records resolution', async () => {
    flag.findUnique.mockResolvedValue({ id: 'fX', userId: 'user-9', severity: 'HIGH' });
    const res = await request(app)
      .post('/api/admin/aml-flags/fX/mark-for-freeze')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ notes: 'pattern confirmed by ops' });
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user-9');
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-9' },
        data: expect.objectContaining({ isFlagged: true }),
      }),
    );
  });

  test('rejects empty notes with 400', async () => {
    const res = await request(app)
      .post('/api/admin/aml-flags/fX/mark-for-freeze')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ notes: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOTES_REQUIRED');
  });
});

describe('GET /api/admin/aml-flags/export', () => {
  test('returns text/csv with header row', async () => {
    flag.findMany.mockResolvedValue([
      {
        id: 'f1',
        userId: 'u1',
        type: 'PAIR_FREQUENCY',
        severity: 'HIGH',
        status: 'OPEN',
        detectedAt: new Date('2026-05-01T00:00:00.000Z'),
        resolvedAt: null,
        resolvedBy: null,
        resolutionNotes: null,
        journeyId: 'j1',
        metadata: { driverId: 'd1', count24h: 6 },
        user: { phoneEncrypted: encrypt('+250788000000') },
        escrow: null,
      },
    ]);
    const res = await request(app)
      .get('/api/admin/aml-flags/export?from=2026-04-01&to=2026-05-31')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text.split('\n')[0]).toContain('flagId,userId,userPhone');
    expect(res.text).toContain('f1,u1,+250788000000,PAIR_FREQUENCY,HIGH,OPEN');
  });
});

describe('GET /api/admin/aml-flags/precision', () => {
  test('401 without token, 403 as non-admin', async () => {
    const anon = await request(app).get('/api/admin/aml-flags/precision');
    expect(anon.status).toBe(401);
    const cust = await request(app)
      .get('/api/admin/aml-flags/precision')
      .set('Cookie', [`accessToken=${customerToken}`]);
    expect(cust.status).toBe(403);
  });

  test('aggregates verdict counts and overturn rate per type', async () => {
    flag.groupBy.mockResolvedValue([
      { type: 'MONEY_FUNNEL', status: 'OPEN', _count: { _all: 4 } },
      { type: 'MONEY_FUNNEL', status: 'RESOLVED', _count: { _all: 1 } },
      { type: 'MONEY_FUNNEL', status: 'DISMISSED', _count: { _all: 3 } },
      { type: 'COLLUSION_RING', status: 'MARKED_FOR_FREEZE', _count: { _all: 2 } },
      { type: 'COLLUSION_RING', status: 'RESOLVED', _count: { _all: 2 } },
    ]);
    const res = await request(app)
      .get('/api/admin/aml-flags/precision')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.byType.MONEY_FUNNEL).toEqual({
      open: 4,
      markedForFreeze: 0,
      upheld: 1,
      overturned: 3,
      overturnRate: 0.75,
    });
    expect(res.body.byType.COLLUSION_RING).toEqual({
      open: 0,
      markedForFreeze: 2,
      upheld: 2,
      overturned: 0,
      overturnRate: 0,
    });
    // Types with no rows in the window: zeros and a null rate.
    expect(res.body.byType.BID_CYCLE_RING).toEqual({
      open: 0,
      markedForFreeze: 0,
      upheld: 0,
      overturned: 0,
      overturnRate: null,
    });
  });

  test('honors the since query param', async () => {
    flag.groupBy.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/admin/aml-flags/precision?since=2026-06-01T00:00:00.000Z')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.since).toBe('2026-06-01T00:00:00.000Z');
    expect(flag.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { detectedAt: { gte: new Date('2026-06-01T00:00:00.000Z') } },
      }),
    );
  });

  test('defaults to a 42-day window', async () => {
    flag.groupBy.mockResolvedValue([]);
    const before = Date.now();
    const res = await request(app)
      .get('/api/admin/aml-flags/precision')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    const since = new Date(res.body.since).getTime();
    const expected = before - 42 * 24 * 60 * 60 * 1000;
    expect(Math.abs(since - expected)).toBeLessThan(60_000);
  });

  test('400 on an unparseable since date', async () => {
    const res = await request(app)
      .get('/api/admin/aml-flags/precision?since=not-a-date')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SINCE');
  });
});
