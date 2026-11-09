// DRIVER-ID v3 G4 — vehicle-change honesty.
//
// Covers: the self-service PUT update path writes an old->new
// VehicleChangeLog row on every actual change (and none on a no-op),
// the 409 guard defers changes during an active journey or open bid,
// the account-deletion write bypasses guard and ledger, and
// getBidsForJourney's vehicleUpdatedRecently flag uses the 7-day
// window (fixture clock).

jest.mock('../prisma', () => {
  const vehicleChangeLogRows: any[] = [];
  const driverProfileRows = new Map<string, any>();
  let journeyFindFirstResult: any = null;
  let bidFindFirstResult: any = null;
  const tx = {
    user: {
      // ACCOUNT-RIGHTS-CORE G3 — executeErasure reads the original
      // phoneHash and the blocking-state columns here before anything
      // overwrites them. The extra fields are inert for the auth
      // middleware, which still reads only frozenAt (and now isDeleted).
      findUnique: jest.fn(async () => ({
        id: 'driver-1',
        frozenAt: null,
        isDeleted: false,
        phoneHash: 'hashed:+250788000001',
        suspendedUntil: null,
      })),
      update: jest.fn(async ({ data }: any) => ({ id: 'u', ...data })),
    },
    // ACCOUNT-RIGHTS-CORE G3 — the rest of the erasure transaction.
    accountTombstone: { upsert: jest.fn(async () => ({ deletionCount: 1 })) },
    deviceToken: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    otpCode: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    refreshToken: { updateMany: jest.fn(async () => ({ count: 0 })) },
    deletionRequest: {
      findFirst: jest.fn(async () => null),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    driverProfile: {
      findUnique: jest.fn(
        async ({ where }: any) => driverProfileRows.get(where.userId) ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const row = driverProfileRows.get(where.userId);
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    journey: {
      findFirst: jest.fn(async () => journeyFindFirstResult),
    },
    bid: {
      findFirst: jest.fn(async () => bidFindFirstResult),
    },
    // LAUNCH-TRUTH G3 — getBidsForJourney resolves fee waivers per
    // bidding driver; default to no waiver.
    feeWaiver: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    vehicleChangeLog: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `vcl-${vehicleChangeLogRows.length + 1}`, changedAt: new Date(), ...data };
        vehicleChangeLogRows.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        vehicleChangeLogRows
          .filter(
            (r) =>
              where.driverId.in.includes(r.driverId) &&
              r.changedAt >= where.changedAt.gte,
          )
          .map((r) => ({ driverId: r.driverId })),
      ),
    },
  };
  return {
    __esModule: true,
    default: {
      ...tx,
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      __rows: { vehicleChangeLogRows, driverProfileRows },
      __setGuards: (j: any, b: any) => {
        journeyFindFirstResult = j;
        bidFindFirstResult = b;
      },
    },
  };
});

jest.mock('../utils/crypto', () => ({
  encrypt: jest.fn((text: string) => `encrypted:${text}`),
  hashPhone: jest.fn((text: string) => `hashed:${text}`),
  decrypt: jest.fn((text: string) => text),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import userRoutes from '../routes/user.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import { updateDriverVehicle } from '../services/user.service';
import { executeErasure } from '../services/account-deletion.service';

const mockPrisma = prisma as any;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/users', userRoutes);
app.use(errorHandler);

const driverId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const driverToken = generateAccessToken({ userId: driverId, role: 'DRIVER' });

function seedProfile(overrides: Record<string, unknown> = {}) {
  mockPrisma.__rows.driverProfileRows.set(driverId, {
    userId: driverId,
    vehicleType: 'MOTO',
    registrationPlate: 'RAC 123A',
    vehicleDescription: 'Honda CB125 - Red',
    verificationStatus: 'VERIFIED',
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.__rows.vehicleChangeLogRows.length = 0;
  mockPrisma.__rows.driverProfileRows.clear();
  mockPrisma.__setGuards(null, null);
});

describe('G4 — updateDriverVehicle writes the ledger', () => {
  test('an actual change writes one old->new VehicleChangeLog row', async () => {
    seedProfile();
    await updateDriverVehicle(driverId, {
      vehicleType: 'MOTO',
      registrationPlate: 'RAD 456B',
      vehicleDescription: 'Yamaha - Blue',
    });
    const logs = mockPrisma.__rows.vehicleChangeLogRows;
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      driverId,
      oldVehicleType: 'MOTO',
      newVehicleType: 'MOTO',
      oldPlate: 'RAC 123A',
      newPlate: 'RAD 456B',
      oldDescription: 'Honda CB125 - Red',
      newDescription: 'Yamaha - Blue',
    });
  });

  test('a no-op save (identical values) writes no ledger row', async () => {
    seedProfile();
    await updateDriverVehicle(driverId, {
      vehicleType: 'MOTO',
      registrationPlate: 'RAC 123A',
      vehicleDescription: 'Honda CB125 - Red',
    });
    expect(mockPrisma.__rows.vehicleChangeLogRows).toHaveLength(0);
  });
});

describe('G4 — the guard defers, never forbids', () => {
  test('409 during an active journey', async () => {
    seedProfile();
    mockPrisma.__setGuards({ id: 'j1' }, null);
    const res = await request(app)
      .put('/api/users/me/driver-profile')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ vehicleType: 'MOTO', registrationPlate: 'RAD 456B', vehicleDescription: 'Yamaha' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VEHICLE_CHANGE_BLOCKED');
    expect(mockPrisma.__rows.vehicleChangeLogRows).toHaveLength(0);
    expect(mockPrisma.__rows.driverProfileRows.get(driverId).registrationPlate).toBe('RAC 123A');
  });

  test('409 during an open bid', async () => {
    seedProfile();
    mockPrisma.__setGuards(null, { id: 'b1' });
    const res = await request(app)
      .put('/api/users/me/driver-profile')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ vehicleType: 'MOTO', registrationPlate: 'RAD 456B', vehicleDescription: 'Yamaha' });
    expect(res.status).toBe(409);
  });

  test('allowed (200 + ledger row) once nothing is active', async () => {
    seedProfile();
    mockPrisma.__setGuards(null, null);
    const res = await request(app)
      .put('/api/users/me/driver-profile')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ vehicleType: 'MOTO', registrationPlate: 'RAD 456B', vehicleDescription: 'Yamaha' });
    expect(res.status).toBe(200);
    expect(res.body.registrationPlate).toBe('RAD 456B');
    expect(mockPrisma.__rows.vehicleChangeLogRows).toHaveLength(1);
  });

  test('400 INVALID_VEHICLE_TYPE for a value outside the enum', async () => {
    seedProfile();
    const res = await request(app)
      .put('/api/users/me/driver-profile')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ vehicleType: 'ROCKET', registrationPlate: 'RAD 456B', vehicleDescription: 'Yamaha' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_VEHICLE_TYPE');
    expect(mockPrisma.__rows.vehicleChangeLogRows).toHaveLength(0);
  });

  test('404 without a driver profile', async () => {
    const res = await request(app)
      .put('/api/users/me/driver-profile')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ vehicleType: 'MOTO', registrationPlate: 'RAD 456B', vehicleDescription: 'Yamaha' });
    expect(res.status).toBe(404);
  });
});

describe('G4 — account deletion bypasses guard and ledger', () => {
  // ACCOUNT-RIGHTS-CORE G3 — the erasure moved out of the DELETE handler
  // into account-deletion.service, because DELETE now opens the 72-hour
  // window instead of erasing. The DRIVER-ID G4 property this test
  // defends is unchanged and still asserted: the erasure writes the
  // driver profile directly, bypassing updateDriverVehicle's
  // active-journey guard and its ledger, because it is an erasure and
  // not a vehicle switch.
  test('erasure succeeds even with an active journey and writes no VehicleChangeLog', async () => {
    seedProfile();
    // An active journey would 409 the vehicle-update path — deletion
    // must not care (it is an erasure, not a switch).
    mockPrisma.__setGuards({ id: 'j1' }, null);
    await executeErasure('driver-1');
    expect(mockPrisma.driverProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          registrationPlate: null,
          vehicleDescription: 'Deleted',
        }),
      }),
    );
    expect(mockPrisma.__rows.vehicleChangeLogRows).toHaveLength(0);
    expect(mockPrisma.vehicleChangeLog.create).not.toHaveBeenCalled();
  });
});

describe('G4 — vehicleUpdatedRecently window (fixture clock)', () => {
  test('true for a change 6 days ago, false for 8 days ago', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    mockPrisma.__rows.vehicleChangeLogRows.push(
      { driverId: 'recent-driver', changedAt: new Date(Date.now() - 6 * DAY) },
      { driverId: 'stale-driver', changedAt: new Date(Date.now() - 8 * DAY) },
    );

    // Minimal getBidsForJourney fixtures: journey + customer + two bids.
    mockPrisma.journey = { findUnique: jest.fn(async () => ({ id: 'j1', customerId: 'c1' })) };
    mockPrisma.user.findUnique = jest.fn(async () => ({ id: 'c1', completedRides: 0 }));
    mockPrisma.bid.findMany = jest.fn(async () => [
      {
        id: 'b1', journeyId: 'j1', driverId: 'recent-driver', price: 1000, etaMinutes: 5,
        status: 'PENDING', createdAt: new Date(), updatedAt: new Date(),
        driver: { nickname: 'Recent', driverProfile: { avgRating: 4.5, totalRides: 10, vehicleType: 'MOTO', vehicleDescription: 'Honda', registrationPlate: 'RAC 1', verificationStatus: 'VERIFIED', ruraAuthorizationNumber: 'R-1', insuranceConfirmed: true, cooperativeName: null } },
      },
      {
        id: 'b2', journeyId: 'j1', driverId: 'stale-driver', price: 1100, etaMinutes: 6,
        status: 'PENDING', createdAt: new Date(), updatedAt: new Date(),
        driver: { nickname: 'Stale', driverProfile: { avgRating: 4.0, totalRides: 20, vehicleType: 'MOTO', vehicleDescription: 'Yamaha', registrationPlate: 'RAC 2', verificationStatus: 'VERIFIED', ruraAuthorizationNumber: 'R-2', insuranceConfirmed: true, cooperativeName: null } },
      },
    ]);

    // Import lazily so the reassigned prisma mocks above are in place.
    const bidService = await import('../services/bid.service');
    const bids = await bidService.getBidsForJourney('j1');
    expect(bids[0].driver.vehicleUpdatedRecently).toBe(true);
    expect(bids[1].driver.vehicleUpdatedRecently).toBe(false);
  });
});
