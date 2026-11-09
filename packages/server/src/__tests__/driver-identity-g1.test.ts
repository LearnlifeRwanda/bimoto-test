// DRIVER-ID v3 G1 — schema/lifecycle foundations.
//
// Covers: the additive migration content (REVOKED, REVOKE_DRIVER,
// revokedAt, unique jacket number, VehicleChangeLog), the
// mandatory-at-approval guard (identifier + plate before VERIFIED, no
// direct REVOKED -> VERIFIED), and the clean 409 when a unique
// ruraAuthorizationNumber collides.

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

import fs from 'fs';
import path from 'path';
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

describe('G1 — schema and migration contents', () => {
  const schema = fs.readFileSync(
    path.join(__dirname, '../../prisma/schema.prisma'),
    'utf8',
  );
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '../../prisma/migrations/20260708120000_driver_id_v3_revoked_identity/migration.sql',
    ),
    'utf8',
  );

  test('VerificationStatus gains REVOKED (schema + migration)', () => {
    expect(schema).toMatch(/enum VerificationStatus \{[^}]*REVOKED[^}]*\}/s);
    expect(migration).toContain(
      `ALTER TYPE "VerificationStatus" ADD VALUE 'REVOKED';`,
    );
  });

  test('AdminActionType gains REVOKE_DRIVER (schema + migration)', () => {
    expect(schema).toMatch(/enum AdminActionType \{[^}]*REVOKE_DRIVER[^}]*\}/s);
    expect(migration).toContain(
      `ALTER TYPE "AdminActionType" ADD VALUE 'REVOKE_DRIVER';`,
    );
  });

  test('DriverProfile gains nullable revokedAt (schema + migration)', () => {
    expect(schema).toMatch(/revokedAt\s+DateTime\?/);
    expect(migration).toContain(
      `ALTER TABLE "DriverProfile" ADD COLUMN "revokedAt" TIMESTAMP(3);`,
    );
  });

  test('ruraAuthorizationNumber becomes unique (schema + migration)', () => {
    expect(schema).toMatch(/ruraAuthorizationNumber\s+String\?\s+@unique/);
    expect(migration).toContain(
      `CREATE UNIQUE INDEX "DriverProfile_ruraAuthorizationNumber_key" ON "DriverProfile"("ruraAuthorizationNumber");`,
    );
  });

  test('VehicleChangeLog table with old->new columns and (driverId, changedAt) index', () => {
    expect(schema).toMatch(/model VehicleChangeLog \{/);
    expect(schema).toMatch(/@@index\(\[driverId, changedAt\]\)/);
    expect(migration).toContain(`CREATE TABLE "VehicleChangeLog"`);
    for (const col of [
      'oldVehicleType',
      'newVehicleType',
      'oldPlate',
      'newPlate',
      'oldDescription',
      'newDescription',
    ]) {
      expect(migration).toContain(`"${col}"`);
    }
    expect(migration).toContain(
      `CREATE INDEX "VehicleChangeLog_driverId_changedAt_idx" ON "VehicleChangeLog"("driverId", "changedAt");`,
    );
    expect(migration).toContain(
      `REFERENCES "User"("id") ON DELETE CASCADE`,
    );
  });

  test('migration is purely additive (no DROP/DELETE statements)', () => {
    expect(migration).not.toMatch(/\bDROP\b/i);
    expect(migration).not.toMatch(/^\s*DELETE\b/im);
  });
});

describe('G1 — assertDriverApprovable', () => {
  const base = {
    verificationStatus: 'UNDER_REVIEW',
    vehicleType: 'MOTO',
    ruraAuthorizationNumber: 'RURA-G1-1',
    registrationPlate: 'RAC 123A',
  };

  test('passes when identifier and plate are present', () => {
    expect(() => assertDriverApprovable(base)).not.toThrow();
  });

  test('422 DRIVER_MISSING_IDENTIFIERS when the jacket number is missing', () => {
    try {
      assertDriverApprovable({ ...base, ruraAuthorizationNumber: null });
      throw new Error('expected AppError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe('DRIVER_MISSING_IDENTIFIERS');
      expect(err.details).toEqual({ missing: ['ruraAuthorizationNumber'] });
    }
  });

  test('422 DRIVER_MISSING_IDENTIFIERS when the plate is missing', () => {
    try {
      assertDriverApprovable({ ...base, registrationPlate: null });
      throw new Error('expected AppError');
    } catch (err: any) {
      expect(err.statusCode).toBe(422);
      expect(err.details).toEqual({ missing: ['registrationPlate'] });
    }
  });

  test('422 DRIVER_REVOKED_REAPPLY_REQUIRED for a REVOKED profile even with identifiers', () => {
    try {
      assertDriverApprovable({ ...base, verificationStatus: 'REVOKED' });
      throw new Error('expected AppError');
    } catch (err: any) {
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe('DRIVER_REVOKED_REAPPLY_REQUIRED');
    }
  });
});

describe('G1 — POST /api/admin/verifications/:userId/approve gate', () => {
  const url = '/api/admin/verifications/u-1/approve';

  test('404 when the driver profile does not exist', async () => {
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
    expect(mockPrisma.driverProfile.update).not.toHaveBeenCalled();
  });

  test('422 when the identifier or plate is missing — VERIFIED is never written', async () => {
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
      userId: 'u-1',
      verificationStatus: 'UNDER_REVIEW',
      vehicleType: 'MOTO',
      ruraAuthorizationNumber: null,
      registrationPlate: 'RAC 123A',
    });
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DRIVER_MISSING_IDENTIFIERS');
    expect(mockPrisma.driverProfile.update).not.toHaveBeenCalled();
  });

  test('422 for a REVOKED profile — no direct REVOKED -> VERIFIED', async () => {
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
      userId: 'u-1',
      verificationStatus: 'REVOKED',
      vehicleType: 'MOTO',
      ruraAuthorizationNumber: 'RURA-G1-2',
      registrationPlate: 'RAC 123A',
    });
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DRIVER_REVOKED_REAPPLY_REQUIRED');
    expect(mockPrisma.driverProfile.update).not.toHaveBeenCalled();
  });

  test('approves an UNDER_REVIEW profile with identifier + plate', async () => {
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
      userId: 'u-1',
      verificationStatus: 'UNDER_REVIEW',
      vehicleType: 'MOTO',
      ruraAuthorizationNumber: 'RURA-G1-3',
      registrationPlate: 'RAC 123A',
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
});

describe('G1 — unique jacket-number collision surfaces cleanly', () => {
  test('PUT /api/users/me/driver-verification maps P2002 to 409 RURA_NUMBER_TAKEN', async () => {
    (mockPrisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
      userId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      verificationStatus: 'PENDING',
    });
    (mockPrisma.driverProfile.update as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    const res = await request(app)
      .put('/api/users/me/driver-verification')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ ruraAuthorizationNumber: 'RURA-DUP-1' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RURA_NUMBER_TAKEN');
  });
});
