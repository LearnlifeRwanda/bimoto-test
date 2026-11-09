import { test, expect, chromium, type Browser } from '@playwright/test';
import {
  loginAs,
  applyAuthToContext,
  addChildPassengerFlag,
  getFairPrice,
  submitBid,
  acceptBid,
  verifyDriver,
  getJourney,
  disconnectPrisma,
} from './helpers';

/**
 * R3-E2E-EXPANSION (§3.4) — child-passenger flag + driver acknowledgment gate.
 *
 * Two halves:
 *
 *  1. Fare premium. The child premium is the REAL constant
 *     CHILD_PASSENGER_MULTIPLIER = 1.1 (fair-price.service), NOT the 1.5x
 *     the dispatch assumed. We assert it via GET /api/journeys/fair-price
 *     with vs without hasChildPassenger for the same distance: the child
 *     band is ~1.1x the baseline (both values are rounded to the nearest
 *     50 RWF by the server, so we assert with a tolerant ratio). The
 *     fair-price band can be null when seed data is sparse; in that case we
 *     skip the ratio assertion but still assert the persisted flag.
 *
 *  2. Driver acknowledgment gate (REAL UI). The dispatch described two
 *     helmet/adult checkboxes, but the real ChildAcknowledgmentModal has no
 *     checkboxes — it lists the safety expectations and gates the bid behind
 *     an explicit Confirm. On /driver/bid/:id the modal interposes BEFORE
 *     the price-confirmation modal whenever the journey hasChildPassenger.
 *     We assert: submit is disabled until price+eta are entered; tapping
 *     submit opens the child-acknowledgment-modal (testid); confirming it
 *     proceeds. The actual match is then driven via the API (the modal's
 *     confirm leads to a price-confirm modal whose final POST we exercise
 *     through the API for determinism), asserting MATCHED.
 *
 * Single chromium browser + single top-level test(). No describe blocks.
 */

// Mirror of fair-price.service constants (local to the server, not exported).
const CHILD_PASSENGER_MULTIPLIER = 1.1;

let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  await disconnectPrisma();
});

test('child-passenger flag applies premium and gates bidding on acknowledgment', async () => {
  // R3-AUTH-CROSS-ORIGIN-FIX (un-skipped): the cross-origin auth defect that
  // previously caused a deterministic 401 on BidPage's GET /api/journeys fetch
  // is fixed on both ends — the server now accepts an Authorization: Bearer
  // fallback (packages/server/src/middleware/auth.ts) and every authenticated
  // client fetch sends credentials: 'include'. activeJourney hydrates, so the
  // acknowledgment-gate assertions below run for real.
  test.setTimeout(120_000);

  const customer = await loginAs('TestCustomer');
  const driver = await loginAs('TestDriver');
  await verifyDriver('TestDriver');

  // --- Fare premium via the fair-price endpoint ----------------------------
  const DISTANCE = 5;
  const baseline = await getFairPrice(customer.api, {
    distance: DISTANCE,
    vehicleType: 'MOTO',
  });
  const child = await getFairPrice(customer.api, {
    distance: DISTANCE,
    vehicleType: 'MOTO',
    hasChildPassenger: true,
  });

  if (baseline.range && child.range) {
    // Child band is ~1.1x baseline; rounding to 50 RWF means we assert a
    // tolerant ratio rather than exact equality.
    const ratio = child.range.median / baseline.range.median;
    expect(ratio).toBeGreaterThan(1.0);
    expect(ratio).toBeCloseTo(CHILD_PASSENGER_MULTIPLIER, 1);
  }

  // --- Create the child-flagged journey (persisted flag) -------------------
  // Age must be >=12: children under 12 cannot ride MOTO in Rwanda
  // (CHILD_TOO_YOUNG_FOR_MOTO). This spec asserts the helmet-gate /
  // acknowledgment flow, not the regulatory age block, so we use a valid age.
  const childJourney = await addChildPassengerFlag(customer.api, { childAgeYears: 13 });
  expect(childJourney.hasChildPassenger).toBe(true);
  const journeyId = childJourney.id as string;

  // PRE-STATE: journey REQUESTED, child flag persisted.
  const createdState = await getJourney(customer.api, journeyId);
  expect(createdState.status).toBe('REQUESTED');
  expect(createdState.hasChildPassenger).toBe(true);

  // --- REAL UI: the driver acknowledgment gate on /driver/bid/:id ----------
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
  });
  await applyAuthToContext(ctx, driver, 'en');
  const page = await ctx.newPage();

  // TEMP(R3-E2E-FOLLOWUP-A, diagnostic): the prior commit's waitForResponse
  // timed out because its predicate also required resp.ok(), which silently
  // rejects a non-2xx journey fetch (e.g. a 401 if BidPage's Bearer token
  // isn't primed before the in-effect fetch fires). Log EVERY /api/journeys
  // response so CI surfaces the actual method/status/url, registered before
  // navigation so nothing is missed.
  page.on('response', (r) => {
    if (r.url().includes('/api/journeys')) {
      // eslint-disable-next-line no-console
      console.log('[debug-resp]', r.request().method(), r.status(), r.url());
    }
  });

  // Arm the GET /api/journeys/${journeyId} wait BEFORE navigating. Predicate is
  // intentionally relaxed (URL + GET only, no resp.ok()) so a non-2xx response
  // resolves the wait instead of silently timing out; we assert .ok() loudly
  // right after, turning a mute 15s timeout into "expected ok, got <status>".
  const journeyRespPromise = page.waitForResponse(
    (resp) =>
      resp.url().includes(`/api/journeys/${journeyId}`) &&
      resp.request().method() === 'GET',
    { timeout: 15_000 },
  );
  await page.goto(`/driver/bid/${journeyId}`);

  // The submit button is disabled until both price + eta are entered.
  const submitBtn = page.getByRole('button', { name: /submit/i }).last();
  await expect(submitBtn).toBeVisible({ timeout: 15_000 });
  await expect(submitBtn).toBeDisabled();

  const journeyResp = await journeyRespPromise;
  expect(journeyResp.ok()).toBe(true);
  const journeyBody = await journeyResp.json();
  expect(journeyBody.hasChildPassenger).toBe(true);

  // Badge sanity check: by now activeJourney is loaded, so the badge renders
  // reliably (no longer racing the fetch).
  await expect(page.getByTestId('child-passenger-badge')).toBeVisible({ timeout: 5_000 });

  // Fill price + eta (the two number inputs on the bid form).
  const numberInputs = page.locator('input[type="number"]');
  await numberInputs.nth(0).fill('1500');
  await numberInputs.nth(1).fill('5');
  await expect(submitBtn).toBeEnabled();

  // Tapping submit on a child journey opens the acknowledgment modal
  // BEFORE the price-confirmation modal.
  await submitBtn.click();
  const ackModal = page.getByTestId('child-acknowledgment-modal');
  await expect(ackModal).toBeVisible();

  // Confirm the acknowledgment — this dismisses the gate and proceeds to
  // the price-confirmation step.
  await page.getByTestId('child-ack-confirm').click();
  await expect(ackModal).toBeHidden();
  await ctx.close();

  // --- Drive the actual match via the API ----------------------------------
  const bid = await submitBid(driver.api, journeyId, 1500, 5);
  await acceptBid(customer.api, journeyId, bid.id);

  // --- POST-STATE: journey MATCHED, child flag retained --------------------
  const matched = await getJourney(customer.api, journeyId);
  expect(matched.status).toBe('MATCHED');
  expect(matched.hasChildPassenger).toBe(true);
  expect(matched.escrow?.status).toBe('HELD');
});
