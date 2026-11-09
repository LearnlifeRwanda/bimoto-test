// FEED-SCHEMA — contract tests for GET /api/journeys query validation.
//
// validate(schema, 'query') replaces req.query with Zod's parsed result,
// and Zod objects strip undeclared keys. Before the FEED-SCHEMA fix,
// journeyQuerySchema did not declare lat/lng/viewAs, so the validator
// silently removed them and every DRIVER-role feed request 400'd with
// LOCATION_REQUIRED no matter what the phone sent. These tests pin the
// contract that would have caught it, route-level (through the real
// validator middleware), plus a structural test that asserts the schema
// declares every query key the handler consumes.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    // FIELD-FIT G5 — the feed asks whether this driver is already carrying
    // someone before building a feed; null = not engaged.
    journey: { findMany: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    driverProfile: { findUnique: jest.fn() },
  },
}));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = {
      userId: req.headers['x-test-user'] || 'u1',
      role: req.headers['x-test-role'] || 'CUSTOMER',
    };
    next();
  },
  driverOnly: (_req: any, _res: any, next: any) => next(),
  customerOnly: (_req: any, _res: any, next: any) => next(),
  invalidateAuthStatusCache: jest.fn(),
  _resetAuthStatusCacheForTests: jest.fn(),
}));

import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { journeyQuerySchema } from '@bimoto/shared';
import journeyRoutes from '../routes/journey.routes';
import { errorHandler } from '../middleware/error-handler';
import prisma from '../prisma';

const app = express();
app.use(express.json());
app.use('/api/journeys', journeyRoutes);
app.use(errorHandler);

const journeyRepo = (prisma as any).journey;
const driverRepo = (prisma as any).driverProfile;

const KIGALI = { lat: -1.9536, lng: 30.0606 };

// An open journey at the driver's exact position: inside the t=0
// cascade ring, no vehicle preference, freshly created.
function makeOpenJourney(overrides: Record<string, unknown> = {}) {
  return {
    id: 'feed-j1',
    customerId: 'cust1',
    status: 'REQUESTED',
    type: 'PASSENGER',
    pickupLat: KIGALI.lat,
    pickupLng: KIGALI.lng,
    vehiclePreference: null,
    createdAt: new Date(),
    discoveryStartedAt: new Date(),
    bids: [],
    customer: { id: 'cust1', nickname: 'Cust', completedRides: 3 },
    ...overrides,
  };
}

function mockDriverBuckets(otherBucket: unknown[]) {
  // The driver branch issues three findMany calls (urgent asc,
  // priority asc, other desc); route the fixture to the "other" bucket.
  journeyRepo.findMany.mockImplementation(({ where }: any) => {
    if (where?.type === 'URGENT_MESSENGER') return Promise.resolve([]);
    if (where?.type === 'PRIORITY_MESSENGER') return Promise.resolve([]);
    return Promise.resolve(otherBucket);
  });
  driverRepo.findUnique.mockResolvedValue({
    userId: 'drv1',
    vehicleType: 'MOTO',
    lastLat: KIGALI.lat,
    lastLng: KIGALI.lng,
    lastLocationAt: new Date(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/journeys — FEED-SCHEMA contract', () => {
  test('DRIVER role + valid lat/lng → 200 with the open journey (coordinates survive validation)', async () => {
    mockDriverBuckets([makeOpenJourney()]);
    const res = await request(app)
      .get(`/api/journeys?lat=${KIGALI.lat}&lng=${KIGALI.lng}`)
      .set('x-test-user', 'drv1')
      .set('x-test-role', 'DRIVER');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.map((j: any) => j.id)).toContain('feed-j1');
    // The driver branch ran — the location guard did NOT fire.
    expect(driverRepo.findUnique).toHaveBeenCalledWith({ where: { userId: 'drv1' } });
  });

  test('DRIVER role with genuinely missing location → 400 LOCATION_REQUIRED (the guard stays)', async () => {
    const res = await request(app)
      .get('/api/journeys')
      .set('x-test-user', 'drv1')
      .set('x-test-role', 'DRIVER');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LOCATION_REQUIRED');
  });

  test('BOTH role + viewAs=driver + coords → driver branch (viewAs survives validation)', async () => {
    mockDriverBuckets([makeOpenJourney()]);
    const res = await request(app)
      .get(`/api/journeys?viewAs=driver&lat=${KIGALI.lat}&lng=${KIGALI.lng}`)
      .set('x-test-user', 'both1')
      .set('x-test-role', 'BOTH');
    expect(res.status).toBe(200);
    expect(driverRepo.findUnique).toHaveBeenCalledWith({ where: { userId: 'both1' } });
  });

  test('customer path unchanged: own journeys, status filter honored, unknown keys still stripped', async () => {
    const own = [makeOpenJourney({ id: 'own-1', customerId: 'cust9', cancelReason: null, escrow: null })];
    journeyRepo.findMany.mockResolvedValue(own);
    const res = await request(app)
      .get('/api/journeys?status=REQUESTED&history=true&totallyUnknown=1')
      .set('x-test-user', 'cust9')
      .set('x-test-role', 'CUSTOMER');
    expect(res.status).toBe(200);
    expect(res.body.map((j: any) => j.id)).toEqual(['own-1']);
    expect(journeyRepo.findMany).toHaveBeenCalledTimes(1);
    const arg = journeyRepo.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ customerId: 'cust9', status: 'REQUESTED' });
    // RIDES-REACH G1 — a STRONGER fact than this line used to state.
    //
    // `history` was undeclared when this test was written, so "it never
    // reaches the query" was a statement about Zod stripping it. It is
    // declared now, and reaches the service as a real boolean — and it
    // still never reaches the customer's query, because this arm
    // deliberately ignores it: `customerId: userId` already IS her
    // rides, so there is nothing left for the flag to narrow. Same
    // `where`, same rows, declared or not (§3: customer responses
    // byte-identical). The byte-identity itself is asserted directly in
    // rides-reach-driver-arm.test.ts.
    expect(JSON.stringify(arg)).not.toContain('history');
    // `totallyUnknown` is the undeclared key now, and it is still
    // stripped — the mechanism this test was built to pin.
    expect(JSON.stringify(arg)).not.toContain('totallyUnknown');
    expect(driverRepo.findUnique).not.toHaveBeenCalled();
  });

  test('history=true on the DRIVER arm reaches the service — no coordinates, no 400', async () => {
    // The regression this dispatch closes, at the route: the rides tab's
    // exact request. It used to 400 LOCATION_REQUIRED, because Zod
    // stripped `history` and what was left looked like a coordinate-less
    // discovery query.
    journeyRepo.findMany.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/journeys?history=true')
      .set('x-test-user', 'drv1')
      .set('x-test-role', 'DRIVER');

    expect(res.status).toBe(200);
    expect(journeyRepo.findMany).toHaveBeenCalledTimes(1);
    expect(journeyRepo.findMany.mock.calls[0][0].where).toEqual({ driverId: 'drv1' });
  });

  test('history=false is still a discovery request — 400 without coordinates', async () => {
    // z.coerce.boolean() would have made this `true` (it is truthiness),
    // which is why the schema uses the two literal strings instead.
    const res = await request(app)
      .get('/api/journeys?history=false')
      .set('x-test-user', 'drv1')
      .set('x-test-role', 'DRIVER');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LOCATION_REQUIRED');
  });

  test('a non-boolean history value is refused, not silently ignored', async () => {
    const res = await request(app)
      .get('/api/journeys?history=yes')
      .set('x-test-user', 'drv1')
      .set('x-test-role', 'DRIVER');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toEqual(['history']);
  });

  test('out-of-range coordinates → 400 VALIDATION_ERROR, not a crash', async () => {
    const res = await request(app)
      .get('/api/journeys?lat=999&lng=30.06')
      .set('x-test-role', 'DRIVER');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toEqual(['lat']);
  });

  test('non-numeric coordinates → 400 VALIDATION_ERROR, not a crash', async () => {
    const res = await request(app)
      .get('/api/journeys?lat=abc&lng=30.06')
      .set('x-test-role', 'DRIVER');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('FEED-SCHEMA structural pin — the schema declares every key the handler reads', () => {
  test('every req.query key consumed by the GET /api/journeys handler is declared in journeyQuerySchema', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../routes/journey.routes.ts'),
      'utf8',
    );

    // Slice out the one handler guarded by validate(journeyQuerySchema,
    // 'query'): from that marker to the next route registration.
    const marker = "validate(journeyQuerySchema, 'query')";
    const start = source.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const nextRoute = source.indexOf('\nrouter.', start);
    const handlerSource = source.slice(start, nextRoute === -1 ? undefined : nextRoute);

    const consumed = new Set<string>();
    // Destructuring reads: const { status, type } = req.query
    for (const m of handlerSource.matchAll(
      /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*req\.query/g,
    )) {
      for (const part of m[1].split(',')) {
        const name = part.split(':')[0].trim();
        if (name) consumed.add(name);
      }
    }
    // Direct reads: req.query.lat
    for (const m of handlerSource.matchAll(/req\.query\.([A-Za-z_$][\w$]*)/g)) {
      consumed.add(m[1]);
    }

    // The handler must actually read something — if this ever goes to
    // zero the extraction regexes have rotted, not the handler.
    expect(consumed.size).toBeGreaterThan(0);

    const declared = new Set(Object.keys(journeyQuerySchema.shape));
    const missing = [...consumed].filter((k) => !declared.has(k));

    if (missing.length > 0) {
      throw new Error(
        `FEED-SCHEMA regression: GET /api/journeys reads query key(s) [${missing.join(', ')}] ` +
          'that journeyQuerySchema does not declare. validate(schema, "query") replaces ' +
          'req.query with the parsed result and Zod strips undeclared keys, so the handler ' +
          'will silently never see them — this is exactly how the driver feed 400\'d with ' +
          'LOCATION_REQUIRED for every request (incident FEED-SCHEMA, PR #147). Declare the ' +
          'key in packages/shared/src/schemas/journey.schema.ts journeyQuerySchema.',
      );
    }
  });
});
