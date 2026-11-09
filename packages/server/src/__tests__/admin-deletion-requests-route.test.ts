// ACCOUNT-RIGHTS-SURFACE G6 — the admin deletion-requests read.
//
// Two things matter about this endpoint and both are asserted here:
//
//   the WINDOW  — everything still open, whatever its age, plus a bounded
//     tail of executed erasures. An open request is open however long it
//     has been open; a request stuck on the same deferral for a fortnight
//     is precisely the row ops needs and must never age out of the list.
//   the SHAPE   — a flat row carrying `deferredReason`, and a real
//     nickname, because a requester is not anonymised until the erasure
//     actually runs.

jest.mock('../prisma', () => {
  const deletionRequestRows: any[] = [];
  const tx = {
    deletionRequest: {
      findMany: jest.fn(async ({ where = {}, select, orderBy }: any = {}) => {
        const matches = (r: any) =>
          (where.OR ?? [{}]).some((clause: any) => {
            if (clause.status?.not && r.status === clause.status.not) return false;
            if (typeof clause.status === 'string' && r.status !== clause.status) return false;
            if (clause.executedAt?.gte && !(r.executedAt && r.executedAt >= clause.executedAt.gte))
              return false;
            return true;
          });
        const rows = deletionRequestRows.filter(matches).map((r) => ({ ...r }));
        if (orderBy?.requestedAt === 'desc') {
          rows.sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
        }
        // Mirror the relation select the route asks for.
        return select?.user ? rows : rows.map(({ user, ...rest }: any) => rest);
      }),
    },
    __rows: { deletionRequestRows },
  };
  return { __esModule: true, default: { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) } };
});

jest.mock('../socket', () => ({ getIO: () => null }));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import adminRoutes from '../routes/admin.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import { _resetAuthStatusCacheForTests } from '../middleware/auth';
import { ADMIN_DELETION_REQUEST_HISTORY_DAYS } from '../services/admin/config';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/admin', adminRoutes);
app.use(errorHandler);

const adminId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const adminToken = generateAccessToken({ userId: adminId, role: 'ADMIN' });
const customerToken = generateAccessToken({ userId, role: 'CUSTOMER' });

const rows = (prisma as any).__rows as { deletionRequestRows: any[] };

const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms);

function seed(over: Record<string, unknown> = {}) {
  const row = {
    id: `req-${rows.deletionRequestRows.length + 1}`,
    userId,
    status: 'PENDING',
    requestedAt: ago(3 * DAY_MS),
    executesAt: ago(0),
    cancelledAt: null,
    executedAt: null,
    deferredReason: null,
    user: { nickname: 'Chantal' },
    ...over,
  };
  rows.deletionRequestRows.push(row);
  return row;
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetAuthStatusCacheForTests();
  rows.deletionRequestRows.length = 0;
});

const get = (token?: string) => {
  const req = request(app).get('/api/admin/deletion-requests');
  return token ? req.set('Cookie', [`accessToken=${token}`]) : req;
};

describe('GET /api/admin/deletion-requests — auth gate', () => {
  test('without a token → 401', async () => {
    expect((await get()).status).toBe(401);
  });

  test('without the admin role → 403', async () => {
    expect((await get(customerToken)).status).toBe(403);
  });
});

describe('GET /api/admin/deletion-requests — the window', () => {
  test('an empty queue answers with an empty list, not an error', async () => {
    const res = await get(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.requests).toEqual([]);
  });

  test('a pending request is listed with a real nickname and its reason', async () => {
    seed({ deferredReason: 'LIVE_ESCROW' });
    const res = await get(adminToken);

    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(1);
    const row = res.body.requests[0];
    expect(row.nickname).toBe('Chantal');
    expect(row.deferredReason).toBe('LIVE_ESCROW');
    expect(row.status).toBe('PENDING');
    // Flattened: the relation is a query detail, not part of the contract.
    expect(row.user).toBeUndefined();
  });

  test('an OLD pending request is still listed — open is open however long', async () => {
    seed({ requestedAt: ago(400 * DAY_MS), executesAt: ago(397 * DAY_MS) });
    const res = await get(adminToken);
    expect(res.body.requests).toHaveLength(1);
  });

  test('a cancelled request is listed', async () => {
    seed({ status: 'CANCELLED', cancelledAt: ago(2 * DAY_MS) });
    const res = await get(adminToken);
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.requests[0].status).toBe('CANCELLED');
  });

  test('a recently executed erasure is listed', async () => {
    seed({ status: 'EXECUTED', executedAt: ago(2 * DAY_MS), user: { nickname: 'Deleted User' } });
    const res = await get(adminToken);
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.requests[0].nickname).toBe('Deleted User');
  });

  test('an erasure older than the history window is not listed', async () => {
    seed({
      status: 'EXECUTED',
      executedAt: ago((ADMIN_DELETION_REQUEST_HISTORY_DAYS + 5) * DAY_MS),
    });
    const res = await get(adminToken);
    expect(res.body.requests).toEqual([]);
  });

  test('newest first', async () => {
    seed({ requestedAt: ago(10 * DAY_MS) });
    seed({ requestedAt: ago(1 * DAY_MS) });
    const res = await get(adminToken);
    expect(res.body.requests.map((r: any) => r.id)).toEqual(['req-2', 'req-1']);
  });
});
