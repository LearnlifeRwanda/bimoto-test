jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
  },
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import {
  authMiddleware,
  invalidateAuthStatusCache,
  _resetAuthStatusCacheForTests,
} from '../middleware/auth';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(cookieParser());
app.use((req, res, next) => authMiddleware(req, res, next).catch(next));
app.get('/protected', (req, res) => {
  res.json({ ok: true, userId: (req as any).user?.userId });
});
app.use(errorHandler);

const userId = '11111111-1111-1111-1111-111111111111';
const token = generateAccessToken({ userId, role: 'CUSTOMER' });

const findUnique = (prisma as any).user.findUnique as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  _resetAuthStatusCacheForTests();
});

describe('auth middleware — frozen-user gate', () => {
  test('frozen user gets 403 ACCOUNT_FROZEN', async () => {
    findUnique.mockResolvedValue({ frozenAt: new Date('2026-05-01T12:00:00Z') });
    const res = await request(app)
      .get('/protected')
      .set('Cookie', [`accessToken=${token}`]);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_FROZEN');
  });

  test('unfrozen user gets through', async () => {
    findUnique.mockResolvedValue({ frozenAt: null });
    const res = await request(app)
      .get('/protected')
      .set('Cookie', [`accessToken=${token}`]);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(userId);
  });

  test('cache hit prevents a second DB lookup within TTL', async () => {
    findUnique.mockResolvedValue({ frozenAt: null });
    await request(app)
      .get('/protected')
      .set('Cookie', [`accessToken=${token}`]);
    await request(app)
      .get('/protected')
      .set('Cookie', [`accessToken=${token}`]);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  test('invalidating cache forces a re-read', async () => {
    findUnique.mockResolvedValueOnce({ frozenAt: null });
    await request(app)
      .get('/protected')
      .set('Cookie', [`accessToken=${token}`]);
    invalidateAuthStatusCache(userId);
    findUnique.mockResolvedValueOnce({ frozenAt: new Date() });
    const res2 = await request(app)
      .get('/protected')
      .set('Cookie', [`accessToken=${token}`]);
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(res2.status).toBe(403);
  });

  test('no cookie → 401 without DB hit', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('auth middleware — Bearer header fallback (R3-AUTH-CROSS-ORIGIN-FIX)', () => {
  test('Authorization: Bearer authenticates when no cookie is present', async () => {
    findUnique.mockResolvedValue({ frozenAt: null });
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(userId);
  });

  test('cookie takes precedence over Authorization header', async () => {
    findUnique.mockResolvedValue({ frozenAt: null });
    const garbage = 'not-a-valid-jwt';
    // Valid cookie + garbage Bearer header → cookie wins, request succeeds.
    const res = await request(app)
      .get('/protected')
      .set('Cookie', [`accessToken=${token}`])
      .set('Authorization', `Bearer ${garbage}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(userId);
  });

  test('frozen-user gate still applies to Bearer-authenticated requests', async () => {
    findUnique.mockResolvedValue({ frozenAt: new Date('2026-05-01T12:00:00Z') });
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_FROZEN');
  });

  test('malformed Authorization header (no Bearer scheme) → 401 without DB hit', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', token); // missing "Bearer " prefix
    expect(res.status).toBe(401);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
