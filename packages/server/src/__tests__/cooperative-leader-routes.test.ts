// Cooperative-leader read routes — exercise role gating + tenancy
// scope + pagination via the in-memory Prisma stub. The smallest-
// wrongness coverage here is the cross-cooperative driver lookup
// returning 404 (not 200, not 403).

const cooperativeRows = new Map<string, any>();
const userRows = new Map<string, any>();
const driverProfileRows = new Map<string, any>();
const journeyRows: any[] = [];
const amlFlagRows: any[] = [];

function matchInClause(value: any, clause: any) {
  if (!clause) return true;
  if (clause.in) return clause.in.includes(value);
  if (clause.gte) return new Date(value) >= new Date(clause.gte);
  return value === clause;
}

const stub = {
  cooperative: {
    findUnique: jest.fn(async ({ where }: any) => cooperativeRows.get(where.id) ?? null),
  },
  user: {
    findUnique: jest.fn(async ({ where }: any) => userRows.get(where.id) ?? null),
    findMany: jest.fn(async ({ where = {} }: any = {}) => {
      const arr = Array.from(userRows.values());
      if (where.id?.in) return arr.filter((u: any) => where.id.in.includes(u.id));
      return arr;
    }),
  },
  driverProfile: {
    findUnique: jest.fn(async ({ where }: any) =>
      driverProfileRows.get(where.id) ?? null,
    ),
    findMany: jest.fn(async ({ where = {}, take, skip }: any = {}) => {
      const arr = Array.from(driverProfileRows.values()).filter((p: any) => {
        if (where.cooperativeId !== undefined && p.cooperativeId !== where.cooperativeId)
          return false;
        if (where.isOnline !== undefined && p.isOnline !== where.isOnline) return false;
        return true;
      });
      const start = skip ?? 0;
      return arr.slice(start, take ? start + take : undefined);
    }),
  },
  journey: {
    findMany: jest.fn(async ({ where = {}, select }: any = {}) => {
      const rows = journeyRows.filter((j: any) => {
        if (where.driverId && !matchInClause(j.driverId, where.driverId)) return false;
        if (where.status && j.status !== where.status) return false;
        if (where.confirmedAt?.gte && new Date(j.confirmedAt ?? 0) < new Date(where.confirmedAt.gte))
          return false;
        if (where.createdAt?.gte && new Date(j.createdAt) < new Date(where.createdAt.gte))
          return false;
        return true;
      });
      if (select) {
        return rows.map((j: any) => {
          const r: any = {};
          for (const k of Object.keys(select)) if (select[k]) r[k] = j[k];
          return r;
        });
      }
      return rows;
    }),
    count: jest.fn(async ({ where = {} }: any = {}) =>
      journeyRows.filter((j: any) => {
        if (where.driverId && !matchInClause(j.driverId, where.driverId)) return false;
        if (where.status && j.status !== where.status) return false;
        if (where.confirmedAt?.gte && new Date(j.confirmedAt ?? 0) < new Date(where.confirmedAt.gte))
          return false;
        return true;
      }).length,
    ),
  },
  amlFlag: {
    findMany: jest.fn(async ({ where = {} }: any = {}) =>
      amlFlagRows.filter((f: any) => f.userId === where.userId),
    ),
  },
};

jest.mock('../prisma', () => ({
  __esModule: true,
  default: stub,
}));

jest.mock('../middleware/auth-status-cache', () => ({
  getAuthStatusCache: () => null,
  setAuthStatusCache: () => undefined,
  invalidateAuthStatusCache: () => undefined,
  _resetAuthStatusCacheForTests: () => undefined,
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import cooperativeLeaderRoutes from '../routes/cooperative-leader.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';

const ferwId = 'coop-ferw';
const coopId = 'coop-coop';
const marieUserId = '11111111-1111-1111-1111-111111111111';
const customerUserId = '22222222-2222-2222-2222-222222222222';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/cooperative', cooperativeLeaderRoutes);
app.use(errorHandler);

const marieToken = `accessToken=${generateAccessToken({ userId: marieUserId, role: 'COOPERATIVE_LEADER' })}`;
const customerToken = `accessToken=${generateAccessToken({ userId: customerUserId, role: 'CUSTOMER' })}`;

beforeEach(() => {
  cooperativeRows.clear();
  userRows.clear();
  driverProfileRows.clear();
  journeyRows.length = 0;
  amlFlagRows.length = 0;

  cooperativeRows.set(ferwId, {
    id: ferwId,
    name: 'FERWACOTAMO',
    commissionRate: 0,
    currency: 'RWF',
    leaderId: marieUserId,
    registrationNumber: 'RDB-1',
    active: true,
  });
  cooperativeRows.set(coopId, {
    id: coopId,
    name: 'COOPACTRA',
    commissionRate: 0.05,
    currency: 'RWF',
    leaderId: null,
    active: true,
  });

  userRows.set(marieUserId, {
    id: marieUserId,
    role: 'COOPERATIVE_LEADER',
    nickname: 'Marie',
    phone: '+250788000111',
    cooperativeId: ferwId,
    frozenAt: null,
    isFlagged: false,
  });
  userRows.set(customerUserId, {
    id: customerUserId,
    role: 'CUSTOMER',
    nickname: 'Cust',
    phone: '+250788111111',
    cooperativeId: null,
    frozenAt: null,
  });

  userRows.set('u-jean', {
    id: 'u-jean',
    nickname: 'Jean',
    phone: '+250788000001',
    isFlagged: false,
    frozenAt: null,
  });
  driverProfileRows.set('dp-jean', {
    id: 'dp-jean',
    userId: 'u-jean',
    cooperativeId: ferwId,
    cooperativeName: 'FERWACOTAMO',
    vehicleType: 'MOTO',
    isOnline: true,
    avgRating: 4.5,
    totalRides: 100,
    active: true,
    verificationStatus: 'VERIFIED',
  });
  userRows.set('u-pascal-d', {
    id: 'u-pascal-d',
    nickname: 'PascalD',
    phone: '+250788000099',
    isFlagged: false,
    frozenAt: null,
  });
  driverProfileRows.set('dp-pascal', {
    id: 'dp-pascal',
    userId: 'u-pascal-d',
    cooperativeId: coopId,
    cooperativeName: 'COOPACTRA',
    vehicleType: 'MOTO',
    isOnline: true,
    avgRating: 4.2,
    totalRides: 50,
    active: true,
    verificationStatus: 'VERIFIED',
  });
});

describe('cooperative-leader routes (read-only)', () => {
  test('GET /dashboard without auth → 401', async () => {
    const res = await request(app).get('/api/cooperative/dashboard');
    expect(res.status).toBe(401);
  });

  test('GET /dashboard as CUSTOMER → 403', async () => {
    const res = await request(app)
      .get('/api/cooperative/dashboard')
      .set('Cookie', customerToken);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COOPERATIVE_LEADER_ROLE_REQUIRED');
  });

  test('GET /dashboard as Marie → 200 with FERWACOTAMO summary', async () => {
    const res = await request(app)
      .get('/api/cooperative/dashboard')
      .set('Cookie', marieToken);
    expect(res.status).toBe(200);
    expect(res.body.cooperativeId).toBe(ferwId);
    expect(res.body.name).toBe('FERWACOTAMO');
    expect(res.body.driverCount).toBe(1);
  });

  test('GET /drivers returns ONLY FERWACOTAMO drivers', async () => {
    const res = await request(app)
      .get('/api/cooperative/drivers')
      .set('Cookie', marieToken);
    expect(res.status).toBe(200);
    expect(res.body.drivers).toHaveLength(1);
    expect(res.body.drivers[0].cooperativeName).toBe('FERWACOTAMO');
  });

  test('GET /drivers/:id for COOPACTRA driver as Marie → 404 (smallest-wrongness)', async () => {
    const res = await request(app)
      .get(`/api/cooperative/drivers/dp-pascal`)
      .set('Cookie', marieToken);
    expect(res.status).toBe(404);
  });

  test('GET /drivers/:id for own-cooperative driver → 200 with detail', async () => {
    const res = await request(app)
      .get(`/api/cooperative/drivers/dp-jean`)
      .set('Cookie', marieToken);
    expect(res.status).toBe(200);
    expect(res.body.driver.userId).toBe('u-jean');
  });

  test('GET /financials?periodDays=7 → returns 7-day summary', async () => {
    const res = await request(app)
      .get('/api/cooperative/financials?periodDays=7')
      .set('Cookie', marieToken);
    expect(res.status).toBe(200);
    expect(res.body.cooperativeId).toBe(ferwId);
    expect(res.body.periodDays).toBe(7);
  });

  test('GET /financials?periodDays=100 → 400 (above max)', async () => {
    const res = await request(app)
      .get('/api/cooperative/financials?periodDays=100')
      .set('Cookie', marieToken);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PERIOD_DAYS');
  });

  test('GET /me → returns user + cooperative', async () => {
    const res = await request(app)
      .get('/api/cooperative/me')
      .set('Cookie', marieToken);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(marieUserId);
    expect(res.body.cooperative.id).toBe(ferwId);
    expect(res.body.cooperative.name).toBe('FERWACOTAMO');
  });
});
