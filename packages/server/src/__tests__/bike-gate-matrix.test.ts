// BIKE-GATE G4 — the approval gate is compliance-driven.
//
// Matrix: the person identifier (jacket number, stored in
// ruraAuthorizationNumber) is mandatory at approval for EVERY vehicle
// type — identity is person-bound, not vehicle-bound — while the
// registration plate is required only where the vehicle-compliance
// matrix says registrationRequired (MOTO, E_MOTO). REVOKED blocks
// approval for all types. Covers the gate function, the admin approve
// route, and the vehicle-aware PENDING -> UNDER_REVIEW auto-promote of
// the driver-verification submission. (The cooperative-leader approve
// caller is covered in cooperative-management.test.ts.)

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: {
      // authMiddleware consults frozenAt on every request.
      findUnique: jest.fn().mockResolvedValue({ frozenAt: null }),
    },
    driverProfile: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import adminRoutes from '../routes/admin.routes';
import userRoutes from '../routes/user.routes';
import { errorHandler, AppError } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import { assertDriverApprovable } from '../services/driver-verification.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);
app.use(errorHandler);

const adminToken = generateAccessToken({
  userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  role: 'ADMIN',
});
const driverToken = generateAccessToken({
  userId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  role: 'DRIVER',
});

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ frozenAt: null });
});

describe('BIKE-GATE — assertDriverApprovable matrix', () => {
  const profile = (overrides: Record<string, unknown>) => ({
    verificationStatus: 'UNDER_REVIEW',
    vehicleType: 'MOTO',
    ruraAuthorizationNumber: 'BM-9001',
    registrationPlate: 'RAC 900A',
    ...overrides,
  });

  test('BIKE with a jacket number and no plate is approvable', () => {
    expect(() =>
      assertDriverApprovable(
        profile({ vehicleType: 'BIKE', registrationPlate: null }),
      ),
    ).not.toThrow();
  });

  test('E_BIKE with a jacket number and no plate is approvable', () => {
    expect(() =>
      assertDriverApprovable(
        profile({ vehicleType: 'E_BIKE', registrationPlate: null }),
      ),
    ).not.toThrow();
  });

  test('BIKE without the jacket number is rejected — the identifier is vehicle-independent', () => {
    try {
      assertDriverApprovable(
        profile({
          vehicleType: 'BIKE',
          ruraAuthorizationNumber: null,
          registrationPlate: null,
        }),
      );
      throw new Error('expected AppError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe('DRIVER_MISSING_IDENTIFIERS');
      // The missing list is correctly shorter for bikes: no plate entry.
      expect(err.details).toEqual({ missing: ['ruraAuthorizationNumber'] });
    }
  });

  test.each(['MOTO', 'E_MOTO'])(
    '%s without identifier and plate is rejected with both in the missing list',
    (vehicleType) => {
      try {
        assertDriverApprovable(
          profile({
            vehicleType,
            ruraAuthorizationNumber: null,
            registrationPlate: null,
          }),
        );
        throw new Error('expected AppError');
      } catch (err: any) {
        expect(err.statusCode).toBe(422);
        expect(err.code).toBe('DRIVER_MISSING_IDENTIFIERS');
        expect(err.details).toEqual({
          missing: ['ruraAuthorizationNumber', 'registrationPlate'],
        });
      }
    },
  );

  test.each(['MOTO', 'E_MOTO'])(
    '%s with identifier but no plate is still rejected',
    (vehicleType) => {
      try {
        assertDriverApprovable(
          profile({ vehicleType, registrationPlate: null }),
        );
        throw new Error('expected AppError');
      } catch (err: any) {
        expect(err.statusCode).toBe(422);
        expect(err.details).toEqual({ missing: ['registrationPlate'] });
      }
    },
  );

  test('an unknown vehicle type falls back to the most restrictive (MOTO) rules', () => {
    try {
      assertDriverApprovable(
        profile({ vehicleType: 'ROCKET', registrationPlate: null }),
      );
      throw new Error('expected AppError');
    } catch (err: any) {
      expect(err.details).toEqual({ missing: ['registrationPlate'] });
    }
  });

  test.each(['BIKE', 'MOTO', 'E_MOTO', 'E_BIKE'])(
    'REVOKED blocks approval for %s regardless of identifiers',
    (vehicleType) => {
      try {
        assertDriverApprovable(
          profile({ vehicleType, verificationStatus: 'REVOKED' }),
        );
        throw new Error('expected AppError');
      } catch (err: any) {
        expect(err.statusCode).toBe(422);
        expect(err.code).toBe('DRIVER_REVOKED_REAPPLY_REQUIRED');
      }
    },
  );
});

describe('BIKE-GATE — admin approve route is vehicle-aware', () => {
  const url = '/api/admin/verifications/u-1/approve';

  test('approves an UNDER_REVIEW BIKE profile with a jacket number and no plate', async () => {
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
      userId: 'u-1',
      verificationStatus: 'UNDER_REVIEW',
      vehicleType: 'BIKE',
      ruraAuthorizationNumber: 'BM-9002',
      registrationPlate: null,
    });
    (mockPrisma.driverProfile.update as jest.Mock).mockResolvedValue({
      userId: 'u-1',
      verificationStatus: 'VERIFIED',
    });
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(mockPrisma.driverProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ verificationStatus: 'VERIFIED' }),
      }),
    );
  });

  test('still refuses a MOTO profile without a plate — 422 with the missing list', async () => {
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
      userId: 'u-1',
      verificationStatus: 'UNDER_REVIEW',
      vehicleType: 'MOTO',
      ruraAuthorizationNumber: 'RURA-9003',
      registrationPlate: null,
    });
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DRIVER_MISSING_IDENTIFIERS');
    expect(res.body.error.details).toEqual({ missing: ['registrationPlate'] });
    expect(mockPrisma.driverProfile.update).not.toHaveBeenCalled();
  });
});

describe('BIKE-GATE — submission auto-promote is vehicle-aware', () => {
  const url = '/api/users/me/driver-verification';

  function mockProfile(row: Record<string, unknown>) {
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue(row);
    (mockPrisma.driverProfile.update as jest.Mock).mockImplementation(
      async ({ data }: any) => ({ ...row, ...data }),
    );
  }

  test('a BIKE submission with only the jacket number promotes PENDING -> UNDER_REVIEW', async () => {
    mockProfile({
      userId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      vehicleType: 'BIKE',
      verificationStatus: 'PENDING',
      drivingLicenseNumber: null,
      ruraAuthorizationNumber: null,
      cooperativeName: null,
      insuranceConfirmed: false,
    });
    const res = await request(app)
      .put(url)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ ruraAuthorizationNumber: 'BM-9004' });
    expect(res.status).toBe(200);
    expect(res.body.verificationStatus).toBe('UNDER_REVIEW');
  });

  test('a MOTO submission with only the jacket number stays PENDING (license/coop/insurance still required)', async () => {
    mockProfile({
      userId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      vehicleType: 'MOTO',
      verificationStatus: 'PENDING',
      drivingLicenseNumber: null,
      ruraAuthorizationNumber: null,
      cooperativeName: null,
      insuranceConfirmed: false,
    });
    const res = await request(app)
      .put(url)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ ruraAuthorizationNumber: 'RURA-9005' });
    expect(res.status).toBe(200);
    expect(res.body.verificationStatus).toBe('PENDING');
  });

  test('a BIKE submission without the jacket number does not promote', async () => {
    mockProfile({
      userId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      vehicleType: 'BIKE',
      verificationStatus: 'PENDING',
      drivingLicenseNumber: null,
      ruraAuthorizationNumber: null,
      cooperativeName: null,
      insuranceConfirmed: false,
    });
    const res = await request(app)
      .put(url)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ insuranceConfirmed: false });
    expect(res.status).toBe(200);
    expect(res.body.verificationStatus).toBe('PENDING');
  });
});
