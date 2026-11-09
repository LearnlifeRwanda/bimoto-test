// Route-level tests for the driver-stats endpoint
// (Dispatch R3-DRIVER-TIER-STATS). Mocks both the auth middleware
// and the underlying service so the cases focus on routing,
// authorization and windowDays clamping.

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    if (req.headers['x-test-anon']) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'errors.unauthorized' } });
      return;
    }
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
  invalidateAuthStatusCache: jest.fn(),
  _resetAuthStatusCacheForTests: jest.fn(),
}));

const getDriverStatsMock = jest.fn();
jest.mock('../services/driver-stats.service', () => ({
  getDriverStats: (...args: any[]) => getDriverStatsMock(...args),
}));

import express from 'express';
import request from 'supertest';
import driverStatsRoutes from '../routes/driver-stats.routes';
import { errorHandler } from '../middleware/error-handler';

const app = express();
app.use(express.json());
app.use('/api/driver/stats', driverStatsRoutes);
app.use(errorHandler);

const baseStats = {
  windowDays: 30,
  acceptanceRate: 0.5,
  totalBids: 4,
  avgAcceptanceTimeMinutes: 4.0,
  completionRate: 0.75,
  totalTerminalJourneys: 4,
  weeklyEarningsRwf: 18500,
  cohortMedianEarningsRwf: 15000,
  vehicleType: 'BIKE',
};

beforeEach(() => {
  getDriverStatsMock.mockReset();
  getDriverStatsMock.mockImplementation(async (_driverId: string, windowDays: number) => ({
    ...baseStats,
    windowDays,
  }));
});

describe('GET /api/driver/stats', () => {
  test('without auth → 401', async () => {
    const res = await request(app).get('/api/driver/stats').set('x-test-anon', '1');
    expect(res.status).toBe(401);
  });

  test('as a CUSTOMER → 403', async () => {
    const res = await request(app).get('/api/driver/stats').set('x-test-role', 'CUSTOMER');
    expect(res.status).toBe(403);
    expect(getDriverStatsMock).not.toHaveBeenCalled();
  });

  test('as a DRIVER → 200 with stats body', async () => {
    const res = await request(app).get('/api/driver/stats');
    expect(res.status).toBe(200);
    expect(res.body.acceptanceRate).toBeCloseTo(0.5);
    expect(res.body.windowDays).toBe(30);
    expect(getDriverStatsMock).toHaveBeenCalledWith('d1', 30);
  });

  test('as BOTH role → 200 (driver+customer hybrid)', async () => {
    const res = await request(app).get('/api/driver/stats').set('x-test-role', 'BOTH');
    expect(res.status).toBe(200);
  });

  test('windowDays=14 within range → service called with 14', async () => {
    const res = await request(app).get('/api/driver/stats?windowDays=14');
    expect(res.status).toBe(200);
    expect(getDriverStatsMock).toHaveBeenCalledWith('d1', 14);
  });

  test('windowDays=0 → clamped up to 7', async () => {
    await request(app).get('/api/driver/stats?windowDays=0');
    expect(getDriverStatsMock).toHaveBeenCalledWith('d1', 30); // 0 falls back to default
  });

  test('windowDays=3 below min → clamped up to 7', async () => {
    await request(app).get('/api/driver/stats?windowDays=3');
    expect(getDriverStatsMock).toHaveBeenCalledWith('d1', 7);
  });

  test('windowDays=999 above max → clamped down to 90', async () => {
    await request(app).get('/api/driver/stats?windowDays=999');
    expect(getDriverStatsMock).toHaveBeenCalledWith('d1', 90);
  });

  test('windowDays=garbage → falls back to default 30', async () => {
    await request(app).get('/api/driver/stats?windowDays=abc');
    expect(getDriverStatsMock).toHaveBeenCalledWith('d1', 30);
  });

  test('passes the authenticated driverId through', async () => {
    await request(app).get('/api/driver/stats').set('x-test-user', 'driver-xyz');
    expect(getDriverStatsMock).toHaveBeenCalledWith('driver-xyz', 30);
  });
});
