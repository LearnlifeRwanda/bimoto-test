// Smallest-wrongness gate for Dispatch M's tenancy boundary.
//
// Marie leads FERWACOTAMO, Pascal leads COOPACTRA. The tests below
// verify that:
//   - requireCooperativeLeader role-gates correctly across all roles
//   - assertDriverInCooperative throws for cross-cooperative drivers
//     and returns silently for own-cooperative drivers
//   - getRequestCooperativeId reads from req.user.cooperativeId
//
// If this file fails after a refactor, STOP and fix it before
// touching anything else. Cross-cooperative leakage is the dispatch's
// non-negotiable.

const userRows = new Map<string, any>();
const driverProfileRows = new Map<string, any>();

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn(async ({ where }: any) => userRows.get(where.id) ?? null),
    },
    driverProfile: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return driverProfileRows.get(where.id) ?? null;
        if (where.userId) {
          for (const r of driverProfileRows.values()) {
            if (r.userId === where.userId) return r;
          }
        }
        return null;
      }),
    },
  },
}));

jest.mock('../middleware/auth-status-cache', () => ({
  getAuthStatusCache: () => null,
  setAuthStatusCache: () => undefined,
  invalidateAuthStatusCache: () => undefined,
  _resetAuthStatusCacheForTests: () => undefined,
}));

import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import { authMiddleware, requireCooperativeLeader } from '../middleware/auth';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import {
  assertDriverInCooperative,
  AuthorizationError,
  getRequestCooperativeId,
} from '../services/cooperative/scope';

const ferwacotamoId = 'coop-ferwacotamo';
const coopactraId = 'coop-coopactra';

const marieUserId = '11111111-1111-1111-1111-111111111111';
const pascalUserId = '22222222-2222-2222-2222-222222222222';
const customerUserId = '33333333-3333-3333-3333-333333333333';
const driverUserId = '44444444-4444-4444-4444-444444444444';
const adminUserId = '55555555-5555-5555-5555-555555555555';
const orphanLeaderUserId = '66666666-6666-6666-6666-666666666666';

const driverFerwacotamoProfileId = 'dp-ferw-1';
const driverCoopactraProfileId = 'dp-coop-1';

beforeEach(() => {
  userRows.clear();
  driverProfileRows.clear();
  userRows.set(marieUserId, {
    id: marieUserId,
    role: 'COOPERATIVE_LEADER',
    cooperativeId: ferwacotamoId,
  });
  userRows.set(pascalUserId, {
    id: pascalUserId,
    role: 'COOPERATIVE_LEADER',
    cooperativeId: coopactraId,
  });
  userRows.set(customerUserId, {
    id: customerUserId,
    role: 'CUSTOMER',
    cooperativeId: null,
  });
  userRows.set(driverUserId, {
    id: driverUserId,
    role: 'DRIVER',
    cooperativeId: null,
  });
  userRows.set(adminUserId, {
    id: adminUserId,
    role: 'ADMIN',
    cooperativeId: null,
  });
  userRows.set(orphanLeaderUserId, {
    id: orphanLeaderUserId,
    role: 'COOPERATIVE_LEADER',
    cooperativeId: null,
  });
  driverProfileRows.set(driverFerwacotamoProfileId, {
    id: driverFerwacotamoProfileId,
    cooperativeId: ferwacotamoId,
  });
  driverProfileRows.set(driverCoopactraProfileId, {
    id: driverCoopactraProfileId,
    cooperativeId: coopactraId,
  });
});

function appWithProtectedHandler() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.get(
    '/protected',
    authMiddleware,
    requireCooperativeLeader,
    (req: Request, res: Response) => {
      res.json({
        ok: true,
        userId: req.user?.userId,
        role: req.user?.role,
        cooperativeId: req.user?.cooperativeId,
      });
    },
  );
  app.use(errorHandler);
  return app;
}

function tokenCookie(userId: string, role: string) {
  return [`accessToken=${generateAccessToken({ userId, role })}`];
}

describe('requireCooperativeLeader middleware', () => {
  test('without auth → 401', async () => {
    const res = await request(appWithProtectedHandler()).get('/protected');
    expect(res.status).toBe(401);
  });

  test('as CUSTOMER → 403 cooperative-leader-role-required', async () => {
    const res = await request(appWithProtectedHandler())
      .get('/protected')
      .set('Cookie', tokenCookie(customerUserId, 'CUSTOMER'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COOPERATIVE_LEADER_ROLE_REQUIRED');
  });

  test('as DRIVER → 403', async () => {
    const res = await request(appWithProtectedHandler())
      .get('/protected')
      .set('Cookie', tokenCookie(driverUserId, 'DRIVER'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COOPERATIVE_LEADER_ROLE_REQUIRED');
  });

  test('as ADMIN → next() with cooperativeId from query', async () => {
    const res = await request(appWithProtectedHandler())
      .get(`/protected?cooperativeId=${ferwacotamoId}`)
      .set('Cookie', tokenCookie(adminUserId, 'ADMIN'));
    expect(res.status).toBe(200);
    expect(res.body.cooperativeId).toBe(ferwacotamoId);
  });

  test('as COOPERATIVE_LEADER without cooperativeId → 403 no-cooperative-assigned', async () => {
    const res = await request(appWithProtectedHandler())
      .get('/protected')
      .set('Cookie', tokenCookie(orphanLeaderUserId, 'COOPERATIVE_LEADER'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NO_COOPERATIVE_ASSIGNED');
  });

  test('as Marie (FERWACOTAMO leader) → next() with her cooperativeId', async () => {
    const res = await request(appWithProtectedHandler())
      .get('/protected')
      .set('Cookie', tokenCookie(marieUserId, 'COOPERATIVE_LEADER'));
    expect(res.status).toBe(200);
    expect(res.body.cooperativeId).toBe(ferwacotamoId);
  });
});

describe('assertDriverInCooperative — smallest-wrongness gate', () => {
  test('cross-cooperative driver → throws AuthorizationError (NOT silently passes)', async () => {
    await expect(
      assertDriverInCooperative(
        prisma as any,
        driverCoopactraProfileId,
        ferwacotamoId,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  test('own-cooperative driver → returns (no throw)', async () => {
    await expect(
      assertDriverInCooperative(
        prisma as any,
        driverFerwacotamoProfileId,
        ferwacotamoId,
      ),
    ).resolves.toBeUndefined();
  });

  test('non-existent driverProfileId → throws AuthorizationError', async () => {
    await expect(
      assertDriverInCooperative(prisma as any, 'ghost', ferwacotamoId),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('getRequestCooperativeId', () => {
  test('returns user.cooperativeId when set', () => {
    const fakeReq = {
      user: { userId: 'u', role: 'COOPERATIVE_LEADER', cooperativeId: 'X' },
    } as any;
    expect(getRequestCooperativeId(fakeReq)).toBe('X');
  });

  test('returns null when no user', () => {
    expect(getRequestCooperativeId({} as any)).toBeNull();
  });
});
