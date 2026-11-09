import { test, expect, chromium, type Browser } from '@playwright/test';
import {
  loginAs,
  applyAuthToContext,
  createPassengerJourney,
  submitBid,
  acceptBid,
  acceptBidViaUI,
  verifyDriver,
  getJourney,
  releaseMatchByMachine,
  getEscrowByJourney,
  getEscrowChain,
  countEscrowsForJourney,
  disconnectPrisma,
  releaseDriverEngagements,
} from './helpers';

/**
 * SETTLE-UP G6 — a customer released by a machine's tidy-up can simply
 * try again.
 *
 * This is docs/payment-failure-matrix.md R9/R10, end to end, through the
 * real customer UI. Before this dispatch the same sequence answered the
 * second accept with 500 INTERNAL_ERROR — P2002 on Escrow.journeyId,
 * because the released journey still owned its FAILED escrow and
 * createEscrowTx is a plain create. The customer-facing shape of that bug
 * was total: the ride could never be requested again.
 *
 * The interactive retry (PAY-TRUTH G5, payment-retry-flow.spec.ts) covers
 * the customer who is still at the screen. This covers the one who is
 * not: the webhook, the reconciler or the unpaid-match reaper let the
 * driver go, and the customer comes back to an ordinary open request.
 *
 * Pre-state:  journey REQUESTED, driverId null, escrow FAILED still
 *             owning journeyId, a fresh bid from a second driver.
 * Post-state: ONE escrow row — the same one — revived to PENDING with the
 *             new bid's amount and driver, chain
 *             CREATED_PENDING, CHARGE_FAILED, ADOPTED_ON_REACCEPT.
 */

let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  await disconnectPrisma();
});

test('a machine-released journey can be accepted again, adopting its escrow', async () => {
  test.setTimeout(90_000);

  const customer = await loginAs('TestCustomer');
  const driver = await loginAs('TestDriver');
  const secondDriver = await loginAs('EBikeJean');
  await verifyDriver('TestDriver');
  // FIELD-FIT G5 — an engaged motari is shown no new requests, so a
  // leftover MATCHED journey from an earlier spec would empty this
  // one's feed. Start from a driver who is carrying nobody.
  await releaseDriverEngagements('TestDriver');
  await verifyDriver('EBikeJean');

  // No vehicle preference: the seed has one MOTO driver, and this
  // journey needs two motari bidding on it.
  const journey = await createPassengerJourney(customer.api, { vehiclePreference: null });
  const journeyId = journey.id as string;

  // Two bids, exactly as a real request gets them.
  const firstBid = await submitBid(driver.api, journeyId, 2000, 5);
  const secondBid = await submitBid(secondDriver.api, journeyId, 2400, 6);

  // The customer picks the first. The second is DECLINED by the accept.
  await acceptBid(customer.api, journeyId, firstBid.id as string);

  // Nobody is at the screen: the machine releases the match. The journey
  // goes back on the market, the rival bid re-opens to PENDING, and the
  // escrow stays FAILED still owning journeyId — the dead end's shape.
  const dead = await releaseMatchByMachine(journeyId);
  const releasedJourney = await getJourney(customer.api, journeyId);
  expect(releasedJourney.status).toBe('REQUESTED');
  expect(releasedJourney.driverId).toBeNull();
  expect(await countEscrowsForJourney(journeyId)).toBe(1);

  // The customer comes back and accepts, through the real bid list.
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
  });
  await applyAuthToContext(context, customer, 'en');
  const page = await context.newPage();
  await page.goto(`/journey/${journeyId}/bids`);
  // The re-opened bid is on the list again (bid-list-state-live is the
  // EMPTY state, so the presence of an Accept button is the signal).
  await page.getByRole('button', { name: /accept/i }).first().waitFor({ timeout: 20_000 });

  await acceptBidViaUI(page, secondBid.id as string);

  // No 500: the customer lands on the matched screen like any other
  // accept. This is the assertion the old code could not pass.
  await page.waitForURL(`**/journey/${journeyId}/matched`, { timeout: 30_000 });

  // Exactly one escrow row for this journey, and it is the SAME row.
  expect(await countEscrowsForJourney(journeyId)).toBe(1);
  const escrow = await getEscrowByJourney(journeyId);
  expect(escrow.id).toBe(dead.escrowId);

  // Revived, paid, and carrying the NEW bid's truth. (This job runs with
  // E2E_FAKE_PAYMENTS=1, so the accept's charge confirms immediately and
  // the adopted escrow lands HELD — machine-release → re-accept →
  // adopted escrow → paid, end to end.)
  expect(escrow.status).toBe('HELD');
  expect(escrow.amount).toBe(2400);
  expect(escrow.driverId).toBe(secondDriver.user.id);
  expect(escrow.txRef).not.toBe(dead.txRef);

  // One chain on one escrow, and the supersession is on it exactly once.
  const chain = await getEscrowChain(escrow.id);
  const actions = chain.map((c) => c.action);
  expect(actions.filter((a) => a === 'ADOPTED_ON_REACCEPT')).toHaveLength(1);
  // The adoption comes after the failure it supersedes, and the charge
  // that paid the ride comes after the adoption.
  const failedAt = actions.lastIndexOf('CHARGE_FAILED');
  const adoptedAt = actions.indexOf('ADOPTED_ON_REACCEPT');
  expect(adoptedAt).toBeGreaterThan(failedAt);
  expect(actions.lastIndexOf('CHARGE_CONFIRMED')).toBeGreaterThan(adoptedAt);
  // Linear and unforked: sequence numbers 0..n-1, no gap, no repeat.
  chain.forEach((entry, i) => expect(entry.sequenceNumber).toBe(i));

  // And the journey agrees with the money: same driver, same price.
  const finalJourney = await getJourney(customer.api, journeyId);
  expect(finalJourney.status).toBe('MATCHED');
  expect(finalJourney.driverId).toBe(secondDriver.user.id);
  expect(finalJourney.agreedPrice).toBe(escrow.amount);

  await context.close();
});
