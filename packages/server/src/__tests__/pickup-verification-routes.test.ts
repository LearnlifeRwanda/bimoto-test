// PILOT-INSTRUMENT G1 — pickup-identity verification capture tests.
//
// Verifies:
//   - happy path: customer's answer creates exactly one row
//   - idempotent per journey: re-answering upserts (last answer wins),
//     never a second row
//   - non-owner (another customer, the driver) gets 403 and writes nothing
//   - journey must be MATCHED or IN_PROGRESS
//   - EVIDENCE-ONLY invariant: a posted MISMATCH triggers no freeze, no
//     flag, no SMS, no socket emit — the upsert is the only write

jest.mock('../prisma', () => {
  // In-memory PickupVerification store keyed by journeyId so the
  // one-row-per-journey invariant is actually observable.
  const pickupRows = new Map<string, any>();
  const journeys = new Map<string, any>();
  let idCounter = 0;
  return {
    __esModule: true,
    default: {
      user: {
        // auth middleware's frozen-check — never frozen in these tests.
        findUnique: jest.fn(async () => ({ frozenAt: null })),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      journey: {
        findUnique: jest.fn(async ({ where }: any) => journeys.get(where.id) ?? null),
        update: jest.fn(),
      },
      amlFlag: {
        create: jest.fn(),
      },
      pickupVerification: {
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const existing = pickupRows.get(where.journeyId);
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const row = {
            id: `pv-${++idCounter}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...create,
          };
          pickupRows.set(where.journeyId, row);
          return row;
        }),
      },
      __stores: { pickupRows, journeys },
    },
  };
});

jest.mock('../config', () => ({
  config: {
    DATABASE_URL: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16-chars',
    ENCRYPTION_KEY: 'a'.repeat(64),
    PORT: 3000,
    CLIENT_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
  },
}));

jest.mock('../services/sms.service', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
}));

const mockEmit = jest.fn();
jest.mock('../socket', () => ({
  getIO: () => ({ to: () => ({ emit: mockEmit }) }),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import pickupVerificationRoutes from '../routes/pickup-verification.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import { sendSms } from '../services/sms.service';
import { _resetAuthStatusCacheForTests } from '../middleware/auth';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/journeys', pickupVerificationRoutes);
app.use(errorHandler);

const customerId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const driverId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const otherCustomerId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const journeyId = '11111111-1111-1111-1111-111111111111';

const customerToken = generateAccessToken({ userId: customerId, role: 'CUSTOMER' });
const driverToken = generateAccessToken({ userId: driverId, role: 'DRIVER' });
const otherCustomerToken = generateAccessToken({
  userId: otherCustomerId,
  role: 'CUSTOMER',
});

const stores = (prisma as any).__stores as {
  pickupRows: Map<string, any>;
  journeys: Map<string, any>;
};

function seedJourney(status: string) {
  stores.journeys.set(journeyId, {
    id: journeyId,
    customerId,
    driverId,
    status,
  });
}

beforeEach(() => {
  stores.pickupRows.clear();
  stores.journeys.clear();
  mockEmit.mockClear();
  (sendSms as jest.Mock).mockClear();
  (prisma.user.update as jest.Mock).mockClear();
  ((prisma as any).amlFlag.create as jest.Mock).mockClear();
  ((prisma as any).pickupVerification.upsert as jest.Mock).mockClear();
  _resetAuthStatusCacheForTests();
});

describe('POST /api/journeys/:id/pickup-verification', () => {
  test('customer answer on a MATCHED journey creates exactly one row', async () => {
    seedJourney('MATCHED');
    const res = await request(app)
      .post(`/api/journeys/${journeyId}/pickup-verification`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ outcome: 'MATCHED' });

    expect(res.status).toBe(201);
    expect(res.body.journeyId).toBe(journeyId);
    expect(res.body.customerId).toBe(customerId);
    expect(res.body.outcome).toBe('MATCHED');
    expect(stores.pickupRows.size).toBe(1);
  });

  test('accepts IN_PROGRESS (answer can land just after ride start)', async () => {
    seedJourney('IN_PROGRESS');
    const res = await request(app)
      .post(`/api/journeys/${journeyId}/pickup-verification`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ outcome: 'UNSURE' });
    expect(res.status).toBe(201);
    expect(stores.pickupRows.size).toBe(1);
  });

  test('idempotent per journey: re-answering upserts, last answer wins', async () => {
    seedJourney('MATCHED');
    await request(app)
      .post(`/api/journeys/${journeyId}/pickup-verification`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ outcome: 'UNSURE' });
    const res = await request(app)
      .post(`/api/journeys/${journeyId}/pickup-verification`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ outcome: 'MATCHED' });

    expect(res.status).toBe(201);
    expect(stores.pickupRows.size).toBe(1);
    expect(stores.pickupRows.get(journeyId).outcome).toBe('MATCHED');
    expect(stores.pickupRows.get(journeyId).reason).toBeNull();
  });

  test('MISMATCH with a one-tap reason stores the reason', async () => {
    seedJourney('MATCHED');
    const res = await request(app)
      .post(`/api/journeys/${journeyId}/pickup-verification`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ outcome: 'MISMATCH', reason: 'WRONG_NUMBER' });

    expect(res.status).toBe(201);
    expect(stores.pickupRows.get(journeyId).outcome).toBe('MISMATCH');
    expect(stores.pickupRows.get(journeyId).reason).toBe('WRONG_NUMBER');
  });

  test('EVIDENCE-ONLY: a MISMATCH triggers no freeze/flag/SMS/socket — the upsert is the only write', async () => {
    seedJourney('MATCHED');
    const res = await request(app)
      .post(`/api/journeys/${journeyId}/pickup-verification`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ outcome: 'MISMATCH', reason: 'DIFFERENT_PERSON' });

    expect(res.status).toBe(201);
    // No punitive or notifying side effect of any kind.
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect((prisma as any).user.updateMany).not.toHaveBeenCalled();
    expect((prisma as any).amlFlag.create).not.toHaveBeenCalled();
    expect((prisma as any).journey.update).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
    // The only write is the single upsert.
    expect((prisma as any).pickupVerification.upsert).toHaveBeenCalledTimes(1);
  });

  test('rejects another customer (403) and writes nothing', async () => {
    seedJourney('MATCHED');
    const res = await request(app)
      .post(`/api/journeys/${journeyId}/pickup-verification`)
      .set('Authorization', `Bearer ${otherCustomerToken}`)
      .send({ outcome: 'MATCHED' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_JOURNEY_CUSTOMER');
    expect(stores.pickupRows.size).toBe(0);
  });

  test('rejects the driver (403) — the answer is customer-owned', async () => {
    seedJourney('MATCHED');
    const res = await request(app)
      .post(`/api/journeys/${journeyId}/pickup-verification`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ outcome: 'MATCHED' });

    expect(res.status).toBe(403);
    expect(stores.pickupRows.size).toBe(0);
  });

  test('rejects a journey that is not at pickup (COMPLETED → 400)', async () => {
    seedJourney('COMPLETED');
    const res = await request(app)
      .post(`/api/journeys/${journeyId}/pickup-verification`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ outcome: 'MATCHED' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('JOURNEY_NOT_AT_PICKUP');
    expect(stores.pickupRows.size).toBe(0);
  });

  test('rejects an unknown journey (404)', async () => {
    const res = await request(app)
      .post(`/api/journeys/${journeyId}/pickup-verification`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ outcome: 'MATCHED' });
    expect(res.status).toBe(404);
  });

  test('rejects an invalid outcome (400 VALIDATION_ERROR)', async () => {
    seedJourney('MATCHED');
    const res = await request(app)
      .post(`/api/journeys/${journeyId}/pickup-verification`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ outcome: 'BANANA' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(stores.pickupRows.size).toBe(0);
  });

  test('rejects free-text reasons (fixed one-tap vocabulary only)', async () => {
    seedJourney('MATCHED');
    const res = await request(app)
      .post(`/api/journeys/${journeyId}/pickup-verification`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ outcome: 'MISMATCH', reason: 'he looked at me funny' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(stores.pickupRows.size).toBe(0);
  });

  test('rejects unauthenticated calls (401)', async () => {
    seedJourney('MATCHED');
    const res = await request(app)
      .post(`/api/journeys/${journeyId}/pickup-verification`)
      .send({ outcome: 'MATCHED' });
    expect(res.status).toBe(401);
    expect(stores.pickupRows.size).toBe(0);
  });
});
