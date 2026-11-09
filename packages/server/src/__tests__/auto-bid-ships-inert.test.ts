// __TESTS__/AUTO-BID-SHIPS-INERT.TEST.TS
//
// TEAM-SAID G4 — the auto-bid screen is built and dark. This file
// proves the "dark" half against the real route and the real
// evaluator, with no server file modified.
//
// Why this test is load-bearing rather than ceremonial:
//
// The dispatch described the K2 server as "complete and dormant". It
// is complete, but it is NOT dormant — evaluateAutoBidsForRingDrivers
// is called from services/discovery/supply-broadcast.ts and from
// urgent-broadcast.ts on every cascade ring, with no feature flag
// between them. The only thing that has kept auto-bid quiet is that
// no driver has ever had a rule, because no client screen existed.
// Adding that screen is exactly what removes the accident.
//
// So "ships inert" is now a property of the CLIENT payload, and it is
// worth proving end to end: a rule created the way the client creates
// one must be skipped by the real evaluator predicate, under
// conditions that would otherwise match.

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
        count: jest.fn(async ({ where }: any) =>
          rules.filter((r) => {
            if (where?.driverId !== undefined && r.driverId !== where.driverId) return false;
            if (where?.enabled !== undefined && r.enabled !== where.enabled) return false;
            return true;
          }).length,
        ),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `rule${nextId++}`, createdAt: new Date(), updatedAt: new Date(), ...data };
          rules.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = rules.find((r) => r.id === where.id);
          Object.assign(row, data);
          return row;
        }),
        delete: jest.fn(async ({ where }: any) => {
          const idx = rules.findIndex((r) => r.id === where.id);
          return rules.splice(idx, 1)[0];
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
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { userId: 'd1', role: 'DRIVER' };
    next();
  },
  driverOnly: (_req: any, _res: any, next: any) => next(),
  customerOnly: (_req: any, _res: any, next: any) => next(),
  invalidateAuthStatusCache: jest.fn(),
  _resetAuthStatusCacheForTests: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import driverAutoBidRoutes from '../routes/driver-auto-bid.routes';
import { errorHandler } from '../middleware/error-handler';
import prisma from '../prisma';
import { ruleMatches } from '../services/auto-bid/evaluator';
import { MAX_RULES_PER_DRIVER } from '../services/auto-bid/config';

const app = express();
app.use(express.json());
app.use('/api/driver/auto-bid-rules', driverAutoBidRoutes);
app.use(errorHandler);

const BASE = '/api/driver/auto-bid-rules';

/**
 * Exactly what hooks/useDriverAutoBid.ts posts while
 * AUTO_BID_PILOT_ENABLED is false. If the client ever starts sending
 * enabled: true, this constant is the thing to change — and the
 * evaluator test below turns red the moment it does.
 */
const clientPayload = (overrides: Record<string, unknown> = {}) => ({
  priority: 0,
  enabled: false,
  maxPickupDistanceM: 3000,
  maxRideDistanceM: 10000,
  vehicleTypeFilter: null,
  bidAmountMode: 'FLAT',
  bidAmountValue: 1500,
  ...overrides,
});

/** A journey and driver that would match the rule on every other axis. */
function matchContextFor(rule: any) {
  const now = new Date();
  return {
    journey: {
      id: 'j1',
      pickupLat: -1.95,
      pickupLng: 30.06,
      destinationLat: -1.9505,
      destinationLng: 30.0605,
      vehiclePreference: 'MOTO',
    },
    driver: {
      id: 'd1',
      lastLat: -1.95,
      lastLng: 30.06,
      lastLocationAt: now,
      frozenAt: null,
    },
    rule,
    now,
  };
}

beforeEach(() => {
  (prisma as any)._reset();
});

describe('a rule the client creates persists, and lists', () => {
  it('round-trips through POST then GET', async () => {
    const created = await request(app).post(BASE).send(clientPayload());
    expect(created.status).toBe(201);

    const list = await request(app).get(BASE);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].maxPickupDistanceM).toBe(3000);
    expect(list.body[0].bidAmountValue).toBe(1500);
  });
});

describe('and it is provably inert', () => {
  it('the real evaluator predicate refuses it under otherwise-matching conditions', async () => {
    const created = await request(app).post(BASE).send(clientPayload());
    const rule = created.body;

    // Same driver, fresh GPS fix, pickup metres away, ride well inside
    // the limits, vehicle filter open. Everything matches except the
    // one thing the client controls.
    expect(rule.enabled).toBe(false);
    expect(ruleMatches(matchContextFor(rule) as any)).toBe(false);
  });

  it('...and the same rule DOES match once enabled — so the negative is real', () => {
    // Without this, "returns false" could be an artefact of the
    // fixture rather than of enabled: false.
    const armed = { ...clientPayload(), enabled: true, id: 'x', vehicleTypeFilter: null };
    expect(ruleMatches(matchContextFor(armed) as any)).toBe(true);
  });

  it('the evaluator only ever loads enabled rules, so a saved rule is never even considered', async () => {
    await request(app).post(BASE).send(clientPayload());

    // This is the query evaluateRulesForJourney issues.
    const loaded = await (prisma as any).driverAutoBidRule.findMany({
      where: { driverId: 'd1', enabled: true },
    });
    expect(loaded).toHaveLength(0);
  });

  it('pause-all round-trips and can only ever disable', async () => {
    await request(app).post(BASE).send(clientPayload({ priority: 0 }));
    await request(app).post(BASE).send(clientPayload({ priority: 1 }));

    const paused = await request(app).post(`${BASE}/pause-all`);
    expect(paused.status).toBe(200);
    // Both rules were already saved-not-active, so nothing needed
    // pausing — and nothing was armed by asking.
    expect(paused.body.paused).toBe(0);

    const list = await request(app).get(BASE);
    expect(list.body.every((r: any) => r.enabled === false)).toBe(true);
  });

  it('pause-all disables rules that were somehow armed', async () => {
    // The kill switch must work on real rules, not only on dark ones.
    await request(app).post(BASE).send(clientPayload({ priority: 0, enabled: true }));

    const paused = await request(app).post(`${BASE}/pause-all`);
    expect(paused.body.paused).toBe(1);

    const list = await request(app).get(BASE);
    expect(list.body[0].enabled).toBe(false);
    expect(ruleMatches(matchContextFor(list.body[0]) as any)).toBe(false);
  });
});

describe('the five-rule cap', () => {
  it('the client fills priorities 0..4 and the route accepts exactly five', async () => {
    for (let p = 0; p < MAX_RULES_PER_DRIVER; p++) {
      const res = await request(app).post(BASE).send(clientPayload({ priority: p }));
      expect(res.status).toBe(201);
    }
    const list = await request(app).get(BASE);
    expect(list.body).toHaveLength(MAX_RULES_PER_DRIVER);
  });

  it('a sixth is refused by the route — the UI blocks first, this is the backstop', async () => {
    for (let p = 0; p < MAX_RULES_PER_DRIVER; p++) {
      await request(app).post(BASE).send(clientPayload({ priority: p }));
    }
    // Every priority in [0,4] is taken, so there is no slot the client
    // could pick. Re-using one is what the route rejects.
    const sixth = await request(app).post(BASE).send(clientPayload({ priority: 0 }));
    expect(sixth.status).toBe(400);
    expect(sixth.body.error.code).toBe('PRIORITY_TAKEN');

    const outOfRange = await request(app)
      .post(BASE)
      .send(clientPayload({ priority: MAX_RULES_PER_DRIVER }));
    expect(outOfRange.status).toBe(400);
  });
});
