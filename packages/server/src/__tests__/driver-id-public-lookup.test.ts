// DRIVER-ID v3 G3 — public live-validity lookup.
//
// Contract tests: the positive shape exposes exactly
// { active, firstName, vehicleType }; every non-active case (revoked,
// rejected, pending, under review, suspended, nonexistent) returns a
// BYTE-IDENTICAL { active: false } so the endpoint is no existence
// oracle; no auth is required; and the rate-limit scope is isolated
// from other buckets (the PR #107 lesson).

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    driverProfile: { findUnique: jest.fn() },
  },
}));

import express from 'express';
import request from 'supertest';
import prisma from '../prisma';
import driverIdRoutes from '../routes/driver-id.routes';
import { errorHandler } from '../middleware/error-handler';
import { rateLimit, _resetRateLimitForTests } from '../middleware/rate-limit';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const app = express();
app.use('/api/driver-id', driverIdRoutes);
// Sibling route with a DIFFERENT scope, to prove bucket isolation.
app.get(
  '/api/other-scope',
  rateLimit(20, 60_000, 'other-scope-test'),
  (_req, res) => res.json({ ok: true }),
);
app.use(errorHandler);

function seedLookup(profile: any) {
  (mockPrisma.driverProfile.findUnique as jest.Mock).mockImplementation(
    async ({ where }: any) =>
      profile && where.ruraAuthorizationNumber === profile.ruraAuthorizationNumber
        ? profile
        : null,
  );
}

const ACTIVE_PROFILE = {
  ruraAuthorizationNumber: 'RURA-0001',
  verificationStatus: 'VERIFIED',
  vehicleType: 'MOTO',
  user: { nickname: 'Jean', suspendedUntil: null },
};

beforeEach(() => {
  jest.clearAllMocks();
  _resetRateLimitForTests();
});

describe('G3 — positive shape', () => {
  test('VERIFIED + not suspended → active with firstName and vehicleType only', async () => {
    seedLookup(ACTIVE_PROFILE);
    const res = await request(app).get('/api/driver-id/RURA-0001');
    expect(res.status).toBe(200);
    expect(res.body).toMatchInlineSnapshot(`
{
  "active": true,
  "firstName": "Jean",
  "vehicleType": "MOTO",
}
`);
    // Exhaustive key check — the contract forbids anything else
    // (no phone, plate, photo, rating, history).
    expect(Object.keys(res.body).sort()).toEqual([
      'active',
      'firstName',
      'vehicleType',
    ]);
  });

  test('a PAST suspension does not hide an otherwise active driver', async () => {
    seedLookup({
      ...ACTIVE_PROFILE,
      user: { nickname: 'Jean', suspendedUntil: new Date(Date.now() - 60_000) },
    });
    const res = await request(app).get('/api/driver-id/RURA-0001');
    expect(res.body.active).toBe(true);
  });

  test('requires no authentication', async () => {
    seedLookup(ACTIVE_PROFILE);
    // No Authorization header, no cookie — still 200.
    const res = await request(app).get('/api/driver-id/RURA-0001');
    expect(res.status).toBe(200);
  });
});

describe('G3 — uniform negative', () => {
  const NON_ACTIVE_CASES: Array<[string, any]> = [
    ['REVOKED', { ...ACTIVE_PROFILE, verificationStatus: 'REVOKED' }],
    ['REJECTED', { ...ACTIVE_PROFILE, verificationStatus: 'REJECTED' }],
    ['PENDING', { ...ACTIVE_PROFILE, verificationStatus: 'PENDING' }],
    ['UNDER_REVIEW', { ...ACTIVE_PROFILE, verificationStatus: 'UNDER_REVIEW' }],
    [
      'suspended (future suspendedUntil)',
      {
        ...ACTIVE_PROFILE,
        user: { nickname: 'Jean', suspendedUntil: new Date(Date.now() + 60_000) },
      },
    ],
    ['nonexistent number', null],
  ];

  test('every non-active case returns the byte-identical negative', async () => {
    const bodies = new Set<string>();
    for (const [label, profile] of NON_ACTIVE_CASES) {
      seedLookup(profile);
      const res = await request(app).get('/api/driver-id/RURA-0001');
      expect({ label, status: res.status }).toEqual({ label, status: 200 });
      // res.text is the raw payload — byte-level comparison, not just
      // structural equality.
      bodies.add(res.text);
      expect(res.body).toMatchInlineSnapshot(`
{
  "active": false,
}
`);
    }
    expect(bodies.size).toBe(1);
  });
});

describe('G3 — rate limiting with an isolated scope', () => {
  test('429 after 20 lookups in the window; a different scope is untouched', async () => {
    seedLookup(ACTIVE_PROFILE);
    // The limiter is bypassed under NODE_ENV=test — flip it for this test.
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      for (let i = 0; i < 20; i++) {
        const res = await request(app).get('/api/driver-id/RURA-0001');
        expect(res.status).toBe(200);
      }
      const blocked = await request(app).get('/api/driver-id/RURA-0001');
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');

      // Exhausting the driver-id bucket must not drain other scopes.
      const other = await request(app).get('/api/other-scope');
      expect(other.status).toBe(200);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});
