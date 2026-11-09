jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    smsInbound: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      groupBy: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    bid: { findFirst: jest.fn() },
  },
}));

jest.mock('../services/sms-inbound/dispatcher', () => ({
  processInbound: jest.fn().mockResolvedValue({ status: 'PROCESSED' }),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import adminSmsInboundRoutes from '../routes/admin-sms-inbound.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/admin/sms-inbound', adminSmsInboundRoutes);
app.use(errorHandler);

const repo = (prisma as any).smsInbound;

const adminToken = generateAccessToken({ userId: 'admin-1', role: 'ADMIN' });
const customerToken = generateAccessToken({ userId: 'cust-1', role: 'CUSTOMER' });

beforeEach(() => {
  jest.clearAllMocks();
  repo.findMany.mockResolvedValue([]);
  repo.findUnique.mockResolvedValue(null);
  repo.update.mockResolvedValue({});
  repo.groupBy.mockResolvedValue([]);
});

describe('admin SMS-inbound routes — auth', () => {
  test('GET / without token → 401', async () => {
    const res = await request(app).get('/api/admin/sms-inbound');
    expect(res.status).toBe(401);
  });

  test('GET / as non-admin → 403', async () => {
    const res = await request(app)
      .get('/api/admin/sms-inbound')
      .set('Cookie', [`accessToken=${customerToken}`]);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/sms-inbound', () => {
  test('returns rows array', async () => {
    repo.findMany.mockResolvedValue([{ id: 'r1', status: 'PROCESSED' }]);
    const res = await request(app)
      .get('/api/admin/sms-inbound')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
  });

  test('rejects invalid status', async () => {
    const res = await request(app)
      .get('/api/admin/sms-inbound?status=NOT_A_STATUS')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(400);
  });

  test('rejects out-of-range limit', async () => {
    const res = await request(app)
      .get('/api/admin/sms-inbound?limit=999')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/sms-inbound/:id', () => {
  test('404 when not found', async () => {
    const res = await request(app)
      .get('/api/admin/sms-inbound/missing')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(404);
  });

  test('200 with row when present', async () => {
    repo.findUnique.mockResolvedValue({ id: 'r1', status: 'PROCESSED' });
    const res = await request(app)
      .get('/api/admin/sms-inbound/r1')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.row.id).toBe('r1');
  });
});

describe('POST /:id/replay', () => {
  test('replays via dispatcher and resets status', async () => {
    repo.findUnique.mockResolvedValue({
      id: 'r1',
      atMessageId: 'at-1',
      fromMsisdn: '+250788111111',
      toShortcode: '15555',
      rawBody: 'YES',
      receivedAt: new Date(),
    });
    const res = await request(app)
      .post('/api/admin/sms-inbound/r1/replay')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING' }),
      }),
    );
  });
});

describe('POST /:id/dismiss', () => {
  test('400 when reason missing', async () => {
    const res = await request(app)
      .post('/api/admin/sms-inbound/r1/dismiss')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({});
    expect(res.status).toBe(400);
  });

  test('marks PROCESSED with dismissal note', async () => {
    repo.findUnique.mockResolvedValue({ id: 'r1' });
    repo.update.mockResolvedValue({ id: 'r1', status: 'PROCESSED', errorMessage: 'Dismissed: spam' });
    const res = await request(app)
      .post('/api/admin/sms-inbound/r1/dismiss')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ reason: 'spam' });
    expect(res.status).toBe(200);
    expect(res.body.row.errorMessage).toContain('Dismissed: spam');
  });
});

describe('GET /api/admin/sms-inbound/stats', () => {
  test('returns count map', async () => {
    repo.groupBy.mockResolvedValue([
      { status: 'PROCESSED', _count: { _all: 5 } },
      { status: 'ERROR', _count: { _all: 1 } },
    ]);
    const res = await request(app)
      .get('/api/admin/sms-inbound/stats')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.stats).toEqual({ PROCESSED: 5, ERROR: 1 });
  });
});
