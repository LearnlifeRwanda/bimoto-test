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
  releaseDriverEngagements,
} from './helpers';

/**
 * LIVE-WIRE G6 — the three things the loop still could not prove.
 *
 * match-close-loop.spec.ts already proves the passenger's half: it
 * blocks the polling fallback and asserts the bid card appears anyway,
 * so it fails if the journey-room subscription is removed. This spec
 * covers what that one does not:
 *
 *   1. the MOTARI is told when his bid is accepted, without navigating.
 *      Before this dispatch there was no path at all: his journey-room
 *      join is refused while the journey is REQUESTED (measured 10/10,
 *      docs/live-wire-measurements.md), and nothing listened for
 *      bid-accepted anyway. He learned by leaving the page and coming
 *      back. This asserts he learns while standing still.
 *   2. a new number is a new person: user B, signing in on the phone
 *      user A just used, sees nothing of A.
 *   3. the parcel speed surface is exactly two options, with the
 *      optional hour window appearing only under Standard.
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

test('the motari is told his bid was accepted, without navigating', async () => {
  test.setTimeout(180_000);

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
  await ppage.waitForURL(`**/journey/${journey.id}/bids`);

  const driver = await loginAs('TestDriver');
  await verifyDriver('TestDriver');
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

  await goOnlineAndOpenFeed(dpage);
  const bid = await placeBidThroughUI(dpage, journey.id, 1500, 7);
  expect(bid.status).toBe('PENDING');

  // The motari stays exactly where he is. Every read he could make for
  // himself is blocked from here on, so the only way the news can reach
  // his screen is the per-user socket room — which is the whole point.
  // Remove the emit in services/bid-outcome.ts and this times out.
  await dpage.route('**/api/bids/my-history', (route) => route.abort());

  const acceptResponse = ppage.waitForResponse(
    (r) => r.url().includes('/accept-bid') && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await acceptBidViaUI(ppage, bid.id);
  expect((await acceptResponse).status()).toBe(200);

  // No reload, no navigation, no poll: the motari's screen says so.
  //
  // .first() because the app mounts <Toast /> twice — once in App.tsx for
  // the shell-less routes and once in AppShell for the rest — so every
  // toast in the app renders in two places off one store value. That is
  // pre-existing and outside this dispatch; asserting on the first is
  // asserting on the toast.
  await expect(
    dpage.getByText(/your offer was accepted/i).first(),
  ).toBeVisible({ timeout: 25_000 });

  await pctx.close();
  await dctx.close();
});

test('a new number is a new person: user B sees nothing of user A', async () => {
  test.setTimeout(180_000);

  // User A signs in, creates a request, and leaves state behind.
  const customer = await loginAs('TestCustomer');
  await prisma.journey.updateMany({
    where: { customerId: customer.user.id, status: 'REQUESTED' },
    data: { status: 'CANCELLED' },
  });
  const ctx = await browser.newContext();
  await applyAuthToContext(ctx, customer, 'en');
  const page = await ctx.newPage();
  await stubGeocodeSearch(page);

  const journey = await createRideThroughUI(page);
  createdJourneyIds.push(journey.id);
  await page.waitForURL(`**/journey/${journey.id}/bids`);

  // The state that used to survive: the journey store's activeJourney,
  // the bid store, and the Dexie read caches.
  await page.evaluate(() => {
    const w = window as unknown as {
      __BIMOTO_AUTH_STORE__?: { getState: () => { logout: () => void } };
    };
    w.__BIMOTO_AUTH_STORE__?.getState().logout();
  });

  // User B signs in on the same page, same browser storage.
  const other = await loginAs('TestDriver');
  await page.evaluate((u) => {
    const w = window as unknown as {
      __BIMOTO_AUTH_STORE__?: { getState: () => { setUser: (u: unknown) => void } };
    };
    w.__BIMOTO_AUTH_STORE__?.getState().setUser(u);
  }, other.user as unknown as Record<string, unknown>);

  const signedInAs = await page.evaluate(() => {
    const w = window as unknown as {
      __BIMOTO_AUTH_STORE__?: { getState: () => { user?: { id?: string } } };
    };
    return w.__BIMOTO_AUTH_STORE__?.getState().user?.id ?? null;
  });
  expect(signedInAs).toBe(other.user.id);

  // Nothing of user A's request is on the screen any more.
  await page.goto('/');
  await expect(page.getByTestId('active-journey-banner')).toHaveCount(0, {
    timeout: 15_000,
  });

  await ctx.close();
});

test('parcel speed offers exactly two options, with hours only under Standard', async () => {
  test.setTimeout(120_000);

  const customer = await loginAs('TestCustomer');
  const ctx = await browser.newContext();
  await applyAuthToContext(ctx, customer, 'en');
  const page = await ctx.newPage();
  await stubGeocodeSearch(page);

  await page.goto('/journey/goods');
  await expect(page.getByTestId('delivery-speed-section')).toBeVisible({
    timeout: 20_000,
  });

  // Exactly two speeds — never the three the field saw.
  const options = page.getByTestId('delivery-speed-options').getByRole('radio');
  await expect(options).toHaveCount(2);
  await expect(page.getByTestId('delivery-speed-STANDARD')).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // Standard is the default, so the optional window is offered.
  await expect(page.getByTestId('standard-hours-section')).toBeVisible();
  await expect(page.getByTestId('standard-hours-any')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  for (const h of [1, 2, 3]) {
    await expect(page.getByTestId(`standard-hours-${h}`)).toBeVisible();
  }

  // Express means now: no window, and a window already chosen is dropped.
  await page.getByTestId('standard-hours-2').click();
  await expect(page.getByTestId('standard-hours-2')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByTestId('delivery-speed-EXPRESS').click();
  await expect(page.getByTestId('standard-hours-section')).toHaveCount(0);

  // And coming back to Standard starts from "any time", not from the
  // window Express discarded.
  await page.getByTestId('delivery-speed-STANDARD').click();
  await expect(page.getByTestId('standard-hours-any')).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await ctx.close();
});
