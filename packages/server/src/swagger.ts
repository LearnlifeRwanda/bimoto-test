import swaggerJSDoc from 'swagger-jsdoc';
import path from 'path';

const definition = {
  openapi: '3.0.3',
  info: {
    title: 'Bimoto API',
    version: '1.0.0',
    description:
      'Two-sided marketplace API for bike, moto & e-moto taxi rides in Rwanda. ' +
      'Offline-first PWA backend with escrow payments and fixed-price bidding.',
    contact: { name: 'Bimoto Engineering', email: 'engineering@bimoto.app' },
  },
  servers: [
    { url: '/', description: 'Current host' },
    { url: 'https://api.bimoto.app', description: 'Production (when configured)' },
  ],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'accessToken',
        description: 'HTTP-only session cookie set by /api/auth/verify-otp.',
      },
      requireAdmin: {
        type: 'apiKey',
        in: 'cookie',
        name: 'accessToken',
        description: 'Cookie auth + admin RBAC (role === ADMIN).',
      },
      flutterwaveSignature: {
        type: 'apiKey',
        in: 'header',
        name: 'verif-hash',
        description: 'Flutterwave webhook signature; rejected if absent or mismatched.',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'INVALID_INPUT' },
              message: { type: 'string', example: 'errors.invalidInput' },
            },
          },
        },
      },
    },
  },
  tags: [
    { name: 'Auth', description: 'Phone+OTP authentication, session refresh, logout.' },
    { name: 'Users', description: 'User profile, driver profile, verification, settings.' },
    { name: 'Journeys', description: 'Journey lifecycle: create, start, end, confirm, dispute.' },
    { name: 'Bids', description: 'Driver bidding on customer journeys.' },
    { name: 'Messages', description: 'In-journey chat between customer and driver.' },
    { name: 'Sync', description: 'Offline-first sync endpoints for the PWA.' },
    { name: 'Uploads', description: 'Photo uploads (verification documents, journey evidence).' },
    { name: 'Ratings', description: 'Post-journey driver/customer ratings.' },
    {
      name: 'Admin',
      description:
        'Admin-only endpoints (verification review, dispute resolution, audit chain inspection, monthly reports).',
    },
    {
      name: 'Admin - Freeze',
      description:
        'Account moderation: freeze/unfreeze users, hold pending payouts, audit trail.',
    },
    {
      name: 'Admin - Conflicts',
      description:
        'ConflictResolver: review and decide journey reconciliations, AML appeals, bid manipulation, GPS plausibility, stale-driver no-shows, photo mismatches.',
    },
    { name: 'Webhooks', description: 'External webhook receivers (Flutterwave payment events).' },
    { name: 'Payments', description: 'Customer-initiated charge endpoints (MoMo via Flutterwave).' },
    { name: 'Payout', description: 'Driver payout preferences and end-shift triggers.' },
    {
      name: 'Scheduled Rides',
      description: 'Future-dated ride bookings with custom pickup location.',
    },
    {
      name: 'Admin - Mobility Intelligence',
      description:
        'K-anonymous mobility aggregates: list rows, per-tier stats, on-demand cron trigger, tier-config inspection and reload. INTEL-DECK G4 split the guards by verb: the three reads admit ADMIN or the read-only ANALYST role (intelRead); the two mutations stay adminOnly.',
    },
    {
      name: 'Intel - Mobility Intelligence',
      description:
        'INTEL-DECK G5 — the ANALYST-readable export surface. Streams the same k-anonymised, marginal-suppressed aggregates as CSV or JSONL. Mounted at /api/intel rather than /api/admin because the reader is not an administrator; its import closure reaches MobilityAggregate and no identified table (see __tests__/intel-export-import-graph.test.ts).',
    },
    {
      name: 'DriverAutoBid',
      description:
        'Dispatch K2 — driver auto-bid rules. Pre-configure up to 5 rules that automatically bid on matching journeys reached via the K1 cascade.',
    },
    {
      name: 'Cooperative Leader',
      description:
        'Dispatch M — cooperative-leader dashboard, operational management (approve/reject/active), and manual on-behalf dispatch. All endpoints scoped to the leader\'s own cooperative.',
    },
    {
      name: 'Push',
      description:
        'Dispatch R2 — native push notification token registration. Devices register a FCM (Android) or APNS (iOS) token via /api/push/register on login and deactivate it on logout.',
    },
    {
      name: 'Admin - Funnel Metrics',
      description:
        'R3-FUNNEL-METRICS-DASHBOARD — admin-internal 4-stage funnel + 6 operational metrics for the 500-driver cooperative-led pilot. PII-rich and gated by adminOnly; distinct from the k-anonymity-gated Admin - Mobility Intelligence surface.',
    },
    {
      name: 'DriverScreener',
      description:
        'R3-DRIVER-SCREENER — in-app driver eligibility screener. 8 self-attested questions answered between consent and vehicle verification; eligibility result is the output of a pure function in @bimoto/shared. Backs the real screener-qualified count on the funnel dashboard.',
    },
    {
      name: 'Admin - Payouts',
      description:
        'PAYOUT-D — read-only money-operations surface: payout batch list/detail, operations summary (stuck/reversed/held/frozen counts), per-driver money view. Mutations stay on Admin - Freeze.',
    },
    {
      name: 'Geocode',
      description:
        'GEOCODE — LocationIQ proxy (address autocomplete + reverse geocoding, biased to Rwanda). The API key stays server-side; results are cached in-memory for 24 h. Answers 503 GEOCODING_UNAVAILABLE when LOCATIONIQ_API_KEY is unset — the client falls back to map + GPS.',
    },
    {
      name: 'Driver ID',
      description:
        'DRIVER-ID v3 — public live-validity lookup for driver numbers (jacket numbers). No auth, own rate-limit scope, uniform negative for every non-active case so the endpoint is not an existence oracle.',
    },
    {
      name: 'Health',
      description:
        'LAUNCH-TRUTH G6 — DB-aware health check. Documented so the swagger-parity gate holds: every registered handler is documented, every documented path has a handler.',
    },
    {
      name: 'Admin - Fee Waivers',
      description:
        'LAUNCH-TRUTH — pilot fee-waiver grants (12 LIFETIME / 500 TEMPORARY, caps enforced server-side). Grant / extend / revoke, every action a hash-chained AdminAction row with a required reason. Revocation is forward-only: rides already waived stay waived.',
    },
    {
      name: 'Simulation',
      description:
        'PREPROTO-SIM — simulated-SMS inbox for pilot runs (SMS_MODE=simulated). Delivers OTP codes, so access requires an admin session or the constant-time x-sim-inbox-token header; answers 503 when no token is configured (fail closed).',
    },
    {
      name: 'Map',
      description:
        'MAP-CACHE — offline Kigali map extract (single-file PMTiles, self-hosted to comply with the OSM tile usage policy). Range-capable download; answers 404 MAP_NOT_AVAILABLE until the ops bundle provisions MAP_PMTILES_PATH — the client stays on online tiles.',
    },
    {
      name: 'Diagnostics',
      description:
        'BLACKBOX / FLIGHT-RECORDER — the error-report bundle from one phone. Reached by an explicit tap on Send report and by the consented background uploader (stated at signup, switchable off in Settings). Both post the same serializer output, and entries arrive already redacted by the device.',
    },
  ],
};

const routesGlob = path.join(__dirname, 'routes', '*.routes.{ts,js}');

export const swaggerSpec = swaggerJSDoc({
  definition,
  apis: [routesGlob],
}) as Record<string, unknown> & { paths?: Record<string, Record<string, unknown>> };
