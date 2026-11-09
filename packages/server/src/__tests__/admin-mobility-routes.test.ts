jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    mobilityAggregate: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    user: {
      findUnique: jest.fn(async () => ({ frozenAt: null })),
    },
  },
}));

jest.mock('../jobs/mobility-aggregation.job', () => ({
  runMobilityAggregationOnce: jest.fn(async () => ({
    modules: 2,
    insertedRows: 0,
    conflicts: 0,
    suppressedByTier: { DENSE: 0, MEDIUM: 0, LOW: 0, SPARSE: 0 },
    durationMs: 1,
  })),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import adminMobilityRoutes from '../routes/admin-mobility.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import { runMobilityAggregationOnce } from '../jobs/mobility-aggregation.job';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/admin/mobility', adminMobilityRoutes);
app.use(errorHandler);

const adminToken = generateAccessToken({ userId: 'admin-1', role: 'ADMIN' });
const customerToken = generateAccessToken({ userId: 'cust-1', role: 'CUSTOMER' });
const analystToken = generateAccessToken({ userId: 'analyst-1', role: 'ANALYST' });
const repo = (prisma as any).mobilityAggregate;

beforeEach(() => {
  jest.clearAllMocks();
  repo.findMany.mockResolvedValue([]);
  repo.groupBy.mockResolvedValue([]);
});

describe('admin mobility routes — auth', () => {
  test('GET /aggregates without token → 401', async () => {
    const res = await request(app).get('/api/admin/mobility/aggregates');
    expect(res.status).toBe(401);
  });

  test('GET /aggregates as non-admin → 403', async () => {
    const res = await request(app)
      .get('/api/admin/mobility/aggregates')
      .set('Cookie', [`accessToken=${customerToken}`])
      .query({ tier: 'DENSE', dateFrom: '2026-05-01', dateTo: '2026-05-02' });
    expect(res.status).toBe(403);
  });
});

// INTEL-DECK G4 — the router splits by verb. Reads open to ANALYST,
// mutations stay shut. Both halves asserted on the real router.
describe('admin mobility routes — the ANALYST split', () => {
  test('an ANALYST may read aggregates, stats and the tier config', async () => {
    const range = { dateFrom: '2026-05-01', dateTo: '2026-05-02' };
    const aggregates = await request(app)
      .get('/api/admin/mobility/aggregates')
      .set('Cookie', [`accessToken=${analystToken}`])
      .query({ tier: 'DENSE', ...range });
    expect(aggregates.status).toBe(200);

    const stats = await request(app)
      .get('/api/admin/mobility/aggregates/stats')
      .set('Cookie', [`accessToken=${analystToken}`])
      .query(range);
    expect(stats.status).toBe(200);

    const config = await request(app)
      .get('/api/admin/mobility/tier-config')
      .set('Cookie', [`accessToken=${analystToken}`]);
    expect(config.status).toBe(200);
    expect(config.body.config.DENSE.kThreshold).toBe(20);
  });

  test('an ANALYST may NOT re-run the aggregation', async () => {
    const res = await request(app)
      .post('/api/admin/mobility/aggregates/run-now')
      .set('Cookie', [`accessToken=${analystToken}`]);
    expect(res.status).toBe(403);
    await new Promise((r) => setImmediate(r));
    expect(runMobilityAggregationOnce).not.toHaveBeenCalled();
  });

  test('an ANALYST may NOT reload the tier thresholds', async () => {
    const res = await request(app)
      .post('/api/admin/mobility/tier-config/reload')
      .set('Cookie', [`accessToken=${analystToken}`]);
    expect(res.status).toBe(403);
  });

  test('a CUSTOMER is still refused every route, read and write alike', async () => {
    const read = await request(app)
      .get('/api/admin/mobility/tier-config')
      .set('Cookie', [`accessToken=${customerToken}`]);
    expect(read.status).toBe(403);
    const write = await request(app)
      .post('/api/admin/mobility/aggregates/run-now')
      .set('Cookie', [`accessToken=${customerToken}`]);
    expect(write.status).toBe(403);
  });
});

describe('GET /api/admin/mobility/aggregates', () => {
  test('returns rows for the tier in range', async () => {
    repo.findMany.mockResolvedValue([
      { id: 'r1', tier: 'DENSE', cellId: 'c1', count: 25 },
    ]);
    const res = await request(app)
      .get('/api/admin/mobility/aggregates')
      .set('Cookie', [`accessToken=${adminToken}`])
      .query({ tier: 'DENSE', dateFrom: '2026-05-01', dateTo: '2026-05-02' });
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tier: 'DENSE', aggregateType: 'POINT_DENSITY' }),
      }),
    );
  });

  test('invalid tier → 400', async () => {
    const res = await request(app)
      .get('/api/admin/mobility/aggregates')
      .set('Cookie', [`accessToken=${adminToken}`])
      .query({ tier: 'BOGUS', dateFrom: '2026-05-01', dateTo: '2026-05-02' });
    expect(res.status).toBe(400);
  });

  test('range > 90 days → 400', async () => {
    const res = await request(app)
      .get('/api/admin/mobility/aggregates')
      .set('Cookie', [`accessToken=${adminToken}`])
      .query({ tier: 'DENSE', dateFrom: '2026-01-01', dateTo: '2026-05-01' });
    expect(res.status).toBe(400);
  });

  // INTEL-DECK G3 — the read side runs the grain gate too, so a row
  // written before the gate existed cannot serve a category of one on
  // its way out.
  test('a legacy row with a singleton marginal is sanitized on the way out', async () => {
    repo.findMany.mockResolvedValue([
      {
        id: 'legacy-1',
        tier: 'DENSE',
        cellId: 'c1',
        count: 20,
        attributesJson: { vehicleTypes: { MOTO: 19, E_BIKE: 1 }, hourBuckets: { 8: 20 } },
      },
    ]);
    const res = await request(app)
      .get('/api/admin/mobility/aggregates')
      .set('Cookie', [`accessToken=${adminToken}`])
      .query({ tier: 'DENSE', dateFrom: '2026-05-01', dateTo: '2026-05-02' });
    expect(res.status).toBe(200);
    // The stored row said E_BIKE: 1. Nothing on the wire does.
    expect(res.body.rows[0].attributesJson.vehicleTypes).toEqual({ other: 20 });
    expect(JSON.stringify(res.body)).not.toContain('E_BIKE');
    // Everything else about the row survives untouched.
    expect(res.body.rows[0].count).toBe(20);
    expect(res.body.rows[0].attributesJson.hourBuckets).toEqual({ '8': 20 });
  });

  test('a row with no attributes stays null rather than becoming an empty object', async () => {
    repo.findMany.mockResolvedValue([
      { id: 'sparse-1', tier: 'SPARSE', cellId: 'c9', count: 10, attributesJson: null },
    ]);
    const res = await request(app)
      .get('/api/admin/mobility/aggregates')
      .set('Cookie', [`accessToken=${adminToken}`])
      .query({ tier: 'SPARSE', dateFrom: '2026-05-01', dateTo: '2026-05-02' });
    expect(res.body.rows[0].attributesJson).toBeNull();
  });

  test('limit > 500 → 400', async () => {
    const res = await request(app)
      .get('/api/admin/mobility/aggregates')
      .set('Cookie', [`accessToken=${adminToken}`])
      .query({ tier: 'DENSE', dateFrom: '2026-05-01', dateTo: '2026-05-02', limit: 9999 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/mobility/aggregates/stats', () => {
  test('returns per-tier counts', async () => {
    repo.groupBy.mockResolvedValue([
      { tier: 'DENSE', _count: { _all: 4 }, _sum: { count: 200 } },
      { tier: 'MEDIUM', _count: { _all: 2 }, _sum: { count: 30 } },
    ]);
    const res = await request(app)
      .get('/api/admin/mobility/aggregates/stats')
      .set('Cookie', [`accessToken=${adminToken}`])
      .query({ dateFrom: '2026-05-01', dateTo: '2026-05-02' });
    expect(res.status).toBe(200);
    expect(res.body.stats.DENSE).toEqual({ cells: 4, totalPoints: 200 });
    expect(res.body.stats.MEDIUM).toEqual({ cells: 2, totalPoints: 30 });
    expect(res.body.stats.LOW).toEqual({ cells: 0, totalPoints: 0 });
  });
});

describe('POST /api/admin/mobility/aggregates/run-now', () => {
  test('returns 202 immediately and triggers aggregator in background', async () => {
    const res = await request(app)
      .post('/api/admin/mobility/aggregates/run-now')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(true);
    // Background promise has had time to fire by the time supertest awaits.
    await new Promise((r) => setImmediate(r));
    expect(runMobilityAggregationOnce).toHaveBeenCalled();
  });

  // LOOSE-ENDS G6 — the optional range. An admin re-builds last
  // month's aggregates without asking a developer; a bodyless request
  // behaves exactly as it always has.
  describe('the optional date range', () => {
    const post = (body?: unknown) => {
      const req = request(app)
        .post('/api/admin/mobility/aggregates/run-now')
        .set('Cookie', [`accessToken=${adminToken}`]);
      return body === undefined ? req : req.send(body as object);
    };

    const settle = () => new Promise((r) => setImmediate(r));

    test.each([
      ['no body at all', undefined],
      ['an empty body', {}],
      ['empty strings', { dateFrom: '', dateTo: '' }],
    ])('%s runs the job with no window — byte-identical to before', async (_case, body) => {
      const res = await post(body);
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ accepted: true });
      await settle();
      expect(runMobilityAggregationOnce).toHaveBeenCalledWith(expect.any(Date), {});
    });

    test('a valid range is parsed and passed through as the window', async () => {
      const res = await post({ dateFrom: '2026-05-01', dateTo: '2026-06-01' });
      expect(res.status).toBe(202);
      await settle();
      const [, window] = (runMobilityAggregationOnce as jest.Mock).mock.calls[0];
      expect(window.sinceUtc.toISOString()).toBe('2026-05-01T00:00:00.000Z');
      expect(window.untilUtc.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    });

    test.each([
      ['only a start date', { dateFrom: '2026-05-01' }, 'INVALID_RANGE'],
      ['only an end date', { dateTo: '2026-06-01' }, 'INVALID_RANGE'],
      ['an unparseable date', { dateFrom: 'not-a-date', dateTo: '2026-06-01' }, 'INVALID_DATE'],
      ['a non-string date', { dateFrom: 20260501, dateTo: '2026-06-01' }, 'INVALID_DATE'],
      ['a reversed range', { dateFrom: '2026-06-01', dateTo: '2026-05-01' }, 'INVALID_RANGE'],
      ['a zero-length range', { dateFrom: '2026-05-01', dateTo: '2026-05-01' }, 'INVALID_RANGE'],
      // Default cap is 90 days.
      ['a range past the cap', { dateFrom: '2026-01-01', dateTo: '2026-06-01' }, 'RANGE_TOO_LARGE'],
    ])('%s is refused with 422 and starts nothing', async (_case, body, code) => {
      const res = await post(body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(code);
      await settle();
      expect(runMobilityAggregationOnce).not.toHaveBeenCalled();
    });

    test('a range is still admin-only — an analyst cannot run one', async () => {
      const res = await request(app)
        .post('/api/admin/mobility/aggregates/run-now')
        .set('Cookie', [`accessToken=${analystToken}`])
        .send({ dateFrom: '2026-05-01', dateTo: '2026-06-01' });
      expect(res.status).toBe(403);
      await settle();
      expect(runMobilityAggregationOnce).not.toHaveBeenCalled();
    });
  });
});

describe('GET /api/admin/mobility/tier-config', () => {
  test('returns the current TIER_CONFIGS object', async () => {
    const res = await request(app)
      .get('/api/admin/mobility/tier-config')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.config.DENSE.kThreshold).toBe(20);
    expect(res.body.config.SPARSE.kThreshold).toBe(10);
    expect(typeof res.body.classificationVersion).toBe('string');
    // LOOSE-ENDS G6 — additive: the ops panel's range picker mirrors
    // the server's cap, and this is where it learns the configured
    // value rather than carrying a copy of the default.
    expect(res.body.maxRunNowRangeDays).toBe(90);
  });
});

describe('POST /api/admin/mobility/tier-config/reload', () => {
  test('returns the new file version', async () => {
    const res = await request(app)
      .post('/api/admin/mobility/tier-config/reload')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(typeof res.body.version).toBe('string');
  });
});
