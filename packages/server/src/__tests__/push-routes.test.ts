jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    deviceToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock('../services/push', () => ({
  __esModule: true,
  sendPushToUser: jest.fn(),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import pushRoutes from '../routes/push.routes';
import adminPushRoutes from '../routes/admin-push.routes';
import { sendPushToUser } from '../services/push';
import { generateAccessToken } from '../utils/jwt';
import { errorHandler } from '../middleware/error-handler';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/push', pushRoutes);
app.use('/api/admin/push', adminPushRoutes);
app.use(errorHandler);

const dt = (prisma as any).deviceToken;
const sendPushMock = sendPushToUser as jest.Mock;

const userToken = generateAccessToken({ userId: 'u1', role: 'CUSTOMER' });
const adminToken = generateAccessToken({ userId: 'admin1', role: 'ADMIN' });

beforeEach(() => {
  jest.clearAllMocks();
  dt.findUnique.mockResolvedValue(null);
  dt.create.mockResolvedValue({});
  dt.update.mockResolvedValue({});
  dt.updateMany.mockResolvedValue({ count: 0 });
});

describe('POST /api/push/register', () => {
  test('401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/push/register')
      .send({ token: 'tok', platform: 'IOS' });
    expect(res.status).toBe(401);
  });

  test('happy path creates a new DeviceToken row', async () => {
    const res = await request(app)
      .post('/api/push/register')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ token: 'tok-new', platform: 'IOS' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(dt.create).toHaveBeenCalledWith({
      data: { userId: 'u1', platform: 'IOS', token: 'tok-new' },
    });
  });

  test('idempotent: re-registering same token updates the existing row', async () => {
    dt.findUnique.mockResolvedValue({
      id: 'existing-id',
      userId: 'u1',
      token: 'tok-existing',
      platform: 'ANDROID',
      isActive: false,
      failureCount: 3,
    });

    const res = await request(app)
      .post('/api/push/register')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ token: 'tok-existing', platform: 'ANDROID' });
    expect(res.status).toBe(200);
    expect(dt.create).not.toHaveBeenCalled();
    expect(dt.update).toHaveBeenCalledWith({
      where: { token: 'tok-existing' },
      data: expect.objectContaining({
        userId: 'u1',
        platform: 'ANDROID',
        isActive: true,
        failureCount: 0,
      }),
    });
  });

  test('400 on invalid platform', async () => {
    const res = await request(app)
      .post('/api/push/register')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ token: 'tok', platform: 'WEB' });
    expect(res.status).toBe(400);
  });

  test('400 on missing token', async () => {
    const res = await request(app)
      .post('/api/push/register')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ platform: 'IOS' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/push/register', () => {
  test('401 when unauthenticated', async () => {
    const res = await request(app)
      .delete('/api/push/register')
      .send({ token: 'tok' });
    expect(res.status).toBe(401);
  });

  test('happy path deactivates token', async () => {
    const res = await request(app)
      .delete('/api/push/register')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ token: 'tok-to-kill' });
    expect(res.status).toBe(200);
    expect(dt.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', token: 'tok-to-kill' },
      data: { isActive: false },
    });
  });

  test('idempotent: unknown token still returns 200', async () => {
    dt.updateMany.mockResolvedValue({ count: 0 });
    const res = await request(app)
      .delete('/api/push/register')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ token: 'nope' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('POST /api/admin/push/test', () => {
  const validBody = {
    userId: '11111111-1111-1111-1111-111111111111',
    title: 't',
    body: 'b',
  };

  test('401 when unauthenticated', async () => {
    const res = await request(app).post('/api/admin/push/test').send(validBody);
    expect(res.status).toBe(401);
  });

  test('403 when authenticated but non-admin', async () => {
    const res = await request(app)
      .post('/api/admin/push/test')
      .set('Cookie', [`accessToken=${userToken}`])
      .send(validBody);
    expect(res.status).toBe(403);
  });

  test('happy path returns per-token send results', async () => {
    sendPushMock.mockResolvedValue([
      { tokenId: 't1', platform: 'IOS', success: true },
    ]);
    const res = await request(app)
      .post('/api/admin/push/test')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(sendPushMock).toHaveBeenCalledWith(
      validBody.userId,
      expect.objectContaining({ title: 't', body: 'b' }),
    );
  });

  test('user with no active tokens returns empty results', async () => {
    sendPushMock.mockResolvedValue([]);
    const res = await request(app)
      .post('/api/admin/push/test')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  test('400 on invalid userId', async () => {
    const res = await request(app)
      .post('/api/admin/push/test')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ ...validBody, userId: 'not-a-uuid' });
    expect(res.status).toBe(400);
  });
});
