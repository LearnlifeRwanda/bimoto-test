jest.mock('../prisma', () => {
  const bids: any[] = [];
  return {
    __esModule: true,
    default: {
      bid: {
        findMany: jest.fn(async ({ where, include, orderBy, take }: any) => {
          let rows = bids.filter((b) => {
            if (where?.driverId !== undefined && b.driverId !== where.driverId) return false;
            if (where?.autoBidRuleId?.not === null && b.autoBidRuleId === null) return false;
            return true;
          });
          if (orderBy?.createdAt === 'desc') {
            rows = [...rows].sort(
              (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
            );
          }
          if (take) rows = rows.slice(0, take);
          if (include?.autoBidRule) {
            rows = rows.map((b) => ({ ...b, autoBidRule: b._rule ?? null }));
          }
          return rows;
        }),
      },
      _bids: bids,
      _seedBid: (data: any) => {
        bids.push({
          createdAt: new Date(),
          autoBidRuleId: null,
          _rule: null,
          ...data,
        });
      },
      _reset: () => {
        bids.length = 0;
      },
    },
  };
});

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = {
      userId: req.headers['x-test-user'] || 'd1',
      role: req.headers['x-test-role'] || 'DRIVER',
    };
    next();
  },
  driverOnly: (req: any, res: any, next: any) => {
    if (!req.user || (req.user.role !== 'DRIVER' && req.user.role !== 'BOTH')) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'errors.driver_only' } });
      return;
    }
    next();
  },
  customerOnly: (_req: any, _res: any, next: any) => next(),
  invalidateAuthStatusCache: jest.fn(),
  _resetAuthStatusCacheForTests: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import bidHistoryRoutes from '../routes/bid-history.routes';
import { errorHandler } from '../middleware/error-handler';
import prisma from '../prisma';

const app = express();
app.use(express.json());
app.use('/api/bids', bidHistoryRoutes);
app.use(errorHandler);

beforeEach(() => {
  (prisma as any)._reset();
});

describe('GET /api/bids/my-history', () => {
  it('returns the driver\'s bids ordered by createdAt desc', async () => {
    (prisma as any)._seedBid({
      id: 'b1',
      driverId: 'd1',
      price: 1500,
      createdAt: new Date('2026-05-05T09:00:00Z'),
    });
    (prisma as any)._seedBid({
      id: 'b2',
      driverId: 'd1',
      price: 2000,
      createdAt: new Date('2026-05-05T10:00:00Z'),
    });
    const res = await request(app).get('/api/bids/my-history');
    expect(res.status).toBe(200);
    expect(res.body.map((b: any) => b.id)).toEqual(['b2', 'b1']);
  });

  it('autoOnly=true filters to bids with autoBidRuleId IS NOT NULL', async () => {
    (prisma as any)._seedBid({
      id: 'manual',
      driverId: 'd1',
      autoBidRuleId: null,
      _rule: null,
      createdAt: new Date('2026-05-05T09:00:00Z'),
    });
    (prisma as any)._seedBid({
      id: 'auto1',
      driverId: 'd1',
      autoBidRuleId: 'r1',
      _rule: { id: 'r1', priority: 0 },
      createdAt: new Date('2026-05-05T10:00:00Z'),
    });
    const res = await request(app).get('/api/bids/my-history?autoOnly=true');
    expect(res.status).toBe(200);
    expect(res.body.map((b: any) => b.id)).toEqual(['auto1']);
  });

  it('each bid carries the joined autoBidRule snapshot when set', async () => {
    (prisma as any)._seedBid({
      id: 'auto1',
      driverId: 'd1',
      autoBidRuleId: 'r2',
      _rule: { id: 'r2', priority: 1, vehicleTypeFilter: 'MOTO' },
      createdAt: new Date(),
    });
    const res = await request(app).get('/api/bids/my-history');
    expect(res.status).toBe(200);
    expect(res.body[0].autoBidRule).toMatchObject({
      id: 'r2',
      priority: 1,
      vehicleTypeFilter: 'MOTO',
    });
  });

  it('customer (non-driver) → 403', async () => {
    const res = await request(app)
      .get('/api/bids/my-history')
      .set('x-test-role', 'CUSTOMER');
    expect(res.status).toBe(403);
  });
});
