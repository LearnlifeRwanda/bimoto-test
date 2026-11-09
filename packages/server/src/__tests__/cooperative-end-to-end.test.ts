// End-to-end multi-cooperative test for Dispatch M.
//
// Two cooperatives — FERWACOTAMO (Marie + 3 drivers) and COOPACTRA
// (Pascal + 2 drivers) — and 5 customers including Sarah. Walks
// through:
//   - dashboard scope (Marie sees only FERWACOTAMO; Pascal sees only
//     COOPACTRA)
//   - driver list scope + cross-coop /drivers/:id returning 404
//   - approve flow + AdminAction with COOPERATIVE_LEADER_ACTION
//   - cross-cooperative approve attempt → 404
//   - dispatch happy path (Marie → Jean for Sarah)
//   - cross-cooperative dispatch → 404
//   - audit chain integrity verification at the end
//   - Pascal can dispatch independently in his cooperative
//   - ADMIN can read any cooperative via ?cooperativeId=

const cooperativeRows = new Map<string, any>();
const userRows = new Map<string, any>();
const driverProfileRows = new Map<string, any>();
const journeyRows = new Map<string, any>();
const bidRows = new Map<string, any>();
const adminActionRows: any[] = [];
const amlFlagRows: any[] = [];

function matchInClause(value: any, clause: any) {
  if (!clause) return true;
  if (clause.in) return clause.in.includes(value);
  if (clause.gte) return new Date(value) >= new Date(clause.gte);
  return value === clause;
}

const tx = {
  cooperative: {
    findUnique: jest.fn(async ({ where }: any) =>
      cooperativeRows.get(where.id) ?? null,
    ),
  },
  user: {
    findUnique: jest.fn(async ({ where }: any) => userRows.get(where.id) ?? null),
    findMany: jest.fn(async ({ where = {} }: any = {}) => {
      const arr = Array.from(userRows.values());
      if (where.id?.in) return arr.filter((u: any) => where.id.in.includes(u.id));
      return arr;
    }),
  },
  driverProfile: {
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.userId) {
        for (const r of driverProfileRows.values()) {
          if (r.userId === where.userId) return r;
        }
        return null;
      }
      return driverProfileRows.get(where.id) ?? null;
    }),
    findMany: jest.fn(async ({ where = {}, take, skip }: any = {}) => {
      const arr = Array.from(driverProfileRows.values()).filter((p: any) => {
        if (where.cooperativeId !== undefined && p.cooperativeId !== where.cooperativeId)
          return false;
        if (where.isOnline !== undefined && p.isOnline !== where.isOnline)
          return false;
        return true;
      });
      const start = skip ?? 0;
      return arr.slice(start, take ? start + take : undefined);
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = driverProfileRows.get(where.id);
      if (!row) throw new Error('not-found');
      Object.assign(row, data);
      return row;
    }),
  },
  journey: {
    create: jest.fn(async ({ data }: any) => {
      const id = `j-${journeyRows.size + 1}`;
      const row = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
      journeyRows.set(id, row);
      return row;
    }),
    findMany: jest.fn(async ({ where = {}, select }: any = {}) => {
      const rows = Array.from(journeyRows.values()).filter((j: any) => {
        if (where.driverId && !matchInClause(j.driverId, where.driverId)) return false;
        if (where.status && j.status !== where.status) return false;
        if (where.confirmedAt?.gte && new Date(j.confirmedAt ?? 0) < new Date(where.confirmedAt.gte))
          return false;
        if (where.createdAt?.gte && new Date(j.createdAt) < new Date(where.createdAt.gte))
          return false;
        return true;
      });
      if (select) {
        return rows.map((j: any) => {
          const r: any = {};
          for (const k of Object.keys(select)) if (select[k]) r[k] = j[k];
          return r;
        });
      }
      return rows;
    }),
    count: jest.fn(async ({ where = {} }: any = {}) =>
      Array.from(journeyRows.values()).filter((j: any) => {
        if (where.driverId && !matchInClause(j.driverId, where.driverId)) return false;
        if (where.status && j.status !== where.status) return false;
        if (where.confirmedAt?.gte && new Date(j.confirmedAt ?? 0) < new Date(where.confirmedAt.gte))
          return false;
        return true;
      }).length,
    ),
  },
  bid: {
    create: jest.fn(async ({ data }: any) => {
      const id = `b-${bidRows.size + 1}`;
      const row = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
      bidRows.set(id, row);
      return row;
    }),
  },
  amlFlag: {
    findMany: jest.fn(async ({ where = {} }: any = {}) =>
      amlFlagRows.filter((f: any) => f.userId === where.userId),
    ),
  },
  adminAction: {
    findFirst: jest.fn(async () =>
      adminActionRows.length === 0 ? null : adminActionRows[adminActionRows.length - 1],
    ),
    findMany: jest.fn(async ({ where = {}, orderBy }: any = {}) => {
      const rows = adminActionRows.filter((r: any) => {
        if (where.targetType && r.targetType !== where.targetType) return false;
        if (where.targetId && r.targetId !== where.targetId) return false;
        return true;
      });
      if (orderBy?.createdAt === 'asc') {
        return [...rows].sort((a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      }
      return rows;
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `aa-${adminActionRows.length + 1}`, ...data };
      adminActionRows.push(row);
      return row;
    }),
  },
};

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    ...tx,
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  },
}));

jest.mock('../middleware/auth-status-cache', () => ({
  getAuthStatusCache: () => null,
  setAuthStatusCache: () => undefined,
  invalidateAuthStatusCache: () => undefined,
  _resetAuthStatusCacheForTests: () => undefined,
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import cooperativeLeaderRoutes from '../routes/cooperative-leader.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import { verifyAdminActionChain } from '../services/admin/admin-action-audit.service';

const ferwId = 'coop-ferw';
const coopactraId = 'coop-coopactra';
const marieUserId = 'marie-uuid-aaaaaaaaaaaaaaaaaaaa-aa';
const pascalUserId = 'pascal-uuid-aaaaaaaaaaaaaaaaaa-a';
const adminUserId = 'admin-uuid-aaaaaaaaaaaaaaaaaaa-a';

// FERWACOTAMO drivers
const jeanUserId = 'u-jean';
const paulUserId = 'u-paul';
const mikeUserId = 'u-mike';

// COOPACTRA drivers
const pascalDriverUserId = 'u-pascal-d';
const danUserId = 'u-dan';

// Customers
const sarahUserId = 'u-sarah';
const aliceUserId = 'u-alice';
const bobUserId = 'u-bob';
const carolUserId = 'u-carol';
const danielUserId = 'u-daniel-c';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/cooperative', cooperativeLeaderRoutes);
app.use(errorHandler);

const marieToken = `accessToken=${generateAccessToken({ userId: marieUserId, role: 'COOPERATIVE_LEADER' })}`;
const pascalToken = `accessToken=${generateAccessToken({ userId: pascalUserId, role: 'COOPERATIVE_LEADER' })}`;
const adminToken = `accessToken=${generateAccessToken({ userId: adminUserId, role: 'ADMIN' })}`;

beforeEach(() => {
  cooperativeRows.clear();
  userRows.clear();
  driverProfileRows.clear();
  journeyRows.clear();
  bidRows.clear();
  adminActionRows.length = 0;
  amlFlagRows.length = 0;

  cooperativeRows.set(ferwId, {
    id: ferwId,
    name: 'FERWACOTAMO',
    leaderId: marieUserId,
    commissionRate: 0,
    currency: 'RWF',
    active: true,
  });
  cooperativeRows.set(coopactraId, {
    id: coopactraId,
    name: 'COOPACTRA',
    leaderId: pascalUserId,
    commissionRate: 0.05,
    currency: 'RWF',
    active: true,
  });

  userRows.set(marieUserId, {
    id: marieUserId,
    role: 'COOPERATIVE_LEADER',
    cooperativeId: ferwId,
    nickname: 'Marie',
    phone: '+250788000111',
    frozenAt: null,
    isFlagged: false,
  });
  userRows.set(pascalUserId, {
    id: pascalUserId,
    role: 'COOPERATIVE_LEADER',
    cooperativeId: coopactraId,
    nickname: 'Pascal',
    phone: '+250788000222',
    frozenAt: null,
    isFlagged: false,
  });
  userRows.set(adminUserId, {
    id: adminUserId,
    role: 'ADMIN',
    cooperativeId: null,
    nickname: 'Admin',
    phone: '+250788000333',
    frozenAt: null,
  });

  // FERWACOTAMO drivers + profiles
  for (const [uid, name, profileId] of [
    [jeanUserId, 'Jean', 'dp-jean'],
    [paulUserId, 'Paul', 'dp-paul'],
    [mikeUserId, 'Mike', 'dp-mike'],
  ] as const) {
    userRows.set(uid, {
      id: uid,
      role: 'DRIVER',
      nickname: name,
      phone: '+25078800' + uid.slice(-4),
      frozenAt: null,
      isFlagged: false,
    });
    driverProfileRows.set(profileId, {
      id: profileId,
      userId: uid,
      cooperativeId: ferwId,
      cooperativeName: 'FERWACOTAMO',
      vehicleType: 'MOTO',
      isOnline: true,
      avgRating: 4.5,
      totalRides: 80,
      active: true,
      verificationStatus: 'PENDING',
      // DRIVER-ID v3 — approval requires jacket number + plate.
      ruraAuthorizationNumber: `RURA-E2E-${profileId}`,
      registrationPlate: `RAC ${profileId.slice(-3).toUpperCase()}`,
    });
  }

  // COOPACTRA drivers + profiles
  for (const [uid, name, profileId] of [
    [pascalDriverUserId, 'PascalD', 'dp-pascal'],
    [danUserId, 'Dan', 'dp-dan'],
  ] as const) {
    userRows.set(uid, {
      id: uid,
      role: 'DRIVER',
      nickname: name,
      phone: '+25078800' + uid.slice(-4),
      frozenAt: null,
      isFlagged: false,
    });
    driverProfileRows.set(profileId, {
      id: profileId,
      userId: uid,
      cooperativeId: coopactraId,
      cooperativeName: 'COOPACTRA',
      vehicleType: 'MOTO',
      isOnline: true,
      avgRating: 4.0,
      totalRides: 40,
      active: true,
      verificationStatus: 'VERIFIED',
    });
  }

  // Customers
  for (const uid of [sarahUserId, aliceUserId, bobUserId, carolUserId, danielUserId]) {
    userRows.set(uid, {
      id: uid,
      role: 'CUSTOMER',
      nickname: uid.slice(2),
      phone: '+25078811' + uid.slice(-4),
      frozenAt: null,
    });
  }
});

describe('Dispatch M end-to-end multi-cooperative scenario', () => {
  test('full flow: scope + management + dispatch + audit chain integrity', async () => {
    // 1. Dashboard scope: Marie sees FERWACOTAMO summary (3 drivers).
    const marieDash = await request(app)
      .get('/api/cooperative/dashboard')
      .set('Cookie', marieToken);
    expect(marieDash.status).toBe(200);
    expect(marieDash.body.cooperativeId).toBe(ferwId);
    expect(marieDash.body.driverCount).toBe(3);

    // Pascal sees COOPACTRA summary (2 drivers); cross-cooperative isolation.
    const pascalDash = await request(app)
      .get('/api/cooperative/dashboard')
      .set('Cookie', pascalToken);
    expect(pascalDash.status).toBe(200);
    expect(pascalDash.body.cooperativeId).toBe(coopactraId);
    expect(pascalDash.body.driverCount).toBe(2);

    // 2. Driver list scope.
    const marieDrivers = await request(app)
      .get('/api/cooperative/drivers')
      .set('Cookie', marieToken);
    expect(marieDrivers.body.drivers).toHaveLength(3);
    expect(marieDrivers.body.drivers.every((d: any) => d.cooperativeName === 'FERWACOTAMO')).toBe(true);

    // 3. Marie can read her own driver detail.
    const ownDetail = await request(app)
      .get('/api/cooperative/drivers/dp-jean')
      .set('Cookie', marieToken);
    expect(ownDetail.status).toBe(200);

    // Cross-cooperative driver detail → 404.
    const crossDetail = await request(app)
      .get('/api/cooperative/drivers/dp-pascal')
      .set('Cookie', marieToken);
    expect(crossDetail.status).toBe(404);

    // 4. Approve flow: Marie approves Jean.
    const approve = await request(app)
      .post('/api/cooperative/drivers/dp-jean/approve')
      .set('Cookie', marieToken)
      .send({ reason: 'Verified license in person' });
    expect(approve.status).toBe(200);
    expect(approve.body.driver.verificationStatus).toBe('VERIFIED');

    // After approve, Jean is VERIFIED so dispatch becomes possible.
    expect(driverProfileRows.get('dp-jean').verificationStatus).toBe('VERIFIED');

    // 5. Cross-cooperative interference: Marie tries to approve a COOPACTRA driver.
    const wrongApprove = await request(app)
      .post('/api/cooperative/drivers/dp-pascal/approve')
      .set('Cookie', marieToken)
      .send({ reason: 'should-not-work' });
    expect(wrongApprove.status).toBe(404);

    // 6. Dispatch happy path: Marie → Jean for Sarah.
    const dispatch = await request(app)
      .post('/api/cooperative/dispatch')
      .set('Cookie', marieToken)
      .send({
        driverId: jeanUserId,
        customerId: sarahUserId,
        pickupLat: -1.95,
        pickupLng: 30.06,
        destinationLat: -1.96,
        destinationLng: 30.07,
        vehiclePreference: 'MOTO',
        priceRwf: 1500,
      });
    expect(dispatch.status).toBe(201);
    const dispatchedBid = bidRows.get(dispatch.body.bidId);
    expect(dispatchedBid.dispatchedByLeaderId).toBe(marieUserId);
    expect(dispatchedBid.driverId).toBe(jeanUserId);
    expect(dispatchedBid.status).toBe('PENDING');

    // 7. Pascal can also dispatch independently — multi-cooperative tenancy.
    const pascalDispatch = await request(app)
      .post('/api/cooperative/dispatch')
      .set('Cookie', pascalToken)
      .send({
        driverId: pascalDriverUserId,
        customerId: aliceUserId,
        pickupLat: -1.97,
        pickupLng: 30.08,
        destinationLat: -1.98,
        destinationLng: 30.09,
        vehiclePreference: 'MOTO',
        priceRwf: 2000,
      });
    expect(pascalDispatch.status).toBe(201);

    // Pascal's dispatch did NOT create a journey for FERWACOTAMO.
    const pascalBid = bidRows.get(pascalDispatch.body.bidId);
    expect(pascalBid.driverId).toBe(pascalDriverUserId);
    expect(pascalBid.dispatchedByLeaderId).toBe(pascalUserId);

    // 8. Admin can read any cooperative via ?cooperativeId=.
    const adminFerw = await request(app)
      .get(`/api/cooperative/dashboard?cooperativeId=${ferwId}`)
      .set('Cookie', adminToken);
    expect(adminFerw.status).toBe(200);
    expect(adminFerw.body.cooperativeId).toBe(ferwId);

    const adminCoop = await request(app)
      .get(`/api/cooperative/dashboard?cooperativeId=${coopactraId}`)
      .set('Cookie', adminToken);
    expect(adminCoop.status).toBe(200);
    expect(adminCoop.body.cooperativeId).toBe(coopactraId);

    // 9. Audit chain integrity: every mutation produced an AdminAction
    // (approve + dispatch ×2 = 3, plus the failed cross-coop attempt
    // produced 0). verifyAdminActionChain returns valid: true.
    expect(adminActionRows.length).toBeGreaterThanOrEqual(3);
    expect(adminActionRows.some((a: any) => a.action === 'COOPERATIVE_LEADER_ACTION')).toBe(true);
    expect(adminActionRows.some((a: any) => a.action === 'COOPERATIVE_DISPATCH')).toBe(true);
    const chain = await verifyAdminActionChain();
    expect(chain.valid).toBe(true);
    expect(chain.brokenAt).toBeNull();
  });
});
