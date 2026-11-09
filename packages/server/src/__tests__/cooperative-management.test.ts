// Operational management — approve / reject / set-active /
// add-to-cooperative / remove-from-cooperative. Verifies:
//   - own-cooperative drivers update successfully
//   - cross-cooperative driver returns 404 (privacy preserved)
//   - reject without reason → 400
//   - set-active toggles
//   - audit chain stays valid through a sequence of mutations

const cooperativeRows = new Map<string, any>();
const userRows = new Map<string, any>();
const driverProfileRows = new Map<string, any>();
const adminActionRows: any[] = [];

const tx = {
  cooperative: {
    findUnique: jest.fn(async ({ where }: any) => cooperativeRows.get(where.id) ?? null),
  },
  user: {
    findUnique: jest.fn(async ({ where }: any) => userRows.get(where.id) ?? null),
  },
  driverProfile: {
    findUnique: jest.fn(async ({ where }: any) => driverProfileRows.get(where.id) ?? null),
    update: jest.fn(async ({ where, data }: any) => {
      const row = driverProfileRows.get(where.id);
      if (!row) throw new Error('not-found');
      Object.assign(row, data);
      return row;
    }),
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
const coopId = 'coop-coop';
const marieUserId = '11111111-1111-1111-1111-111111111111';
const marieToken = `accessToken=${generateAccessToken({ userId: marieUserId, role: 'COOPERATIVE_LEADER' })}`;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/cooperative', cooperativeLeaderRoutes);
app.use(errorHandler);

beforeEach(() => {
  cooperativeRows.clear();
  userRows.clear();
  driverProfileRows.clear();
  adminActionRows.length = 0;

  cooperativeRows.set(ferwId, { id: ferwId, name: 'FERWACOTAMO', commissionRate: 0 });
  cooperativeRows.set(coopId, { id: coopId, name: 'COOPACTRA', commissionRate: 0.05 });

  userRows.set(marieUserId, {
    id: marieUserId,
    role: 'COOPERATIVE_LEADER',
    cooperativeId: ferwId,
    nickname: 'Marie',
    phone: '+250788111111',
    frozenAt: null,
  });

  // DRIVER-ID v3 — approval requires the jacket number for everyone and
  // the plate where the compliance matrix does (MOTO here), so
  // approvable fixtures carry both (unique RURA numbers per driver).
  driverProfileRows.set('dp-jean', {
    id: 'dp-jean',
    userId: 'u-jean',
    cooperativeId: ferwId,
    cooperativeName: 'FERWACOTAMO',
    vehicleType: 'MOTO',
    verificationStatus: 'PENDING',
    ruraAuthorizationNumber: 'RURA-COOP-JEAN',
    registrationPlate: 'RAC 111A',
    active: true,
  });
  // BIKE-GATE — a bicycle driver in Marie's cooperative: jacket number,
  // no plate (bicycles have none).
  driverProfileRows.set('dp-claudine', {
    id: 'dp-claudine',
    userId: 'u-claudine',
    cooperativeId: ferwId,
    cooperativeName: 'FERWACOTAMO',
    vehicleType: 'BIKE',
    verificationStatus: 'PENDING',
    ruraAuthorizationNumber: 'BM-COOP-CLAUDINE',
    registrationPlate: null,
    active: true,
  });
  driverProfileRows.set('dp-pascal', {
    id: 'dp-pascal',
    userId: 'u-pascal-d',
    cooperativeId: coopId,
    cooperativeName: 'COOPACTRA',
    vehicleType: 'MOTO',
    verificationStatus: 'PENDING',
    ruraAuthorizationNumber: 'RURA-COOP-PASCAL',
    registrationPlate: 'RAC 222B',
    active: true,
  });
});

describe('cooperative management routes', () => {
  test('POST /drivers/:id/approve own-cooperative driver → 200, AdminAction logged', async () => {
    const res = await request(app)
      .post('/api/cooperative/drivers/dp-jean/approve')
      .set('Cookie', marieToken)
      .send({ reason: 'License confirmed in person' });
    expect(res.status).toBe(200);
    expect(res.body.driver.verificationStatus).toBe('VERIFIED');
    expect(adminActionRows).toHaveLength(1);
    expect(adminActionRows[0].action).toBe('COOPERATIVE_LEADER_ACTION');
    expect(adminActionRows[0].targetType).toBe('DRIVER_PROFILE');
    expect(adminActionRows[0].targetId).toBe('dp-jean');
  });

  test('POST /drivers/:id/approve BIKE driver with jacket number and no plate → 200 (BIKE-GATE)', async () => {
    const res = await request(app)
      .post('/api/cooperative/drivers/dp-claudine/approve')
      .set('Cookie', marieToken)
      .send({ reason: 'Bicycle driver, jacket issued' });
    expect(res.status).toBe(200);
    expect(res.body.driver.verificationStatus).toBe('VERIFIED');
  });

  test('POST /drivers/:id/approve BIKE driver without a jacket number → 422 (identifier is vehicle-independent)', async () => {
    driverProfileRows.get('dp-claudine').ruraAuthorizationNumber = null;
    const res = await request(app)
      .post('/api/cooperative/drivers/dp-claudine/approve')
      .set('Cookie', marieToken)
      .send({ reason: 'should not work' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DRIVER_MISSING_IDENTIFIERS');
    expect(res.body.error.details).toEqual({ missing: ['ruraAuthorizationNumber'] });
  });

  test('POST /drivers/:id/approve for COOPACTRA driver as Marie → 404 (smallest-wrongness)', async () => {
    const res = await request(app)
      .post('/api/cooperative/drivers/dp-pascal/approve')
      .set('Cookie', marieToken)
      .send({ reason: 'should-not-work' });
    expect(res.status).toBe(404);
    expect(adminActionRows).toHaveLength(0);
  });

  test('POST /drivers/:id/reject without reason → 400', async () => {
    const res = await request(app)
      .post('/api/cooperative/drivers/dp-jean/reject')
      .set('Cookie', marieToken)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('REASON_TOO_SHORT');
  });

  test('POST /drivers/:id/reject with reason → 200, status REJECTED', async () => {
    const res = await request(app)
      .post('/api/cooperative/drivers/dp-jean/reject')
      .set('Cookie', marieToken)
      .send({ reason: 'License missing' });
    expect(res.status).toBe(200);
    expect(res.body.driver.verificationStatus).toBe('REJECTED');
  });

  test('POST /drivers/:id/set-active toggles active flag', async () => {
    const res = await request(app)
      .post('/api/cooperative/drivers/dp-jean/set-active')
      .set('Cookie', marieToken)
      .send({ active: false });
    expect(res.status).toBe(200);
    expect(res.body.driver.active).toBe(false);
    expect(adminActionRows).toHaveLength(1);
    expect(adminActionRows[0].payload).toMatchObject({ subaction: 'SET_ACTIVE', active: false });
  });

  test('POST /drivers/:id/set-active without flag → 400', async () => {
    const res = await request(app)
      .post('/api/cooperative/drivers/dp-jean/set-active')
      .set('Cookie', marieToken)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ACTIVE_FLAG');
  });

  test('POST /drivers/:id/remove-from-cooperative clears cooperativeId/Name', async () => {
    const res = await request(app)
      .post('/api/cooperative/drivers/dp-jean/remove-from-cooperative')
      .set('Cookie', marieToken)
      .send({ reason: 'leaving cooperative' });
    expect(res.status).toBe(200);
    expect(res.body.driver.cooperativeId).toBeNull();
    expect(res.body.driver.cooperativeName).toBeNull();
  });

  test('audit chain integrity: approve + set-active + reject sequence keeps chain valid', async () => {
    await request(app)
      .post('/api/cooperative/drivers/dp-jean/approve')
      .set('Cookie', marieToken)
      .send({ reason: 'ok' });
    await request(app)
      .post('/api/cooperative/drivers/dp-jean/set-active')
      .set('Cookie', marieToken)
      .send({ active: false, reason: 'temporary suspension' });
    await request(app)
      .post('/api/cooperative/drivers/dp-jean/reject')
      .set('Cookie', marieToken)
      .send({ reason: 'expired license' });
    expect(adminActionRows).toHaveLength(3);
    const result = await verifyAdminActionChain();
    expect(result.valid).toBe(true);
  });
});
