import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import { loginAs, applyAuthToContext, getJourney, disconnectPrisma } from './helpers';

/**
 * CREATE-FIX G3 — UI-driven journey creation.
 *
 * Every other spec in this suite seeds journeys via the API, which is
 * why a non-conformant creation body (type 'RIDE' +
 * pickupAddress/destinationAddress) could pass CI while every real
 * create from the UI 400'd. This spec drives the creation UI itself:
 * pick pickup + destination, submit, and assert the POST /api/journeys
 * the PAGE builds is accepted by the real server.
 *
 * Only /api/geocode/search is stubbed (page.route): the e2e stack has
 * no LOCATIONIQ_API_KEY, so the real endpoint answers 503 and the
 * address picker would go dormant. The journey create call is real —
 * stubbing it would defeat the point of the spec.
 *
 * Several i18n keys these pages use (journey.findDrivers, the goods.*
 * form keys) are missing from the locale files, so the rendered texts
 * are the raw keys; selectors below prefer data-testids and accept
 * either the raw key or a real translation where text is unavoidable.
 */

const PICKUP = { lat: -1.9536, lng: 30.0606, label: 'Kimironko Market' };
const DESTINATION = { lat: -1.9706, lng: 30.1044, label: 'Kigali Convention Centre' };

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
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    const place = /convention|kcc/i.test(q) ? DESTINATION : PICKUP;
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
 * this list, so "suggestion-0" is now usually a landmark. This spec is
 * about the geocoder path, so it asks for a geocoder row by name; the
 * landmark path has a spec of its own in landmark-ride.spec.ts.
 */
async function pickAddress(page: Page, inputTestId: string, query: string) {
  await page.getByTestId(inputTestId).fill(query);
  await page
    .locator(`[data-testid^="${inputTestId}-suggestion-"][data-result-kind="geocode"]`)
    .first()
    .click();
}

test('customer creates an ordinary Leave-now ride through the UI', async () => {
  test.setTimeout(90_000);

  const customer = await loginAs('TestCustomer');
  const context = await browser.newContext();
  await applyAuthToContext(context, customer, 'en');
  const page = await context.newPage();
  await stubGeocode(page);

  // PILOT-UX-2 G3 — '/' is now the ride/parcel fork over the map; the
  // ride form lives at /journey/new behind the "Request a ride" tile.
  await page.goto('/');
  await page.getByTestId('home-fork-ride').click();
  await page.waitForURL('**/journey/new');
  await pickAddress(page, 'pickup-address-input', 'Kimironko market');
  await pickAddress(page, 'destination-address-input', 'Convention centre');

  const [createResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/api/journeys') && r.request().method() === 'POST',
    ),
    page
      .getByRole('button', { name: /find drivers|journey\.findDrivers/i })
      .click(),
  ]);

  // The whole point of CREATE-FIX: the body the page builds must not 4xx.
  expect(createResponse.status()).toBe(201);
  const journey = await createResponse.json();
  expect(journey.type).toBe('PASSENGER');
  expect(journey.pickupName).toBe(PICKUP.label);
  expect(journey.destinationName).toBe(DESTINATION.label);

  // Bid-list / searching state reached.
  await page.waitForURL(`**/journey/${journey.id}/bids`);

  // Server-side truth: the journey exists and is open for bids.
  const persisted = await getJourney(customer.api, journey.id);
  expect(persisted.status).toBe('REQUESTED');

  // Cleanup so the open journey does not leak into other specs.
  await customer.api.post(`/api/journeys/${journey.id}/cancel`, { data: {} });
  await context.close();
});

test('customer creates a goods request through the UI', async () => {
  test.setTimeout(90_000);

  const customer = await loginAs('TestCustomer');
  const context = await browser.newContext();
  await applyAuthToContext(context, customer, 'en');
  const page = await context.newPage();
  await stubGeocode(page);

  await page.goto('/journey/goods');
  await pickAddress(page, 'pickup-address-input', 'Kimironko market');
  await pickAddress(page, 'destination-address-input', 'Convention centre');

  await page
    .getByPlaceholder(/goods\.descriptionPlaceholder|what is being sent/i)
    .fill('Spare parts');
  // TRUE-WORDS — the recipient hint used to repeat its own label; the
  // 13-Aug review replaced it with the shared "Write here", which the wish
  // price on the same screen now also uses. The label is the unambiguous
  // handle (Input associates it via htmlFor), so target that instead.
  await page.getByLabel(/goods\.recipientName$|recipient name/i).fill('E2E Recipient');
  await page
    .getByPlaceholder(/goods\.recipientPhonePlaceholder|\+250/i)
    .fill('+250788999888');

  const [createResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/api/journeys') && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: /goods\.submit|request delivery/i }).click(),
  ]);

  expect(createResponse.status()).toBe(201);
  const journey = await createResponse.json();
  expect(journey.type).toBe('GOODS');
  expect(journey.pickupName).toBe(PICKUP.label);
  expect(journey.goodsSizeCategory).toBe('MEDIUM');
  expect(journey.recipientName).toBe('E2E Recipient');

  await page.waitForURL(`**/journey/${journey.id}/bids`);

  await customer.api.post(`/api/journeys/${journey.id}/cancel`, { data: {} });
  await context.close();
});
