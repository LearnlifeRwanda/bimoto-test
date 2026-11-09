// __TESTS__/CUSTOMER-MODES-ROUTES.TEST.TS
//
// Dispatch K3 group 7 — supertest exercises the new customer-modes
// endpoints (suggest-up, customer-mode-status) end-to-end with a
// mocked prisma + a stub auth middleware.

jest.mock('../prisma', () => {
  const journeys = new Map<string, any>();
  return {
    __esModule: true,
    default: {
      journey: {
        findUnique: jest.fn(async ({ where }: any) => journeys.get(where.id) ?? null),
        update: jest.fn(async ({ where, data }: any) => {
          const j = journeys.get(where.id);
          if (!j) throw new Error('not found');
          if (data.suggestUpCount?.increment !== undefined) {
            j.suggestUpCount = (j.suggestUpCount ?? 0) + data.suggestUpCount.increment;
          }
          if (data.wishPrice !== undefined) j.wishPrice = data.wishPrice;
          return j;
        }),
      },
      _journeys: journeys,
      _reset: () => journeys.clear(),
      _seed: (j: any) => journeys.set(j.id, j),
    },
  };
});

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    if (req.headers['x-test-anon']) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'errors.unauthorized' } });
      return;
    }
    req.user = {
      userId: req.headers['x-test-user'] || 'c1',
      role: req.headers['x-test-role'] || 'CUSTOMER',
    };
    next();
  },
  driverOnly: (_req: any, _res: any, next: any) => next(),
  customerOnly: (req: any, res: any, next: any) => {
    if (!req.user || (req.user.role !== 'CUSTOMER' && req.user.role !== 'BOTH')) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'errors.customer_only' } });
      return;
    }
    next();
  },
  invalidateAuthStatusCache: jest.fn(),
  _resetAuthStatusCacheForTests: jest.fn(),
}));

jest.mock('../socket', () => ({
  emitToJourney: jest.fn(),
  getIO: () => {
    throw new Error('not initialized');
  },
}));

import express from 'express';
import request from 'supertest';
import journeyRoutes from '../routes/journey.routes';
import { errorHandler } from '../middleware/error-handler';
import prisma from '../prisma';

const app = express();
app.use(express.json());
app.use('/api/journeys', journeyRoutes);
app.use(errorHandler);

const T0 = new Date('2026-05-05T17:00:00.000Z');
const ago = (sec: number) => new Date(Date.now() - sec * 1000);

beforeEach(() => {
  (prisma as any)._reset();
});

function seedJourney(overrides: any = {}) {
  const now = new Date();
  const j = {
    id: 'j1',
    customerId: 'c1',
    status: 'REQUESTED',
    discoveryStartedAt: ago(70),
    createdAt: ago(70),
    suggestUpCount: 0,
    wishPrice: 1500,
    requestMode: 'WAIT_AND_COMPARE',
    priceCeilingRwf: null,
    priceCeilingMultiplier: null,
    ...overrides,
  };
  (prisma as any)._seed(j);
  return j;
}

describe('POST /api/journeys/:id/suggest-up', () => {
  it('valid amount within window → 200, wishPrice incremented', async () => {
    seedJourney({ discoveryStartedAt: ago(70) });
    const res = await request(app)
      .post('/api/journeys/j1/suggest-up')
      .send({ addRwf: 50 });
    expect(res.status).toBe(200);
    expect(res.body.newWishPrice).toBe(1550);
    expect(res.body.suggestUpCount).toBe(1);
  });

  it('addRwf=75 (not in config) → 400', async () => {
    seedJourney({ discoveryStartedAt: ago(70) });
    const res = await request(app)
      .post('/api/journeys/j1/suggest-up')
      .send({ addRwf: 75 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SUGGEST_UP_INVALID_AMOUNT');
    expect(res.body.error.validAmounts).toEqual([50, 100]);
  });

  it('non-owner → 403', async () => {
    seedJourney({ discoveryStartedAt: ago(70) });
    const res = await request(app)
      .post('/api/journeys/j1/suggest-up')
      .set('x-test-user', 'OTHER_CUSTOMER')
      .send({ addRwf: 50 });
    expect(res.status).toBe(403);
  });

  it('already MATCHED journey → 400', async () => {
    seedJourney({ discoveryStartedAt: ago(70), status: 'MATCHED' });
    const res = await request(app)
      .post('/api/journeys/j1/suggest-up')
      .send({ addRwf: 50 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SUGGEST_UP_INVALID');
  });

  it('addRwf=100 at 70s (T2 not yet open) → 400', async () => {
    seedJourney({ discoveryStartedAt: ago(70) });
    const res = await request(app)
      .post('/api/journeys/j1/suggest-up')
      .send({ addRwf: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error.reason).toBe('amount-not-yet-available');
  });
});

describe('GET /api/journeys/:id/customer-mode-status', () => {
  it('WAIT_AND_COMPARE journey → null ceiling', async () => {
    seedJourney({ discoveryStartedAt: ago(30) });
    const res = await request(app).get('/api/journeys/j1/customer-mode-status');
    expect(res.status).toBe(200);
    expect(res.body.requestMode).toBe('WAIT_AND_COMPARE');
    expect(res.body.priceCeilingRwf).toBeNull();
    expect(res.body.suggestUpStatus.availableAmounts).toEqual([]);
  });

  it('NEED_TO_GO at t=30s → ceiling set, no amounts yet', async () => {
    seedJourney({
      discoveryStartedAt: ago(30),
      requestMode: 'NEED_TO_GO',
      priceCeilingRwf: 2600,
      priceCeilingMultiplier: 1.3,
    });
    const res = await request(app).get('/api/journeys/j1/customer-mode-status');
    expect(res.status).toBe(200);
    expect(res.body.requestMode).toBe('NEED_TO_GO');
    expect(res.body.priceCeilingRwf).toBe(2600);
    expect(res.body.suggestUpStatus.availableAmounts).toEqual([]);
    expect(res.body.suggestUpStatus.nextAmountAvailableAt).toBeTruthy();
  });

  it('NEED_TO_GO at t=130s → both amounts available', async () => {
    seedJourney({
      discoveryStartedAt: ago(130),
      requestMode: 'NEED_TO_GO',
      priceCeilingRwf: 2600,
      priceCeilingMultiplier: 1.3,
    });
    const res = await request(app).get('/api/journeys/j1/customer-mode-status');
    expect(res.status).toBe(200);
    expect(res.body.suggestUpStatus.availableAmounts).toEqual([50, 100]);
    expect(res.body.suggestUpStatus.nextAmountAvailableAt).toBeNull();
  });

  it('non-owner → 403', async () => {
    seedJourney({ discoveryStartedAt: ago(30) });
    const res = await request(app)
      .get('/api/journeys/j1/customer-mode-status')
      .set('x-test-user', 'OTHER');
    expect(res.status).toBe(403);
  });

  it('not-found → 404', async () => {
    const res = await request(app).get('/api/journeys/missing/customer-mode-status');
    expect(res.status).toBe(404);
  });
});
