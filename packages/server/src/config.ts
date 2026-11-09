import { z } from 'zod';

// PREPROTO-AUTH G4 — fail closed on placeholder/known-default secrets.
// A deployment that ships the .env.example value (or a test fixture
// value) must refuse to start rather than sign real sessions with a
// public string.
const KNOWN_DEFAULT_SECRETS = new Set([
  'change-this-to-a-random-64-char-string',
  'change-this-to-a-different-random-64-char-string',
  'change-this-to-a-32-byte-hex-string',
  'test-jwt-secret-at-least-16-chars',
  'test-refresh-secret-at-least-16-chars',
  'secret',
  'changeme',
]);

const strongSecret = (name: string) =>
  z
    .string()
    .min(32, `${name} must be at least 32 characters`)
    .refine((v) => !KNOWN_DEFAULT_SECRETS.has(v), {
      message: `${name} is a known default/placeholder value — generate a real random secret`,
    });

// PILOT-GUARD amendment — exported so pilot-guard-ci-boot-combos.test.ts
// can resolve a workflow env block through the SAME defaults the server
// applies at boot, instead of a hand-copied list that would drift.
export const envSchema = z.object({
  DATABASE_URL: z.string(),
  // DB-RESILIENCE G1 — explicit Prisma pool sizing (defaults suit the
  // single-machine pilot; see prisma.ts for the arithmetic). Applied as
  // connection_limit / pool_timeout / connect_timeout URL parameters
  // unless DATABASE_URL already carries them (an explicit URL wins).
  DB_POOL_SIZE: z.string().default('30').transform(Number),
  DB_POOL_TIMEOUT_SECONDS: z.string().default('10').transform(Number),
  DB_CONNECT_TIMEOUT_SECONDS: z.string().default('5').transform(Number),
  JWT_SECRET: strongSecret('JWT_SECRET'),
  JWT_REFRESH_SECRET: strongSecret('JWT_REFRESH_SECRET'),
  ENCRYPTION_KEY: z.string().min(32),
  // PREPROTO-AUTH G1 — dedicated key for the OTP-at-rest HMAC. Optional:
  // falls back to ENCRYPTION_KEY (utils/crypto.hmacOtp), but a weak value
  // (set-but-short) is a hard startup error, never a silent downgrade.
  OTP_HMAC_KEY: z.string().min(32).optional(),
  // PREPROTO-AUTH G2 — wrong guesses allowed per OTP code before the code
  // is invalidated (even the correct code is rejected afterwards).
  OTP_MAX_ATTEMPTS: z.string().default('5').transform(Number),
  // PREPROTO-AUTH G4 — session cookies carry the Secure flag whenever
  // this is true (default), independent of NODE_ENV: the HTTPS tunnel in
  // front of a development-mode server still gets Secure cookies. Only
  // set to 'false' for plain-HTTP local development.
  COOKIE_SECURE: z.string().default('true').transform((v) => v === 'true'),
  // PREPROTO-AUTH G5 — comma-separated CORS allow-list. Empty = allow
  // only CLIENT_URL (back-compat). Origins are matched exactly; the
  // server never reflects req.headers.origin.
  CORS_ORIGINS: z.string().default(''),
  // PREPROTO-AUTH G5 — express trust-proxy setting. 'false' (default) =
  // no proxy; 'true' = exactly one trusted hop (e.g. Cloudflare Tunnel);
  // a number/preset string is passed through to express.
  TRUST_PROXY: z.string().default('false'),
  PORT: z.string().default('3000').transform(Number),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SKIP_DRIVER_VERIFICATION: z.string().default('false').transform(v => v === 'true'),
  FLW_PUBLIC_KEY: z.string().default(''),
  FLW_SECRET_KEY: z.string().default(''),
  FLW_ENCRYPTION_KEY: z.string().default(''),
  FLW_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  // PREPROTO-SIM G1 — pilot simulation switches. 'simulated' swaps the
  // gateway client / SMS transport for in-process fakes; the 'live' code
  // paths are untouched. Startup aborts if a simulated mode could be
  // confused with real money (see startup-guard.ts).
  PAYMENTS_MODE: z.enum(['live', 'simulated']).default('live'),
  SMS_MODE: z.enum(['live', 'simulated']).default('live'),
  // SENDER-MATCH-2 — which SMS commands a registered user may actually run.
  //
  // SMS authenticates by CALLER ID. That is a weaker credential than the
  // app's session, and the surface that attacks it — MSISDN spoofing toward
  // an aggregator, a borrowed handset, a second SIM — is not something a
  // pilot can simulate its way to confidence about. Yet the fixed sender
  // lookup would hand caller-ID senders STRONGER powers than the app grants:
  // a driver's YES performing the customer's confirmation and releasing his
  // own payment, against #177's customerOnly model.
  //
  // So 'safe' (the default, and the pilot's mode) leaves rights and reads
  // on — STOP, HELP, STATUS, BALANCE, and the parcel-recipient receipt
  // flows — and answers every money or marketplace command with "use the
  // app". 'full' is the whole command set, and exists so the gated paths
  // can be tested; startup-guard.ts refuses to boot it against live
  // payments, so the flag alone can never open SMS money actions onto real
  // francs without a code change and the design conversation that owes.
  SMS_COMMAND_TIER: z.enum(['safe', 'full']).default('safe'),
  // SENDER-MATCH-2 — the support number the HELP reply offers, in E.164.
  //
  // The HELP template shipped reading "Support +250 XXX XXX XXX." — a
  // placeholder, never noticed because HELP had never once run for a
  // registered user (the sender lookup matched nobody). This launch
  // activates it. Unset means the support clause is OMITTED: a real number
  // or silence, never a placeholder pointing nowhere.
  SUPPORT_PHONE: z.string().default(''),
  // PAY-TRUTH G4 — what the SIMULATED gateway does when asked to charge.
  //
  // The simulated client used to succeed unconditionally, which is why
  // three APKs reached Kigali with a money path nobody could break: under
  // PAYMENTS_MODE=simulated there was no failure a tester could produce,
  // so none of docs/payment-failure-matrix.md was reachable in the field.
  // Setting this makes the fake gateway fail the way a real one does —
  // through the same axios-shaped errors mapFlwError classifies, so the
  // whole live code path above the SDK runs unchanged.
  //
  // Only meaningful when PAYMENTS_MODE=simulated; startup-guard.ts refuses
  // to boot if it is set against a live gateway.
  SIMULATED_FAILURE_MODE: z
    .enum(['none', 'insufficient_funds', 'invalid_wallet', 'declined', 'timeout', 'gateway_down'])
    .default('none'),
  // Deliberate, documented override for running a simulated pilot on a
  // production-mode server (e.g. behind the Cloudflare Tunnel doorway).
  ALLOW_SIMULATED_IN_PROD: z.string().default('false').transform((v) => v === 'true'),
  // PILOT-GUARD Item 4 — the payments kill-switch enters the law.
  //
  // E2E_FAKE_PAYMENTS=1 makes chargeCard return a synthetic SUCCESS
  // without touching the gateway, and lets the bid and payment-retry
  // rails drive an escrow PENDING→HELD against a synthetic 'e2e-' tx id.
  // It is read at six production sites (services/payment/charge.ts,
  // bid.service.ts, routes/payment.routes.ts, and the three
  // conflict-resolver refund paths) and was set in exactly one place,
  // .github/workflows/e2e.yml — but it appeared in no schema, no
  // .env.example, and no startup guard. A server booted with
  // PAYMENTS_MODE=live and E2E_FAKE_PAYMENTS=1 started cleanly and
  // marked escrows HELD for money that had never moved.
  //
  // Declaring it here is half the fix; startup-guard.ts refuses the
  // live+1 combination, for the reason assertSmsCommandTierSafety gives
  // about its own ruling: one that lives only in a default is one env
  // var away from being undone by someone who does not know it exists.
  E2E_FAKE_PAYMENTS: z.enum(['0', '1']).default('0'),
  // PREPROTO-SIM G3 — bearer token for the simulated-SMS inbox. The inbox
  // delivers OTP codes (an account-takeover surface), so a set-but-weak
  // token is a hard startup error, never a silent downgrade. Empty =
  // token access disabled; admin sessions still work, and the /api/sim
  // routes answer 503 when simulated SMS runs with no token configured.
  SIM_INBOX_TOKEN: z
    .string()
    .default('')
    .refine((v) => v === '' || v.length >= 32, {
      message: 'SIM_INBOX_TOKEN must be at least 32 characters (or unset)',
    }),
  // Server-side only — never expose to the client. When empty, the
  // /api/geocode routes answer 503 GEOCODING_UNAVAILABLE and the app
  // falls back to map + GPS (see services/geocoding/locationiq.ts).
  LOCATIONIQ_API_KEY: z.string().default(''),
  // MAP-CACHE G1 — absolute path to the Kigali PMTiles extract served at
  // GET /api/map/kigali.pmtiles. The file ships with the Kigali update
  // bundle (ops-side); when unset or missing on disk the route answers a
  // clean 404 MAP_NOT_AVAILABLE and the client stays on online tiles.
  MAP_PMTILES_PATH: z.string().default(''),
  // SOS-WIRE G1 — designated ops phone that receives an SMS on every
  // rider emergency (POST /journeys/:id/emergency). Empty = the ops-SMS
  // channel is skipped with a server log warning; the other emergency
  // channels (socket alerts, contact SMS) still fire.
  EMERGENCY_OPS_PHONE: z.string().default(''),
  // GROUNDSKEEPER G2 — five keys that were read straight from process.env
  // and so bypassed this schema entirely. Absence must not break a dev
  // boot, so every one defaults; presence gets its shape validated, and
  // each carries the consequence of leaving it unset.
  //
  // Africa's Talking credentials. Empty is fine for development and for
  // SMS_MODE=simulated; a PRODUCTION server on SMS_MODE=live refuses to
  // start without AT_API_KEY (startup-guard.ts) rather than silently
  // sending nothing. AT_USERNAME's 'sandbox' default is Africa's
  // Talking's own sandbox account name and matches the previous inline fallback.
  AT_API_KEY: z.string().default(''),
  AT_USERNAME: z.string().default('sandbox'),
  // Flutterwave webhook signature secret (routes/webhook.routes.ts). Empty
  // = webhook signatures are not verified; the route logs a Sentry warning
  // and the money path trusts an unauthenticated caller.
  FLW_SECRET_HASH: z.string().default(''),
  // Sentry DSN. Empty = error monitoring is off (jobs check it before
  // capturing). A malformed value would silently drop every event, so a
  // set-but-unparseable DSN is a startup error instead.
  SENTRY_DSN: z
    .string()
    .default('')
    .refine((v) => v === '' || /^https?:\/\/.+@.+\/.+$/.test(v), {
      message: 'SENTRY_DSN must be a Sentry DSN URL (https://<key>@<host>/<project>) or unset',
    }),
  // BNR monthly compliance report output directory. Empty = the default
  // ~/.bimoto/reports/bnr (services/bnr-report/config.ts).
  BNR_REPORT_DIR: z.string().default(''),
  // COUNTER-READY G2 — the dormant switch for one-counter-per-bid.
  //
  // Ruling D4 (24 Aug) decided the counter-offer; the dormant-shipping
  // decision (25 Aug) decided WHEN. The experiment starts only after
  // weeks of plain-bidding baseline, so the whole machinery ships in APK
  // 14 asleep and Update 7 is an env flip on the pilot Mac — no new
  // build, no store round, no APK. That is the SENDER-MATCH precedent
  // exactly (the money tier shipped gated behind SMS_COMMAND_TIER).
  //
  // A SERVER env var and deliberately NOT a Vite one: VITE_* is baked
  // into the bundle at build time, so a client-side flag would need a
  // new APK to flip — the one thing this is designed to avoid. The
  // client learns the value from /api/health, on the same boot-time
  // probe that already carries PAYMENTS_MODE and SMS_MODE.
  //
  // Default false, and false is the safe direction: an unreachable
  // health endpoint never ENABLES a dormant feature, the mirror image of
  // the simulation store's "an unreachable health endpoint never paints
  // real money as fake".
  COUNTER_BID_ENABLED: z.string().default('false').transform((v) => v === 'true'),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.format());
    // In test mode, use defaults
    if (process.env.NODE_ENV === 'test') {
      return {
        DATABASE_URL: 'postgresql://test:test@localhost:5432/bimoto_test',
        DB_POOL_SIZE: 30,
        DB_POOL_TIMEOUT_SECONDS: 10,
        DB_CONNECT_TIMEOUT_SECONDS: 5,
        JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
        JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16-chars',
        ENCRYPTION_KEY: 'a'.repeat(64),
        OTP_HMAC_KEY: undefined,
        OTP_MAX_ATTEMPTS: 5,
        // Tests exercise plain-HTTP supertest requests; mirrors the old
        // NODE_ENV-driven behaviour (secure only outside dev/test).
        COOKIE_SECURE: false,
        CORS_ORIGINS: '',
        TRUST_PROXY: 'false',
        PORT: 3000,
        CLIENT_URL: 'http://localhost:5173',
        NODE_ENV: 'test' as const,
        SKIP_DRIVER_VERIFICATION: true,
        FLW_PUBLIC_KEY: '',
        FLW_SECRET_KEY: '',
        FLW_ENCRYPTION_KEY: '',
        FLW_ENV: 'sandbox' as const,
        PAYMENTS_MODE: 'live' as const,
        SMS_MODE: 'live' as const,
        SMS_COMMAND_TIER: 'safe' as const,
        SUPPORT_PHONE: '',
        SIMULATED_FAILURE_MODE: 'none' as const,
        ALLOW_SIMULATED_IN_PROD: false,
        E2E_FAKE_PAYMENTS: '0' as const,
        SIM_INBOX_TOKEN: '',
        LOCATIONIQ_API_KEY: '',
        MAP_PMTILES_PATH: '',
        EMERGENCY_OPS_PHONE: '',
        AT_API_KEY: '',
        AT_USERNAME: 'sandbox',
        FLW_SECRET_HASH: '',
        SENTRY_DSN: '',
        BNR_REPORT_DIR: '',
        // COUNTER-READY G2 — dormant in tests too, so the disabled arm
        // is what a suite gets unless it says otherwise. The enabled arm
        // is exercised by overriding config.COUNTER_BID_ENABLED.
        COUNTER_BID_ENABLED: false,
      };
    }
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
