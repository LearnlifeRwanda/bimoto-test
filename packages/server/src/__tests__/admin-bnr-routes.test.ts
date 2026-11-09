jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    bnrReport: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import adminBnrRoutes from '../routes/admin-bnr.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/admin/bnr-reports', adminBnrRoutes);
app.use(errorHandler);

const repo = (prisma as any).bnrReport;

const adminToken = generateAccessToken({ userId: 'admin-1', role: 'ADMIN' });
const customerToken = generateAccessToken({ userId: 'cust-1', role: 'CUSTOMER' });

beforeEach(() => {
  jest.clearAllMocks();
  repo.findMany.mockResolvedValue([]);
  repo.findFirst.mockResolvedValue(null);
  repo.findUnique.mockResolvedValue(null);
  repo.create.mockResolvedValue({ id: 'r1', period: '2026-04', status: 'PENDING' });
  repo.update.mockResolvedValue({});
});

describe('admin BNR routes — auth', () => {
  test('GET / without token → 401', async () => {
    const res = await request(app).get('/api/admin/bnr-reports');
    expect(res.status).toBe(401);
  });

  test('GET / as non-admin → 403', async () => {
    const res = await request(app)
      .get('/api/admin/bnr-reports')
      .set('Cookie', [`accessToken=${customerToken}`]);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/bnr-reports', () => {
  test('returns array of reports', async () => {
    repo.findMany.mockResolvedValue([{ id: 'r1', period: '2026-04', status: 'COMPLETED' }]);
    const res = await request(app)
      .get('/api/admin/bnr-reports')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.reports).toHaveLength(1);
  });
});

describe('POST /api/admin/bnr-reports/generate', () => {
  test('valid past period → 202', async () => {
    const res = await request(app)
      .post('/api/admin/bnr-reports/generate')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ period: '2024-01' });
    expect(res.status).toBe(202);
  });

  test('malformed period → 400', async () => {
    const res = await request(app)
      .post('/api/admin/bnr-reports/generate')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ period: 'abc' });
    expect(res.status).toBe(400);
  });

  test('future period → 400', async () => {
    const res = await request(app)
      .post('/api/admin/bnr-reports/generate')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ period: '2099-12' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/bnr-reports/:id/download.pdf', () => {
  test('non-existent id → 404', async () => {
    repo.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .get('/api/admin/bnr-reports/missing/download.pdf')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(404);
  });

  test('PENDING report → 404 (not ready)', async () => {
    repo.findUnique.mockResolvedValue({
      id: 'r1', period: '2026-04', status: 'PENDING',
      pdfPath: null, csvPath: null,
    });
    const res = await request(app)
      .get('/api/admin/bnr-reports/r1/download.pdf')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(404);
  });
});
