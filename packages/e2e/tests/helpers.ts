import { expect, type APIRequestContext, type BrowserContext, type Page, request } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { createRequire } from 'node:module';

// ONBOARD-EASE gate fix — @bimoto/shared builds as CommonJS, and this file is
// the e2e project's first RUNTIME import of it: named ESM imports throw
// "Named export not found" under the Node ESM loader (CI run #722's exact
// error). createRequire is the interop that works regardless of tsconfig
// interop flags; the type assertion keeps the constants typed.
const requireShared = createRequire(import.meta.url);
const { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } =
  requireShared('@bimoto/shared') as typeof import('@bimoto/shared');

const API = process.env.E2E_API_URL || 'http://localhost:3000';

// The seed creates these users with stable, known phone numbers. Phones are
// stored encrypted in the DB (`phoneHash` is sha256), so the test cannot
// recover them from a Prisma read; hard-coding here matches the seed.
export const SEED_USERS = {
  TestCustomer: { phone: '+250781234567', role: 'CUSTOMER' as const },
  TestDriver: { phone: '+250789876543', role: 'BOTH' as const },
  // R3-E2E-EXPANSION — admin actor for the disputed-flow spec. Matches the
  // ADMIN user seeded in packages/server/prisma/seed.ts (adminPhone).
  TestAdmin: { phone: '+250780000000', role: 'ADMIN' as const },
  // FEED-SCHEMA — the one seeded pure-DRIVER-role user (EBikeJean in
  // seed.ts). The driver dashboard's feed request relies on the auth
  // role reaching the driver branch, so the feed walk needs a user
  // whose role IS 'DRIVER' (TestDriver is BOTH and would fall into the
  // customer branch — see the FEED-SCHEMA completion report).
  EBikeJean: { phone: '+250781000004', role: 'DRIVER' as const },
} as const;

export type SeedUserName = keyof typeof SEED_USERS;

const prisma = new PrismaClient();

export interface AuthSession {
  user: {
    id: string;
    nickname: string;
    role: string;
    language: string;
    privacyConsentAt: string;
    privacyConsentVersion: string;
    termsAcceptedAt: string;
    termsAcceptedVersion: string;
    idVerified: boolean;
    licenseVerified: boolean;
    completedRides: number;
    cancellationCount: number;
    totalRequests: number;
  };
  /** JWT extracted from the accessToken cookie set by /api/auth/verify-otp. */
  accessToken: string;
  /** Cookies usable with browserContext.addCookies for HTTP auth. */
  cookies: Array<{ name: string; value: string; domain: string; path: string }>;
  /** APIRequestContext with auth cookies set, for further API calls. */
  api: APIRequestContext;
}

/**
 * Drive an OTP login through the real request/verify endpoints.
 *
 * PREPROTO-AUTH G1 stores only hmacOtp(code) in OtpCode.code, so the
 * plaintext can no longer be read from the DB. Under NODE_ENV=test the
 * server returns the plaintext as `testOtp` on the request-otp response
 * (a test-only seam gated inside otp.service — the field does not exist
 * in any other environment), and that is what we submit here.
 *
 * Also accepts privacy + terms on the user's behalf so ProtectedRoute lets
 * the page render past /consent.
 */
/**
 * CUTGUARD v2 amendment — the version this e2e client represents.
 *
 * The suite stands in for the REAL v14 app, so it must say so on every
 * request. Until it did, `X-App-Version` was absent, the server correctly
 * read that as LEGACY (middleware/app-version.ts: absent ⇒ 0), and the
 * specs silently exercised the v13 path while asserting v14 behaviour.
 * One assertion noticed (the savings preview); the rest were passing for
 * the wrong reason, which is worse.
 *
 * Kept as a constant rather than a literal at the call site so the next
 * cut moves one line — and so `legacyApi` below can be read as its
 * deliberate opposite.
 */
export const E2E_APP_VERSION = '14';

/**
 * A context authenticated as the same person but sending NO version
 * header — a v13 phone that has not updated yet.
 *
 * Deliberately not "the same context with the header blanked": absence is
 * the thing under test, because absence is what a v13 build actually
 * produces. Auth travels on the Cookie header so the session is identical
 * and the ONLY difference between this context and `session.api` is the
 * version marker.
 *
 * Dispose it when done — it is a real context, not a view of another one.
 */
export async function legacyApi(session: AuthSession): Promise<APIRequestContext> {
  const cookie = session.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return request.newContext({
    baseURL: API,
    extraHTTPHeaders: { Cookie: cookie },
  });
}

export async function loginAs(name: SeedUserName): Promise<AuthSession> {
  const phone = SEED_USERS[name].phone;
  const api = await request.newContext({
    baseURL: API,
    // CUTGUARD v2 amendment — every spec request now carries the version
    // the suite represents. See E2E_APP_VERSION above.
    extraHTTPHeaders: { 'X-App-Version': E2E_APP_VERSION },
  });

  const otpReq = await api.post('/api/auth/request-otp', { data: { phone } });
  if (!otpReq.ok()) {
    throw new Error(`request-otp failed for ${name}: ${otpReq.status()} ${await otpReq.text()}`);
  }
  const otpBody = await otpReq.json();
  const testOtp: string | undefined = otpBody.testOtp;
  if (!testOtp) {
    throw new Error(
      `request-otp returned no testOtp for ${name} — the server must run with NODE_ENV=test ` +
        `(the OTP is HMAC-hashed at rest and cannot be read from the DB).`,
    );
  }

  const verify = await api.post('/api/auth/verify-otp', {
    data: { phone, otp: testOtp },
  });
  if (!verify.ok()) {
    throw new Error(`verify-otp failed for ${name}: ${verify.status()} ${await verify.text()}`);
  }

  // Tokens are returned via Set-Cookie; pull them from the context's storage
  // state so we can both (a) reuse them on the browser context and
  // (b) inject the JWT into the auth store for socket handshake.
  const state = await api.storageState();
  const accessToken = state.cookies.find((c) => c.name === 'accessToken')?.value;
  if (!accessToken) throw new Error('accessToken cookie missing after verify-otp');

  // Accept current privacy + terms so ProtectedRoute does not bounce to /consent.
  //
  // COMPLIANCE-ACK — these read the shared constants rather than the
  // '1.0' literals they used to hold. Those literals were invisible to
  // a symbol census (nothing here imported the version constants), so
  // the terms bump would have silently bounced every e2e walk to
  // /consent. Reading the constant means the next bump cannot do that.
  await api.post('/api/users/me/accept-privacy', { data: { version: CURRENT_PRIVACY_VERSION } });
  await api.post('/api/users/me/accept-terms', { data: { version: CURRENT_TERMS_VERSION } });

  // Re-fetch /me so the returned user includes the consent timestamps.
  const meRes = await api.get('/api/users/me');
  if (!meRes.ok()) throw new Error(`/api/users/me failed: ${meRes.status()}`);
  const me = await meRes.json();

  return {
    user: me.user ?? me,
    accessToken,
    cookies: state.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
    })),
    api,
  };
}

export async function createPassengerJourney(
  api: APIRequestContext,
  // SETTLE-UP G6 — the seed has exactly one MOTO driver, so a spec that
  // needs TWO drivers bidding on one journey has to leave the preference
  // open (bid.service only gates when journey.vehiclePreference is set).
  // Defaults to MOTO, so every existing caller is unchanged.
  opts: { vehiclePreference?: 'MOTO' | 'BIKE' | 'E_BIKE' | 'E_MOTO' | 'CAR' | null } = {},
) {
  const vehiclePreference =
    opts.vehiclePreference === undefined ? 'MOTO' : opts.vehiclePreference;
  const r = await api.post('/api/journeys', {
    data: {
      type: 'PASSENGER',
      pickupLat: -1.9536,
      pickupLng: 30.0606,
      pickupName: 'Kimironko Market',
      destinationLat: -1.9706,
      destinationLng: 30.1044,
      destinationName: 'Kigali Convention Centre',
      ...(vehiclePreference ? { vehiclePreference } : {}),
    },
  });
  if (!r.ok()) throw new Error(`createJourney failed: ${r.status()} ${await r.text()}`);
  return r.json();
}

// SCHED-UI — advance-booking journey via the API at the given ISO
// pickup time (same route/coords as createPassengerJourney).
export async function createScheduledJourney(
  api: APIRequestContext,
  scheduledForIso: string,
) {
  const r = await api.post('/api/journeys', {
    data: {
      type: 'PASSENGER',
      pickupLat: -1.9536,
      pickupLng: 30.0606,
      pickupName: 'Kimironko Market',
      destinationLat: -1.9706,
      destinationLng: 30.1044,
      destinationName: 'Kigali Convention Centre',
      vehiclePreference: 'MOTO',
      bookingMode: 'SCHEDULED',
      scheduledFor: scheduledForIso,
    },
  });
  if (!r.ok()) throw new Error(`createScheduledJourney failed: ${r.status()} ${await r.text()}`);
  return r.json();
}

// SCHED-UI — make upcoming-list assertions deterministic across runs by
// cancelling any live scheduled journeys the seed customer still has.
// Status update (not delete) so FK'd rows (legs, bids) stay intact.
export async function cancelExistingScheduledJourneys(customerId: string) {
  await prisma.journey.updateMany({
    where: {
      customerId,
      bookingMode: 'SCHEDULED',
      status: { in: ['SCHEDULED', 'REQUESTED', 'MATCHED'] },
    },
    data: { status: 'CANCELLED' },
  });
}

/**
 * FIELD-FIT G2 — bring a SCHEDULED journey's bid window forward so a
 * spec can exercise the offer/accept half of advance booking without
 * waiting an hour.
 *
 * This is fixture shaping, not a clock hack: it makes exactly the two
 * writes the bid-window-opener job makes when it runs
 * (jobs/bid-window-opener.job.ts) — pull `bidWindowOpensAt` into the
 * past and move SCHEDULED -> REQUESTED. `autoFallbackAt` is left where
 * createJourney put it (pickup − 30 min), so `assertBidWindowOpen`
 * still evaluates the real window rule against real timestamps.
 */
export async function openBidWindow(journeyId: string) {
  await prisma.journey.update({
    where: { id: journeyId },
    data: { bidWindowOpensAt: new Date(Date.now() - 60_000), status: 'REQUESTED' },
  });
}

/**
 * FIELD-FIT G5 — release any ride a seed driver is still carrying.
 *
 * The suite shares a handful of seed drivers across specs, and specs
 * routinely finish with their driver still MATCHED (nothing ever needed
 * them to tidy up). Since an engaged motari is deliberately shown no new
 * requests, one spec's leftover MATCHED journey now empties the feed for
 * every spec that runs after it.
 *
 * Same shape and reasoning as cancelExistingScheduledJourneys above:
 * status update rather than delete, so bids, escrows and legs stay
 * intact. Call it wherever a spec needs its driver to see a live feed.
 */
export async function releaseDriverEngagements(nickname: SeedUserName) {
  const user = await prisma.user.findFirst({ where: { nickname } });
  if (!user) throw new Error(`releaseDriverEngagements: no user with nickname ${nickname}`);
  await prisma.journey.updateMany({
    where: {
      driverId: user.id,
      status: { in: ['MATCHED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'] },
    },
    data: { status: 'CANCELLED' },
  });
}

export async function submitBid(
  api: APIRequestContext,
  journeyId: string,
  price: number,
  etaMinutes: number,
) {
  const r = await api.post(`/api/journeys/${journeyId}/bids`, {
    data: { journeyId, price, etaMinutes },
  });
  if (!r.ok()) throw new Error(`submitBid failed: ${r.status()} ${await r.text()}`);
  return r.json();
}

export async function acceptBid(api: APIRequestContext, journeyId: string, bidId: string) {
  const r = await api.post(`/api/journeys/${journeyId}/accept-bid`, {
    data: { bidId },
  });
  if (!r.ok()) throw new Error(`acceptBid failed: ${r.status()} ${await r.text()}`);
  return r.json();
}

/**
 * Set up a browser context to act as the given user:
 *   - Reuses the auth cookies on the context so HTTP /api/* calls authenticate.
 *   - Sets the i18n language in localStorage *before* any page script runs.
 *   - Injects token + user into the Zustand auth store as soon as it is
 *     available on window (`__BIMOTO_AUTH_STORE__`), so the socket handshake
 *     finds a token without waiting for App.tsx's /me round-trip.
 */
export async function applyAuthToContext(
  context: BrowserContext,
  session: AuthSession,
  language: 'rw' | 'en' | 'fr',
) {
  await context.addCookies(
    session.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax' as const,
    })),
  );

  await context.addInitScript(
    ({ token, user, lang }) => {
      try {
        localStorage.setItem('bimoto-lang', lang);
      } catch {
        // ignore (e.g. cross-origin init)
      }

      const apply = () => {
        const w = window as unknown as {
          __BIMOTO_AUTH_STORE__?: { setState: (s: Record<string, unknown>) => void };
          __BIMOTO_I18N__?: { changeLanguage: (l: string) => unknown; language?: string };
        };
        if (w.__BIMOTO_AUTH_STORE__) {
          w.__BIMOTO_AUTH_STORE__.setState({
            token,
            user,
            isAuthenticated: true,
            isLoading: false,
          });
          if (w.__BIMOTO_I18N__ && w.__BIMOTO_I18N__.language !== lang) {
            w.__BIMOTO_I18N__.changeLanguage(lang);
          }
          return true;
        }
        return false;
      };

      if (!apply()) {
        const id = setInterval(() => {
          if (apply()) clearInterval(id);
        }, 25);
        // Stop polling after 5s so a misconfigured page does not leak the timer.
        setTimeout(() => clearInterval(id), 5000);
      }
    },
    { token: session.accessToken, user: session.user, lang: language },
  );
}

export async function setLanguage(page: Page, language: 'rw' | 'en' | 'fr') {
  await page.evaluate((lang) => {
    const w = window as unknown as {
      __BIMOTO_I18N__?: { changeLanguage: (l: string) => unknown };
    };
    localStorage.setItem('bimoto-lang', lang);
    w.__BIMOTO_I18N__?.changeLanguage(lang);
  }, language);
}

export async function verifyDriver(nickname: string) {
  const user = await prisma.user.findFirst({ where: { nickname } });
  if (!user) throw new Error(`verifyDriver: no user with nickname ${nickname}`);
  await prisma.user.updateMany({
    where: { id: user.id },
    data: { idVerified: true, licenseVerified: true },
  });
  // DRIVER-ID v3 added a unique constraint on ruraAuthorizationNumber, so
  // the number must be per-driver — a shared constant would P2002-collide
  // across specs on a shared database.
  await prisma.driverProfile.update({
    where: { userId: user.id },
    data: {
      drivingLicenseNumber: `TEST-LICENSE-${user.id.slice(0, 8)}`,
      ruraAuthorizationNumber: `TEST-RURA-${user.id.slice(0, 8)}`,
      cooperativeName: 'Test Cooperative',
      insuranceConfirmed: true,
      verificationStatus: 'VERIFIED',
      verifiedAt: new Date(),
    },
  });
}

export async function disconnectPrisma() {
  await prisma.$disconnect();
}

/**
 * Drives the BidListPage inline confirmation modal for the CARD payment path:
 * clicks Accept on the bid, selects the Card payment method, then clicks the
 * "Confirm and pay by card" button.
 *
 * Assumes `window.FlutterwaveCheckout` is already stubbed (via
 * `context.addInitScript`) BEFORE the page navigation — the card-flow spec
 * sets that up, not this helper.
 *
 * The bid card has no stable data-testid, so we prefer one if present and
 * otherwise fall back to the (single) Accept button. The card radio is keyed
 * by its `value="card"` attribute, which is translation-independent.
 */
/**
 * SETTLE-UP G6 — the MoMo sibling of acceptBidWithCardViaUI: accept a bid
 * through the real BidListPage, Confirm & Pay, no card. Same bid-card
 * selector fallback, same dialog.
 */
export async function acceptBidViaUI(page: Page, bidId: string): Promise<void> {
  const byTestId = page.getByTestId(`bid-${bidId}-accept`);
  if (await byTestId.count()) {
    await byTestId.first().click();
  } else {
    await page.getByRole('button', { name: /accept/i }).first().click();
  }
  await page.getByRole('dialog').waitFor({ state: 'visible' });
  // LIVE-WIRE G6 — the confirm button relabels itself under
  // PAYMENTS_MODE=simulated (BidListPage renders simulation.payConfirm,
  // "Pay (simulated)", instead of transparency.confirmAndPay). CI runs
  // live-with-fake-charges and never saw it; a local simulated stack
  // does, and the helper silently timed out there. Same button, same
  // click — the alternation just covers both labels.
  await page
    .getByRole('button', { name: /confirm & pay|confirm and pay|pay \(simulated\)/i })
    .first()
    .click();
}

export async function acceptBidWithCardViaUI(page: Page, bidId: string): Promise<void> {
  // PILOT-GUARD amendment — which card checkout opens depends on the
  // server's PAYMENTS_MODE, so ask the server, the same way the client
  // itself does (App.tsx reads /api/health.paymentsMode): under 'live'
  // chargeWithCard drives window.FlutterwaveCheckout (which card specs
  // stub), under 'simulated' it opens the in-app simulated checkout
  // (PAY-TRUTH G4), which has real buttons this helper must press.
  // Asked up front and branched on — never inferred from a wait that
  // times out, which is a coin-flip on a slow runner.
  const health = await page.request.get(`${API}/api/health`);
  const paymentsSimulated = (await health.json()).paymentsMode === 'simulated';

  const byTestId = page.getByTestId(`bid-${bidId}-accept`);
  if (await byTestId.count()) {
    await byTestId.first().click();
  } else {
    await page.getByRole('button', { name: /accept/i }).first().click();
  }

  // The confirmation modal (ui/Modal) renders role="dialog".
  await page.getByRole('dialog').waitFor({ state: 'visible' });

  // Select the card payment method (radio value is stable across locales).
  await page.locator('input[type="radio"][value="card"]').check();

  // The Confirm button's label is the card variant once Card is picked,
  // in both payment modes (payment.method.confirmCard).
  await page.getByRole('button', { name: /confirm and pay by card/i }).click();

  if (paymentsSimulated) {
    // The in-app simulated checkout (services/simulated-card-widget.ts)
    // replaces the vendor widget: approve it, as a tester would. Its
    // callback feeds the same initiate-card round-trip the stubbed
    // vendor widget feeds under 'live'.
    await page.getByTestId('simulated-card-approve').click();
  }
}

// ---------------------------------------------------------------------------
// R3-E2E-EXPANSION — additive helpers for the multi-stop, parcel-delivery,
// child-passenger and disputed-flow specs. These wrap the REAL backend
// endpoints and DB models (verified against server source); see
// docs/e2e-expansion-design.md for the endpoint/field mapping.
// ---------------------------------------------------------------------------

/** Generic GET-one-journey helper (mirrors GET /api/journeys/:id). */
export async function getJourney(api: APIRequestContext, journeyId: string) {
  const r = await api.get(`/api/journeys/${journeyId}`);
  if (!r.ok()) throw new Error(`getJourney failed: ${r.status()} ${await r.text()}`);
  return r.json();
}

/**
 * Poll `fn` until it returns a truthy value or the timeout elapses.
 * Returns the truthy value, or throws after `timeoutMs`.
 */
export async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  { timeoutMs = 10_000, intervalMs = 250, label = 'condition' }: {
    timeoutMs?: number;
    intervalMs?: number;
    label?: string;
  } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await fn();
    if (result) return result;
    if (Date.now() >= deadline) throw new Error(`waitFor: timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * A leg as accepted by POST /api/journeys (matches legInputSchema in
 * @bimoto/shared: lat/lng/name + optional contact/parcel fields). Goods
 * legs (GOODS_PICKUP/GOODS_DROPOFF) MUST carry a parcelSize.
 */
export interface MultiStopLegInput {
  type: 'PASSENGER_PICKUP' | 'PASSENGER_DROPOFF' | 'GOODS_PICKUP' | 'GOODS_DROPOFF' | 'WAIT';
  lat: number;
  lng: number;
  name: string;
  contactName?: string;
  contactPhone?: string;
  parcelSize?: 'SMALL' | 'MEDIUM' | 'LARGE';
}

/**
 * Create a multi-stop journey. Legs are passed inline to POST /api/journeys
 * via the `legs` array; the server's journey.service wraps the journey +
 * legs in one transaction (createLegsForJourney assigns sequence 0..N-1 in
 * input order). Returns the journey id plus the created leg ids in
 * `sequence` order (read back from the DB — the create response does not
 * embed legs).
 */
export async function createMultiStopJourney(api: APIRequestContext, legs: MultiStopLegInput[]) {
  const r = await api.post('/api/journeys', {
    data: {
      type: 'PASSENGER',
      pickupLat: -1.9536,
      pickupLng: 30.0606,
      pickupName: 'Kimironko Market',
      destinationLat: -1.9706,
      destinationLng: 30.1044,
      destinationName: 'Kigali Convention Centre',
      vehiclePreference: 'MOTO',
      legs,
    },
  });
  if (!r.ok()) throw new Error(`createMultiStopJourney failed: ${r.status()} ${await r.text()}`);
  const journey = await r.json();
  const dbLegs = await prisma.leg.findMany({
    where: { journeyId: journey.id },
    orderBy: { sequence: 'asc' },
  });
  return { journeyId: journey.id as string, legIds: dbLegs.map((l) => l.id) };
}

/**
 * Create a parcel/goods delivery journey with a recipient, modelled as two
 * legs: GOODS_PICKUP then GOODS_DROPOFF. The dropoff leg carries the
 * recipient in `contactPhone` (the REAL Leg field — there is no per-leg
 * `recipientPhone`), which is what markLegCompleted reads to fire the
 * parcel-delivered SMS, and what the inbound recipient-confirm handler
 * matches against. Goods legs require a parcelSize (legInputSchema).
 * Returns the journey id, the GOODS_DROPOFF leg id, and the recipient phone.
 */
export async function createParcelJourney(
  api: APIRequestContext,
  recipient: { name: string; phone: string },
  category: 'SMALL' | 'MEDIUM' | 'LARGE' = 'MEDIUM',
) {
  const r = await api.post('/api/journeys', {
    data: {
      type: 'GOODS',
      pickupLat: -1.9536,
      pickupLng: 30.0606,
      pickupName: 'Kimironko Market',
      destinationLat: -1.9706,
      destinationLng: 30.1044,
      destinationName: 'Kigali Convention Centre',
      vehiclePreference: 'MOTO',
      legs: [
        {
          type: 'GOODS_PICKUP',
          lat: -1.9536,
          lng: 30.0606,
          name: 'Kimironko Market',
          parcelSize: category,
        },
        {
          type: 'GOODS_DROPOFF',
          lat: -1.9706,
          lng: 30.1044,
          name: 'Kigali Convention Centre',
          contactName: recipient.name,
          contactPhone: recipient.phone,
          parcelSize: category,
        },
      ],
    },
  });
  if (!r.ok()) throw new Error(`createParcelJourney failed: ${r.status()} ${await r.text()}`);
  const journey = await r.json();
  const dropoffLeg = await prisma.leg.findFirst({
    where: { journeyId: journey.id, type: 'GOODS_DROPOFF' },
  });
  if (!dropoffLeg) throw new Error('createParcelJourney: GOODS_DROPOFF leg not created');
  return {
    journeyId: journey.id as string,
    legId: dropoffLeg.id,
    recipientPhone: recipient.phone,
  };
}

/**
 * Create a journey with the child-passenger flag set.
 *
 * DEVIATION FROM DISPATCH: `hasChildPassenger` is a CREATE-time field on
 * POST /api/journeys (createJourneySchema) — there is NO PATCH/flag
 * endpoint to toggle it on an existing journey. This helper therefore
 * creates a fresh child-flagged journey. The child premium (1.1x) is NOT
 * folded into priceCeilingRwf at create (that field is only set for the
 * NEED_TO_GO request mode); it surfaces in the fair-price estimate. For
 * MOTO + childAge <= 12 the server's child-safety validator requires
 * `childPassengerHelmetConfirmed: true`, so we send it.
 */
export async function addChildPassengerFlag(
  api: APIRequestContext,
  opts: { childAgeYears?: number } = {},
) {
  const r = await api.post('/api/journeys', {
    data: {
      type: 'PASSENGER',
      pickupLat: -1.9536,
      pickupLng: 30.0606,
      pickupName: 'Kimironko Market',
      destinationLat: -1.9706,
      destinationLng: 30.1044,
      destinationName: 'Kigali Convention Centre',
      vehiclePreference: 'MOTO',
      hasChildPassenger: true,
      childAgeYears: opts.childAgeYears ?? 8,
      childPassengerHelmetConfirmed: true,
    },
  });
  if (!r.ok()) throw new Error(`addChildPassengerFlag failed: ${r.status()} ${await r.text()}`);
  return r.json();
}

/**
 * GET /api/journeys/fair-price — returns { range: {min,median,max} | null }.
 * Used by the child-passenger spec to assert the 1.1x premium when the
 * data-driven band is available.
 */
export async function getFairPrice(
  api: APIRequestContext,
  params: { distance: number; vehicleType?: string; hasChildPassenger?: boolean },
) {
  const q = new URLSearchParams();
  q.set('distance', String(params.distance));
  if (params.vehicleType) q.set('vehicleType', params.vehicleType);
  if (params.hasChildPassenger) q.set('hasChildPassenger', 'true');
  const r = await api.get(`/api/journeys/fair-price?${q.toString()}`);
  if (!r.ok()) throw new Error(`getFairPrice failed: ${r.status()} ${await r.text()}`);
  return r.json() as Promise<{ range: { min: number; median: number; max: number } | null }>;
}

/**
 * Customer disputes a journey (must be AWAITING_CONFIRMATION). There is no
 * standalone Conflict table — a DISPUTED journey IS the conflict, surfaced
 * to admins under the JOURNEY_RECONCILIATION conflict type. So
 * conflictId === journeyId. The dispute endpoint sets the journey to
 * DISPUTED and freezes escrow (FROZEN).
 */
export async function disputeJourney(api: APIRequestContext, journeyId: string, reason: string) {
  const r = await api.post(`/api/journeys/${journeyId}/dispute`, { data: { reason } });
  if (!r.ok()) throw new Error(`disputeJourney failed: ${r.status()} ${await r.text()}`);
  await r.json();
  return { conflictId: journeyId, type: 'JOURNEY_RECONCILIATION' as const };
}

/**
 * Customer interrupts a journey. Returns the updated journey.
 * Triggers the server-side wiring (post-PR-#84) that sets
 * reconciliationOpenedAt and freezes escrow.
 */
export async function interruptJourney(
  api: APIRequestContext,
  journeyId: string,
  opts: { lat?: number; lng?: number; reason?: string } = {},
) {
  const r = await api.post(`/api/journeys/${journeyId}/interrupt`, {
    data: {
      lat: opts.lat ?? -1.9706,
      lng: opts.lng ?? 30.1044,
      reason: opts.reason ?? 'E2E: customer interrupted',
    },
  });
  if (!r.ok()) throw new Error(`interruptJourney failed: ${r.status()} ${await r.text()}`);
  return r.json();
}

/**
 * Records a reconciliation response from one party of an INTERRUPTED journey.
 * When both parties respond and at least one is not 'ARRIVED_SAFELY', the
 * server's recordReconciliationResponse wrapper transitions the journey via
 * RECONCILE_CONFLICT to DISPUTED. Returns the wrapper's result shape.
 */
export async function recordReconciliationResponse(
  api: APIRequestContext,
  journeyId: string,
  response: 'ARRIVED_SAFELY' | 'NEVER_ARRIVED' | 'NEED_HELP',
): Promise<{ rowId: string; bothPartiesResponded: boolean; verdict?: 'BOTH_ARRIVED' | 'CONFLICT' }> {
  const r = await api.post(`/api/journeys/${journeyId}/reconcile`, {
    data: { response },
  });
  if (!r.ok())
    throw new Error(`recordReconciliationResponse failed: ${r.status()} ${await r.text()}`);
  return r.json();
}

// Real ConflictDecision enum values (Prisma). For a JOURNEY_RECONCILIATION
// conflict the valid subset is RESOLVED_REFUND / RESOLVED_PAY /
// RESOLVED_SPLIT.
export type ConflictDecision =
  | 'RESOLVED_REFUND'
  | 'RESOLVED_PAY'
  | 'RESOLVED_SPLIT';

/**
 * Admin decides a conflict via POST /api/admin/conflicts/:type/:id/decide.
 * The route is keyed by conflict type; `reason` must meet the server's
 * minimum length. Response is `{ adminAction }` (the appended AdminAction
 * row, which includes entryHash — the audit chain hash).
 *
 * For JOURNEY_RECONCILIATION (the default type), the conflict module's
 * decide() applies the escrow + journey status flips inside the SAME
 * transaction as the EscrowAuditLog and AdminAction writes
 * (R3-RECONCILIATION-WIRING-FIX): RESOLVED_REFUND → journey CANCELLED +
 * escrow REFUNDED; RESOLVED_PAY → journey COMPLETED + escrow RELEASED;
 * RESOLVED_SPLIT / NO_ACTION leave the journey DISPUTED. Assert the flips by
 * re-reading the journey.
 */
export async function decideConflict(
  api: APIRequestContext,
  conflictId: string,
  decision: ConflictDecision,
  type: 'JOURNEY_RECONCILIATION' = 'JOURNEY_RECONCILIATION',
  reason = 'e2e admin decision: resolving disputed journey for the customer',
) {
  const r = await api.post(`/api/admin/conflicts/${type}/${conflictId}/decide`, {
    data: { decision, reason },
  });
  if (!r.ok()) throw new Error(`decideConflict failed: ${r.status()} ${await r.text()}`);
  const body = await r.json();
  return {
    adminActionId: body.adminAction?.id as string,
    chainHash: body.adminAction?.entryHash as string,
    conflictDecision: body.adminAction?.conflictDecision as string,
  };
}

/**
 * DEVIATION FROM DISPATCH: there is NO outbound-SMS store to intercept.
 * The recipient parcel-delivered SMS is fire-and-forget (sms.service →
 * Twilio provider, which only console.logs in dev) — no DB model, no queue
 * endpoint. So the "intercept the recipient SMS" step is replaced by
 * asserting the leg reaches the delivered state (completedAt set) — the
 * exact precondition markLegCompleted uses to fire that SMS — and then
 * exercising the recipient REPLY path (the observable half of the loop).
 *
 * This polls the leg until completedAt is set, returning the leg row.
 */
export async function waitForLegDelivered(legId: string) {
  return waitFor(
    () =>
      prisma.leg.findFirst({
        where: { id: legId, type: 'GOODS_DROPOFF', completedAt: { not: null } },
      }),
    { timeoutMs: 10_000, intervalMs: 250, label: `delivered (completedAt) for leg ${legId}` },
  );
}

/** Poll a leg until recipientConfirmedAt is stamped (after the YES reply). */
export async function waitForRecipientConfirmed(legId: string) {
  return waitFor(
    () =>
      prisma.leg.findFirst({
        where: { id: legId, recipientConfirmedAt: { not: null } },
      }),
    { timeoutMs: 10_000, intervalMs: 250, label: `recipientConfirmedAt for leg ${legId}` },
  );
}

/**
 * Verify the AdminAction audit hash chain via
 * GET /api/admin/conflicts/audit/verify.
 *
 * DEVIATION: the dispatch assumed a combined escrow+admin verify endpoint.
 * The real endpoint verifies the AdminAction chain only, returning
 * `{ valid, brokenAt, entries }` (entries = chain length).
 */
export async function getAuditVerification(api: APIRequestContext) {
  const r = await api.get('/api/admin/conflicts/audit/verify');
  if (!r.ok()) throw new Error(`audit verify failed: ${r.status()} ${await r.text()}`);
  return r.json() as Promise<{
    valid: boolean;
    brokenAt: string | null;
    entries: number;
  }>;
}

/**
 * POST the inbound SMS webhook (provider → app): /api/sms/inbound. The
 * Africa's-Talking-style route consumes application/x-www-form-urlencoded
 * with fields { id, from, to, text }. In test/dev no HMAC secret is set,
 * so the signature check accepts the request. Processing is async
 * (setImmediate) — callers should poll for the resulting state change.
 */
export async function postInboundSms(
  api: APIRequestContext,
  payload: { from: string; to?: string; text: string; id?: string },
) {
  const r = await api.post('/api/sms/inbound', {
    form: {
      id: payload.id ?? `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      from: payload.from,
      to: payload.to ?? 'BIMOTO',
      text: payload.text,
    },
  });
  if (!r.ok()) throw new Error(`postInboundSms failed: ${r.status()} ${await r.text()}`);
  return r.json();
}

/**
 * PAYOUT-C — direct DB setup for the payout-flow spec. Pins the driver's
 * payout preference and completedShifts (so training wheels are in a known
 * state), seeds the pending balance, and clears any PENDING payout batch
 * left by an earlier run (an in-flight batch blocks end-shift firing).
 */
/**
 * CUTGUARD v2 G6 (B-3) — give a driver a money PIN, directly.
 *
 * Only the PRESENCE of a hash matters to the caller: `requireMoneyStepUp`
 * short-circuits to 428 ENROLMENT on a NULL hash before it looks at
 * anything else, so flipping it non-null is what moves the gate off its
 * enrolment arm and onto the step-up arm. The VALUE is never verified by
 * the assertion that uses this — no PIN is ever submitted — which is why
 * it is a marker string rather than a real `hmacOtp(pin)`. Anything that
 * needs to actually PASS the gate must walk the real pad
 * (`enrollMoneyPin`), and does.
 */
export async function giveDriverAMoneyPin(nickname: string): Promise<void> {
  const user = await prisma.user.findFirst({ where: { nickname } });
  if (!user) throw new Error(`giveDriverAMoneyPin: no user with nickname ${nickname}`);
  await prisma.user.update({
    where: { id: user.id },
    data: { moneyPinHash: 'e2e-money-pin-present-not-verified' },
  });
}

export async function seedDriverPayoutState(
  nickname: string,
  opts: {
    payoutPreference: 'AT_SHIFT_END' | 'TWICE_DAILY' | 'DAILY_22H';
    completedShifts: number;
    pendingAmount: number;
  },
): Promise<string> {
  const user = await prisma.user.findFirst({ where: { nickname } });
  if (!user) throw new Error(`seedDriverPayoutState: no user with nickname ${nickname}`);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      payoutPreference: opts.payoutPreference,
      completedShifts: opts.completedShifts,
      // MONEY-PIN — clear the PIN so every run starts from the state the
      // pilot's drivers are actually in: never enrolled.
      //
      // This is the OPPOSITE of seeding a hash to skip the UI. Clearing
      // it means the enrolment path is walked end-to-end on every run,
      // through the real pad, which is worth more than the seconds it
      // costs. It is also what makes the specs order-independent: the
      // step-up session lives in server memory and a previous spec may
      // have left one open, but requireMoneyStepUp answers 428
      // ENROLLMENT_REQUIRED on a NULL hash before it ever looks at a
      // session — so a cleared hash prompts deterministically.
      moneyPinHash: null,
      moneyPinPendingHash: null,
      moneyPinPendingActivatesAt: null,
      moneyPinAttempts: 0,
      moneyPinLockedUntil: null,
    },
  });
  await prisma.driverBalance.upsert({
    where: { driverId: user.id },
    create: { driverId: user.id, pendingAmount: opts.pendingAmount },
    update: { pendingAmount: opts.pendingAmount },
  });
  await prisma.driverPayoutBatch.deleteMany({
    where: { driverId: user.id, status: 'PENDING' },
  });
  return user.id;
}

/** Most-recent-first payout batches for a driver (PAYOUT-C spec assertion). */
export async function getDriverPayoutBatches(driverId: string) {
  return prisma.driverPayoutBatch.findMany({
    where: { driverId },
    orderBy: { createdAt: 'desc' },
  });
}

// ── MATCH-CLOSE G5 — shared setup for the two-sided loop walk ────────
//
// The loop spec drives BOTH sides through the real UI, so the steps
// each side takes live here rather than being inlined twice.

/** Canonical Kigali pickup/destination the loop spec uses. */
export const LOOP_PICKUP = { lat: -1.9536, lng: 30.0606, label: 'Kimironko Market' };
export const LOOP_DESTINATION = { lat: -1.9706, lng: 30.1044, label: 'Kigali Convention Centre' };

/**
 * The e2e stack has no LOCATIONIQ_API_KEY, so /api/geocode/search
 * answers 503 and the address picker would go dormant. Only the address
 * LOOKUP is stubbed — journey creation, the feed, bidding and accepting
 * are all real (same boundary create-ride-ui.spec.ts draws).
 */
export async function stubGeocodeSearch(page: Page) {
  await page.route('**/api/geocode/search*', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    const place = /convention|kcc/i.test(q) ? LOOP_DESTINATION : LOOP_PICKUP;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [place] }),
    });
  });
}

/**
 * Type into an AddressSearchInput and pick the first GEOCODER suggestion.
 *
 * LANDMARKS G3 put the Kigali landmark catalog ahead of the geocoder in
 * this list, so "suggestion-0" is now a landmark row carrying the real
 * catalog point — not the coordinates stubGeocodeSearch serves. The loop
 * spec seeds the driver's fix at LOOP_PICKUP, so a landmark pickup put
 * the request ~8.7km away and out of the 5km feed radius. Ask for a
 * geocoder row by kind, exactly as create-ride-ui.spec.ts does.
 */
async function pickGeocodedAddress(page: Page, inputTestId: string, query: string) {
  await page.getByTestId(inputTestId).fill(query);
  await page
    .locator(`[data-testid^="${inputTestId}-suggestion-"][data-result-kind="geocode"]`)
    .first()
    .click();
}

/** Customer creates an ordinary Leave-now ride through the UI. */
export async function createRideThroughUI(page: Page) {
  await page.goto('/');
  await page.getByTestId('home-fork-ride').click();
  await page.waitForURL('**/journey/new');
  await pickGeocodedAddress(page, 'pickup-address-input', 'Kimironko market');
  await pickGeocodedAddress(page, 'destination-address-input', 'Convention centre');

  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/api/journeys') && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: /find drivers|journey\.findDrivers/i }).click(),
  ]);
  if (res.status() !== 201) {
    throw new Error(`createRideThroughUI: POST /api/journeys → ${res.status()}`);
  }
  return res.json();
}

/**
 * Motari goes online from the dashboard, which runs the real chain:
 * browser geolocation → PUT /me/location → PUT /me/online-status →
 * GET /api/journeys?viewAs=driver&lat&lng. Returns that feed response
 * so the caller can assert on the hop that regressed in #147/#148.
 */
export async function goOnlineAndOpenFeed(page: Page) {
  await page.goto('/driver');
  const toggle = page.getByRole('button', { name: /i'm offline/i });
  await toggle.waitFor({ state: 'visible', timeout: 20_000 });
  const feedResponse = page.waitForResponse(
    (r) =>
      r.url().includes('/api/journeys') &&
      r.url().includes('lat=') &&
      r.request().method() === 'GET',
    { timeout: 30_000 },
  );
  await toggle.click();
  return feedResponse;
}

/** Motari places a bid through the bid page + its confirmation modal. */
export async function placeBidThroughUI(
  page: Page,
  journeyId: string,
  price: number,
  etaMinutes: number,
) {
  await page.goto(`/driver/bid/${journeyId}`);
  const numbers = page.locator('input[type="number"]');
  await numbers.nth(0).fill(String(price));
  await numbers.nth(1).fill(String(etaMinutes));
  await page.getByRole('button', { name: /submit offer/i }).first().click();
  const confirm = page.getByRole('button', { name: /submit offer/i }).last();
  await confirm.waitFor({ state: 'visible', timeout: 10_000 });
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/journeys\/[^/]+\/bids$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 30_000 },
    ),
    confirm.click(),
  ]);
  if (res.status() !== 201) {
    throw new Error(`placeBidThroughUI: POST /bids → ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// PAY-TRUTH G5 — the failed-charge state, written directly.
//
// The e2e job runs with no FLW keys, so a real gateway decline is not
// producible here; the gateway-side taxonomy is covered by the server
// suites (payment-failure-matrix.test.ts, simulated-failure-mode.test.ts).
// What the e2e spec is for is the RECOVERY: that the retry surface appears
// on the screen where the failure happened and one tap pays.
//
// So this writes exactly the state PAY-TRUTH G2's 'keep-match' disposition
// produces — escrow FAILED, journey still MATCHED, bid still ACCEPTED —
// including the CHARGE_FAILED audit entry, so the chain the retry appends
// to is the same shape the real path leaves behind.
// ---------------------------------------------------------------------------
export async function failEscrowForRetry(journeyId: string) {
  const escrow = await prisma.escrow.findUnique({ where: { journeyId } });
  if (!escrow) throw new Error(`failEscrowForRetry: no escrow for journey ${journeyId}`);

  await prisma.escrow.update({
    where: { id: escrow.id },
    data: { status: 'FAILED', lastChargeAttemptAt: new Date() },
  });

  const last = await prisma.escrowAuditLog.findFirst({
    where: { escrowId: escrow.id },
    orderBy: { sequenceNumber: 'desc' },
  });
  await prisma.escrowAuditLog.create({
    data: {
      escrowId: escrow.id,
      sequenceNumber: last ? last.sequenceNumber + 1 : 0,
      action: 'CHARGE_FAILED',
      previousHash: last ? last.entryHash : 'GENESIS',
      entryHash: `e2e-charge-failed-${escrow.id}`,
      amount: escrow.amount,
      triggeredBy: escrow.customerId,
      metadata: { reason: 'INSUFFICIENT_FUNDS', disposition: 'keep-match', seededBy: 'e2e' },
    },
  });

  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });
  return {
    escrowId: escrow.id,
    txRef: escrow.txRef,
    escrowStatus: 'FAILED',
    journeyStatus: journey?.status ?? null,
  };
}

/**
 * SETTLE-UP G6 — the NON-interactive release: what a webhook, the
 * reconciler's timeout sweep or the unpaid-match reaper leaves behind
 * when nobody is at the screen.
 *
 * Mirrors escrow.service.releaseMatchTx (the shared implementation both
 * dispositions use) in the same direct-write style failEscrowForRetry
 * already uses: the escrow goes FAILED with a `release-match` audit
 * entry, and the journey goes back on the market with its driver let go.
 * The escrow row keeps owning journeyId — which is exactly the state the
 * adopt branch has to survive.
 */
export async function releaseMatchByMachine(journeyId: string) {
  const escrow = await prisma.escrow.findUnique({ where: { journeyId } });
  if (!escrow) throw new Error(`releaseMatchByMachine: no escrow for journey ${journeyId}`);

  // DOC-GUARD G4 — this used to imitate the release with its own writes:
  // it set the escrow FAILED, forged an audit entry, reverted the
  // journey and reopened `status: 'DECLINED'` bids by hand. That last
  // line was a copy of the bug under test, so any spec built on this
  // helper was proving the helper rather than the server.
  //
  // Now the helper sets up only the PRECONDITION and the server does
  // the release. The precondition is an unconfirmed charge: this job
  // runs with E2E_FAKE_PAYMENTS=1, so accepting a bid confirms the
  // charge immediately and leaves the escrow HELD — a state
  // markEscrowChargeFailed correctly ignores, because a paid ride is
  // not released by a late failure report. Putting the escrow back to
  // PENDING is exactly where it sits in production while the gateway
  // has not answered yet.
  await prisma.escrow.update({
    where: { id: escrow.id },
    data: { status: 'PENDING', lastChargeAttemptAt: new Date() },
  });

  // From here everything is the real path: the Flutterwave webhook
  // reporting a failed charge, which is what happens when nobody is at
  // the screen. routes/webhook.routes.ts → markEscrowChargeFailed
  // (default disposition 'release-match') → releaseMatchTx, including
  // the audit entry and the bid reopen this dispatch fixed.
  const res = await request.newContext({ baseURL: API }).then((ctx) =>
    ctx.post('/api/webhooks/flutterwave', {
      headers: { 'verif-hash': process.env.FLW_SECRET_HASH ?? '' },
      data: {
        event: 'charge.completed',
        data: {
          id: `e2e-machine-release-${escrow.id}`,
          status: 'failed',
          meta: { escrowId: escrow.id },
        },
      },
    }),
  );
  if (!res.ok()) {
    throw new Error(
      `releaseMatchByMachine: webhook rejected (${res.status()} ${await res.text()}). ` +
        `FLW_SECRET_HASH must be set for the server AND this process.`,
    );
  }

  return { escrowId: escrow.id, txRef: escrow.txRef, amount: escrow.amount };
}

/** Every bid on a journey, newest status included — the "is it lying?" read. */
export async function getBids(journeyId: string) {
  return prisma.bid.findMany({
    where: { journeyId },
    select: { id: true, driverId: true, status: true, price: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** The escrow's audit chain, oldest first — actions only. */
export async function getEscrowChain(escrowId: string) {
  const rows = await prisma.escrowAuditLog.findMany({
    where: { escrowId },
    orderBy: { sequenceNumber: 'asc' },
    select: { sequenceNumber: true, action: true },
  });
  return rows;
}

/** Every escrow row bound to a journey — the "exactly one" assertion. */
export async function countEscrowsForJourney(journeyId: string) {
  return prisma.escrow.count({ where: { journeyId } });
}

/** Read the escrow row for a journey (id / status / txRef assertions). */
export async function getEscrowByJourney(journeyId: string) {
  const escrow = await prisma.escrow.findUnique({ where: { journeyId } });
  if (!escrow) throw new Error(`getEscrowByJourney: no escrow for journey ${journeyId}`);
  return escrow;
}

// ── MONEY-PIN (founder ruling D25) ────────────────────────────────────
//
// Driver money surfaces — the balance, "Pay me now", and the payout
// preferences — sit behind a 4-digit PIN. A spec whose subject IS one of
// those surfaces now has to walk that friction, because the product has
// it. These helpers exist so the walk is one line and each spec stays
// about its own subject.
//
// NOTHING HERE BYPASSES THE UI. There is deliberately no "seed a PIN
// hash" helper: the enrolment path staying exercised end-to-end is worth
// more than the seconds it would save, and a bypass helper is the kind
// of thing that gets reached for until nothing tests the real path.
//
// The pad is a pad, so these tap digits by testid exactly as a thumb
// would.

/** Taps a PIN into whichever pad is on screen. */
export async function enterMoneyPin(page: Page, pin: string, prefix = 'money-pin'): Promise<void> {
  for (const digit of pin.split('')) {
    await page.getByTestId(`${prefix}-key-${digit}`).click();
  }
}

/**
 * Walks first-time enrolment: the pad asks for the PIN, then for the same
 * PIN again to confirm. Leaves the money surface open behind it.
 */
export async function enrollMoneyPin(page: Page, pin: string): Promise<void> {
  const pad = page.getByTestId('money-pin-gate');
  await expect(pad).toHaveAttribute('data-prompt', 'enroll', { timeout: 15_000 });
  await enterMoneyPin(page, pin); // choose
  await enterMoneyPin(page, pin); // confirm
  await expect(pad).toBeHidden({ timeout: 15_000 });
}

/**
 * Enrols or verifies IF the pad is showing, and does nothing if it is
 * not.
 *
 * The "if" matters: the money step-up session lives in server memory and
 * is keyed by user, so a spec running after one that already enrolled may
 * find no prompt at all. A spec that unconditionally expected one would
 * pass or fail on run order, which is the kind of flake that gets blamed
 * on infrastructure for a month.
 */
export async function passMoneyPinIfPrompted(page: Page, pin: string): Promise<void> {
  const pad = page.getByTestId('money-pin-gate');
  try {
    await pad.waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    return; // No gate in the way — a session is already open.
  }
  const prompt = await pad.getAttribute('data-prompt');
  if (prompt === 'enroll') {
    await enterMoneyPin(page, pin);
    await enterMoneyPin(page, pin);
  } else if (prompt === 'verify') {
    await enterMoneyPin(page, pin);
  } else {
    throw new Error(`passMoneyPinIfPrompted: unexpected money-PIN state "${prompt}"`);
  }
  await expect(pad).toBeHidden({ timeout: 15_000 });
}

/** The PIN the e2e suite uses. Any four digits; this one is not special. */
export const E2E_MONEY_PIN = '2468';
