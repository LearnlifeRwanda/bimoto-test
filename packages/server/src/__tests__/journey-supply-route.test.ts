jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findUnique: jest.fn() },
    driverProfile: { findMany: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { userId: req.headers['x-test-user'] || 'u1', role: 'CUSTOMER' };
    next();
  },
  driverOnly: (_req: any, _res: any, next: any) => next(),
  customerOnly: (_req: any, _res: any, next: any) => next(),
  invalidateAuthStatusCache: jest.fn(),
  _resetAuthStatusCacheForTests: jest.fn(),
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

const journeyRepo = (prisma as any).journey;
const driverRepo = (prisma as any).driverProfile;

const KIGALI = { lat: -1.9536, lng: 30.0606 };

function makeJourney(overrides: Partial<{
  id: string;
  customerId: string;
  status: string;
  type: string;
  pickupLat: number;
  pickupLng: number;
  createdAt: Date;
  discoveryStartedAt: Date | null;
}> = {}) {
  return {
    id: overrides.id ?? 'j1',
    customerId: overrides.customerId ?? 'cust1',
    status: overrides.status ?? 'REQUESTED',
    type: overrides.type ?? 'GOODS',
    pickupLat: overrides.pickupLat ?? KIGALI.lat,
    pickupLng: overrides.pickupLng ?? KIGALI.lng,
    createdAt: overrides.createdAt ?? new Date(),
    discoveryStartedAt:
      overrides.discoveryStartedAt === undefined
        ? new Date()
        : overrides.discoveryStartedAt,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/journeys/:id/supply', () => {
  test('non-existent journey → 404', async () => {
    journeyRepo.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .get('/api/journeys/missing/supply')
      .set('x-test-user', 'cust1');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('JOURNEY_NOT_FOUND');
  });

  test('caller is not the customer of the journey → 403', async () => {
    journeyRepo.findUnique.mockResolvedValue(makeJourney({ customerId: 'otherCust' }));
    const res = await request(app)
      .get('/api/journeys/j1/supply')
      .set('x-test-user', 'cust1');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('non-REQUESTED journey returns cascadeComplete=true with count=null', async () => {
    journeyRepo.findUnique.mockResolvedValue(
      makeJourney({ status: 'COMPLETED' }),
    );
    const res = await request(app)
      .get('/api/journeys/j1/supply')
      .set('x-test-user', 'cust1');
    expect(res.status).toBe(200);
    expect(res.body.count).toBeNull();
    expect(res.body.cascadeComplete).toBe(true);
    expect(driverRepo.findMany).not.toHaveBeenCalled();
  });

  test('PENDING journey at t=0 with 5 in-ring drivers returns count=5', async () => {
    journeyRepo.findUnique.mockResolvedValue(makeJourney());
    driverRepo.findMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        lastLat: KIGALI.lat + 0.0001 * (i + 1),
        lastLng: KIGALI.lng,
      })),
    );
    const res = await request(app)
      .get('/api/journeys/j1/supply')
      .set('x-test-user', 'cust1');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(5);
    expect(res.body.currentRingMeters).toBe(200);
    expect(typeof res.body.cascadeComplete).toBe('boolean');
  });

  test('SMALLEST WRONGNESS: 1 in-ring driver → privacy floor returns count=null', async () => {
    journeyRepo.findUnique.mockResolvedValue(makeJourney());
    driverRepo.findMany.mockResolvedValue([
      { lastLat: KIGALI.lat + 0.0001, lastLng: KIGALI.lng },
    ]);
    const res = await request(app)
      .get('/api/journeys/j1/supply')
      .set('x-test-user', 'cust1');
    expect(res.status).toBe(200);
    expect(res.body.count).toBeNull();
    expect(res.body.displayHint).toBe('few');
  });

  test('polling: two consecutive GETs within 5s return identical counts', async () => {
    journeyRepo.findUnique.mockResolvedValue(makeJourney());
    driverRepo.findMany.mockResolvedValue([
      { lastLat: KIGALI.lat, lastLng: KIGALI.lng + 0.0001 },
      { lastLat: KIGALI.lat, lastLng: KIGALI.lng + 0.0002 },
      { lastLat: KIGALI.lat, lastLng: KIGALI.lng + 0.0003 },
    ]);
    const r1 = await request(app)
      .get('/api/journeys/j1/supply')
      .set('x-test-user', 'cust1');
    const r2 = await request(app)
      .get('/api/journeys/j1/supply')
      .set('x-test-user', 'cust1');
    expect(r1.body.count).toBe(r2.body.count);
    expect(r1.body.count).toBe(3);
  });

  test('uses createdAt fallback when discoveryStartedAt is null', async () => {
    journeyRepo.findUnique.mockResolvedValue(
      makeJourney({ discoveryStartedAt: null, createdAt: new Date() }),
    );
    driverRepo.findMany.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/journeys/j1/supply')
      .set('x-test-user', 'cust1');
    expect(res.status).toBe(200);
    expect(res.body.count).toBeNull();
  });

  // R3-PRIORITY-CASCADE-WIRING — the supply endpoint must reflect the
  // half-speed cascade for PRIORITY_MESSENGER trips. DENSE Kigali rings:
  // 200, 500, 1000, 2000m at 30s each. At t=15s, NORMAL is still at
  // ring 0 (200m); PRIORITY is at ring 1 (500m).
  test('PRIORITY_MESSENGER at t=15s reports the 500m ring (half-speed cascade)', async () => {
    const t0 = new Date('2026-05-05T10:00:00Z');
    const t15 = new Date(t0.getTime() + 15_000);
    jest.useFakeTimers().setSystemTime(t15);
    try {
      journeyRepo.findUnique.mockResolvedValue(
        makeJourney({
          type: 'PRIORITY_MESSENGER',
          createdAt: t0,
          discoveryStartedAt: t0,
        }),
      );
      driverRepo.findMany.mockResolvedValue([]);
      const res = await request(app)
        .get('/api/journeys/j1/supply')
        .set('x-test-user', 'cust1');
      expect(res.status).toBe(200);
      expect(res.body.currentRingMeters).toBe(500);
    } finally {
      jest.useRealTimers();
    }
  });

  test('NORMAL (GOODS) at t=15s reports the 200m ring (regression-protect)', async () => {
    const t0 = new Date('2026-05-05T10:00:00Z');
    const t15 = new Date(t0.getTime() + 15_000);
    jest.useFakeTimers().setSystemTime(t15);
    try {
      journeyRepo.findUnique.mockResolvedValue(
        makeJourney({
          type: 'GOODS',
          createdAt: t0,
          discoveryStartedAt: t0,
        }),
      );
      driverRepo.findMany.mockResolvedValue([]);
      const res = await request(app)
        .get('/api/journeys/j1/supply')
        .set('x-test-user', 'cust1');
      expect(res.status).toBe(200);
      expect(res.body.currentRingMeters).toBe(200);
    } finally {
      jest.useRealTimers();
    }
  });

  test('URGENT_MESSENGER at t=0 reports the 2000m final ring (cascade bypass)', async () => {
    const t0 = new Date('2026-05-05T10:00:00Z');
    jest.useFakeTimers().setSystemTime(t0);
    try {
      journeyRepo.findUnique.mockResolvedValue(
        makeJourney({
          type: 'URGENT_MESSENGER',
          createdAt: t0,
          discoveryStartedAt: t0,
        }),
      );
      driverRepo.findMany.mockResolvedValue([]);
      const res = await request(app)
        .get('/api/journeys/j1/supply')
        .set('x-test-user', 'cust1');
      expect(res.status).toBe(200);
      expect(res.body.currentRingMeters).toBe(2000);
      expect(res.body.cascadeComplete).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
