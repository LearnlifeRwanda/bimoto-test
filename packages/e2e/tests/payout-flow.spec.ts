import { test, expect, chromium, type Browser } from '@playwright/test';
import {
  loginAs,
  legacyApi,
  giveDriverAMoneyPin,
  applyAuthToContext,
  seedDriverPayoutState,
  getDriverPayoutBatches,
  disconnectPrisma,
  enrollMoneyPin,
  passMoneyPinIfPrompted,
  E2E_MONEY_PIN,
} from './helpers';

/**
 * PAYOUT-C — driver money screen end-to-end.
 *
 *   seed balance (direct DB) → Dashboard shows earnings card →
 *   "Pay me now" → confirmation UI + DriverPayoutBatch row →
 *   Account page shows the three payout-preference options
 *
 * The driver is seeded with payoutPreference=AT_SHIFT_END and
 * completedShifts=5 so the training-wheels override is OFF and the
 * effective preference allows end-shift ("Pay me now" is visible).
 *
 * Gateway behaviour: the e2e stack runs without FLW keys, so the server's
 * stub Flutterwave client makes transferToWallet throw NO_KEYS_CONFIGURED
 * and the batch settles as FAILED. POST /api/payout/end-shift still
 * returns 200 {batchId, amount, expectedDeliveryAt} (the transfer is
 * fire-and-record), so per the dispatch this spec asserts the response-
 * driven confirmation UI and the created batch row — NOT transfer
 * completion, which is not stubbable end-to-end today
 * (E2E_FAKE_PAYMENTS=1 only covers chargeCard, not transfers).
 *
 * Balance seeding is direct-DB on purpose — a full ride-completion flow
 * is out of scope for this spec.
 *
 * MONEY-PIN (ruling D25): the balance and the payout preferences are the
 * money surfaces, so both tests below now meet the PIN. That is the
 * product, not an obstacle to route around — seedDriverPayoutState clears
 * the driver's PIN so each run starts never-enrolled, the first test walks
 * the real enrolment pad, and the second uses the enrols-if-prompted
 * helper so it stays about payout preferences rather than about PINs.
 *
 * Single chromium browser, sequential tests (mirrors payment-card-flow /
 * disputed-flow structure; workers=1 in playwright.config.ts).
 */

const SEEDED_AMOUNT = 12_500;

let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  await disconnectPrisma();
});

test('driver sees today\'s balance on the Dashboard and "Pay me now" fires an end-shift payout', async () => {
  test.setTimeout(60_000);

  // 1. Driver with a seeded balance, out of training wheels, AT_SHIFT_END.
  const driver = await loginAs('TestDriver');
  const driverId = await seedDriverPayoutState('TestDriver', {
    payoutPreference: 'AT_SHIFT_END',
    completedShifts: 5,
    pendingAmount: SEEDED_AMOUNT,
  });

  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
  });
  await applyAuthToContext(context, driver, 'en');
  const page = await context.newPage();

  // 2. Dashboard shows the earnings card. The driver has never set a
  //    money PIN, so the card asks for one first — IN ITS OWN SLOT, with
  //    the rest of the dashboard working around it (D25's second half,
  //    pinned by the client suite's "no PIN, full working screen").
  await page.goto('/driver');
  const card = page.getByTestId('driver-earnings-card');
  await expect(card).toBeVisible({ timeout: 15_000 });

  // The one spec that walks enrolment end-to-end, through the real pad.
  await enrollMoneyPin(page, E2E_MONEY_PIN);

  // Only now does the number appear.
  await expect(page.getByTestId('driver-earnings-balance')).toContainText('12,500 RWF');
  // AT_SHIFT_END + 5 shifts → no training-wheels explainer, no lands-at line.
  await expect(page.getByTestId('driver-earnings-training-wheels')).toHaveCount(0);

  // 3. Effective preference allows end-shift → the button is there; tap it.
  const payNow = page.getByTestId('driver-earnings-pay-now');
  await expect(payNow).toBeVisible();
  await expect(payNow).toBeEnabled();
  await payNow.click();

  // 4. Confirmation UI renders the paid amount from the API response.
  const confirmation = page.getByTestId('driver-earnings-confirmation');
  await expect(confirmation).toBeVisible({ timeout: 15_000 });
  await expect(confirmation).toContainText('12,500');

  // 5. Server-side: an end-shift batch row exists for the seeded amount.
  //    (Status is FAILED in this environment — no FLW keys — so assert the
  //    row + amount, not transfer completion.)
  const batches = await getDriverPayoutBatches(driverId);
  expect(batches.length).toBeGreaterThan(0);
  expect(batches[0].amount).toBe(SEEDED_AMOUNT);
  expect(batches[0].trigger).toBe('SHIFT_END');

  await context.close();
});

test('Account page renders the three payout-preference options with the current one marked', async () => {
  test.setTimeout(60_000);

  const driver = await loginAs('TestDriver');
  await seedDriverPayoutState('TestDriver', {
    payoutPreference: 'AT_SHIFT_END',
    completedShifts: 5,
    pendingAmount: 0,
  });

  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
  });
  await applyAuthToContext(context, driver, 'en');
  const page = await context.newPage();

  await page.goto('/driver/account');
  // Payout preferences are a money surface, so pass the gate FIRST and
  // then assert. Order matters here in a way it does not on the
  // Dashboard: the Account page mounts two money sections (the earnings
  // card and this one), the first refusal owns the pad, and which one
  // that is depends on which fetch lands first. Entering the PIN before
  // asserting makes the spec independent of that race.
  await passMoneyPinIfPrompted(page, E2E_MONEY_PIN);
  await expect(page.getByTestId('payout-preference-section')).toBeVisible({ timeout: 15_000 });
  for (const pref of ['TWICE_DAILY', 'DAILY_22H', 'AT_SHIFT_END']) {
    await expect(page.getByTestId(`payout-pref-option-${pref}`)).toBeVisible();
  }
  await expect(page.getByTestId('payout-pref-option-AT_SHIFT_END')).toHaveAttribute(
    'data-current',
    'true',
  );

  await context.close();
});

/* ==================================================================== */

test('the money-PIN gate narrows by CLIENT, and only the enrolment arm', async () => {
  // CUTGUARD v2 G6 (B-3) — both sides of the second gate, at the wire.
  //
  // THE DEFECT. A v13 motari has no enrolment screen in his build, so the
  // 428 that says "set a PIN first" made his whole earnings surface a dead
  // end for the length of the rollout. He could not see his own money.
  //
  // THE TWO SIDES. A current client is asked to enrol; a legacy one is
  // let through to exactly the pre-window behaviour. The two tests above
  // drive the BROWSER, which sends the header the real app sends — this
  // one drives the wire, because the legacy side has no browser to drive:
  // there is no v13 build in this repo to point Playwright at.
  //
  // WHAT THIS IS NOT. It is not a claim that the header is a security
  // boundary. It is client-supplied and anybody can send anything, which
  // is exactly why the gate is on the ENROLMENT arm alone — the arm that
  // is only reachable when no PIN exists. The final assertion below is
  // that half: claiming to be legacy must not skip a PIN that is real.
  const driver = await loginAs('TestDriver');
  await seedDriverPayoutState('TestDriver', {
    payoutPreference: 'AT_SHIFT_END',
    completedShifts: 5,
    pendingAmount: 12_500,
  });

  // 1. CURRENT CLIENT, no PIN → asked to enrol. Unchanged behaviour.
  const current = await driver.api.get('/api/payout/summary');
  expect(current.status(), 'a v14 client is asked to enrol').toBe(428);
  expect((await current.json()).error.code).toBe('MONEY_PIN_ENROLLMENT_REQUIRED');

  // 2. LEGACY CLIENT, no PIN → through, exactly as before the window.
  const legacy = await legacyApi(driver);
  try {
    const summary = await legacy.get('/api/payout/summary');
    expect(summary.status(), 'B-3: a legacy motari still reaches his money').toBe(200);
    const body = await summary.json();
    expect(typeof body.pendingAmount, 'and it is his real balance').toBe('number');

    // 3. AND THE HALF THAT MUST NOT MOVE. Once a PIN exists, the version
    //    header makes NO difference — that is the whole security claim,
    //    and it is asserted as an equality rather than as a fixed code on
    //    purpose.
    //
    //    A bare `.toBe(401)` here would be order-dependent: the step-up
    //    session lives in server memory, the two tests above walk the
    //    real pad for this same driver, and the runner is serial
    //    (workers: 1) — so an open session would make this 200 and the
    //    spec would fail for a reason that has nothing to do with the
    //    gate. What must be true either way is that the two clients get
    //    the SAME answer, and that neither is sent back to enrolment.
    await giveDriverAMoneyPin('TestDriver');
    const legacyGated = await legacy.get('/api/payout/summary');
    const currentGated = await driver.api.get('/api/payout/summary');
    expect(
      legacyGated.status(),
      'claiming legacy changes nothing once a PIN exists',
    ).toBe(currentGated.status());
    expect(legacyGated.status(), 'and it is never the enrolment arm').not.toBe(428);
  } finally {
    await legacy.dispose();
  }
});
