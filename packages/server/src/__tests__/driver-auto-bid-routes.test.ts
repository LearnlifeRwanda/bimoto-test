// Test the driver-auto-bid routes end-to-end with a mocked prisma
// and a stub authMiddleware so we exercise routing + validation +
// the store layer without touching a real DB.

jest.mock('../prisma', () => {
  const rules: any[] = [];
  let nextId = 1;
  return {
    __esModule: true,
    default: {
      driverAutoBidRule: {
        findMany: jest.fn(async ({ where, orderBy }: any) => {
          let rows = rules.filter((r) => {
            if (where?.driverId !== undefined && r.driverId !== where.driverId) return false;
            if (where?.enabled !== undefined && r.enabled !== where.enabled) return false;
            return true;
          });
          if (orderBy?.priority === 'asc') {
            rows = [...rows].sort((a, b) => a.priority - b.priority);
          }
          return rows;
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.id) return rules.find((r) => r.id === where.id) ?? null;
          if (where.driverId_priority) {
            const { driverId, priority } = where.driverId_priority;
            return rules.find((r) => r.driverId === driverId && r.priority === priority) ?? null;
          }
          return null;
        }),
        count: jest.fn(async ({ where }: any) => {
          return rules.filter((r) => {
            if (where?.driverId !== undefined && r.driverId !== where.driverId) return false;
            if (where?.enabled !== undefined && r.enabled !== where.enabled) return false;
            return true;
          }).length;
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `rule${nextId++}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          };
          rules.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = rules.find((r) => r.id === where.id);
          if (!row) throw new Error('not found');
          Object.assign(row, data);
          return row;
        }),
        delete: jest.fn(async ({ where }: any) => {
          const idx = rules.findIndex((r) => r.id === where.id);
          if (idx < 0) throw new Error('not found');
          const [removed] = rules.splice(idx, 1);
          return removed;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const r of rules) {
            if (where?.driverId !== undefined && r.driverId !== where.driverId) continue;
            if (where?.enabled !== undefined && r.enabled !== where.enabled) continue;
            Object.assign(r, data);
            count++;
          }
          return { count };
        }),
      },
      _rules: rules,
      _reset: () => {
        rules.length = 0;
        nextId = 1;
      },
    },
  };
});

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    if (req.headers['x-test-anon']) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'errors.unauthorized' } });
      return;
    }
    req.user = {
      userId: req.headers['x-test-user'] || 'd1',
      role: req.headers['x-test-role'] || 'DRIVER',
    };
    next();
  },
  driverOnly: (req: any, res: any, next: any) => {
    if (!req.user || (req.user.role !== 'DRIVER' && req.user.role !== 'BOTH')) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'errors.driver_only' } });
      return;
    }
    next();
  },
  customerOnly: (_req: any, _res: any, next: any) => next(),
  invalidateAuthStatusCache: jest.fn(),
  _resetAuthStatusCacheForTests: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import driverAutoBidRoutes from '../routes/driver-auto-bid.routes';
import { errorHandler } from '../middleware/error-handler';
import prisma from '../prisma';

const app = express();
app.use(express.json());
app.use('/api/driver/auto-bid-rules', driverAutoBidRoutes);
app.use(errorHandler);

const baseInput = (overrides: any = {}) => ({
  priority: 0,
  enabled: true,
  maxPickupDistanceM: 500,
  maxRideDistanceM: 3000,
  vehicleTypeFilter: 'MOTO',
  bidAmountMode: 'FLAT',
  bidAmountValue: 1500,
  ...overrides,
});

beforeEach(() => {
  (prisma as any)._reset();
});

describe('GET /api/driver/auto-bid-rules', () => {
  it('without auth → 401', async () => {
    const res = await request(app)
      .get('/api/driver/auto-bid-rules')
      .set('x-test-anon', '1');
    expect(res.status).toBe(401);
  });

  it('as a customer → 403', async () => {
    const res = await request(app)
      .get('/api/driver/auto-bid-rules')
      .set('x-test-role', 'CUSTOMER');
    expect(res.status).toBe(403);
  });

  it('as a driver → 200 with array', async () => {
    const res = await request(app).get('/api/driver/auto-bid-rules');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/driver/auto-bid-rules', () => {
  it('valid input → 201', async () => {
    const res = await request(app)
      .post('/api/driver/auto-bid-rules')
      .send(baseInput());
    expect(res.status).toBe(201);
    expect(res.body.bidAmountValue).toBe(1500);
  });

  it('PERCENT 110 → 201, value stored as 110', async () => {
    const res = await request(app)
      .post('/api/driver/auto-bid-rules')
      .send(baseInput({ bidAmountMode: 'PERCENT_OF_FAIR_PRICE', bidAmountValue: 110 }));
    expect(res.status).toBe(201);
    expect(res.body.bidAmountValue).toBe(110);
  });

  it('PERCENT 205 → 400 (above PERCENT_BID_MAX)', async () => {
    const res = await request(app)
      .post('/api/driver/auto-bid-rules')
      .send(baseInput({ bidAmountMode: 'PERCENT_OF_FAIR_PRICE', bidAmountValue: 205 }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_AMOUNT');
  });

  it('6th rule when 5 enabled exist → 400 TOO_MANY_RULES', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/driver/auto-bid-rules').send(baseInput({ priority: i }));
    }
    const res = await request(app)
      .post('/api/driver/auto-bid-rules')
      .send(baseInput({ priority: 0 }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TOO_MANY_RULES');
  });

  it('priority taken → 400 PRIORITY_TAKEN', async () => {
    await request(app).post('/api/driver/auto-bid-rules').send(baseInput({ priority: 2 }));
    // Pause rule 2 so the cap doesn't fire first.
    await request(app)
      .patch(`/api/driver/auto-bid-rules/${(prisma as any)._rules[0].id}`)
      .send({ enabled: false });
    const res = await request(app)
      .post('/api/driver/auto-bid-rules')
      .send(baseInput({ priority: 2 }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PRIORITY_TAKEN');
  });
});

describe('PATCH /api/driver/auto-bid-rules/:id', () => {
  it('updating another driver\'s rule → 403', async () => {
    // Create as driver d1 (the default mock user).
    const created = await request(app)
      .post('/api/driver/auto-bid-rules')
      .send(baseInput());
    const ruleId = created.body.id;
    const res = await request(app)
      .patch(`/api/driver/auto-bid-rules/${ruleId}`)
      .set('x-test-user', 'OTHER')
      .send({ bidAmountValue: 2000 });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/driver/auto-bid-rules/:id', () => {
  it('204 then GET returns empty', async () => {
    const created = await request(app)
      .post('/api/driver/auto-bid-rules')
      .send(baseInput());
    const ruleId = created.body.id;
    const del = await request(app).delete(`/api/driver/auto-bid-rules/${ruleId}`);
    expect(del.status).toBe(204);
    const list = await request(app).get('/api/driver/auto-bid-rules');
    expect(list.body).toEqual([]);
  });
});

describe('POST /api/driver/auto-bid-rules/pause-all + resume-all', () => {
  it('pause-all sets enabled=false and resume-all reverses', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app).post('/api/driver/auto-bid-rules').send(baseInput({ priority: i }));
    }
    const pause = await request(app).post('/api/driver/auto-bid-rules/pause-all');
    expect(pause.status).toBe(200);
    expect(pause.body.paused).toBe(3);
    const list1 = await request(app).get('/api/driver/auto-bid-rules');
    expect(list1.body.every((r: any) => r.enabled === false)).toBe(true);

    const resume = await request(app).post('/api/driver/auto-bid-rules/resume-all');
    expect(resume.status).toBe(200);
    expect(resume.body.resumed).toBe(3);
    const list2 = await request(app).get('/api/driver/auto-bid-rules');
    expect(list2.body.every((r: any) => r.enabled === true)).toBe(true);
  });
});

// DEADWOOD G4 — one vehicle enum.
//
// The route used to validate vehicleTypeFilter against
// z.enum(['MOTO','BIKE','EMOTO']) while the shared VehicleType enum —
// and therefore every Journey.vehiclePreference the evaluator compares
// against with a plain !== — spells it 'E_MOTO'. A driver who filtered
// to electric motos wrote a rule that was guaranteed never to fire.
//
// The fix has to hold both ends at once: the canonical spelling must be
// what gets STORED, and the old spelling must still be ACCEPTED,
// because a deployed APK is still sending it and a 400 on a rule the
// driver already wrote would be worse than the bug.
describe('vehicleTypeFilter — the E_MOTO spelling', () => {
  it('E_MOTO is accepted and stored verbatim', async () => {
    const res = await request(app)
      .post('/api/driver/auto-bid-rules')
      .send(baseInput({ vehicleTypeFilter: 'E_MOTO' }));
    expect(res.status).toBe(201);
    expect(res.body.vehicleTypeFilter).toBe('E_MOTO');
  });

  it('the legacy EMOTO from a deployed APK is normalised, not rejected', async () => {
    const res = await request(app)
      .post('/api/driver/auto-bid-rules')
      .send(baseInput({ vehicleTypeFilter: 'EMOTO' }));
    expect(res.status).toBe(201);
    expect(res.body.vehicleTypeFilter).toBe('E_MOTO');
  });

  it('PATCH normalises the legacy spelling too', async () => {
    const created = await request(app)
      .post('/api/driver/auto-bid-rules')
      .send(baseInput({ vehicleTypeFilter: null }));
    expect(created.status).toBe(201);

    const patched = await request(app)
      .patch(`/api/driver/auto-bid-rules/${created.body.id}`)
      .send({ vehicleTypeFilter: 'EMOTO' });
    expect(patched.status).toBe(200);
    expect(patched.body.vehicleTypeFilter).toBe('E_MOTO');
  });

  it('null still means "any vehicle"', async () => {
    const res = await request(app)
      .post('/api/driver/auto-bid-rules')
      .send(baseInput({ vehicleTypeFilter: null }));
    expect(res.status).toBe(201);
    expect(res.body.vehicleTypeFilter).toBeNull();
  });

  it('a spelling neither the enum nor the alias knows is still a 400', async () => {
    const res = await request(app)
      .post('/api/driver/auto-bid-rules')
      .send(baseInput({ vehicleTypeFilter: 'E-MOTO' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// FLIGHT-RECORDER G5.4 — E_BIKE was the fourth member of the shared
// VehicleType enum and the only one this filter never accepted. An
// e-bike driver could scope a rule to any machine except the one he
// rides: his options were MOTO, BIKE, E_MOTO or "any journey". The
// evaluator has always compared the filter against
// journey.vehiclePreference with a plain !==, so the value it needed was
// there all along; nothing but this enum was in the way.
describe('vehicleTypeFilter — E_BIKE, the machine the list forgot', () => {
  it('E_BIKE is accepted and stored verbatim', async () => {
    const res = await request(app)
      .post('/api/driver/auto-bid-rules')
      .send(baseInput({ vehicleTypeFilter: 'E_BIKE' }));
    expect(res.status).toBe(201);
    expect(res.body.vehicleTypeFilter).toBe('E_BIKE');
  });

  it('PATCH can move a rule onto E_BIKE', async () => {
    const created = await request(app)
      .post('/api/driver/auto-bid-rules')
      .send(baseInput({ vehicleTypeFilter: 'BIKE' }));
    expect(created.status).toBe(201);

    const patched = await request(app)
      .patch(`/api/driver/auto-bid-rules/${created.body.id}`)
      .send({ vehicleTypeFilter: 'E_BIKE' });
    expect(patched.status).toBe(200);
    expect(patched.body.vehicleTypeFilter).toBe('E_BIKE');
  });

  it('every VehicleType the schema has is now a legal filter', async () => {
    for (const value of ['MOTO', 'BIKE', 'E_MOTO', 'E_BIKE']) {
      const res = await request(app)
        .post('/api/driver/auto-bid-rules')
        .send(baseInput({ vehicleTypeFilter: value }));
      expect([201, 400]).toContain(res.status);
      // A rule limit or a priority clash may answer 400; a rejected
      // SPELLING is what this asserts against.
      if (res.status === 400) {
        expect(res.body.error.code).not.toBe('VALIDATION_ERROR');
      } else {
        expect(res.body.vehicleTypeFilter).toBe(value);
      }
    }
  });

  it('adding E_BIKE did not open the door to EBIKE', async () => {
    const res = await request(app)
      .post('/api/driver/auto-bid-rules')
      .send(baseInput({ vehicleTypeFilter: 'EBIKE' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('the legacy EMOTO alias still normalises — E_BIKE changed nothing there', async () => {
    const res = await request(app)
      .post('/api/driver/auto-bid-rules')
      .send(baseInput({ vehicleTypeFilter: 'EMOTO' }));
    expect(res.status).toBe(201);
    expect(res.body.vehicleTypeFilter).toBe('E_MOTO');
  });
});
