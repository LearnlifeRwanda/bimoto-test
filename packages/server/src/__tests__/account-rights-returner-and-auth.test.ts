// ACCOUNT-RIGHTS-CORE G5 — what the tombstone is FOR, and what erasure
// does to a session.
//
// Two properties that only make sense together. The tombstone exists so a
// returner can be recognised; the auth change exists so the account they
// are returning from is actually gone. Each is tested in both directions.

jest.mock('../prisma', () => {
  const db: any = {
    otpCode: {
      create: jest.fn(async ({ data }: any) => ({ id: 'otp1', ...data })),
      findFirst: jest.fn(),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    user: { findUnique: jest.fn(), create: jest.fn(async ({ data }: any) => ({ id: 'new-user', ...data })) },
    accountTombstone: { findUnique: jest.fn(async () => null) },
    refreshToken: { create: jest.fn(async () => ({})), findUnique: jest.fn(async () => null) },
  };
  return { __esModule: true, default: db };
});

jest.mock('../services/otp.service', () => ({
  sendLoginOtp: jest.fn(async () => ({ testOnlyCode: '123456' })),
  verifyLoginOtp: jest.fn(async () => ({ verified: true })),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import { verifyOtp } from '../services/auth.service';
import { authMiddleware, _resetAuthStatusCacheForTests } from '../middleware/auth';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';

const db = prisma as any;
const PHONE = '+250788555111';

beforeEach(() => {
  jest.clearAllMocks();
  _resetAuthStatusCacheForTests();
  db.user.findUnique.mockResolvedValue(null);
  db.accountTombstone.findUnique.mockResolvedValue(null);
});

/* ------------------------------------------- the returner (D19) ------- */

describe('the returner — decision D19, flag and never refuse', () => {
  test('a first-time signup with no tombstone gets a clean, unflagged account', async () => {
    const { user, isNewUser } = await verifyOtp(PHONE, '123456');

    expect(isNewUser).toBe(true);
    // CUTGUARD v2 G1 — asserted on the WRITE, not on the echo.
    //
    // These two lines used to read `user.isFlagged` / `user.flagReason`
    // off verifyOtp's return. That return is now `toClientUser(...)`,
    // which does not carry the fraud fields at all — so the old
    // assertions could only ever have said "the serializer dropped
    // them", which is a different (and weaker) claim than the one this
    // test is making. The write is the stronger oracle: it proves the
    // row was CREATED clean, not merely reported clean.
    const created = db.user.create.mock.calls[0][0].data;
    expect(created).not.toHaveProperty('isFlagged');
    expect(created).not.toHaveProperty('flagReason');
  });

  test('a returner who was NOT suspended gets a clean account too — no flag', async () => {
    db.accountTombstone.findUnique.mockResolvedValue({
      phoneHash: 'h', deletionCount: 1, wasSuspended: false, lastDeletedAt: new Date(),
    });

    const { user } = await verifyOtp(PHONE, '123456');

    // Same move as above: the write is the fact, the payload is not.
    expect(db.user.create.mock.calls[0][0].data).not.toHaveProperty('isFlagged');
  });

  test('a returner who WAS suspended is flagged with a reason — and still gets in', async () => {
    db.accountTombstone.findUnique.mockResolvedValue({
      phoneHash: 'h', deletionCount: 1, wasSuspended: true, lastDeletedAt: new Date(),
    });

    const { user, isNewUser, accessToken } = await verifyOtp(PHONE, '123456');

    // NOT refused. The account exists, the session is issued, and the app
    // works — this is the written no-auto-block policy (auth.ts) and the
    // PILOT-GUARD Item 1 correction, not a lockout.
    expect(isNewUser).toBe(true);
    expect(accessToken).toBeTruthy();
    // The flag is real and PERSISTED — the fact this test is about.
    const created = db.user.create.mock.calls[0][0].data;
    expect(created.isFlagged).toBe(true);
    expect(created.flagReason).toBe('RETURNED_AFTER_DELETION_WHILE_SUSPENDED');
    // CUTGUARD v2 G1 — and it is NOT told to the returner. A person who
    // can read their own flag can also read that deleting and re-signing
    // up is what raised it, which is the loop D19 exists to close.
    expect(user).not.toHaveProperty('isFlagged');
    expect(user).not.toHaveProperty('flagReason');
  });

  test('the tombstone is looked up by the phone HASH, not the number', async () => {
    await verifyOtp(PHONE, '123456');
    const where = db.accountTombstone.findUnique.mock.calls[0][0].where;
    expect(Object.keys(where)).toEqual(['phoneHash']);
    expect(where.phoneHash).not.toContain(PHONE);
  });

  test('an EXISTING account is not re-provisioned and never consults the tombstone', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u-existing', role: 'CUSTOMER' });

    const { isNewUser } = await verifyOtp(PHONE, '123456');

    expect(isNewUser).toBe(false);
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.accountTombstone.findUnique).not.toHaveBeenCalled();
  });
});

/* ---------------------------- erasure ends the session at auth -------- */

describe('a deleted account cannot use a still-valid access token', () => {
  const app = express();
  app.use(cookieParser());
  app.use((req, res, next) => authMiddleware(req, res, next).catch(next));
  app.get('/protected', (req, res) => res.json({ ok: true }));
  app.use(errorHandler);

  const userId = '22222222-2222-4222-8222-222222222222';
  // Minted BEFORE the erasure and still well inside its own TTL. This is
  // the exact token the pre-wave code kept honouring.
  const token = generateAccessToken({ userId, role: 'CUSTOMER' });

  test('an erased user is 401 UNAUTHORIZED even with an unexpired token', async () => {
    db.user.findUnique.mockResolvedValue({ frozenAt: null, isDeleted: true });

    const res = await request(app).get('/protected').set('Cookie', [`accessToken=${token}`]);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  test('a live user with the same token still gets through', async () => {
    db.user.findUnique.mockResolvedValue({ frozenAt: null, isDeleted: false });

    const res = await request(app).get('/protected').set('Cookie', [`accessToken=${token}`]);

    expect(res.status).toBe(200);
  });

  test('a FROZEN user still gets the distinct 403, not the deletion 401', async () => {
    // Freeze semantics are untouched by this wave: there is an account, a
    // reason and an appeal, so the answer stays 403 ACCOUNT_FROZEN.
    db.user.findUnique.mockResolvedValue({ frozenAt: new Date(), isDeleted: false });

    const res = await request(app).get('/protected').set('Cookie', [`accessToken=${token}`]);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_FROZEN');
  });

  test('both facts come off ONE query — the hot path did not gain a lookup', async () => {
    db.user.findUnique.mockResolvedValue({ frozenAt: null, isDeleted: false });

    await request(app).get('/protected').set('Cookie', [`accessToken=${token}`]);

    expect(db.user.findUnique).toHaveBeenCalledTimes(1);
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: userId },
      select: { frozenAt: true, isDeleted: true },
    });
  });

  test('the deleted verdict is cached like the frozen one — no re-query within TTL', async () => {
    db.user.findUnique.mockResolvedValue({ frozenAt: null, isDeleted: true });

    await request(app).get('/protected').set('Cookie', [`accessToken=${token}`]);
    await request(app).get('/protected').set('Cookie', [`accessToken=${token}`]);

    expect(db.user.findUnique).toHaveBeenCalledTimes(1);
  });
});
