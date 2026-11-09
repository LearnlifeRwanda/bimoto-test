jest.mock('../prisma', () => {
  const adminActionRows: any[] = [];
  const driverPayoutBatchRows: any[] = [];
  const userRows = new Map<string, any>();
  const tx = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => userRows.get(where.id) ?? null),
      findMany: jest.fn(async ({ where = {} }: any = {}) => {
        return Array.from(userRows.values()).filter((u: any) => {
          if (where.frozenAt && where.frozenAt.not !== undefined) {
            return u.frozenAt !== null && u.frozenAt !== undefined;
          }
          return true;
        });
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = userRows.get(where.id) ?? { id: where.id };
        Object.assign(row, data);
        userRows.set(where.id, row);
        return row;
      }),
    },
    driverPayoutBatch: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const b of driverPayoutBatchRows) {
          if (
            b.driverId === where.driverId &&
            (where.held === undefined || b.held === where.held) &&
            (where.paidOutAt === null ? !b.paidOutAt : true) &&
            (where.status === undefined || b.status === where.status)
          ) {
            Object.assign(b, data);
            count++;
          }
        }
        return { count };
      }),
    },
    adminAction: {
      findFirst: jest.fn(async () =>
        adminActionRows.length === 0
          ? null
          : adminActionRows[adminActionRows.length - 1],
      ),
      findMany: jest.fn(async ({ where = {}, orderBy }: any = {}) => {
        const rows = adminActionRows.filter((r) => {
          if (where.targetType && r.targetType !== where.targetType) return false;
          if (where.targetId && r.targetId !== where.targetId) return false;
          return true;
        });
        if (orderBy?.createdAt === 'desc') rows.reverse();
        return rows;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `aa-${adminActionRows.length + 1}`, ...data };
        adminActionRows.push(row);
        return row;
      }),
    },
  };
  return {
    __esModule: true,
    default: {
      ...tx,
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      __rows: { adminActionRows, driverPayoutBatchRows, userRows },
    },
  };
});

jest.mock('../services/sms.service', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../socket', () => ({ getIO: () => null }));

import express from 'express';
import { encrypt } from '../utils/crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import adminFreezeRoutes from '../routes/admin-freeze.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import { sendSms } from '../services/sms.service';
import { _resetAuthStatusCacheForTests } from '../middleware/auth';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/admin/freeze', adminFreezeRoutes);
app.use(errorHandler);

const adminId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const targetId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const adminToken = generateAccessToken({ userId: adminId, role: 'ADMIN' });
const customerToken = generateAccessToken({ userId: targetId, role: 'CUSTOMER' });

const rows = (prisma as any).__rows as {
  adminActionRows: any[];
  driverPayoutBatchRows: any[];
  userRows: Map<string, any>;
};

beforeEach(() => {
  jest.clearAllMocks();
  _resetAuthStatusCacheForTests();
  rows.adminActionRows.length = 0;
  rows.driverPayoutBatchRows.length = 0;
  rows.userRows.clear();
  rows.userRows.set(adminId, { id: adminId, role: 'ADMIN', frozenAt: null });
  rows.userRows.set(targetId, {
    id: targetId,
    role: 'DRIVER',
    phoneEncrypted: encrypt('+250788111111'),
    nickname: 'TestDriver',
    frozenAt: null,
  });
});

describe('admin-freeze routes — auth gate', () => {
  test('POST freeze without token → 401', async () => {
    const res = await request(app).post(`/api/admin/freeze/${targetId}/freeze`);
    expect(res.status).toBe(401);
  });

  test('POST freeze without admin role → 403', async () => {
    const res = await request(app)
      .post(`/api/admin/freeze/${targetId}/freeze`)
      .set('Cookie', [`accessToken=${customerToken}`])
      .send({ reason: 'AML CRITICAL detected', category: 'AML_CRITICAL' });
    expect(res.status).toBe(403);
  });
});

describe('POST /freeze/:userId/freeze', () => {
  test('400 when reason < 10 chars', async () => {
    const res = await request(app)
      .post(`/api/admin/freeze/${targetId}/freeze`)
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ reason: 'short', category: 'AML_CRITICAL' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('REASON_TOO_SHORT');
  });

  test('400 when category invalid', async () => {
    const res = await request(app)
      .post(`/api/admin/freeze/${targetId}/freeze`)
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ reason: 'Long enough reason', category: 'NOT_A_CATEGORY' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CATEGORY');
  });

  test('404 when user does not exist', async () => {
    const res = await request(app)
      .post(`/api/admin/freeze/${'00000000-0000-0000-0000-000000000099'}/freeze`)
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ reason: 'AML CRITICAL detected', category: 'AML_CRITICAL' });
    expect(res.status).toBe(404);
  });

  test('200 with valid input — AdminAction created, batches held, SMS sent', async () => {
    rows.driverPayoutBatchRows.push({
      id: 'b1',
      driverId: targetId,
      paidOutAt: null,
      status: 'PENDING',
      held: false,
      amount: 5000,
    });
    const res = await request(app)
      .post(`/api/admin/freeze/${targetId}/freeze`)
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({
        reason: 'AML CRITICAL detected on payout',
        category: 'AML_CRITICAL',
        notify: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.adminAction.action).toBe('FREEZE_USER');
    expect(res.body.heldBatchCount).toBe(1);
    expect(rows.userRows.get(targetId)?.frozenAt).toBeTruthy();
    expect(rows.driverPayoutBatchRows[0].held).toBe(true);
    expect(sendSms).toHaveBeenCalledTimes(1);
  });
});

describe('POST /freeze/:userId/unfreeze', () => {
  test('200 clears frozenAt; releases held batches when releasePayouts=true', async () => {
    rows.userRows.get(targetId)!.frozenAt = new Date();
    rows.driverPayoutBatchRows.push({
      id: 'b1',
      driverId: targetId,
      paidOutAt: null,
      status: 'PENDING',
      held: true,
      amount: 5000,
    });
    const res = await request(app)
      .post(`/api/admin/freeze/${targetId}/unfreeze`)
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ reason: 'cleared after appeal review', releasePayouts: true });
    expect(res.status).toBe(200);
    expect(res.body.releasedBatchCount).toBe(1);
    expect(rows.userRows.get(targetId)?.frozenAt).toBeNull();
    expect(rows.driverPayoutBatchRows[0].held).toBe(false);
  });
});

describe('GET /freeze and detail', () => {
  test('GET / returns frozen users only', async () => {
    rows.userRows.set('frozen-1', {
      id: 'frozen-1',
      role: 'CUSTOMER',
      frozenAt: new Date(),
      frozenCategory: 'AML_CRITICAL',
    });
    const res = await request(app)
      .get('/api/admin/freeze')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
  });

  test('GET /:userId/audit returns AdminAction history', async () => {
    rows.adminActionRows.push({
      id: 'aa-1',
      adminId,
      targetType: 'USER',
      targetId,
      action: 'FREEZE_USER',
      createdAt: new Date(),
    });
    const res = await request(app)
      .get(`/api/admin/freeze/${targetId}/audit`)
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.actions).toHaveLength(1);
    expect(res.body.actions[0].action).toBe('FREEZE_USER');
  });
});
