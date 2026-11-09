import { test, expect, chromium, type Browser } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { loginAs, applyAuthToContext, disconnectPrisma, releaseDriverEngagements } from './helpers';

/**
 * FEED-CONTRACT G5 — the acceptance walk for the whole four-layer arc,
 * with the case #147's walk was missing: the REAL driver shape.
 *
 * Every driver onboarded through the app has role BOTH
 * (createDriverProfile writes role='BOTH'), and before FEED-CONTRACT G1
 * that shape fell into the customer branch: the dashboard sent
 * `role=driver` — a key journeyQuerySchema strips — so the server
 * derived 'customer' from BOTH and answered with the driver's own
 * journeys instead of nearby requests. #147 proved server-side that
 * BOTH + viewAs=driver reaches the driver branch; this walk proves the
 * client now sends that key.
 *
 * The walk, with NO interception (no page.route, no stubbed fetch —
 * same discipline as driver-feed.spec.ts):
 *
 *   1. a BOTH-role motari (TestDriver, the seed's onboarded shape)
 *      logs in and goes online → the feed request carries
 *      viewAs=driver and real coordinates → the seeded nearby requests
 *      appear — none of them the driver's own;
 *   2. the app reloads (the Kigali "every app open shows offline"
 *      case) → FEED-CONTRACT G3's restore reads
 *      GET /api/users/me → driverProfile.isOnline (true — the
 *      go-online chain now writes it through PUT /me/online-status)
 *      → the dashboard is still online WITHOUT a tap and the requests
 *      are still visible.
 */

const PICKUP = { lat: -1.9536, lng: 30.0606, name: 'Kimironko Market' };

const PASSENGER_DEST = 'KCC — both-role walk passenger';
const PARCEL_DEST = 'Remera — both-role walk parcel';

const prisma = new PrismaClient();

let browser: Browser;
const createdJourneyIds: string[] = [];

test.beforeAll(async () => {
  browser = await chromium.launch(
    process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  );
});

test.afterAll(async () => {
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

test('a BOTH-role motari goes online, sees nearby requests, reloads, and is still online with the requests visible', async () => {
  test.setTimeout(180_000);

  // 1. Seed the feed as the customer: passenger + parcel, both open at
  //    the pickup, no vehicle preference (TestDriver rides a MOTO but
  //    unset preference matches every vehicle). Close leftovers first
  //    so the exact-count assertion holds.
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
      goodsDescription: 'Both-role walk parcel: documents envelope',
      goodsSizeCategory: 'SMALL',
    },
  });
  expect(parcelRes.ok()).toBe(true);
  const parcelJourney = await parcelRes.json();
  createdJourneyIds.push(parcelJourney.id);

  // 2. The driver: TestDriver is the seed's BOTH-role user — the shape
  //    real onboarding produces. Start from a clean cold state: any
  //    leftover own REQUESTED journeys closed (they'd pollute the
  //    customer-branch comparison) and server-side isOnline false so
  //    "goes online" is the driver's action, not seed residue.
  const driver = await loginAs('TestDriver');
  // FIELD-FIT G5 — an engaged motari is shown no new requests, so a
  // leftover MATCHED journey from an earlier spec would empty this
  // one's feed. Start from a driver who is carrying nobody.
  await releaseDriverEngagements('TestDriver');
  expect(driver.user.role).toBe('BOTH');
  await prisma.journey.updateMany({
    where: { customerId: driver.user.id, status: 'REQUESTED' },
    data: { status: 'CANCELLED' },
  });
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

  // 3. Dashboard → go online. The REAL chain: browser geolocation →
  //    PUT /me/location → PUT /me/online-status → the feed request.
  await page.goto('/driver');
  const offlineToggle = page.getByRole('button', { name: /i'm offline/i });
  await expect(offlineToggle).toBeVisible({ timeout: 15_000 });

  const feedResponsePromise = page.waitForResponse(
    (res) =>
      res.url().includes('/api/journeys') &&
      res.url().includes('lat=') &&
      res.request().method() === 'GET',
    { timeout: 20_000 },
  );
  await offlineToggle.click();

  const feedResponse = await feedResponsePromise;
  // The four-layer contract, pinned at the wire: the request the
  // dashboard actually sent carries viewAs=driver (not the dead role
  // key) and it succeeds.
  expect(feedResponse.url()).toContain('viewAs=driver');
  expect(feedResponse.url()).not.toContain('role=');
  expect(feedResponse.status()).toBe(200);
  const feedBody = (await feedResponse.json()) as Array<{
    id: string;
    customerId: string;
  }>;
  const feedIds = feedBody.map((j) => j.id);
  expect(feedIds).toContain(passengerJourney.id);
  expect(feedIds).toContain(parcelJourney.id);
  // The driver branch answered — nearby requests, not the driver's own
  // journeys (the customer branch would return only their own).
  for (const j of feedBody) {
    expect(j.customerId).not.toBe(driver.user.id);
  }

  // 4. The driver SEES the requests.
  await expect(page.getByRole('button', { name: /i'm online/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(PASSENGER_DEST)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(PARCEL_DEST)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /nearby requests \(2\)/i }),
  ).toBeVisible();

  // 5. Going online wrote the server's truth — the column the restore
  //    reads back (PUT /me/online-status → driverProfile.isOnline).
  const profileAfterOnline = await prisma.driverProfile.findUnique({
    where: { userId: driver.user.id },
  });
  expect(profileAfterOnline?.isOnline).toBe(true);

  // 6. RELOAD — the field case: every app open used to show the driver
  //    offline. The G3 restore must bring the dashboard back online
  //    from GET /me's driverProfile.isOnline with NO tap, and the
  //    requests must still be visible.
  const restoreFeedPromise = page.waitForResponse(
    (res) =>
      res.url().includes('/api/journeys') &&
      res.url().includes('viewAs=driver') &&
      res.request().method() === 'GET',
    { timeout: 30_000 },
  );
  await page.reload();

  const restoreFeed = await restoreFeedPromise;
  expect(restoreFeed.status()).toBe(200);
  const restoreBody = (await restoreFeed.json()) as Array<{ id: string }>;
  expect(restoreBody.map((j) => j.id)).toContain(passengerJourney.id);

  await expect(page.getByRole('button', { name: /i'm online/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(PASSENGER_DEST)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(PARCEL_DEST)).toBeVisible();

  await context.close();
});
