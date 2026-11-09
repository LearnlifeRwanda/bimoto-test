import { test, expect, chromium, type Browser } from '@playwright/test';
import {
  loginAs,
  applyAuthToContext,
  createScheduledJourney,
  cancelExistingScheduledJourneys,
  getJourney,
  openBidWindow,
  submitBid,
  acceptBid,
  verifyDriver,
  disconnectPrisma,
} from './helpers';

/**
 * SCHED-UI — advance booking (scheduled rides), customer side.
 *
 *   create a SCHEDULED journey at the minimum valid lead →
 *   home shows the "Upcoming rides" section →
 *   its entry opens the scheduled state screen (pickup time,
 *   "drivers can bid from", auto-fallback note) →
 *   cancel via the existing journey-cancel flow →
 *   journey is CANCELLED and the upcoming section is gone.
 *
 * Deliberately NOT covered here (server-tested; no time-travel hacks
 * per the dispatch): the 60-minute bid-window opening and the
 * 30-minute auto-fallback.
 *
 * Creation is via the API (house pattern — every spec in this suite
 * seeds journeys through /api/journeys; the address-picker UI needs a
 * live geocode key the e2e stack doesn't have). The creation UI itself
 * is covered by NewJourneyPage-scheduled.test.tsx in the client suite.
 *
 * Minimum valid lead is 60 min (MIN_LEAD_TIME_MS in
 * services/scheduled-rides/validators.ts); 61 min keeps a margin
 * against request latency.
 */

let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  await disconnectPrisma();
});

test('customer schedules a ride at minimum lead, sees it upcoming, and cancels it', async () => {
  test.setTimeout(90_000);

  const customer = await loginAs('TestCustomer');
  await cancelExistingScheduledJourneys(customer.user.id);

  // 1. Create at minimum valid lead (60 min + 1 min margin).
  const scheduledFor = new Date(Date.now() + 61 * 60 * 1000).toISOString();
  const journey = await createScheduledJourney(customer.api, scheduledFor);
  expect(journey.status).toBe('SCHEDULED');
  expect(journey.bookingMode).toBe('SCHEDULED');

  const context = await browser.newContext();
  await applyAuthToContext(context, customer, 'en');
  const page = await context.newPage();

  // 2. Home shows the upcoming-rides section with this journey.
  // PILOT-UX-2 G2/G3 — home is now the fork sheet over the background
  // map; expand the sheet so the upcoming section is fully on-screen.
  await page.goto('/');
  await page.getByTestId('sheet-handle').click();
  const upcoming = page.getByTestId('upcoming-rides-section');
  await expect(upcoming).toBeVisible();
  const entry = page.getByTestId(`upcoming-ride-${journey.id}`);
  await expect(entry).toBeVisible();

  // 3. The entry opens the scheduled state screen.
  await entry.click();
  await page.waitForURL(`**/journey/${journey.id}/scheduled`);
  await expect(page.getByTestId('scheduled-state-screen')).toBeVisible();
  await expect(page.getByTestId('scheduled-pickup-time')).toBeVisible();
  await expect(page.getByTestId('scheduled-bidding-opens')).toBeVisible();
  await expect(page.getByTestId('scheduled-fallback-note')).toBeVisible();

  // 4. Cancel through the existing flow.
  await page.getByTestId('scheduled-cancel-button').click();
  await page.getByTestId('scheduled-cancel-confirm').click();
  await page.waitForURL((url) => url.pathname === '/');

  // 5. Journey is CANCELLED server-side and gone from the upcoming list.
  const after = await getJourney(customer.api, journey.id);
  expect(after.status).toBe('CANCELLED');
  await page.reload();
  await expect(page.getByTestId('upcoming-rides-section')).toHaveCount(0);

  await context.close();
});

/**
 * FIELD-FIT G2 — the motari's half of advance booking, which is the
 * half the team reported broken ("Scheduled page can not get the data of
 * scheduled rides").
 *
 * The old query filtered on `driverId` alone, so the page could only
 * ever show a ride after the customer had accepted a bid — and since
 * bidding opens 60 minutes before pickup, a motari who had offered a
 * price on a future ride saw an empty page. This walks the exact failure
 * path: offer first (page must show it), acceptance second (page must
 * relabel it).
 */
test("a motari sees a scheduled ride he has offered on, and again once it is his", async () => {
  test.setTimeout(120_000);

  const customer = await loginAs('TestCustomer');
  const driver = await loginAs('TestDriver');
  await cancelExistingScheduledJourneys(customer.user.id);
  await verifyDriver('TestDriver');

  const scheduledFor = new Date(Date.now() + 61 * 60 * 1000).toISOString();
  const journey = await createScheduledJourney(customer.api, scheduledFor);
  expect(journey.status).toBe('SCHEDULED');

  const context = await browser.newContext();
  await applyAuthToContext(context, driver, 'en');
  const page = await context.newPage();

  // 1. Nobody has offered: the page is empty and says why.
  await page.goto('/driver/scheduled');
  await expect(page.getByTestId('driver-scheduled-empty')).toBeVisible();

  // 2. The window opens and the motari offers a price.
  await openBidWindow(journey.id);
  const bid = await submitBid(driver.api, journey.id, 1500, 8);

  // 3. THE REGRESSION: his own offer is on his scheduled page.
  await page.goto('/driver/scheduled');
  await expect(page.getByTestId('driver-scheduled-list')).toBeVisible();
  const row = page.getByTestId(`driver-scheduled-ride-${journey.id}`);
  await expect(row).toBeVisible();
  await expect(page.getByTestId(`driver-scheduled-commitment-${journey.id}`)).toHaveText(
    /offer is waiting/i,
  );
  await expect(row).toContainText('1,500');

  // 4. The customer accepts; the same row now reads as a commitment.
  await acceptBid(customer.api, journey.id, bid.id);
  await page.goto('/driver/scheduled');
  await expect(page.getByTestId(`driver-scheduled-commitment-${journey.id}`)).toHaveText(
    /this ride is yours/i,
  );

  await context.close();
});
