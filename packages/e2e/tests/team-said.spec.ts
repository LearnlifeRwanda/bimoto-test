import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import {
  loginAs,
  applyAuthToContext,
  disconnectPrisma,
  releaseDriverEngagements,
  stubGeocodeSearch,
} from './helpers';

/**
 * TEAM-SAID G5 — the two walks this dispatch exists for.
 *
 *   1. A passenger ticks "Travelling with a child?" and the motari
 *      reads it on the screen where he decides whether to come — with
 *      no child-passenger premium and none of the child 422 taxonomy
 *      anywhere near the booking.
 *   2. A driver writes an auto-bid rule and it persists dark: stored,
 *      listed, and provably not something the evaluator will act on.
 *
 * The geocoder is stubbed (the e2e stack has no LOCATIONIQ_API_KEY, so
 * the real endpoint 503s); everything else is real.
 */

const prisma = new PrismaClient();

let browser: Browser;
const createdJourneyIds: string[] = [];
const createdRuleIds: string[] = [];

test.beforeAll(async () => {
  browser = await chromium.launch(
    process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  );
});

test.afterAll(async () => {
  if (createdJourneyIds.length > 0) {
    await prisma.journey.updateMany({
      where: { id: { in: createdJourneyIds } },
      data: { status: 'CANCELLED' },
    });
  }
  if (createdRuleIds.length > 0) {
    await prisma.driverAutoBidRule.deleteMany({ where: { id: { in: createdRuleIds } } });
  }
  await browser?.close();
  await disconnectPrisma();
  await prisma.$disconnect();
});

/** Type a landmark name and pick the landmark row it produces. */
async function pickLandmark(page: Page, inputTestId: string, name: string) {
  await page.getByTestId(inputTestId).fill(name);
  const rows = page.locator(`[data-testid^="${inputTestId}-suggestion-"]`);
  await rows.first().waitFor();
  await rows.filter({ hasText: name }).first().click();
}

// ------------------------------------------------------- G1: the child flag

test('a passenger warns the motari a child is coming, and he sees it — with no premium', async () => {
  test.setTimeout(90_000);

  const customer = await loginAs('TestCustomer');
  const customerContext = await browser.newContext();
  await applyAuthToContext(customerContext, customer, 'en');
  const page = await customerContext.newPage();
  await stubGeocodeSearch(page);

  await page.goto('/journey/new');
  await pickLandmark(page, 'pickup-address-input', 'Sonatubes');
  await pickLandmark(page, 'destination-address-input', 'Giporoso');

  // The whole of the feature, from the passenger's side: one checkbox.
  // No age, no guardian, no helmet step follows it.
  await page.getByTestId('child-travel-toggle').check();
  await expect(page.getByTestId('child-age-input')).toHaveCount(0);
  await expect(page.getByTestId('child-guardian-phone-input')).toHaveCount(0);
  await expect(page.getByTestId('child-helmet-toggle')).toHaveCount(0);

  const [createResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/api/journeys') && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: /find drivers|journey\.findDrivers/i }).click(),
  ]);

  // 201, not a 422 from the child taxonomy the omitted flow raises.
  expect(createResponse.status()).toBe(201);
  const journey = await createResponse.json();
  createdJourneyIds.push(journey.id);

  expect(journey.travellingWithChild).toBe(true);
  // The flag is advisory, so none of the declaration flow was entered.
  expect(journey.hasChildPassenger).toBe(false);
  expect(journey.childAgeYears).toBeNull();
  expect(journey.childPassengerHelmetConfirmed).toBe(false);

  // The motari's side: the advisory is on the request card, on the
  // screen where he decides whether to come.
  const driver = await loginAs('TestDriver');
  await releaseDriverEngagements('TestDriver');
  const driverContext = await browser.newContext();
  await applyAuthToContext(driverContext, driver, 'en');
  const driverPage = await driverContext.newPage();
  await driverPage.goto(`/driver/bid/${journey.id}`);

  await expect(driverPage.getByTestId('child-travel-notice')).toBeVisible();
  // And the badge belonging to the omitted flow is not there — the two
  // are separate things and must look separate to him.
  await expect(driverPage.getByTestId('child-passenger-badge')).toHaveCount(0);

  await customer.api.post(`/api/journeys/${journey.id}/cancel`, { data: {} });
  await driverContext.close();
  await customerContext.close();
});

// ------------------------------------------------- G4: a rule that stays dark

test('a driver writes an auto-bid rule and it persists dark', async () => {
  test.setTimeout(90_000);

  const driver = await loginAs('TestDriver');
  // Start from a clean slate — the route caps at five priorities, and a
  // rule left by a re-run would take the slot this test writes into.
  await prisma.driverAutoBidRule.deleteMany({ where: { driverId: driver.user.id } });

  const driverContext = await browser.newContext();
  await applyAuthToContext(driverContext, driver, 'en');
  const page = await driverContext.newPage();

  // Reached from the driver Account screen, not from a nav tab.
  await page.goto('/driver/account');
  await page.getByTestId('auto-bid-entry').click();
  await expect(page).toHaveURL(/\/driver\/auto-bid$/);

  // The screen says what it is before the driver writes anything.
  await expect(page.getByTestId('auto-bid-off-banner')).toBeVisible();

  await page.getByTestId('auto-bid-add-rule').click();
  await page.getByTestId('auto-bid-max-pickup').fill('2');
  await page.getByTestId('auto-bid-max-ride').fill('8');
  await page.getByTestId('auto-bid-vehicle-MOTO').click();
  await page.getByTestId('auto-bid-amount').fill('1800');

  const [createResponse] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/driver/auto-bid-rules') && r.request().method() === 'POST',
    ),
    page.getByTestId('auto-bid-save').click(),
  ]);

  expect(createResponse.status()).toBe(201);
  const rule = await createResponse.json();
  createdRuleIds.push(rule.id);

  // Stored with the driver's numbers, in the route's units.
  expect(rule.maxPickupDistanceM).toBe(2000);
  expect(rule.maxRideDistanceM).toBe(8000);
  expect(rule.bidAmountValue).toBe(1800);
  expect(rule.vehicleTypeFilter).toBe('MOTO');

  // ...and dark. This is the assertion the whole group is for.
  expect(rule.enabled).toBe(false);

  // It is in the database that way, not merely in the response.
  const stored = await prisma.driverAutoBidRule.findUnique({ where: { id: rule.id } });
  expect(stored?.enabled).toBe(false);

  // The evaluator loads only enabled rules, so this driver has nothing
  // for it to consider — the rule waits without bidding.
  const armed = await prisma.driverAutoBidRule.findMany({
    where: { driverId: driver.user.id, enabled: true },
  });
  expect(armed).toHaveLength(0);

  // The screen shows it back as saved-but-not-active, and the one
  // control that could arm it is closed.
  await expect(page.getByTestId(`auto-bid-rule-${rule.id}`)).toHaveAttribute(
    'data-enabled',
    'false',
  );
  await expect(page.getByTestId('auto-bid-resume-all')).toBeDisabled();

  // The kill switch works and round-trips.
  const [pauseResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auto-bid-rules/pause-all')),
    page.getByTestId('auto-bid-pause-all').click(),
  ]);
  expect(pauseResponse.status()).toBe(200);

  await prisma.driverAutoBidRule.deleteMany({ where: { driverId: driver.user.id } });
  await driverContext.close();
});
