import express from 'express';
import swaggerUi from 'swagger-ui-express';
import request from 'supertest';
import { swaggerSpec } from '../swagger';
import { listRegisteredEndpoints } from './launch-truth-g6-swagger-parity.helper';

const VERBS = ['get', 'post', 'put', 'delete', 'patch'] as const;

const app = express();
app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'Bimoto API Docs',
  }),
);

describe('Swagger spec', () => {
  test('is a valid OpenAPI 3.0 object with paths', () => {
    expect(swaggerSpec).toMatchObject({
      openapi: expect.stringMatching(/^3\.0/),
      info: { title: expect.any(String), version: expect.any(String) },
    });
    expect(swaggerSpec.paths).toBeDefined();
    expect(Object.keys(swaggerSpec.paths || {}).length).toBeGreaterThan(0);
  });

  test('contains all 177 annotated endpoints across route files', () => {
    const paths = (swaggerSpec.paths ?? {}) as Record<string, Record<string, unknown>>;
    const endpoints = Object.values(paths).flatMap((p) =>
      Object.keys(p).filter((k) => (VERBS as readonly string[]).includes(k)),
    );
    // 96 existing + 7 from Dispatch K2 + 2 from K3
    // (POST /:id/suggest-up, GET /:id/customer-mode-status)
    // + 11 from Dispatch M (5 read dashboard + 5 management + 1
    // dispatch) + 3 from Dispatch R2 push routes (POST + DELETE
    // /api/push/register, POST /api/admin/push/test) + 1 from R3-E
    // (GET /api/journeys/:id/eta) + 2 from R3-N-4 (POST /:id/dispute-no-show,
    // POST /:id/redispatch) + 1 from R3-N-5 (GET /api/users/me/account-status)
    // + 1 from R3-LEGS (POST /api/journeys/:id/legs/:legId/complete)
    // + 1 from R3-DRIVER-TIER-STATS (GET /api/driver/stats)
    // + 1 from R3-DELIVERY-NOTIFICATIONS-2 (POST /api/journeys/:id/legs/:legId/activate)
    // + 2 from R3-FUNNEL-METRICS-DASHBOARD (GET /api/admin/funnel/metrics,
    //   GET /api/admin/funnel/export.csv)
    // + 2 from R3-DRIVER-SCREENER (POST + GET /api/drivers/me/screener)
    // + 1 from R3-PAYMENT-CARD-SERVER (POST /api/payments/initiate-card)
    // + 1 from R3-PAYMENT-CARD-ACCEPT-BID (POST /api/journeys/:id/accept-bid-card)
    // + 1 from PAYOUT-C (GET /api/payout/summary)
    // + 4 from PAYOUT-D (GET /api/admin/payouts/batches, GET
    //   /api/admin/payouts/batches/:id, GET /api/admin/payouts/summary,
    //   GET /api/admin/payouts/driver/:driverId)
    // + 2 from GEOCODE (GET /api/geocode/search, GET /api/geocode/reverse)
    // + 1 from AML-FP G5 (GET /api/admin/aml-flags/precision)
    // + 1 from DRIVER-ID G2 (POST /api/admin/verifications/:userId/revoke)
    // + 1 from DRIVER-ID G3 (GET /api/driver-id/:number)
    // + 1 from DRIVER-ID G4 (PUT /api/users/me/driver-profile)
    // + 4 from LAUNCH-TRUTH G2 (GET /api/admin/fee-waivers, POST
    //   /driver/:driverId/grant, POST /:waiverId/extend,
    //   POST /:waiverId/revoke)
    // + 2 from LAUNCH-TRUTH G6 (GET /api/health, POST /api/sms/inbound —
    //   pre-existing undocumented handlers surfaced by the parity test
    //   below and documented as the trivial fix).
    // + 2 from PREPROTO-SIM G3 (GET /api/sim/messages, GET /api/sim/inbox)
    // + 2 from PILOT-INSTRUMENT (POST /api/journeys/:id/pickup-verification,
    //   GET /api/admin/pickup-verifications/summary)
    // + 2 from MAP-CACHE (GET /api/map/kigali.pmtiles,
    //   GET /api/geocode/directions)
    // + 1 from DOC-GUARD G2 (GET /api/documents/:key — the
    //   authenticated replacement for the express.static /uploads
    //   mount, which was a handler the parity test could not see at
    //   all. Documents stored before that dispatch are read through
    //   this same endpoint with an encoded key, so there is one
    //   endpoint rather than two)
    // + 3 from BLACKBOX G4 (POST /api/diagnostics/error-report — the
    //   user-tapped Send report path; GET /api/admin/error-reports and
    //   GET /api/admin/error-reports/:id/export.json — the team's
    //   read-and-forward surface)
    // + 2 from MAP-RWANDA G2 (GET /api/map/regions — the
    //   filesystem-derived list of provisioned offline archives; and
    //   GET /api/map/{region}.pmtiles — the same archive contract as
    //   the Kigali route for every other region. The Kigali route is
    //   still counted above and still registered separately, so old
    //   apps in the field keep the path they know)
    // + 2 from FLIGHT-RECORDER G4 (GET /api/admin/error-reports/groups —
    //   the exact-count grouping BLACKBOX deliberately left out while
    //   every report was a deliberate tap; and GET
    //   /api/admin/error-reports/export.jsonl — the machine-readable
    //   firehose, one report per line)
    // + 1 from INTEL-DECK G5 (GET /api/intel/aggregates/export — the
    //   analyst's way out of the reading room: the same k-anonymised,
    //   marginal-suppressed rows the screen shows, streamed as CSV or
    //   JSONL. Mounted at /api/intel rather than /api/admin because the
    //   reader is the read-only ANALYST role, not an administrator)
    // + 2 from TEAM-ANSWERS (POST /api/journeys/:id/report — the
    //   driver's incident report about a ride he drove, feeding the
    //   admin conflicts dashboard as ConflictType RIDE_REPORT; and
    //   POST /api/journeys/:id/bids/:bidId/decline — the passenger
    //   declining ONE driver's offer without accepting anybody)
    // ACCOUNT-RIGHTS-CORE G2 — 170 -> 171: POST
    // /api/users/me/deletion/cancel, the way out of the 72-hour deletion
    // window. DELETE /api/users/me was not added or removed, only
    // re-documented: it now opens the window instead of erasing.
    // ACCOUNT-RIGHTS-SURFACE G1 — 171 -> 172: GET
    // /api/admin/deletion-requests, the ops view of the deletion queue and
    // of why a due erasure has not run (`deferredReason`).
    // EXPORT-AND-LEDGER G3 — 172 -> 171, and the first DECREASE this
    // counter has ever recorded. Founder decision D10 removed POST
    // /api/journeys/:id/customer-complete along with its OpenAPI block, so
    // the app has one way to end a ride rather than two. This pin is the
    // oracle that caught it: the D10 census greps found the route, the
    // service, both guards and the socket event, and did NOT find this
    // number, because a count is not a name.
    // MONEY-PIN G2 — 171 -> 177: the six money-PIN doors, all under
    // /api/users/me/money-pin. GET (status), POST (first-time set), POST
    // /verify (opens the step-up session), POST /change (old PIN in, new
    // PIN out, immediate), POST /reset/request (sends the SMS code) and
    // POST /reset/confirm (writes the pending PIN 24 hours out). They are
    // deliberately NOT behind requireMoneyStepUp — they are the gate's own
    // doors, and putting the gate in front of them would lock every one of
    // them behind itself.
    // COUNTER-READY G2 — 177 -> 179: the two counter doors, both under
    // /api/journeys/:id/bids/:bidId. POST /counter (the passenger's one
    // suggestion) and POST /counter/respond (the motari's answer). Both
    // ship DORMANT behind COUNTER_BID_ENABLED and answer 403
    // COUNTER_DISABLED until the founder flips it — the routes exist in
    // APK 14, the experiment does not.
    expect(endpoints.length).toBe(179);
  });

  test('declares all 30 tags', () => {
    const tagNames = (((swaggerSpec as unknown) as { tags?: { name: string }[] }).tags ?? []).map(
      (t) => t.name,
    );
    expect(tagNames).toEqual(
      expect.arrayContaining([
        'Auth',
        'Users',
        'Journeys',
        'Bids',
        'Messages',
        'Sync',
        'Uploads',
        'Ratings',
        'Admin',
        'Admin - Freeze',
        'Admin - Conflicts',
        'Webhooks',
        'Payments',
        'Payout',
        'Scheduled Rides',
        'Admin - Mobility Intelligence',
        'DriverAutoBid',
        'Cooperative Leader',
        'Push',
        'Admin - Funnel Metrics',
        'DriverScreener',
        'Admin - Payouts',
        'Geocode',
        'Driver ID',
        'Admin - Fee Waivers',
        'Health',
        'Simulation',
        'Map',
        'Diagnostics',
        'Intel - Mobility Intelligence',
      ]),
    );
    expect(tagNames.length).toBe(30);
  });

  // LAUNCH-TRUTH G6.3 — parity in BOTH directions. The census above
  // counts entries; it cannot catch a documented-but-unimplemented
  // endpoint (a vehicle-update PUT was documented but never implemented
  // and shipped undetected until #110) or an implemented-but-invisible
  // one. This test walks the actual express routers mounted in index.ts
  // and diffs them against the spec.
  describe('documentation parity', () => {
    // Deliberately undocumented, with the reason on record:
    //   GET /api/docs.json — serves the spec itself; swagger-jsdoc only
    //   scans routes/*.routes.ts and self-describing the docs endpoint
    //   inside the docs adds nothing.
    const UNDOCUMENTED_ALLOWED = new Set(['GET /api/docs.json']);

    const VERB_SET = new Set<string>(VERBS as readonly string[]);
    const documented = new Set(
      Object.entries((swaggerSpec.paths ?? {}) as Record<string, Record<string, unknown>>)
        .flatMap(([p, ops]) =>
          Object.keys(ops)
            .filter((k) => VERB_SET.has(k))
            .map((k) => `${k.toUpperCase()} ${p}`),
        ),
    );
    const registered = new Set(
      listRegisteredEndpoints().map((e) => `${e.method.toUpperCase()} ${e.path}`),
    );

    test('every documented path has a registered handler', () => {
      const ghosts = [...documented].filter((d) => !registered.has(d));
      expect(ghosts).toEqual([]);
    });

    test('every registered handler is documented (or explicitly allowlisted)', () => {
      const undocumented = [...registered].filter(
        (r) => !documented.has(r) && !UNDOCUMENTED_ALLOWED.has(r),
      );
      expect(undocumented).toEqual([]);
    });

    test('the allowlist stays honest — no stale entries', () => {
      const stale = [...UNDOCUMENTED_ALLOWED].filter(
        (a) => !registered.has(a) || documented.has(a),
      );
      expect(stale).toEqual([]);
    });
  });

  test('GET /api/docs.json returns the JSON spec', async () => {
    const res = await request(app).get('/api/docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\.0/);
    expect(res.body.paths).toBeDefined();
  });

  test('GET /api/docs/ renders the Swagger UI', async () => {
    const res = await request(app).get('/api/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });
});
