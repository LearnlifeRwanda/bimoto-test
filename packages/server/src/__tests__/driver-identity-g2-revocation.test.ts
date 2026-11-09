// DRIVER-ID v3 G2 — revocation end-to-end (server side).
//
// Covers: the revokeDriver transaction (REVOKED + revokedAt + isOnline
// false, SYSTEM bid withdrawal — the enum's first production writer,
// hash-chained REVOKE_DRIVER AdminAction), honest settlement through the
// standard payout path with the freeze-wins deferral, the admin route
// (auth, reason validation, 404/409 mapping), the online-toggle gate,
// and the re-application path (REVOKED -> PENDING only through the
// driver-verification submission flow).

jest.mock('../prisma', () => {
  const adminActionRows: any[] = [];
  const driverProfileRows = new Map<string, any>();
  const userRows = new Map<string, any>();
  const bidRows: any[] = [];
  const tx = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => userRows.get(where.id) ?? null),
    },
    driverProfile: {
      findUnique: jest.fn(
        async ({ where }: any) => driverProfileRows.get(where.userId) ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const row = driverProfileRows.get(where.userId);
        if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
        Object.assign(row, data);
        return row;
      }),
    },
    bid: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const b of bidRows) {
          if (
            b.driverId === where.driverId &&
            where.status.in.includes(b.status)
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
      __rows: { adminActionRows, driverProfileRows, userRows, bidRows },
    },
  };
});

jest.mock('../services/payout.service', () => ({
  firePreferenceChangeBatch: jest.fn().mockResolvedValue({
    batchId: 'batch-1',
    amount: 4200,
  }),
}));

jest.mock('../socket', () => ({ getIO: () => null }));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import adminRoutes from '../routes/admin.routes';
import userRoutes from '../routes/user.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import { revokeDriver } from '../services/driver-verification.service';
import { firePreferenceChangeBatch } from '../services/payout.service';
import { _resetAuthStatusCacheForTests } from '../middleware/auth';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);
app.use(errorHandler);

const adminId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const driverId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const adminToken = generateAccessToken({ userId: adminId, role: 'ADMIN' });
const driverToken = generateAccessToken({ userId: driverId, role: 'DRIVER' });
const customerToken = generateAccessToken({ userId: driverId, role: 'CUSTOMER' });

const rows = (prisma as any).__rows as {
  adminActionRows: any[];
  driverProfileRows: Map<string, any>;
  userRows: Map<string, any>;
  bidRows: any[];
};

function seedDriver(overrides: Record<string, unknown> = {}) {
  rows.userRows.set(adminId, { id: adminId, frozenAt: null });
  rows.userRows.set(driverId, { id: driverId, frozenAt: null });
  rows.driverProfileRows.set(driverId, {
    userId: driverId,
    verificationStatus: 'VERIFIED',
    ruraAuthorizationNumber: 'RURA-G2-1',
    registrationPlate: 'RAC 123A',
    isOnline: true,
    revokedAt: null,
    drivingLicenseNumber: 'LIC-1',
    cooperativeName: 'Coop',
    insuranceConfirmed: true,
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (firePreferenceChangeBatch as jest.Mock).mockResolvedValue({
    batchId: 'batch-1',
    amount: 4200,
  });
  rows.adminActionRows.length = 0;
  rows.bidRows.length = 0;
  rows.driverProfileRows.clear();
  rows.userRows.clear();
  _resetAuthStatusCacheForTests();
});

describe('G2 — revokeDriver service', () => {
  test('sets REVOKED + revokedAt, forces isOnline false, audits with reason', async () => {
    seedDriver();
    const result = await revokeDriver({
      driverId,
      adminId,
      reason: 'RURA authorization withdrawn by the regulator',
    });

    const profile = rows.driverProfileRows.get(driverId);
    expect(profile.verificationStatus).toBe('REVOKED');
    expect(profile.revokedAt).toBeInstanceOf(Date);
    expect(profile.isOnline).toBe(false);

    expect(rows.adminActionRows).toHaveLength(1);
    expect(rows.adminActionRows[0]).toMatchObject({
      action: 'REVOKE_DRIVER',
      targetType: 'USER',
      targetId: driverId,
      reason: 'RURA authorization withdrawn by the regulator',
    });
    expect(result.profile.verificationStatus).toBe('REVOKED');
  });

  test('withdraws every PENDING/ACCEPTED bid with withdrawnSource SYSTEM, leaves others alone', async () => {
    seedDriver();
    rows.bidRows.push(
      { id: 'b1', driverId, status: 'PENDING' },
      { id: 'b2', driverId, status: 'ACCEPTED' },
      { id: 'b3', driverId, status: 'DECLINED' },
      { id: 'b4', driverId: 'someone-else', status: 'PENDING' },
    );
    const result = await revokeDriver({ driverId, adminId, reason: 'valid reason here' });

    expect(result.withdrawnBidCount).toBe(2);
    expect(rows.bidRows[0]).toMatchObject({ status: 'WITHDRAWN', withdrawnSource: 'SYSTEM' });
    expect(rows.bidRows[1]).toMatchObject({ status: 'WITHDRAWN', withdrawnSource: 'SYSTEM' });
    expect(rows.bidRows[2].status).toBe('DECLINED');
    expect(rows.bidRows[3].status).toBe('PENDING');
    expect(rows.adminActionRows[0].payload).toEqual({ withdrawnBidCount: 2 });
  });

  test('settles a positive balance through the standard payout path (ADMIN trigger)', async () => {
    seedDriver();
    const result = await revokeDriver({ driverId, adminId, reason: 'valid reason here' });
    expect(firePreferenceChangeBatch).toHaveBeenCalledWith(driverId, 'ADMIN');
    expect(result.settlement).toEqual({
      batchId: 'batch-1',
      amount: 4200,
      deferredForFreeze: false,
    });
  });

  test('freeze wins: a frozen driver is NOT settled — deferred to unfreeze', async () => {
    seedDriver();
    rows.userRows.set(driverId, { id: driverId, frozenAt: new Date() });
    const result = await revokeDriver({ driverId, adminId, reason: 'valid reason here' });
    expect(firePreferenceChangeBatch).not.toHaveBeenCalled();
    expect(result.settlement).toEqual({
      batchId: null,
      amount: 0,
      deferredForFreeze: true,
    });
    // Revocation itself still happened — it is independent of freeze.
    expect(rows.driverProfileRows.get(driverId).verificationStatus).toBe('REVOKED');
  });

  test('refuses an already-revoked driver', async () => {
    seedDriver({ verificationStatus: 'REVOKED' });
    await expect(
      revokeDriver({ driverId, adminId, reason: 'valid reason here' }),
    ).rejects.toMatchObject({ code: 'ALREADY_REVOKED' });
  });
});

describe('G2 — POST /api/admin/verifications/:userId/revoke', () => {
  test('401 without a token, 403 for a non-admin', async () => {
    seedDriver();
    const url = `/api/admin/verifications/${driverId}/revoke`;
    const anon = await request(app).post(url).send({ reason: 'valid reason here' });
    expect(anon.status).toBe(401);
    const nonAdmin = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: 'valid reason here' });
    expect(nonAdmin.status).toBe(403);
    expect(rows.driverProfileRows.get(driverId).verificationStatus).toBe('VERIFIED');
  });

  test('400 REASON_TOO_SHORT when the reason is missing or short', async () => {
    seedDriver();
    const res = await request(app)
      .post(`/api/admin/verifications/${driverId}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('REASON_TOO_SHORT');
  });

  test('404 for a missing profile, 409 when already revoked', async () => {
    rows.userRows.set(adminId, { id: adminId, frozenAt: null });
    const missing = await request(app)
      .post('/api/admin/verifications/no-such-user/revoke')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'valid reason here' });
    expect(missing.status).toBe(404);

    seedDriver({ verificationStatus: 'REVOKED' });
    const dup = await request(app)
      .post(`/api/admin/verifications/${driverId}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'valid reason here' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_REVOKED');
  });

  test('happy path returns profile, adminAction, withdrawnBidCount and settlement', async () => {
    seedDriver();
    rows.bidRows.push({ id: 'b1', driverId, status: 'PENDING' });
    const res = await request(app)
      .post(`/api/admin/verifications/${driverId}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'RURA authorization withdrawn' });
    expect(res.status).toBe(200);
    expect(res.body.profile.verificationStatus).toBe('REVOKED');
    expect(res.body.withdrawnBidCount).toBe(1);
    expect(res.body.settlement).toEqual({
      batchId: 'batch-1',
      amount: 4200,
      deferredForFreeze: false,
    });
    expect(res.body.adminAction.action).toBe('REVOKE_DRIVER');
  });
});

describe('G2 — REVOKED gates', () => {
  test('a REVOKED driver cannot toggle back online (403), but can go offline', async () => {
    seedDriver({ verificationStatus: 'REVOKED', isOnline: false });
    const on = await request(app)
      .put('/api/users/me/online-status')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ isOnline: true });
    expect(on.status).toBe(403);
    expect(on.body.error.code).toBe('DRIVER_REVOKED');
    expect(rows.driverProfileRows.get(driverId).isOnline).toBe(false);

    const off = await request(app)
      .put('/api/users/me/online-status')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ isOnline: false });
    expect(off.status).toBe(200);
  });
});

describe('G2 — re-application is the only exit from REVOKED', () => {
  test('re-submitting verification fields resets REVOKED -> PENDING (then auto-promotes), never VERIFIED', async () => {
    seedDriver({
      verificationStatus: 'REVOKED',
      revokedAt: new Date('2026-07-08T00:00:00Z'),
    });
    const res = await request(app)
      .put('/api/users/me/driver-verification')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ ruraAuthorizationNumber: 'RURA-G2-NEW' });
    expect(res.status).toBe(200);
    // Complete submission (all fields already on file) auto-promotes the
    // re-application PENDING -> UNDER_REVIEW — the admin queue, not
    // VERIFIED.
    expect(res.body.verificationStatus).toBe('UNDER_REVIEW');
    const profile = rows.driverProfileRows.get(driverId);
    expect(profile.revokedAt).toBeNull();
    expect(profile.verificationStatus).not.toBe('VERIFIED');
  });

  test('an incomplete re-application lands in PENDING', async () => {
    seedDriver({
      verificationStatus: 'REVOKED',
      revokedAt: new Date('2026-07-08T00:00:00Z'),
      insuranceConfirmed: false,
    });
    const res = await request(app)
      .put('/api/users/me/driver-verification')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ ruraAuthorizationNumber: 'RURA-G2-NEW2' });
    expect(res.status).toBe(200);
    expect(res.body.verificationStatus).toBe('PENDING');
  });
});
