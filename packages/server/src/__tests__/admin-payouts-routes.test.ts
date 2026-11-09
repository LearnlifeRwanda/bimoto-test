jest.mock('../prisma', () => {
  const batchRows: any[] = [];
  const balanceRows = new Map<string, any>();
  const userRows = new Map<string, any>();
  const amlFlagRows: any[] = [];

  function matchesWhere(b: any, where: any = {}): boolean {
    if (where.status !== undefined && b.status !== where.status) return false;
    if (where.trigger !== undefined && b.trigger !== where.trigger) return false;
    if (where.held !== undefined && b.held !== where.held) return false;
    if (where.driverId !== undefined && b.driverId !== where.driverId) return false;
    if (where.createdAt?.gte !== undefined && b.createdAt < where.createdAt.gte) return false;
    if (where.createdAt?.lt !== undefined && b.createdAt >= where.createdAt.lt) return false;
    if (where.paidOutAt?.gte !== undefined) {
      if (!b.paidOutAt || b.paidOutAt < where.paidOutAt.gte) return false;
    }
    if (where.reversedAt !== undefined) {
      if (where.reversedAt === null) {
        if (b.reversedAt) return false;
      } else if (where.reversedAt.gte !== undefined) {
        if (!b.reversedAt || b.reversedAt < where.reversedAt.gte) return false;
      }
    }
    if (where.OR !== undefined && !where.OR.some((w: any) => matchesWhere(b, w))) {
      return false;
    }
    return true;
  }

  const client = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => userRows.get(where.id) ?? null),
      findMany: jest.fn(async ({ where = {} }: any = {}) => {
        let rows = Array.from(userRows.values());
        if (where.id?.in) rows = rows.filter((u: any) => where.id.in.includes(u.id));
        return rows;
      }),
      count: jest.fn(async ({ where = {} }: any = {}) => {
        return Array.from(userRows.values()).filter((u: any) => {
          if (where.frozenAt?.not === null && !u.frozenAt) return false;
          if (where.role !== undefined && u.role !== where.role) return false;
          return true;
        }).length;
      }),
    },
    driverBalance: {
      findUnique: jest.fn(async ({ where }: any) => balanceRows.get(where.driverId) ?? null),
    },
    driverPayoutBatch: {
      findUnique: jest.fn(async ({ where }: any) =>
        batchRows.find((b) => b.id === where.id) ?? null,
      ),
      findMany: jest.fn(async ({ where = {}, orderBy, take, skip }: any = {}) => {
        let rows = batchRows.filter((b) => matchesWhere(b, where));
        if (orderBy?.createdAt === 'desc') {
          rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
        }
        if (skip) rows = rows.slice(skip);
        if (take !== undefined) rows = rows.slice(0, take);
        return rows;
      }),
      count: jest.fn(async ({ where = {} }: any = {}) =>
        batchRows.filter((b) => matchesWhere(b, where)).length,
      ),
      groupBy: jest.fn(async ({ by, where = {} }: any) => {
        const field = by[0];
        const counts = new Map<string, number>();
        for (const b of batchRows.filter((r) => matchesWhere(r, where))) {
          counts.set(b[field], (counts.get(b[field]) ?? 0) + 1);
        }
        return Array.from(counts.entries()).map(([value, n]) => ({
          [field]: value,
          _count: { _all: n },
        }));
      }),
    },
    amlFlag: {
      groupBy: jest.fn(async ({ by, where = {} }: any) => {
        const field = by[0];
        const counts = new Map<string, number>();
        for (const f of amlFlagRows) {
          if (where.status !== undefined && f.status !== where.status) continue;
          counts.set(f[field], (counts.get(f[field]) ?? 0) + 1);
        }
        return Array.from(counts.entries()).map(([value, n]) => ({
          [field]: value,
          _count: { _all: n },
        }));
      }),
    },
  };
  return {
    __esModule: true,
    default: { ...client, __rows: { batchRows, balanceRows, userRows, amlFlagRows } },
  };
});

import express from 'express';
import { encrypt } from '../utils/crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import adminPayoutsRoutes from '../routes/admin-payouts.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import { _resetAuthStatusCacheForTests } from '../middleware/auth';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/admin/payouts', adminPayoutsRoutes);
app.use(errorHandler);

const adminId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const driverId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const driver2Id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const adminToken = generateAccessToken({ userId: adminId, role: 'ADMIN' });
const driverToken = generateAccessToken({ userId: driverId, role: 'DRIVER' });

const rows = (prisma as any).__rows as {
  batchRows: any[];
  balanceRows: Map<string, any>;
  userRows: Map<string, any>;
  amlFlagRows: any[];
};

const HOUR = 60 * 60 * 1000;

function batch(overrides: Partial<any> = {}) {
  return {
    id: `batch-${rows.batchRows.length + 1}`,
    driverId,
    amount: 5000,
    txRef: null,
    flwTransferId: null,
    status: 'PENDING',
    trigger: 'SCHEDULED_22H',
    failureReason: null,
    createdAt: new Date(Date.now() - 1 * HOUR),
    paidOutAt: null,
    reversedAt: null,
    held: false,
    heldAt: null,
    heldBy: null,
    heldReason: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetAuthStatusCacheForTests();
  rows.batchRows.length = 0;
  rows.balanceRows.clear();
  rows.userRows.clear();
  rows.amlFlagRows.length = 0;
  rows.userRows.set(adminId, { id: adminId, role: 'ADMIN', frozenAt: null });
  rows.userRows.set(driverId, {
    id: driverId,
    role: 'DRIVER',
    nickname: 'Driver One',
    phoneEncrypted: encrypt('+250788111111'),
    payoutPreference: 'AT_SHIFT_END',
    completedShifts: 1,
    frozenAt: null,
    frozenReason: null,
    frozenBy: null,
    frozenCategory: null,
  });
  rows.userRows.set(driver2Id, {
    id: driver2Id,
    role: 'DRIVER',
    nickname: 'Driver Two',
    phoneEncrypted: encrypt('+250788222222'),
    payoutPreference: 'DAILY_22H',
    completedShifts: 12,
    frozenAt: new Date(),
    frozenReason: 'AML critical pattern',
    frozenBy: adminId,
    frozenCategory: 'AML_CRITICAL',
  });
});

describe('admin-payouts routes — auth gate', () => {
  test('GET /batches without token → 401', async () => {
    const res = await request(app).get('/api/admin/payouts/batches');
    expect(res.status).toBe(401);
  });

  test('GET /summary with non-admin role → 403', async () => {
    const res = await request(app)
      .get('/api/admin/payouts/summary')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(403);
  });
});

describe('GET /batches', () => {
  test('returns batches newest-first with driver nickname/phone joined', async () => {
    rows.batchRows.push(
      batch({ id: 'b-old', createdAt: new Date(Date.now() - 5 * HOUR) }),
      batch({ id: 'b-new', createdAt: new Date(Date.now() - 1 * HOUR) }),
    );
    const res = await request(app)
      .get('/api/admin/payouts/batches')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.batches.map((b: any) => b.id)).toEqual(['b-new', 'b-old']);
    expect(res.body.batches[0].driver).toMatchObject({
      nickname: 'Driver One',
      phone: '+250788111111',
    });
  });

  test('filters by status', async () => {
    rows.batchRows.push(
      batch({ id: 'b-p', status: 'PENDING' }),
      batch({ id: 'b-f', status: 'FAILED', failureReason: 'flw error' }),
    );
    const res = await request(app)
      .get('/api/admin/payouts/batches?status=FAILED')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.batches).toHaveLength(1);
    expect(res.body.batches[0].id).toBe('b-f');
  });

  test('filters by trigger', async () => {
    rows.batchRows.push(
      batch({ id: 'b-s', trigger: 'SHIFT_END' }),
      batch({ id: 'b-22', trigger: 'SCHEDULED_22H' }),
    );
    const res = await request(app)
      .get('/api/admin/payouts/batches?trigger=SHIFT_END')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.body.batches).toHaveLength(1);
    expect(res.body.batches[0].id).toBe('b-s');
  });

  test('filters by held', async () => {
    rows.batchRows.push(
      batch({ id: 'b-h', held: true, heldReason: 'frozen' }),
      batch({ id: 'b-n', held: false }),
    );
    const res = await request(app)
      .get('/api/admin/payouts/batches?held=true')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.body.batches).toHaveLength(1);
    expect(res.body.batches[0].id).toBe('b-h');
  });

  test('filters by driverId', async () => {
    rows.batchRows.push(
      batch({ id: 'b-1', driverId }),
      batch({ id: 'b-2', driverId: driver2Id }),
    );
    const res = await request(app)
      .get(`/api/admin/payouts/batches?driverId=${driver2Id}`)
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.body.batches).toHaveLength(1);
    expect(res.body.batches[0].id).toBe('b-2');
  });

  test('sinceHours window excludes older batches (default 168h)', async () => {
    rows.batchRows.push(
      batch({ id: 'b-recent', createdAt: new Date(Date.now() - 2 * HOUR) }),
      batch({ id: 'b-ancient', createdAt: new Date(Date.now() - 200 * HOUR) }),
    );
    const res = await request(app)
      .get('/api/admin/payouts/batches')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.body.batches.map((b: any) => b.id)).toEqual(['b-recent']);

    const wide = await request(app)
      .get('/api/admin/payouts/batches?sinceHours=300')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(wide.body.batches).toHaveLength(2);
  });

  test('pagination: limit + offset, total unaffected', async () => {
    for (let i = 0; i < 5; i++) {
      rows.batchRows.push(
        batch({ id: `b-${i}`, createdAt: new Date(Date.now() - i * HOUR) }),
      );
    }
    const res = await request(app)
      .get('/api/admin/payouts/batches?limit=2&offset=2')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.body.total).toBe(5);
    expect(res.body.batches.map((b: any) => b.id)).toEqual(['b-2', 'b-3']);
  });

  test('400 on invalid status / limit', async () => {
    const bad = await request(app)
      .get('/api/admin/payouts/batches?status=NOT_A_STATUS')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_STATUS');

    const badLimit = await request(app)
      .get('/api/admin/payouts/batches?limit=9999')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(badLimit.status).toBe(400);
    expect(badLimit.body.error.code).toBe('INVALID_LIMIT');
  });
});

describe('GET /batches/:id', () => {
  test('returns full row + driver, 404 when missing', async () => {
    rows.batchRows.push(batch({ id: 'b-detail', status: 'SUCCESS', paidOutAt: new Date() }));
    const res = await request(app)
      .get('/api/admin/payouts/batches/b-detail')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.batch.id).toBe('b-detail');
    expect(res.body.batch.driver.nickname).toBe('Driver One');

    const missing = await request(app)
      .get('/api/admin/payouts/batches/nope')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(missing.status).toBe(404);
  });
});

describe('GET /summary', () => {
  test('returns counts by status/trigger for 24h and 7d windows', async () => {
    rows.batchRows.push(
      batch({ id: 'b-1', status: 'SUCCESS', trigger: 'SHIFT_END', createdAt: new Date(Date.now() - 2 * HOUR), paidOutAt: new Date(Date.now() - 2 * HOUR) }),
      batch({ id: 'b-2', status: 'FAILED', trigger: 'SCHEDULED_22H', createdAt: new Date(Date.now() - 3 * HOUR) }),
      // In 7d but outside 24h:
      batch({ id: 'b-3', status: 'SUCCESS', trigger: 'SCHEDULED_22H', createdAt: new Date(Date.now() - 48 * HOUR), paidOutAt: new Date(Date.now() - 48 * HOUR) }),
    );
    const res = await request(app)
      .get('/api/admin/payouts/summary')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.last24h.byStatus).toMatchObject({ SUCCESS: 1, FAILED: 1, PENDING: 0 });
    expect(res.body.last7d.byStatus).toMatchObject({ SUCCESS: 2, FAILED: 1, PENDING: 0 });
    expect(res.body.last24h.byTrigger).toMatchObject({ SHIFT_END: 1, SCHEDULED_22H: 1 });
    expect(res.body.last7d.byTrigger).toMatchObject({ SHIFT_END: 1, SCHEDULED_22H: 2 });
  });

  test('counts stuck PENDING (older than 30 min) but not fresh PENDING', async () => {
    rows.batchRows.push(
      batch({ id: 'b-stuck', status: 'PENDING', createdAt: new Date(Date.now() - 2 * HOUR) }),
      batch({ id: 'b-fresh', status: 'PENDING', createdAt: new Date(Date.now() - 5 * 60 * 1000) }),
    );
    const res = await request(app)
      .get('/api/admin/payouts/summary')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.body.stuckPendingCount).toBe(1);
    expect(res.body.stuckThresholdMinutes).toBe(30);
  });

  test('counts reversals in 7d: reversedAt window, paidOutAt fallback for legacy rows', async () => {
    rows.batchRows.push(
      // New-style reversal: reversedAt stamped by markBatchTransferReversed.
      batch({ id: 'b-rev', status: 'FAILED', failureReason: 'transfer reversed: insufficient float', paidOutAt: new Date(Date.now() - 10 * HOUR), reversedAt: new Date(Date.now() - 9 * HOUR) }),
      // Legacy reversal (pre-reversedAt column): null reversedAt, FAILED with
      // paidOutAt in window — must stay visible via the fallback branch.
      batch({ id: 'b-rev-legacy', status: 'FAILED', failureReason: 'transfer reversed', paidOutAt: new Date(Date.now() - 20 * HOUR), reversedAt: null }),
      // Plain failure: never paid out.
      batch({ id: 'b-fail', status: 'FAILED', failureReason: 'flw 400', paidOutAt: null }),
      // Reversal older than 7d: outside the window even though paid recently
      // — reversedAt wins over the paidOutAt fallback when present.
      batch({ id: 'b-rev-old', status: 'FAILED', failureReason: 'transfer reversed', paidOutAt: new Date(Date.now() - 10 * HOUR), reversedAt: new Date(Date.now() - 10 * 24 * HOUR) }),
      // Legacy reversal older than 7d: outside the window.
      batch({ id: 'b-rev-legacy-old', status: 'FAILED', failureReason: 'transfer reversed', paidOutAt: new Date(Date.now() - 10 * 24 * HOUR), reversedAt: null }),
    );
    const res = await request(app)
      .get('/api/admin/payouts/summary')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.body.reversedCount7d).toBe(2);
  });

  test('counts held batches and frozen drivers', async () => {
    rows.batchRows.push(
      batch({ id: 'b-h1', held: true }),
      batch({ id: 'b-h2', held: true }),
      batch({ id: 'b-n', held: false }),
    );
    const res = await request(app)
      .get('/api/admin/payouts/summary')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.body.heldCount).toBe(2);
    // driver2 is frozen; the admin (also frozen: no) and driver1 are not.
    expect(res.body.frozenDriverCount).toBe(1);
  });

  test('counts open AML flags by severity; resolved flags excluded', async () => {
    rows.amlFlagRows.push(
      { id: 'f1', status: 'OPEN', severity: 'CRITICAL' },
      { id: 'f2', status: 'OPEN', severity: 'HIGH' },
      { id: 'f3', status: 'OPEN', severity: 'HIGH' },
      { id: 'f4', status: 'RESOLVED', severity: 'CRITICAL' },
      { id: 'f5', status: 'DISMISSED', severity: 'LOW' },
    );
    const res = await request(app)
      .get('/api/admin/payouts/summary')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.openAmlFlags).toEqual({ LOW: 0, MEDIUM: 0, HIGH: 2, CRITICAL: 1 });
    expect(res.body.openAmlFlagCount).toBe(3);
  });
});

describe('GET /driver/:driverId', () => {
  test('returns balance, preferences, freeze state and last 20 batches', async () => {
    rows.balanceRows.set(driverId, { driverId, pendingAmount: 12500 });
    for (let i = 0; i < 25; i++) {
      rows.batchRows.push(
        batch({ id: `b-${i}`, createdAt: new Date(Date.now() - i * HOUR) }),
      );
    }
    const res = await request(app)
      .get(`/api/admin/payouts/driver/${driverId}`)
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.driver).toMatchObject({ nickname: 'Driver One' });
    expect(res.body.pendingAmount).toBe(12500);
    // 1 completed shift + AT_SHIFT_END → training wheels force TWICE_DAILY.
    expect(res.body.storedPreference).toBe('AT_SHIFT_END');
    expect(res.body.effectivePreference).toBe('TWICE_DAILY');
    expect(res.body.trainingWheelsActive).toBe(true);
    expect(res.body.freeze.frozenAt).toBeNull();
    expect(res.body.batches).toHaveLength(20);
    expect(res.body.batches[0].id).toBe('b-0');
  });

  test('exposes freeze state for a frozen driver; zero balance defaults to 0', async () => {
    const res = await request(app)
      .get(`/api/admin/payouts/driver/${driver2Id}`)
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.pendingAmount).toBe(0);
    expect(res.body.freeze).toMatchObject({
      frozenReason: 'AML critical pattern',
      frozenBy: adminId,
      frozenCategory: 'AML_CRITICAL',
    });
    // 12 shifts → no training wheels; stored preference honored.
    expect(res.body.effectivePreference).toBe('DAILY_22H');
    expect(res.body.trainingWheelsActive).toBe(false);
  });

  test('404 for unknown driver', async () => {
    const res = await request(app)
      .get('/api/admin/payouts/driver/00000000-0000-0000-0000-000000000099')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(404);
  });
});
