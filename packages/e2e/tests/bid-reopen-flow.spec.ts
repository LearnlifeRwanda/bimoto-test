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
  getBids,
  releaseMatchByMachine,
  getEscrowByJourney,
  getEscrowChain,
  countEscrowsForJourney,
  disconnectPrisma,
  releaseDriverEngagements,
} from './helpers';

/**
 * DOC-GUARD G4 — the customer is never shown a button that lies.
 *
 * The sibling spec (escrow-adoption-flow.spec.ts) covers the RIVAL bid:
 * a machine releases the match, and the customer accepts the OTHER
 * motari. This one covers the case the release left broken.
 *
 * When the webhook or the unpaid-match reaper released a failed match,
 * releaseMatchTx reopened `status: 'DECLINED'` bids and stopped there.
 * The WINNING bid stayed ACCEPTED on a journey that no longer had a
 * driver. The customer came back to a bid list that still showed an
 * Accept button on it — and pressing it answered 400 BID_NOT_PENDING.
 * Nothing was broken in the database; the screen simply lied, and the
 * one motari the customer had already chosen was the one he could not
 * choose again.
 *
 * The walk proved here, end to end and through the real customer UI:
 *
 *   one motari bids -> customer accepts him -> the machine releases the
 *   match (the real Flutterwave webhook, not a helper imitating it) ->
 *   his bid reads PENDING again -> the customer accepts THE SAME MOTARI
 *   -> #155's adopt branch fires -> one escrow row, revived, one linear
 *   chain.
 */

let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  await disconnectPrisma();
});

test('a released journey re-offers the accepted bid, and the same motari can be accepted again', async () => {
  test.setTimeout(90_000);

  const customer = await loginAs('TestCustomer');
  const driver = await loginAs('TestDriver');
  await verifyDriver('TestDriver');
  // FIELD-FIT G5 — an engaged motari is shown no new requests, so a
  // leftover MATCHED journey from an earlier spec would empty this
  // one's feed. Start from a driver who is carrying nobody.
  await releaseDriverEngagements('TestDriver');

  const journey = await createPassengerJourney(customer.api, { vehiclePreference: null });
  const journeyId = journey.id as string;

  // ONE bid, so the only way forward after the release is the very bid
  // that was accepted. If it stays ACCEPTED the customer is stuck.
  const onlyBid = await submitBid(driver.api, journeyId, 2200, 5);

  await acceptBid(customer.api, journeyId, onlyBid.id as string);
  expect((await getBids(journeyId))[0].status).toBe('ACCEPTED');

  const dead = await releaseMatchByMachine(journeyId);

  // The journey is back on the market...
  const releasedJourney = await getJourney(customer.api, journeyId);
  expect(releasedJourney.status).toBe('REQUESTED');
  expect(releasedJourney.driverId).toBeNull();
  expect(await countEscrowsForJourney(journeyId)).toBe(1);

  // ...and so is the bid. This is the assertion the old code failed:
  // before DOC-GUARD G4 this read 'ACCEPTED' while the journey had no
  // driver, and the Accept button below answered 400 BID_NOT_PENDING.
  const afterRelease = await getBids(journeyId);
  expect(afterRelease).toHaveLength(1);
  expect(afterRelease[0].id).toBe(onlyBid.id);
  expect(afterRelease[0].status).toBe('PENDING');

  // The customer comes back and accepts THE SAME MOTARI, through the
  // real bid list.
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
  });
  await applyAuthToContext(context, customer, 'en');
  const page = await context.newPage();
  await page.goto(`/journey/${journeyId}/bids`);
  await page.getByRole('button', { name: /accept/i }).first().waitFor({ timeout: 20_000 });

  await acceptBidViaUI(page, onlyBid.id as string);

  // No 400, no 500: the ordinary matched screen.
  await page.waitForURL(`**/journey/${journeyId}/matched`, { timeout: 30_000 });

  // Exactly one escrow row, and it is the SAME row — the adopt branch,
  // not a second escrow.
  expect(await countEscrowsForJourney(journeyId)).toBe(1);
  const escrow = await getEscrowByJourney(journeyId);
  expect(escrow.id).toBe(dead.escrowId);
  expect(escrow.status).toBe('HELD');
  expect(escrow.amount).toBe(2200);
  expect(escrow.driverId).toBe(driver.user.id);
  expect(escrow.txRef).not.toBe(dead.txRef);

  // One chain on one escrow, linear and unforked, with the supersession
  // recorded exactly once.
  const chain = await getEscrowChain(escrow.id);
  const actions = chain.map((c) => c.action);
  expect(actions.filter((a) => a === 'ADOPTED_ON_REACCEPT')).toHaveLength(1);
  const failedAt = actions.lastIndexOf('CHARGE_FAILED');
  const adoptedAt = actions.indexOf('ADOPTED_ON_REACCEPT');
  expect(adoptedAt).toBeGreaterThan(failedAt);
  expect(actions.lastIndexOf('CHARGE_CONFIRMED')).toBeGreaterThan(adoptedAt);
  chain.forEach((entry, i) => expect(entry.sequenceNumber).toBe(i));

  // And the journey agrees with the money: the same motari, his price.
  const finalJourney = await getJourney(customer.api, journeyId);
  expect(finalJourney.status).toBe('MATCHED');
  expect(finalJourney.driverId).toBe(driver.user.id);
  expect(finalJourney.agreedPrice).toBe(escrow.amount);

  // The bid he was accepted on is ACCEPTED again — one bid, one row,
  // no duplicate created by the second accept.
  const finalBids = await getBids(journeyId);
  expect(finalBids).toHaveLength(1);
  expect(finalBids[0].status).toBe('ACCEPTED');

  await context.close();
});
