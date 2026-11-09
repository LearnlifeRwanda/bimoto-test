// PREPROTO-AUTH G6 — cross-origin Bearer-token flow. The Capacitor app
// (origin https://localhost) cannot use the httpOnly cookies, so
// verify-otp/refresh return tokens in the body and refresh/logout accept
// the refresh token from the body. These tests drive the real routes +
// services with an in-memory store and never send a cookie.

jest.mock('../prisma', () => {
  const otpRows: any[] = [];
  const refreshRows: any[] = [];
  const userRows = new Map<string, any>();
  const refreshToken = {
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `rt-${refreshRows.length + 1}`, revokedAt: null, replacedByJti: null, createdAt: new Date(), ...data };
      refreshRows.push(row);
      return row;
    }),
    findUnique: jest.fn(async ({ where }: any) => refreshRows.find((r) => r.jti === where.jti) ?? null),
    update: jest.fn(async ({ where, data }: any) => {
      const row = refreshRows.find((r) => r.jti === where.jti);
      Object.assign(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const r of refreshRows) {
        if (where.familyId && r.familyId !== where.familyId) continue;
        if (where.userId && r.userId !== where.userId) continue;
        if (where.revokedAt === null && r.revokedAt !== null) continue;
        Object.assign(r, data);
        count++;
      }
      return { count };
    }),
  };
  return {
    __esModule: true,
    default: {
      otpCode: {
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `otp-${otpRows.length + 1}`, used: false, attemptCount: 0, createdAt: new Date(), ...data };
          otpRows.push(row);
          return row;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          const now = new Date();
          const matches = otpRows
            .filter(
              (r) =>
                r.phoneHash === where.phoneHash &&
                r.purpose === where.purpose &&
                r.used === where.used &&
                r.expiresAt >= now,
            )
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return matches[0] ?? null;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = otpRows.find((r) => r.id === where.id);
          Object.assign(row, data);
          return row;
        }),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      refreshToken,
      // ACCOUNT-RIGHTS-CORE G3 — registration reads the tombstone to apply
      // the D19 returner policy. No tombstone in these fixtures, so the
      // account below is an ordinary first-time signup and the
      // cross-origin Bearer flow this file asserts is unchanged.
      accountTombstone: {
        findUnique: jest.fn(async () => null),
      },
      user: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.phoneHash) {
            return Array.from(userRows.values()).find((u) => u.phoneHash === where.phoneHash) ?? null;
          }
          return userRows.get(where.id) ?? null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `user-${userRows.size + 1}`, frozenAt: null, ...data };
          userRows.set(row.id, row);
          return row;
        }),
      },
      $transaction: jest.fn(async (ops: any) => (typeof ops === 'function' ? ops({ refreshToken }) : Promise.all(ops))),
      __rows: { otpRows, refreshRows, userRows },
    },
  };
});

jest.mock('../services/sms.service', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import { sendSms } from '../services/sms.service';
import authRoutes from '../routes/auth.routes';
import { authMiddleware } from '../middleware/auth';
import { errorHandler } from '../middleware/error-handler';
import { _resetAuthStatusCacheForTests } from '../middleware/auth';

const sms = sendSms as jest.Mock;
const rows = (prisma as any).__rows as { otpRows: any[]; refreshRows: any[]; userRows: Map<string, any> };

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.get('/api/whoami', authMiddleware, (req, res) => {
    res.json({ userId: req.user!.userId });
  });
  app.use(errorHandler);
  return app;
}

function lastSmsCode(): string {
  const body: string = sms.mock.calls[sms.mock.calls.length - 1][1];
  return body.match(/(\d{6})/)![1];
}

beforeEach(() => {
  jest.clearAllMocks();
  rows.otpRows.length = 0;
  rows.refreshRows.length = 0;
  rows.userRows.clear();
  _resetAuthStatusCacheForTests();
});

describe('cross-origin Bearer flow (G6)', () => {
  test('login returns tokens in the body; Bearer works with no cookie at all', async () => {
    const app = makeApp();
    await request(app).post('/api/auth/request-otp').send({ phone: '+250788123456' });

    const verify = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '+250788123456', otp: lastSmsCode() });

    expect(verify.status).toBe(200);
    expect(verify.body.accessToken).toBeDefined();
    expect(verify.body.refreshToken).toBeDefined();
    expect(verify.body.user).toBeDefined();

    // Authenticated request by Bearer only — deliberately no Cookie header.
    const whoami = await request(app)
      .get('/api/whoami')
      .set('Authorization', `Bearer ${verify.body.accessToken}`);
    expect(whoami.status).toBe(200);
    expect(whoami.body.userId).toBe(verify.body.user.id);
  });

  test('refresh accepts the token from the JSON body and rotates it', async () => {
    const app = makeApp();
    await request(app).post('/api/auth/request-otp').send({ phone: '+250788123456' });
    const verify = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '+250788123456', otp: lastSmsCode() });

    const refresh = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: verify.body.refreshToken });

    expect(refresh.status).toBe(200);
    expect(refresh.body.accessToken).toBeDefined();
    expect(refresh.body.refreshToken).toBeDefined();
    expect(refresh.body.refreshToken).not.toBe(verify.body.refreshToken);

    // The rotated-out token is dead; replaying it revokes the family.
    const replay = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: verify.body.refreshToken });
    expect(replay.status).toBe(401);

    const afterTheft = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: refresh.body.refreshToken });
    expect(afterTheft.status).toBe(401);
  });

  test('refresh accepts the token from an Authorization Bearer header', async () => {
    const app = makeApp();
    await request(app).post('/api/auth/request-otp').send({ phone: '+250788123456' });
    const verify = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '+250788123456', otp: lastSmsCode() });

    const refresh = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${verify.body.refreshToken}`);
    expect(refresh.status).toBe(200);
    expect(refresh.body.accessToken).toBeDefined();
  });

  test('logout with the token in the body revokes it server-side', async () => {
    const app = makeApp();
    await request(app).post('/api/auth/request-otp').send({ phone: '+250788123456' });
    const verify = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '+250788123456', otp: lastSmsCode() });

    const logout = await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: verify.body.refreshToken });
    expect(logout.status).toBe(200);

    const refresh = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: verify.body.refreshToken });
    expect(refresh.status).toBe(401);
  });

  test('a frozen user cannot refresh by body token (403 ACCOUNT_FROZEN)', async () => {
    const app = makeApp();
    await request(app).post('/api/auth/request-otp').send({ phone: '+250788123456' });
    const verify = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '+250788123456', otp: lastSmsCode() });

    rows.userRows.get(verify.body.user.id).frozenAt = new Date();
    const refresh = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: verify.body.refreshToken });
    expect(refresh.status).toBe(403);
    expect(refresh.body.error.code).toBe('ACCOUNT_FROZEN');
  });
});
