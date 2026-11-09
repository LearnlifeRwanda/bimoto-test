import { test, expect, chromium, type Browser } from '@playwright/test';
import {
  loginAs,
  applyAuthToContext,
  createPassengerJourney,
  submitBid,
  acceptBidWithCardViaUI,
  verifyDriver,
  getJourney,
  disconnectPrisma,
  releaseDriverEngagements,
} from './helpers';

/**
 * R3-PAYMENT-CARD-E2E — customer pays a bid with card via the Flutterwave
 * Inline widget (stubbed). Verifies the full client-server chain:
 *   accept-bid-card → widget stub fires → initiate-card → escrow HELD → MatchedPage
 *
 * The FLW gateway is stubbed at TWO levels so no real network call is made:
 *   (1) Client-side via `context.addInitScript` injecting a synchronous-ish
 *       `window.FlutterwaveCheckout` stub that fires the success callback on
 *       the next event-loop tick (setTimeout(0)) so the client's Promise
 *       resolves cleanly without racing React state updates.
 *   (2) Server-side via E2E_FAKE_PAYMENTS=1 (set in the CI workflow env),
 *       which makes chargeCard() skip the live verifyTransaction call and
 *       return a synthetic SUCCESS (the AML check still fires).
 *
 * The client's chargeWithCard() reads VITE_FLW_PUBLIC_KEY before opening the
 * widget; CI sets a stub value (VITE_FLW_PUBLIC_KEY=test-public-key-e2e-only)
 * so the guard passes and the stubbed widget is invoked.
 *
 * Pre-state:  customer logged in, driver verified, journey REQUESTED with a
 *             PENDING bid.
 * Post-state: journey MATCHED, escrow HELD, customer on MatchedPage.
 *
 * Single chromium browser + single top-level test(). No describe blocks
 * (mirrors disputed-flow.spec.ts).
 */

let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  await disconnectPrisma();
});

test('customer pays a bid by card via the FLW widget (stubbed)', async () => {
  test.setTimeout(60_000);

  // 1. Actors: a verified driver and the journey customer.
  const customer = await loginAs('TestCustomer');
  const driver = await loginAs('TestDriver');
  await verifyDriver('TestDriver');
  // FIELD-FIT G5 — an engaged motari is shown no new requests, so a
  // leftover MATCHED journey from an earlier spec would empty this
  // one's feed. Start from a driver who is carrying nobody.
  await releaseDriverEngagements('TestDriver');

  // 2. Customer creates a passenger journey (REQUESTED).
  const journey = await createPassengerJourney(customer.api);
  const journeyId = journey.id as string;

  // 3. Driver submits a PENDING bid via the API.
  const bid = await submitBid(driver.api, journeyId, 2000, 5);
  const bidId = bid.id as string;

  // 4. Customer browser context with auth (cookies + injected auth store).
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
  });
  await applyAuthToContext(context, customer, 'en');

  // 5. Stub window.FlutterwaveCheckout BEFORE any page navigation. The stub
  //    fires the success callback on the next tick so the client's widget
  //    Promise resolves without racing the modal's state reset.
  await context.addInitScript(() => {
    (window as unknown as { FlutterwaveCheckout: (config: Record<string, unknown>) => void })
      .FlutterwaveCheckout = (config: Record<string, unknown>) => {
        setTimeout(() => {
          const callback = config.callback as
            | ((resp: Record<string, unknown>) => void)
            | undefined;
          if (typeof callback === 'function') {
            callback({
              transaction_id: `e2e-card-${Date.now()}`,
              tx_ref: config.tx_ref,
              status: 'successful',
            });
          }
        }, 0);
      };
  });

  // 6. Drive the customer flow on the BidListPage.
  const page = await context.newPage();
  await page.goto(`/journey/${journeyId}/bids`);
  await acceptBidWithCardViaUI(page, bidId);

  // 7. On verified success the client navigates to MatchedPage.
  await page.waitForURL(`**/journey/${journeyId}/matched`, { timeout: 15_000 });

  // 8. Server-side state: journey MATCHED, escrow HELD (no gateway was called).
  const finalJourney = await getJourney(customer.api, journeyId);
  expect(finalJourney.status).toBe('MATCHED');
  expect(finalJourney.escrow?.status).toBe('HELD');

  await context.close();
});
