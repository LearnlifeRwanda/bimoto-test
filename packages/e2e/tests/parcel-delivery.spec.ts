import { test, expect, chromium, type Browser } from '@playwright/test';
import {
  loginAs,
  createParcelJourney,
  submitBid,
  acceptBid,
  verifyDriver,
  getJourney,
  postInboundSms,
  waitForLegDelivered,
  waitForRecipientConfirmed,
  disconnectPrisma,
} from './helpers';

/**
 * R3-E2E-EXPANSION (§3.3) — parcel delivery + recipient SMS confirmation.
 *
 * A customer ships a parcel modelled as two legs: GOODS_PICKUP then
 * GOODS_DROPOFF (the dropoff leg carries the recipient in contactPhone).
 * The driver bids, the customer accepts, and the driver completes both legs.
 *
 * DEVIATION FROM DISPATCH: there is no outbound-SMS store to intercept (the
 * parcel-delivered SMS is fire-and-forget via the Twilio provider, which
 * only logs in dev). So instead of intercepting the outbound text, we
 * assert the GOODS_DROPOFF leg reaches the delivered state (completedAt
 * set — the exact precondition markLegCompleted uses to fire that SMS),
 * then exercise the observable other half of the loop: the recipient replies
 * "OK" to the real inbound webhook (/api/sms/inbound, urlencoded), and the
 * recipient-confirm handler stamps leg.recipientConfirmedAt. ("OK" is one of
 * the real RECIPIENT_CONFIRM keywords in the inbound parser
 * (sms-inbound/parser.ts) — alongside RECEIVED, CONFIRMED, "GOT IT", THANKS,
 * MURAKOZE, NABONYE, YEGO, "REÇU", RECU, MERCI. The original draft used "YES",
 * but "YES" maps to CONFIRM_JOURNEY (not RECIPIENT_CONFIRM) in the parser, so
 * the recipient-confirm handler was never invoked and the leg stayed
 * unconfirmed. Confirm-intent is matched on the whole, upper-cased message,
 * so the reply body must be exactly the keyword.)
 *
 * Pre-state:  journey REQUESTED, legs PENDING, no recipient confirmation.
 * Post-state: GOODS_DROPOFF leg COMPLETED + recipientConfirmedAt set,
 *             journey COMPLETED, escrow RELEASED.
 *
 * Single chromium browser + single top-level test(). No describe blocks.
 */

let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  await disconnectPrisma();
});

test('parcel delivery confirms via recipient SMS reply', async () => {
  test.setTimeout(120_000);

  const customer = await loginAs('TestCustomer');
  const driver = await loginAs('TestDriver');
  await verifyDriver('TestDriver');

  // Unique recipient phone so the inbound-confirm handler matches THIS
  // leg (it matches the most-recent unconfirmed delivered leg by phone).
  const recipientPhone = `+25078812${Date.now().toString().slice(-4)}`;

  // --- Customer creates a parcel journey -----------------------------------
  const { journeyId, legId, recipientPhone: recip } = await createParcelJourney(
    customer.api,
    { name: 'Parcel Recipient', phone: recipientPhone },
    'MEDIUM',
  );
  expect(recip).toBe(recipientPhone);

  // --- PRE-STATE -----------------------------------------------------------
  const created = await getJourney(customer.api, journeyId);
  expect(created.status).toBe('REQUESTED');
  expect(created.legs).toHaveLength(2);
  for (const leg of created.legs) {
    expect(leg.status).toBe('PENDING');
  }
  const dropoffPre = created.legs.find((l: { id: string }) => l.id === legId);
  expect(dropoffPre.type).toBe('GOODS_DROPOFF');
  expect(dropoffPre.recipientConfirmedAt).toBeFalsy();

  // --- Driver bids, customer accepts ---------------------------------------
  const bid = await submitBid(driver.api, journeyId, 2500, 8);
  await acceptBid(customer.api, journeyId, bid.id);

  const matched = await getJourney(customer.api, journeyId);
  expect(matched.status).toBe('MATCHED');
  expect(matched.escrow?.status).toBe('HELD');

  // --- Driver starts and completes both legs -------------------------------
  const startRes = await driver.api.post(`/api/journeys/${journeyId}/start`, {
    data: { lat: -1.9536, lng: 30.0606 },
  });
  expect(startRes.ok()).toBeTruthy();

  const orderedLegs = [...matched.legs].sort(
    (a: { sequence: number }, b: { sequence: number }) => a.sequence - b.sequence,
  );
  const pickupLegId = orderedLegs[0].id;
  const dropoffLegId = orderedLegs[1].id;
  expect(dropoffLegId).toBe(legId);

  // GOODS_PICKUP: activate then complete.
  await driver.api.post(`/api/journeys/${journeyId}/legs/${pickupLegId}/activate`, {});
  await driver.api.post(`/api/journeys/${journeyId}/legs/${pickupLegId}/complete`, {});

  // GOODS_DROPOFF: activate then complete (fires the delivered SMS).
  await driver.api.post(`/api/journeys/${journeyId}/legs/${dropoffLegId}/activate`, {});
  await driver.api.post(`/api/journeys/${journeyId}/legs/${dropoffLegId}/complete`, {});

  // --- Delivered: leg.completedAt set (SMS precondition) -------------------
  await waitForLegDelivered(dropoffLegId);

  // --- Recipient replies OK via the inbound webhook ------------------------
  // "OK" is a RECIPIENT_CONFIRM keyword (parser maps the whole, upper-cased
  // body); "YES" maps to CONFIRM_JOURNEY and would never reach this handler.
  await postInboundSms(customer.api, { from: recipientPhone, text: 'OK' });

  // --- recipientConfirmedAt is stamped by the recipient-confirm handler ----
  await waitForRecipientConfirmed(dropoffLegId);

  // --- Driver ends, customer confirms → escrow RELEASED --------------------
  await driver.api.post(`/api/journeys/${journeyId}/end`, {
    data: { lat: -1.9706, lng: 30.1044 },
  });
  const confirmRes = await customer.api.post(`/api/journeys/${journeyId}/confirm`, {});
  expect(confirmRes.ok()).toBeTruthy();

  // --- POST-STATE ----------------------------------------------------------
  const final = await getJourney(customer.api, journeyId);
  expect(final.status).toBe('COMPLETED');
  const finalDropoff = final.legs.find((l: { id: string }) => l.id === dropoffLegId);
  expect(finalDropoff.status).toBe('COMPLETED');
  expect(finalDropoff.recipientConfirmedAt).toBeTruthy();
  expect(final.escrow?.status).toBe('RELEASED');
});
