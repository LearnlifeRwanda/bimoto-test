import { test, expect, chromium, type Browser } from '@playwright/test';
import {
  loginAs,
  createPassengerJourney,
  submitBid,
  acceptBid,
  applyAuthToContext,
  setLanguage,
  verifyDriver,
  disconnectPrisma,
} from './helpers';

let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  await disconnectPrisma();
});

test('quick message sent in Kinyarwanda renders in English on customer device', async () => {
  // 1. Real OTP login for both seed users.
  const customer = await loginAs('TestCustomer');
  const driver = await loginAs('TestDriver');
  await verifyDriver('TestDriver');

  // 2. Customer creates journey, driver bids, customer accepts.
  //    All via the HTTP API for speed and reliability — the chat UI is
  //    what we are actually testing.
  const journey = await createPassengerJourney(customer.api);
  const bid = await submitBid(driver.api, journey.id, 1500, 5);
  await acceptBid(customer.api, journey.id, bid.id);

  // 3. Two browser contexts on one browser — same network, separate
  //    storage and locale, simulating two devices.
  const driverCtx = await browser.newContext({ locale: 'rw-RW' });
  const customerCtx = await browser.newContext({ locale: 'en-US' });

  await applyAuthToContext(driverCtx, driver, 'rw');
  await applyAuthToContext(customerCtx, customer, 'en');

  const driverPage = await driverCtx.newPage();
  const customerPage = await customerCtx.newPage();

  // 4. Both navigate to the journey's chat page. Customer first so the
  //    socket subscription is live before the driver sends.
  await customerPage.goto(`/journey/${journey.id}/chat`);
  await driverPage.goto(`/journey/${journey.id}/chat`);

  // 5. Wait for both pages to actually render past auth/consent gates.
  //    The quick-message button appearing on the driver page is a tight
  //    signal that auth injection landed and the chat shell rendered.
  await expect(driverPage.getByRole('button', { name: 'Ndaje', exact: true })).toBeVisible({
    timeout: 10_000,
  });
  // The customer is a CUSTOMER role and gets no driver quick-message
  // buttons; the chat <input> is the equivalent "chat shell rendered"
  // signal. The input is the only textbox on the page.
  await expect(customerPage.getByRole('textbox').first()).toBeVisible({
    timeout: 10_000,
  });

  // 6. Driver clicks the "Ndaje" quick button (the Kinyarwanda render of
  //    qm_on_my_way). Use exact match to avoid catching translation
  //    strings that happen to contain the word.
  await driverPage.getByRole('button', { name: 'Ndaje', exact: true }).click();

  // 7. Customer must see the English render of the same canonical id
  //    delivered through the socket within 5s. The bubble's text is
  //    re-localized from quickMessageId on receive — this is the exact
  //    behaviour PR #8 introduced and that the §6 acceptance criterion
  //    asks us to lock in.
  await expect(customerPage.getByText('On my way', { exact: true })).toBeVisible({
    timeout: 5_000,
  });
  await expect(customerPage.getByText('Ndaje', { exact: true })).toHaveCount(0);

  // 8. Switch the customer to French. The same already-rendered bubble
  //    should re-localize to "J'arrive" via i18n.changeLanguage().
  await setLanguage(customerPage, 'fr');
  await expect(customerPage.getByText("J'arrive", { exact: true })).toBeVisible({
    timeout: 5_000,
  });
  await expect(customerPage.getByText('On my way', { exact: true })).toHaveCount(0);
});
