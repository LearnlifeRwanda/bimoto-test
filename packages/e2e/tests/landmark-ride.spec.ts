import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import { loginAs, applyAuthToContext, getJourney, disconnectPrisma, releaseDriverEngagements } from './helpers';

/**
 * LANDMARKS G5 — the walk this whole dispatch exists for.
 *
 * A passenger types a Kigali place name, not an address. "Sonatubes" is a
 * junction; "Kwa Jules" is a spot in Gisozi that no public map knows. This
 * spec drives both halves through the real UI and the real server:
 *
 *   1. Typing a landmark name offers the landmark BEFORE the geocoder, the
 *      chosen point lands inside the Kigali bounding box, and the create
 *      body the page builds is accepted.
 *   2. A place the catalog cannot pin is still bookable in words: the
 *      passenger describes it, and the description is on the motari's
 *      screen when the driver opens the request.
 *
 * /api/geocode/search is stubbed (the e2e stack has no LOCATIONIQ_API_KEY,
 * so the real endpoint 503s) and it deliberately answers with a point far
 * outside Kigali — if the ride ever picks that up, the ordering broke.
 * Everything else is real.
 */

// A deliberately wrong answer, 20 km west of the city: exactly where the
// old catalog used to send people. Nothing in this spec may end up here.
const WRONG_GEOCODER_ANSWER = { lat: -1.9536, lng: 29.8497, label: 'Somewhere In The Hills' };

const KIGALI_BBOX = { west: 29.95, south: -2.1, east: 30.25, north: -1.83 };

let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  await disconnectPrisma();
});

async function stubGeocode(page: Page) {
  await page.route('**/api/geocode/search*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [WRONG_GEOCODER_ANSWER] }),
    });
  });
}

/** Type a landmark name and pick the landmark row it produces. */
async function pickLandmark(page: Page, inputTestId: string, name: string) {
  await page.getByTestId(inputTestId).fill(name);
  const rows = page.locator(`[data-testid^="${inputTestId}-suggestion-"]`);
  await rows.first().waitFor();
  // The promise of G3: the landmark is first, the geocoder is not.
  await expect(rows.first()).toHaveAttribute('data-result-kind', 'landmark');
  await rows.filter({ hasText: name }).first().click();
}

function insideKigali(lat: number, lng: number): boolean {
  return (
    lng >= KIGALI_BBOX.west &&
    lng <= KIGALI_BBOX.east &&
    lat >= KIGALI_BBOX.south &&
    lat <= KIGALI_BBOX.north
  );
}

test('a ride created by typing landmark names lands inside Kigali', async () => {
  test.setTimeout(90_000);

  const customer = await loginAs('TestCustomer');
  const context = await browser.newContext();
  await applyAuthToContext(context, customer, 'en');
  const page = await context.newPage();
  await stubGeocode(page);

  await page.goto('/journey/new');
  await pickLandmark(page, 'pickup-address-input', 'Sonatubes');
  await pickLandmark(page, 'destination-address-input', 'Giporoso');

  const [createResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/api/journeys') && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: /find drivers|journey\.findDrivers/i }).click(),
  ]);

  expect(createResponse.status()).toBe(201);
  const journey = await createResponse.json();
  expect(journey.pickupName).toBe('Sonatubes');
  expect(journey.destinationName).toBe('Giporoso');

  // The invariant, end to end: the point a passenger got by typing a
  // spoken name is in the city, not in the hills the stub offered.
  expect(insideKigali(journey.pickupLat, journey.pickupLng)).toBe(true);
  expect(insideKigali(journey.destinationLat, journey.destinationLng)).toBe(true);
  expect(journey.pickupLng).not.toBe(WRONG_GEOCODER_ANSWER.lng);

  const persisted = await getJourney(customer.api, journey.id);
  expect(persisted.status).toBe('REQUESTED');

  await customer.api.post(`/api/journeys/${journey.id}/cancel`, { data: {} });
  await context.close();
});

test('a place with no pin still reaches the motari, in words', async () => {
  test.setTimeout(240_000);

  const customer = await loginAs('TestCustomer');
  const customerContext = await browser.newContext();
  await applyAuthToContext(customerContext, customer, 'en');
  const page = await customerContext.newPage();
  await stubGeocode(page);

  await page.goto('/journey/new');

  // "Kwa Jules (Gisozi)" is in the catalog by name and in nobody's
  // database by coordinate. Choosing it asks for a pin.
  await page.getByTestId('pickup-address-input').fill('Kwa Jules');
  const pickupRows = page.locator('[data-testid^="pickup-address-input-suggestion-"]');
  await pickupRows.first().waitFor();
  await pickupRows.filter({ hasText: 'Kwa Jules' }).first().click();

  // The area hint became the starting point of the description, and the
  // passenger adds their own words to it.
  const description = page.getByTestId('pickup-description-input');
  await expect(description).toHaveValue('Gisozi');
  await description.fill('Kuwa Mudugudu, past the blue gate');

  // The pin the catalog could not supply comes from the map: the picker
  // opened on its own when the landmark was chosen, so the passenger taps
  // where the place actually is and confirms.
  await expect(page.getByTestId('picker-tap-hint')).toBeVisible();
  // Tap clear of the form sheet, which sits centred over the map.
  const map = page.getByTestId('map-canvas');
  const sheet = page.getByTestId('bottom-sheet');
  const mapBox = (await map.boundingBox())!;
  const sheetBox = await sheet.boundingBox();
  const x = sheetBox ? Math.max(mapBox.x + 20, sheetBox.x / 2) : mapBox.x + mapBox.width / 2;
  await page.mouse.click(x, mapBox.y + mapBox.height / 2);
  await page.getByTestId('picker-confirm').click();

  // Back to the form, with the pin planted and the words intact.
  await page.getByTestId('sheet-handle').click();
  await expect(page.getByTestId('pickup-address-input')).not.toHaveValue('');
  await expect(page.getByTestId('pickup-description-input')).toHaveValue(
    'Kuwa Mudugudu, past the blue gate',
  );

  await pickLandmark(page, 'destination-address-input', 'Giporoso');

  const [createResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/api/journeys') && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: /find drivers|journey\.findDrivers/i }).click(),
  ]);

  expect(createResponse.status()).toBe(201);
  const journey = await createResponse.json();
  expect(journey.pickupDescription).toBe('Kuwa Mudugudu, past the blue gate');
  expect(insideKigali(journey.pickupLat, journey.pickupLng)).toBe(true);

  // The motari's side: the words are on the request card.
  const driver = await loginAs('TestDriver');
  // FIELD-FIT G5 — an engaged motari is shown no new requests, so a
  // leftover MATCHED journey from an earlier spec would empty this
  // one's feed. Start from a driver who is carrying nobody.
  await releaseDriverEngagements('TestDriver');
  const driverContext = await browser.newContext();
  await applyAuthToContext(driverContext, driver, 'en');
  const driverPage = await driverContext.newPage();
  await driverPage.goto(`/driver/bid/${journey.id}`);

  await expect(driverPage.getByTestId('pickup-description')).toContainText(
    'Kuwa Mudugudu, past the blue gate',
  );

  await customer.api.post(`/api/journeys/${journey.id}/cancel`, { data: {} });
  await driverContext.close();
  await customerContext.close();
});
