import { test, expect, chromium, type Browser } from '@playwright/test';
import {
  loginAs,
  applyAuthToContext,
  createPassengerJourney,
  submitBid,
  acceptBid,
  verifyDriver,
  getJourney,
  failEscrowForRetry,
  getEscrowByJourney,
  disconnectPrisma,
} from './helpers';

/**
 * PAY-TRUTH G5 — a customer whose payment failed pays again, in one tap,
 * and keeps the motari who already agreed to carry them.
 *
 * This is docs/payment-failure-matrix.md R1, end to end, through the real
 * customer UI. Before this dispatch the same sequence put the customer on
 * the live-tracking MatchedPage for a ride that did not exist, over a
 * journey no accept could ever succeed on again (500, P2002 on
 * Escrow.journeyId).
 *
 * The failed-charge state is written directly rather than provoked from
 * the gateway: this CI job runs with no FLW keys, and the point under test
 * is the RECOVERY — that the retry surface appears on the screen where the
 * failure happened, that one tap charges the SAME escrow, and that the
 * driver is still there afterwards. The gateway-side failure taxonomy is
 * covered by the server suites (payment-failure-matrix.test.ts and
 * simulated-failure-mode.test.ts), which drive the real simulated client
 * through every fault.
 *
 * Pre-state:  journey MATCHED, escrow FAILED (charge declined), bid ACCEPTED.
 * Post-state: escrow HELD on the SAME row with a fresh txRef, journey still
 *             MATCHED to the same driver, customer on MatchedPage.
 */

let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  await disconnectPrisma();
});

test('a failed MoMo charge offers a retry that pays and keeps the driver', async () => {
  test.setTimeout(90_000);

  const customer = await loginAs('TestCustomer');
  const driver = await loginAs('TestDriver');
  await verifyDriver('TestDriver');

  const journey = await createPassengerJourney(customer.api);
  const journeyId = journey.id as string;
  const bid = await submitBid(driver.api, journeyId, 2000, 5);
  await acceptBid(customer.api, journeyId, bid.id as string);

  // The charge declined. PAY-TRUTH G2: the match is HELD, not torn down.
  const before = await failEscrowForRetry(journeyId);
  expect(before.escrowStatus).toBe('FAILED');
  expect(before.journeyStatus).toBe('MATCHED');

  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
  });
  await applyAuthToContext(context, customer, 'en');
  const page = await context.newPage();
  await page.goto(`/journey/${journeyId}/bids`);

  // The way forward is on the screen, and it is honest about the money.
  //
  // This is the RELOAD path — the customer came back to a MATCHED journey
  // over a FAILED escrow. SETTLE-UP G3 closed the gap that used to leave
  // this panel on the generic fallback: the reason has always lived on
  // the CHARGE_FAILED audit entry, and GET /api/payments/:escrowId/status
  // now hands it back, so the returning customer reads the same named
  // reason they would have seen in the moment. The seeded entry says
  // INSUFFICIENT_FUNDS (helpers.failEscrowForRetry), which is the one
  // reason a customer can actually act on.
  const panel = page.getByTestId('payment-failure-panel');
  await panel.waitFor({ timeout: 20_000 });
  await expect(page.getByTestId('payment-failure-reason')).toContainText(
    /not enough money/i,
    { timeout: 10_000 },
  );
  // The reassurance that the ride is not lost. TRUE-WORDS retired "motari"
  // from English copy (the decided English word is Driver), so match the
  // clause that carries the meaning rather than the role noun.
  await expect(panel).toContainText(/still holding this ride/i);

  // One tap.
  await page.getByTestId('payment-retry-momo').click();
  await page.waitForURL(`**/journey/${journeyId}/matched`, { timeout: 30_000 });

  // Same escrow row, revived; same driver; money held.
  const after = await getEscrowByJourney(journeyId);
  expect(after.id).toBe(before.escrowId);
  expect(after.status).toBe('HELD');
  expect(after.txRef).not.toBe(before.txRef);

  const finalJourney = await getJourney(customer.api, journeyId);
  expect(finalJourney.status).toBe('MATCHED');
  expect(finalJourney.driverId).toBe(driver.user.id);

  await context.close();
});
