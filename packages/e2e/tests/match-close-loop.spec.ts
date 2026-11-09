import { test, expect, chromium, type Browser } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import {
  loginAs,
  applyAuthToContext,
  verifyDriver,
  disconnectPrisma,
  stubGeocodeSearch,
  createRideThroughUI,
  goOnlineAndOpenFeed,
  placeBidThroughUI,
  acceptBidViaUI,
  LOOP_PICKUP,
  LOOP_DESTINATION,
  releaseDriverEngagements,
} from './helpers';

/**
 * MATCH-CLOSE G5 — the team's own test: two people, two phones, one loop.
 *
 * The driver-feed specs prove the motari sees the request; nothing
 * proved the passenger sees the bid, which is exactly where the pilot
 * broke three times ("neither side can find the other"). This spec
 * covers the seam between the two sides, end to end, through the real
 * UI on both:
 *
 *   passenger creates a request → motari goes online and sees it →
 *   motari bids → the bid appears on the passenger's screen with NO
 *   reload → the passenger accepts → both sides agree.
 *
 * It fails if the driver feed regresses (step 2 asserts the feed's own
 * status and contents), and it fails if the passenger's live
 * subscription is removed (step 3 blocks the polling fallback for the
 * duration of the wait, so the bid can only arrive over the socket —
 * with the subscription gone, nothing arrives and the assertion times
 * out).
 */

const prisma = new PrismaClient();
let browser: Browser;
const createdJourneyIds: string[] = [];

test.beforeAll(async () => {
  browser = await chromium.launch(
    process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  );
});

test.afterAll(async () => {
  if (createdJourneyIds.length > 0) {
    await prisma.journey.updateMany({
      where: { id: { in: createdJourneyIds }, status: { in: ['REQUESTED', 'MATCHED'] } },
      data: { status: 'CANCELLED' },
    });
  }
  await browser?.close();
  await disconnectPrisma();
  await prisma.$disconnect();
});

test('passenger and motari close the loop live: request → bid → accept', async () => {
  test.setTimeout(180_000);

  // 1. Passenger creates a ride through the UI and lands on the bid list.
  const customer = await loginAs('TestCustomer');
  await prisma.journey.updateMany({
    where: { customerId: customer.user.id, status: 'REQUESTED' },
    data: { status: 'CANCELLED' },
  });
  const pctx = await browser.newContext();
  await applyAuthToContext(pctx, customer, 'en');
  const ppage = await pctx.newPage();
  await stubGeocodeSearch(ppage);

  const journey = await createRideThroughUI(ppage);
  createdJourneyIds.push(journey.id);
  expect(journey.status).toBe('REQUESTED');
  await ppage.waitForURL(`**/journey/${journey.id}/bids`);
  await expect(ppage.getByTestId('bid-list-state-live')).toBeVisible({ timeout: 20_000 });

  // 2. Motari — BOTH role, the shape real onboarding produces — signs in
  //    separately, with a granted Kigali fix, and goes online. A feed
  //    that 4xx'd or came back without this journey fails here.
  const driver = await loginAs('TestDriver');
  await verifyDriver('TestDriver');
  // FIELD-FIT G5 — an engaged motari is shown no new requests, so a
  // leftover MATCHED journey from an earlier spec would empty this
  // one's feed. Start from a driver who is carrying nobody.
  await releaseDriverEngagements('TestDriver');
  await prisma.driverProfile.updateMany({
    where: { userId: driver.user.id },
    data: { isOnline: false },
  });
  const dctx = await browser.newContext({
    geolocation: { latitude: LOOP_PICKUP.lat, longitude: LOOP_PICKUP.lng },
    permissions: ['geolocation'],
  });
  await applyAuthToContext(dctx, driver, 'en');
  const dpage = await dctx.newPage();

  const feedResponse = await goOnlineAndOpenFeed(dpage);
  expect(feedResponse.status()).toBe(200);
  const feed = await feedResponse.json();
  expect((feed as Array<{ id: string }>).map((j) => j.id)).toContain(journey.id);
  await expect(dpage.getByText(LOOP_DESTINATION.label).first()).toBeVisible({
    timeout: 15_000,
  });

  // 3. The seam. The passenger's polling fallback is blocked from here
  //    on, so the bid about to be placed can reach the screen ONLY over
  //    the journey-room subscription. Remove that subscription and this
  //    step is what fails.
  await ppage.route('**/api/journeys/*/bids', (route) =>
    route.request().method() === 'GET' ? route.abort() : route.continue(),
  );

  const bid = await placeBidThroughUI(dpage, journey.id, 1500, 7);
  expect(bid.status).toBe('PENDING');

  // No reload, no navigation: the bid card simply appears.
  await expect(ppage.getByText('1,500')).toBeVisible({ timeout: 20_000 });
  await expect(ppage.getByRole('button', { name: /accept/i })).toBeVisible();

  // 4. The passenger accepts, and both sides agree afterwards.
  await ppage.unroute('**/api/journeys/*/bids');
  // LIVE-WIRE G6 — through the shared helper rather than an inline
  // click. The inline version matched only the live-mode label, so this
  // spec could not pass against a PAYMENTS_MODE=simulated stack (where
  // BidListPage renders "Pay (simulated)"); CI runs live-with-fake-
  // charges and never saw it. Same two clicks, both labels.
  const acceptResponse = ppage.waitForResponse(
    (r) => r.url().includes('/accept-bid') && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await acceptBidViaUI(ppage, bid.id);
  expect((await acceptResponse).status()).toBe(200);
  await ppage.waitForURL(`**/journey/${journey.id}/matched`, { timeout: 30_000 });

  const persistedJourney = await prisma.journey.findUnique({ where: { id: journey.id } });
  const persistedBid = await prisma.bid.findUnique({ where: { id: bid.id } });
  expect(persistedJourney?.status).toBe('MATCHED');
  expect(persistedJourney?.driverId).toBe(driver.user.id);
  expect(persistedBid?.status).toBe('ACCEPTED');

  await pctx.close();
  await dctx.close();
});
