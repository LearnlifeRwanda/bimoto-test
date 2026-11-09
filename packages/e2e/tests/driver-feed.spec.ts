import { test, expect, chromium, type Browser } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { loginAs, applyAuthToContext, disconnectPrisma, releaseDriverEngagements } from './helpers';

/**
 * FEED-SCHEMA G3 — the pilot's core loop, walked honestly.
 *
 *   seeded Postgres → real server → real client → driver logs in →
 *   goes online with a real (context-level) GPS fix → the dashboard's
 *   own feed request carries real coordinates → the seeded open
 *   journeys appear in the driver's list.
 *
 * NO injected responses anywhere: no page.route, no request
 * interception, no stubbed fetch. The one browser-level affordance is
 * Playwright's context geolocation (a Kigali fix), which is the
 * standard way to give a headless browser a GPS position — the fix
 * still travels through the app's own geolocation helper, the real
 * PUT /api/users/me/location write, and the real GET /api/journeys
 * feed request. #146 had to inject the feed payload to get past the
 * validator; this spec exists so that can never be necessary again.
 *
 * The driver is EBikeJean — the one seeded pure-DRIVER-role user, kept
 * here to pin the schema-fix path for the DRIVER role. (Since
 * FEED-CONTRACT G1 the dashboard sends `viewAs=driver&lat&lng`; the
 * BOTH-role case — the shape real onboarding produces — has its own
 * walk in driver-feed-both-role.spec.ts, including the reload/restore
 * step.) Before the schema fix, lat/lng were stripped by the query
 * validator and every such request 400'd with LOCATION_REQUIRED.
 *
 * Journeys are created WITHOUT a vehiclePreference so the E_BIKE
 * driver passes the feed's vehicle prefilter; the driver's fix is
 * placed exactly at the pickup so the t=0 discovery cascade ring
 * (200 m) contains them.
 */

// Same canonical pickup the other specs use (helpers.ts).
const PICKUP = { lat: -1.9536, lng: 30.0606, name: 'Kimironko Market' };

const PASSENGER_DEST = 'KCC — feed-walk passenger';
const PARCEL_DEST = 'Remera — feed-walk parcel';

const prisma = new PrismaClient();

let browser: Browser;
const createdJourneyIds: string[] = [];

test.beforeAll(async () => {
  // Same escape hatch as playwright.config.ts: sandboxes with a
  // pre-installed Chromium whose build doesn't match this
  // @playwright/test version set PW_CHROMIUM_PATH. Unset in CI.
  browser = await chromium.launch(
    process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  );
});

test.afterAll(async () => {
  // Leave the shared DB the way we found it: close our journeys so
  // re-runs (and other specs' feed assertions) stay deterministic.
  if (createdJourneyIds.length > 0) {
    await prisma.journey.updateMany({
      where: { id: { in: createdJourneyIds } },
      data: { status: 'CANCELLED' },
    });
  }
  await browser?.close();
  await disconnectPrisma();
  await prisma.$disconnect();
});

test('motari goes online and sees the seeded open passenger request AND the parcel in the live feed', async () => {
  test.setTimeout(120_000);

  // 1. Customer seeds the feed: one passenger journey, one parcel —
  //    both open (REQUESTED), both at the pickup point, no vehicle
  //    preference. First close any leftover open journeys from earlier
  //    runs so the assertion below is exact.
  const customer = await loginAs('TestCustomer');
  await prisma.journey.updateMany({
    where: { customerId: customer.user.id, status: 'REQUESTED' },
    data: { status: 'CANCELLED' },
  });

  const passengerRes = await customer.api.post('/api/journeys', {
    data: {
      type: 'PASSENGER',
      pickupLat: PICKUP.lat,
      pickupLng: PICKUP.lng,
      pickupName: PICKUP.name,
      destinationLat: -1.9706,
      destinationLng: 30.1044,
      destinationName: PASSENGER_DEST,
    },
  });
  expect(passengerRes.ok()).toBe(true);
  const passengerJourney = await passengerRes.json();
  createdJourneyIds.push(passengerJourney.id);

  const parcelRes = await customer.api.post('/api/journeys', {
    data: {
      type: 'GOODS',
      pickupLat: PICKUP.lat,
      pickupLng: PICKUP.lng,
      pickupName: PICKUP.name,
      destinationLat: -1.9571,
      destinationLng: 30.0935,
      destinationName: PARCEL_DEST,
      goodsDescription: 'Feed-walk parcel: documents envelope',
      goodsSizeCategory: 'SMALL',
    },
  });
  expect(parcelRes.ok()).toBe(true);
  const parcelJourney = await parcelRes.json();
  createdJourneyIds.push(parcelJourney.id);

  expect(passengerJourney.status).toBe('REQUESTED');
  expect(parcelJourney.status).toBe('REQUESTED');

  // 2. The driver: pure DRIVER role, browser context whose GPS fix is
  //    exactly the pickup point. The seed leaves EBikeJean server-side
  //    online; start cold so "goes online" is this walk's action —
  //    otherwise FEED-CONTRACT G3's mount restore brings the dashboard
  //    up already online (that path has its own walk in
  //    driver-feed-both-role.spec.ts).
  const driver = await loginAs('EBikeJean');
  // FIELD-FIT G5 — an engaged motari is shown no new requests, so a
  // leftover MATCHED journey from an earlier spec would empty this
  // one's feed. Start from a driver who is carrying nobody.
  await releaseDriverEngagements('EBikeJean');
  await prisma.driverProfile.update({
    where: { userId: driver.user.id },
    data: { isOnline: false },
  });
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    geolocation: { latitude: PICKUP.lat, longitude: PICKUP.lng },
    permissions: ['geolocation'],
  });
  await applyAuthToContext(context, driver, 'en');
  const page = await context.newPage();

  // 3. Dashboard → "I'm offline" toggle → go online. Going online runs
  //    the REAL chain: browser geolocation → PUT /api/users/me/location
  //    → PUT /api/users/me/online-status →
  //    GET /api/journeys?viewAs=driver&lat=…&lng=… (the lat/lng pair is
  //    the exact part that 400'd with LOCATION_REQUIRED before the
  //    schema fix).
  await page.goto('/driver');
  const toggle = page.getByRole('button', { name: /i'm offline/i });
  await expect(toggle).toBeVisible({ timeout: 15_000 });

  const feedResponsePromise = page.waitForResponse(
    (res) =>
      res.url().includes('/api/journeys') &&
      res.url().includes('lat=') &&
      res.request().method() === 'GET',
    { timeout: 20_000 },
  );
  await toggle.click();

  // The feed request itself must succeed — a 400 here is the exact
  // regression this walk pins down.
  const feedResponse = await feedResponsePromise;
  expect(feedResponse.status()).toBe(200);
  const feedBody = await feedResponse.json();
  const feedIds = (feedBody as Array<{ id: string }>).map((j) => j.id);
  expect(feedIds).toContain(passengerJourney.id);
  expect(feedIds).toContain(parcelJourney.id);

  // 4. And the driver actually SEES them: both request cards render
  //    with their destinations, under the "Nearby requests" heading.
  await expect(page.getByRole('button', { name: /i'm online/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(PASSENGER_DEST)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(PARCEL_DEST)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /nearby requests \(2\)/i }),
  ).toBeVisible();

  await context.close();
});
