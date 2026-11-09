// R3-DRIVER-SCREENER — integration tests for the screener service +
// routes. Uses the same mocked-prisma + supertest pattern as
// admin-aml-routes.test.ts.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    driverProfile: {
      findUnique: jest.fn(),
    },
    driverScreener: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import driverScreenerRoutes from '../routes/driver-screener.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/drivers/me', driverScreenerRoutes);
app.use(errorHandler);

const driverProfile = (prisma as any).driverProfile;
const driverScreener = (prisma as any).driverScreener;

const driverToken = generateAccessToken({
  userId: 'driver-1',
  role: 'DRIVER',
} as any);
const customerToken = generateAccessToken({
  userId: 'cust-1',
  role: 'CUSTOMER',
} as any);

function eligibleSubmission() {
  return {
    is18OrOlder: true,
    holdsDriversLicence: 'yes',
    hasRuraAuthorisation: 'have',
    primaryVehicleType: 'MOTO',
    cooperativeId: null,
    cooperativeNameProvided: null,
    primaryCityBand: 'kigali_dense',
    weeklyAvailabilityHours: 20,
    priorPlatformExperience: false,
    priorPlatformMonths: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('driver screener — auth', () => {
  test('POST /screener without token → 401', async () => {
    const res = await request(app)
      .post('/api/drivers/me/screener')
      .send(eligibleSubmission());
    expect(res.status).toBe(401);
  });

  test('POST /screener as non-driver → 403', async () => {
    const res = await request(app)
      .post('/api/drivers/me/screener')
      .set('Cookie', [`accessToken=${customerToken}`])
      .send(eligibleSubmission());
    expect(res.status).toBe(403);
  });

  test('GET /screener without token → 401', async () => {
    const res = await request(app).get('/api/drivers/me/screener');
    expect(res.status).toBe(401);
  });

  test('GET /screener as non-driver → 403', async () => {
    const res = await request(app)
      .get('/api/drivers/me/screener')
      .set('Cookie', [`accessToken=${customerToken}`]);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/drivers/me/screener', () => {
  test('creates a new DriverScreener row for an eligible submission', async () => {
    driverProfile.findUnique.mockResolvedValue({ id: 'dp-1' });
    driverScreener.upsert.mockResolvedValue({
      id: 'screener-1',
      eligibilityResult: 'ELIGIBLE',
      ineligibilityReason: null,
    });

    const res = await request(app)
      .post('/api/drivers/me/screener')
      .set('Cookie', [`accessToken=${driverToken}`])
      .send(eligibleSubmission());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      screenerId: 'screener-1',
      eligibilityResult: 'eligible',
      ineligibilityReason: null,
    });

    expect(driverScreener.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { driverProfileId: 'dp-1' },
        create: expect.objectContaining({
          driverProfileId: 'dp-1',
          eligibilityResult: 'ELIGIBLE',
          ineligibilityReason: null,
          holdsDriversLicence: 'YES',
          hasRuraAuthorisation: 'HAVE',
          primaryVehicleType: 'MOTO',
        }),
      }),
    );
  });

  test('returns 400 on missing required field', async () => {
    driverProfile.findUnique.mockResolvedValue({ id: 'dp-1' });
    const bad = { ...eligibleSubmission() } as any;
    delete bad.is18OrOlder;
    const res = await request(app)
      .post('/api/drivers/me/screener')
      .set('Cookie', [`accessToken=${driverToken}`])
      .send(bad);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(driverScreener.upsert).not.toHaveBeenCalled();
  });

  test('returns 404 when DriverProfile is missing', async () => {
    driverProfile.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/drivers/me/screener')
      .set('Cookie', [`accessToken=${driverToken}`])
      .send(eligibleSubmission());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('DRIVER_PROFILE_NOT_FOUND');
  });

  test('is idempotent on resubmit (upsert)', async () => {
    driverProfile.findUnique.mockResolvedValue({ id: 'dp-1' });
    driverScreener.upsert.mockResolvedValue({
      id: 'screener-1',
      eligibilityResult: 'ELIGIBLE',
      ineligibilityReason: null,
    });
    const submission = eligibleSubmission();

    await request(app)
      .post('/api/drivers/me/screener')
      .set('Cookie', [`accessToken=${driverToken}`])
      .send(submission);
    await request(app)
      .post('/api/drivers/me/screener')
      .set('Cookie', [`accessToken=${driverToken}`])
      .send({ ...submission, weeklyAvailabilityHours: 30 });

    expect(driverScreener.upsert).toHaveBeenCalledTimes(2);
    // Same composite key on both calls — Prisma upsert guarantees 1:1
    // via the @unique constraint on driverProfileId.
    const calls = driverScreener.upsert.mock.calls;
    expect(calls[0][0].where).toEqual({ driverProfileId: 'dp-1' });
    expect(calls[1][0].where).toEqual({ driverProfileId: 'dp-1' });
  });

  test('stores ineligibilityReason when result is needs_follow_up', async () => {
    driverProfile.findUnique.mockResolvedValue({ id: 'dp-1' });
    driverScreener.upsert.mockResolvedValue({
      id: 'screener-1',
      eligibilityResult: 'NEEDS_FOLLOW_UP',
      ineligibilityReason: 'NEEDS_RURA_PATH',
    });
    const submission = {
      ...eligibleSubmission(),
      hasRuraAuthorisation: 'not_yet',
    };
    const res = await request(app)
      .post('/api/drivers/me/screener')
      .set('Cookie', [`accessToken=${driverToken}`])
      .send(submission);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      screenerId: 'screener-1',
      eligibilityResult: 'needs_follow_up',
      ineligibilityReason: 'needs_rura_path',
    });
    expect(driverScreener.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          eligibilityResult: 'NEEDS_FOLLOW_UP',
          ineligibilityReason: 'NEEDS_RURA_PATH',
        }),
      }),
    );
  });
});

describe('GET /api/drivers/me/screener', () => {
  test('returns 404 when no row exists', async () => {
    driverProfile.findUnique.mockResolvedValue({ id: 'dp-1' });
    driverScreener.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .get('/api/drivers/me/screener')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SCREENER_NOT_FOUND');
  });

  test('returns the submission + eligibility result when row exists', async () => {
    driverProfile.findUnique.mockResolvedValue({ id: 'dp-1' });
    driverScreener.findUnique.mockResolvedValue({
      id: 'screener-1',
      driverProfileId: 'dp-1',
      is18OrOlder: true,
      holdsDriversLicence: 'YES',
      hasRuraAuthorisation: 'HAVE',
      primaryVehicleType: 'MOTO',
      cooperativeId: null,
      cooperativeNameProvided: null,
      primaryCityBand: 'kigali_dense',
      weeklyAvailabilityHours: 20,
      priorPlatformExperience: false,
      priorPlatformMonths: null,
      eligibilityResult: 'ELIGIBLE',
      ineligibilityReason: null,
      completedAt: new Date('2026-05-29T10:00:00.000Z'),
    });
    const res = await request(app)
      .get('/api/drivers/me/screener')
      .set('Cookie', [`accessToken=${driverToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.eligibilityResult).toBe('eligible');
    expect(res.body.ineligibilityReason).toBeNull();
    expect(res.body.submission.holdsDriversLicence).toBe('yes');
    expect(res.body.submission.hasRuraAuthorisation).toBe('have');
    expect(res.body.submission.primaryCityBand).toBe('kigali_dense');
  });
});
