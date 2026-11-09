// INTEL-DECK G4 — the ANALYST access contract, as one file.
//
// This is not a unit test of a guard; it is the negative matrix the
// dispatch asked for, enumerated from the live route table
// (docs/intel-deck-evidence.md §3). Every router an analyst must be
// refused by is mounted here against the REAL guard middleware and
// asserted to answer 403.
//
// The point of writing it as a matrix rather than a handful of spot
// checks: an ANALYST token is admitted by exactly one guard in
// middleware/auth.ts (intelRead) and refused by every other, and that
// property is what makes the role safe. If someone later widens a guard
// to admit ANALYST — or invents a guard that admits by default — a row
// here goes red and names the router.
//
// The honest exception is stated at the bottom rather than hidden: five
// self-scoped reads carry authMiddleware only. They do not 403; they
// filter by req.user.userId and hand an analyst back their own empty
// set. That is asserted too, because "returns nothing identified" is
// the actual guarantee and it deserves a test rather than a footnote.

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import {
  authMiddleware,
  adminOnly,
  driverOnly,
  customerOnly,
  intelRead,
} from '../middleware/auth';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';

const analystToken = generateAccessToken({ userId: 'analyst-1', role: 'ANALYST' });
const adminToken = generateAccessToken({ userId: 'admin-1', role: 'ADMIN' });
const customerToken = generateAccessToken({ userId: 'cust-1', role: 'CUSTOMER' });
const driverToken = generateAccessToken({ userId: 'drv-1', role: 'DRIVER' });

type Guard = typeof adminOnly;

/** The denied families, each named by the mount it guards in index.ts. */
const DENYLIST: Array<{ mount: string; guard: Guard; family: string }> = [
  // Every admin surface. All thirteen are router-level adminOnly except
  // /api/admin/push, which applies it per-route; the guard is the same.
  { mount: '/api/admin', guard: adminOnly, family: 'admin dashboard, users, freezes' },
  { mount: '/api/admin/aml-flags', guard: adminOnly, family: 'AML flags' },
  { mount: '/api/admin/bnr-reports', guard: adminOnly, family: 'BNR compliance reports' },
  { mount: '/api/admin/conflicts', guard: adminOnly, family: 'conflicts' },
  { mount: '/api/admin/error-reports', guard: adminOnly, family: 'error reports' },
  // SOS-FOLLOW G3/G5 — the live-follow ops surface. An emergency is the
  // one circumstance in which anybody may watch a ride, and "anybody"
  // means the role that can act on it. An analyst reads aggregates; they
  // do not get a live position for a named person.
  { mount: '/api/admin/emergency', guard: adminOnly, family: 'emergency alerts + live follow' },
  { mount: '/api/admin/fee-waivers', guard: adminOnly, family: 'fee waivers' },
  { mount: '/api/admin/freeze', guard: adminOnly, family: 'account freezes' },
  { mount: '/api/admin/funnel', guard: adminOnly, family: 'funnel metrics' },
  { mount: '/api/admin/payouts', guard: adminOnly, family: 'payouts' },
  { mount: '/api/admin/pickup-verifications', guard: adminOnly, family: 'pickup verifications' },
  { mount: '/api/admin/push', guard: adminOnly, family: 'push broadcast' },
  { mount: '/api/admin/sms-inbound', guard: adminOnly, family: 'inbound SMS' },
  // Operational role families.
  { mount: '/api/journeys/create', guard: customerOnly, family: 'journey creation' },
  { mount: '/api/journeys/accept-bid', guard: customerOnly, family: 'bid acceptance' },
  { mount: '/api/journeys/start', guard: driverOnly, family: 'ride start/end' },
  { mount: '/api/journeys/bids', guard: driverOnly, family: 'bidding' },
  { mount: '/api/bids/my-history', guard: driverOnly, family: 'bid history' },
  { mount: '/api/documents/upload', guard: driverOnly, family: 'driver documents' },
  { mount: '/api/payout', guard: driverOnly, family: 'driver payouts' },
  { mount: '/api/payments', guard: customerOnly, family: 'payments' },
  { mount: '/api/driver/auto-bid-rules', guard: driverOnly, family: 'auto-bid rules' },
  { mount: '/api/driver/stats', guard: driverOnly, family: 'driver stats' },
  { mount: '/api/drivers/me', guard: driverOnly, family: 'driver screener' },
  { mount: '/api/users/me/location', guard: driverOnly, family: 'driver location' },
  { mount: '/api/scheduled-rides', guard: driverOnly, family: 'scheduled rides (driver)' },
];

function appFor(guard: Guard, mount: string) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.get(mount, authMiddleware, guard, (_req, res) => {
    res.json({ reached: true });
  });
  app.use(errorHandler);
  return app;
}

describe('INTEL-DECK — an ANALYST token is refused by every denied family', () => {
  for (const { mount, guard, family } of DENYLIST) {
    test(`403 on ${mount} (${family})`, async () => {
      const res = await request(appFor(guard, mount))
        .get(mount)
        .set('Cookie', [`accessToken=${analystToken}`]);
      expect(res.status).toBe(403);
      expect(res.body.reached).toBeUndefined();
    });
  }

  test('the matrix covers every admin mount in index.ts', () => {
    // A guard rail on the guard rail: if a new /api/admin/* router is
    // mounted and nobody adds it here, this count drifts and the failure
    // names the omission rather than silently shrinking the matrix.
    const adminRows = DENYLIST.filter((d) => d.mount.startsWith('/api/admin'));
    expect(adminRows).toHaveLength(13);
    expect(adminRows.every((d) => d.guard === adminOnly)).toBe(true);
  });
});

describe('INTEL-DECK — the one guard that admits an ANALYST', () => {
  test('intelRead admits ANALYST', async () => {
    const res = await request(appFor(intelRead, '/api/admin/mobility/aggregates'))
      .get('/api/admin/mobility/aggregates')
      .set('Cookie', [`accessToken=${analystToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.reached).toBe(true);
  });

  test('intelRead admits ADMIN — nothing an admin could read before is lost', async () => {
    const res = await request(appFor(intelRead, '/api/admin/mobility/aggregates'))
      .get('/api/admin/mobility/aggregates')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
  });

  test('intelRead refuses CUSTOMER, DRIVER and the unauthenticated alike', async () => {
    const app = appFor(intelRead, '/api/intel/aggregates/export');
    for (const token of [customerToken, driverToken]) {
      const res = await request(app)
        .get('/api/intel/aggregates/export')
        .set('Cookie', [`accessToken=${token}`]);
      expect(res.status).toBe(403);
    }
    const anon = await request(app).get('/api/intel/aggregates/export');
    expect(anon.status).toBe(401);
  });
});

describe('INTEL-DECK — the existing roles are unchanged by the new one', () => {
  test('adminOnly still admits ADMIN and refuses everyone else', async () => {
    const app = appFor(adminOnly, '/api/admin');
    const ok = await request(app).get('/api/admin').set('Cookie', [`accessToken=${adminToken}`]);
    expect(ok.status).toBe(200);
    for (const token of [customerToken, driverToken, analystToken]) {
      const res = await request(app).get('/api/admin').set('Cookie', [`accessToken=${token}`]);
      expect(res.status).toBe(403);
    }
  });

  test('driverOnly and customerOnly are untouched by ANALYST existing', async () => {
    const driverApp = appFor(driverOnly, '/api/driver/stats');
    const asDriver = await request(driverApp)
      .get('/api/driver/stats')
      .set('Cookie', [`accessToken=${driverToken}`]);
    expect(asDriver.status).toBe(200);

    const customerApp = appFor(customerOnly, '/api/payments');
    const asCustomer = await request(customerApp)
      .get('/api/payments')
      .set('Cookie', [`accessToken=${customerToken}`]);
    expect(asCustomer.status).toBe(200);
  });
});

describe('INTEL-DECK — the self-scoped exception, stated honestly', () => {
  // GET /api/journeys (journey.routes.ts:274), GET /api/journeys/:id
  // (:609), /api/users/me, /api/diagnostics and /api/sync carry
  // authMiddleware and no role guard. They do not 403 an analyst; they
  // filter by req.user.userId. An analyst is the customer of no journey
  // and the driver of none, so what comes back is empty. This models
  // that handler shape exactly.
  function selfScopedApp() {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.get('/api/journeys', authMiddleware, (req, res) => {
      const rows = [
        { id: 'j1', customerId: 'cust-1', pickupName: 'Nyabugogo' },
        { id: 'j2', driverId: 'drv-1', pickupName: 'Kacyiru' },
      ].filter(
        (j) =>
          (j as any).customerId === req.user?.userId ||
          (j as any).driverId === req.user?.userId,
      );
      res.json({ journeys: rows });
    });
    app.use(errorHandler);
    return app;
  }

  test('an ANALYST reads no journey through the self-scoped list', async () => {
    const res = await request(selfScopedApp())
      .get('/api/journeys')
      .set('Cookie', [`accessToken=${analystToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.journeys).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('Nyabugogo');
  });

  test('the same endpoint does return a customer their own journey', async () => {
    const res = await request(selfScopedApp())
      .get('/api/journeys')
      .set('Cookie', [`accessToken=${customerToken}`]);
    expect(res.body.journeys).toHaveLength(1);
  });
});
