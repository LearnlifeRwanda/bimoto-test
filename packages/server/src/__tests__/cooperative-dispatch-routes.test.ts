// Cooperative dispatch route tests — covers the route layer's
// validation + auth + error mapping. Smallest-wrongness coverage:
// dispatching a driver from another cooperative returns 404, not
// 200 and not 403, so a leader can't probe other cooperatives'
// driver IDs.

const cooperativeRows = new Map<string, any>();
const userRows = new Map<string, any>();
const driverProfileRows = new Map<string, any>();
const journeyRows = new Map<string, any>();
const bidRows = new Map<string, any>();
const adminActionRows: any[] = [];

const tx = {
  cooperative: {
    findUnique: jest.fn(async ({ where }: any) =>
      cooperativeRows.get(where.id) ?? null,
    ),
  },
  user: {
    findUnique: jest.fn(async ({ where }: any) => userRows.get(where.id) ?? null),
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
  },
  journey: {
    create: jest.fn(async ({ data }: any) => {
      const id = `j-${journeyRows.size + 1}`;
      const row = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
      journeyRows.set(id, row);
      return row;
    }),
  },
  bid: {
    create: jest.fn(async ({ data }: any) => {
      const id = `b-${bidRows.size + 1}`;
      const row = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
      bidRows.set(id, row);
      return row;
    }),
  },
  adminAction: {
    findFirst: jest.fn(async () =>
      adminActionRows.length === 0 ? null : adminActionRows[adminActionRows.length - 1],
    ),
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

const ferwId = 'coop-ferw';
const coopId = 'coop-coop';
const marieUserId = '11111111-1111-1111-1111-111111111111';
const customerUserId = '22222222-2222-2222-2222-222222222222';
const jeanUserId = 'u-jean';
const pascalUserId = 'u-pascal';
const sarahUserId = 'u-sarah';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/cooperative', cooperativeLeaderRoutes);
app.use(errorHandler);

const marieToken = `accessToken=${generateAccessToken({ userId: marieUserId, role: 'COOPERATIVE_LEADER' })}`;
const customerToken = `accessToken=${generateAccessToken({ userId: customerUserId, role: 'CUSTOMER' })}`;

const validBody = {
  driverId: jeanUserId,
  customerId: sarahUserId,
  pickupLat: -1.95,
  pickupLng: 30.06,
  destinationLat: -1.96,
  destinationLng: 30.07,
  vehiclePreference: 'MOTO',
  priceRwf: 1500,
};

beforeEach(() => {
  cooperativeRows.clear();
  userRows.clear();
  driverProfileRows.clear();
  journeyRows.clear();
  bidRows.clear();
  adminActionRows.length = 0;

  cooperativeRows.set(ferwId, { id: ferwId, name: 'FERWACOTAMO', commissionRate: 0 });
  cooperativeRows.set(coopId, { id: coopId, name: 'COOPACTRA', commissionRate: 0.05 });

  userRows.set(marieUserId, {
    id: marieUserId,
    role: 'COOPERATIVE_LEADER',
    cooperativeId: ferwId,
    frozenAt: null,
  });
  userRows.set(customerUserId, {
    id: customerUserId,
    role: 'CUSTOMER',
    cooperativeId: null,
    frozenAt: null,
  });
  userRows.set(jeanUserId, { id: jeanUserId, role: 'DRIVER', frozenAt: null });
  userRows.set(pascalUserId, { id: pascalUserId, role: 'DRIVER', frozenAt: null });
  userRows.set(sarahUserId, { id: sarahUserId, role: 'CUSTOMER', frozenAt: null });

  driverProfileRows.set('dp-jean', {
    id: 'dp-jean',
    userId: jeanUserId,
    cooperativeId: ferwId,
    vehicleType: 'MOTO',
    isOnline: true,
    verificationStatus: 'VERIFIED',
    active: true,
  });
  driverProfileRows.set('dp-pascal', {
    id: 'dp-pascal',
    userId: pascalUserId,
    cooperativeId: coopId,
    vehicleType: 'MOTO',
    isOnline: true,
    verificationStatus: 'VERIFIED',
    active: true,
  });
});

describe('POST /api/cooperative/dispatch', () => {
  test('valid payload → 201, includes journeyId/bidId/notified flags', async () => {
    const res = await request(app)
      .post('/api/cooperative/dispatch')
      .set('Cookie', marieToken)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.journeyId).toBeDefined();
    expect(res.body.bidId).toBeDefined();
    expect(res.body.notifiedDriver).toBe(true);
    expect(res.body.notifiedCustomer).toBe(true);
  });

  test('without auth → 401', async () => {
    const res = await request(app).post('/api/cooperative/dispatch').send(validBody);
    expect(res.status).toBe(401);
  });

  test('as CUSTOMER → 403', async () => {
    const res = await request(app)
      .post('/api/cooperative/dispatch')
      .set('Cookie', customerToken)
      .send(validBody);
    expect(res.status).toBe(403);
  });

  test('driver from another cooperative → 404 (smallest-wrongness)', async () => {
    const res = await request(app)
      .post('/api/cooperative/dispatch')
      .set('Cookie', marieToken)
      .send({ ...validBody, driverId: pascalUserId });
    expect(res.status).toBe(404);
    expect(journeyRows.size).toBe(0);
  });

  test('frozen driver → 422 driver-frozen', async () => {
    userRows.get(jeanUserId).frozenAt = new Date();
    const res = await request(app)
      .post('/api/cooperative/dispatch')
      .set('Cookie', marieToken)
      .send(validBody);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DRIVER_FROZEN');
  });

  test('offline driver → 422 driver-offline', async () => {
    driverProfileRows.get('dp-jean').isOnline = false;
    const res = await request(app)
      .post('/api/cooperative/dispatch')
      .set('Cookie', marieToken)
      .send(validBody);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DRIVER_OFFLINE');
  });

  test('non-existent customer → 404', async () => {
    const res = await request(app)
      .post('/api/cooperative/dispatch')
      .set('Cookie', marieToken)
      .send({ ...validBody, customerId: 'ghost-customer' });
    expect(res.status).toBe(404);
  });

  test('without priceRwf → 201 with computed estimate', async () => {
    const { priceRwf, ...withoutPrice } = validBody;
    const res = await request(app)
      .post('/api/cooperative/dispatch')
      .set('Cookie', marieToken)
      .send(withoutPrice);
    expect(res.status).toBe(201);
    expect(res.body.priceRwf).toBeGreaterThan(0);
  });

  test('priceRwf=0 → 400', async () => {
    const res = await request(app)
      .post('/api/cooperative/dispatch')
      .set('Cookie', marieToken)
      .send({ ...validBody, priceRwf: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PRICE');
  });

  test('invalid coords → 400', async () => {
    const res = await request(app)
      .post('/api/cooperative/dispatch')
      .set('Cookie', marieToken)
      .send({ ...validBody, pickupLat: 200 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_COORDS');
  });

  test('invalid vehicle preference → 400', async () => {
    const res = await request(app)
      .post('/api/cooperative/dispatch')
      .set('Cookie', marieToken)
      .send({ ...validBody, vehiclePreference: 'CAR' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_VEHICLE');
  });
});
