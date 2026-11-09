// CUTGUARD v2 amendment 2 — B-2 as a CLASS, proven at the wire.
//
// G6 gated the bid list and this suite pinned it (journey-read-
// authorization.spec.ts). Then the amendment-1 grep found the same shape
// reaching a v13 phone on two MORE customer surfaces, and the guard rule
// written to close the class found two more after that. Five in total.
//
// A unit test can prove the option is threaded. Only this can prove what
// actually arrives on the socket the passenger's phone is holding: real
// Postgres, real escrow, real HTTP, one context that says `X-App-Version:
// 14` and one that says nothing at all — which is exactly what a phone
// running the da9eca0 APK says, because that build has no such header.
//
// WHY EACH LEGACY ASSERTION IS `hasOwnProperty` AND NOT `toBeFalsy`.
// `null` passes `toBeFalsy` and `null` is not the fix. v13's screens
// guard with `&&`, so null survives today — but the shape those builds
// have always coped with is ABSENT, and a `commissionBreakdown: null` is
// a place for the next refactor to put something back. The key must not
// be there.
//
// WHAT v13 DEREFERENCES, from the APK's own source at da9eca0:
//
//   MatchedPage.tsx:365-384   totalCommissionAmount, totalCommissionRate,
//                             driverPayout
//   HistoryPage.tsx:175-244   totalCommissionRate, totalCommissionAmount,
//                             driverTier, driverCommissionRate, driverPayout
//
// None of those is in the customer-safe four, and none of them may be
// (#202 — any one reconstructs the motari's net). The discriminator that
// makes v14 safe, `hasCustomerSafeCommission`, landed in #206, AFTER that
// APK. So presence alone is the crash.

import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import {
  loginAs,
  legacyApi,
  createPassengerJourney,
  submitBid,
  acceptBid,
  verifyDriver,
  releaseDriverEngagements,
  disconnectPrisma,
} from './helpers';

test.afterAll(async () => {
  await disconnectPrisma();
});

const CUSTOMER_SAFE_FOUR = ['bidPrice', 'customerSavings', 'customerTier', 'feeWaiverApplied'];

/** Every key a v13 customer screen dereferences off a breakdown. */
const V13_DEREFERENCES = [
  'totalCommissionAmount',
  'totalCommissionRate',
  'driverPayout',
  'driverTier',
  'driverCommissionRate',
];

function expectCustomerSafe(breakdown: Record<string, unknown>, where: string) {
  expect(Object.keys(breakdown).sort(), `${where}: exactly the customer-safe four`).toEqual(
    [...CUSTOMER_SAFE_FOUR].sort(),
  );
  // Claiming a version can only ever get you LESS. The header is a
  // compatibility signal and never an authorization one, so the v14 arm
  // must not be a wider payload — only a present one.
  for (const key of V13_DEREFERENCES) {
    expect(breakdown, `${where}: ${key} is the motari's money`).not.toHaveProperty(key);
  }
}

function expectOmitted(row: Record<string, unknown>, where: string) {
  expect(
    Object.prototype.hasOwnProperty.call(row, 'commissionBreakdown'),
    `${where}: a legacy client must not be sent a preview it cannot render`,
  ).toBe(false);
}

/** A matched, escrowed ride. Returns the accept RESPONSE too — it is a surface. */
async function matchedRide(
  customerApi: APIRequestContext,
  driverApi: APIRequestContext,
  acceptWith: APIRequestContext,
) {
  await releaseDriverEngagements('TestDriver');
  const journey = await createPassengerJourney(customerApi, { vehiclePreference: null });
  const bid = await submitBid(driverApi, journey.id, 1750, 5);
  const accepted = await acceptBid(acceptWith, journey.id, bid.id);
  return { journeyId: journey.id as string, accepted };
}

test('the savings preview is gated by CLIENT on every customer surface, at the wire', async () => {
  const customer = await loginAs('TestCustomer');
  const driver = await loginAs('TestDriver');
  await verifyDriver('TestDriver');

  const legacy = await legacyApi(customer);
  try {
    /* ------------------------------------------- 1. the ACCEPT response --- */
    //
    // The subtlest of the five, and the one this dispatch nearly attested
    // away on the grounds that v13's confirm dialog reads its breakdown
    // off the bid ROW. It does — and it also does
    // `setActiveJourney(updated)` with the accept BODY and navigates to
    // MatchedPage, which draws whatever is in that store whenever the
    // refetch that would have overwritten it fails.

    const current = await matchedRide(customer.api, driver.api, customer.api);
    expect(current.accepted.commissionBreakdown, 'v14 accept response').toBeTruthy();
    expectCustomerSafe(current.accepted.commissionBreakdown, 'accept response (v14)');

    // A second ride, accepted by a context that sends no version header —
    // a different journey because an accept happens once.
    const old = await matchedRide(customer.api, driver.api, legacy);
    expectOmitted(old.accepted, 'accept response (legacy)');
    // …and everything da9eca0's accept handler reads before it navigates
    // is still there. The gate withholds the preview and nothing else.
    for (const field of ['escrowStatus', 'escrowId', 'escrowTxRef', 'escrowAmount']) {
      expect(old.accepted, `a legacy accept keeps ${field}`).toHaveProperty(field);
    }
    expect(old.accepted.journey.status, 'and the match itself').toBe('MATCHED');

    /* ---------------------------------------------- 2. the JOURNEY read --- */
    //
    // MatchedPage for the length of the ride, and RideReceiptPage after.

    const readV14 = await customer.api.get(`/api/journeys/${current.journeyId}`);
    expect(readV14.status()).toBe(200);
    const journeyV14 = await readV14.json();
    expect(journeyV14.commissionBreakdown, 'v14 journey read').toBeTruthy();
    expectCustomerSafe(journeyV14.commissionBreakdown, 'journey read (v14)');

    const readLegacy = await legacy.get(`/api/journeys/${current.journeyId}`);
    expect(readLegacy.status(), 'a legacy client still reads her own journey').toBe(200);
    const journeyLegacy = await readLegacy.json();
    expectOmitted(journeyLegacy, 'journey read (legacy)');
    // The rest of MatchedPage is untouched: the driver she is waiting for,
    // the ride she is on, the escrow her money is in.
    for (const field of ['id', 'status', 'agreedPrice', 'driverId', 'escrow']) {
      expect(journeyLegacy, `a legacy journey read keeps ${field}`).toHaveProperty(field);
    }

    /* ------------------------------------------------ 3. the RIDES list --- */
    //
    // HistoryPage — the screen she opens to check what she paid.

    const listV14 = await customer.api.get('/api/journeys');
    expect(listV14.status()).toBe(200);
    const rowsV14 = await listV14.json();
    const rowV14 = rowsV14.find((j: { id: string }) => j.id === current.journeyId);
    expect(rowV14, 'her own ride is on her own list').toBeTruthy();
    expect(rowV14.commissionBreakdown, 'v14 rides list').toBeTruthy();
    expectCustomerSafe(rowV14.commissionBreakdown, 'rides list (v14)');

    const listLegacy = await legacy.get('/api/journeys');
    expect(listLegacy.status(), 'a legacy client still reads her history').toBe(200);
    const rowsLegacy = await listLegacy.json();
    const rowLegacy = rowsLegacy.find((j: { id: string }) => j.id === current.journeyId);
    expect(rowLegacy, 'the row itself is unchanged for a legacy client').toBeTruthy();
    expectOmitted(rowLegacy, 'rides list (legacy)');
    for (const field of ['id', 'status', 'agreedPrice']) {
      expect(rowLegacy, `a legacy history row keeps ${field}`).toHaveProperty(field);
    }

    /* ------------------------------- 4. nothing of his, at either version --- */
    //
    // Checked as RAW TEXT over the whole payload, not key by key: the
    // point of #202 is that the motari's net must not be RECONSTRUCTIBLE,
    // and a nested copy under some other name would pass a key check.
    for (const [label, text] of [
      ['journey read (v14)', await readV14.text()],
      ['rides list (v14)', await listV14.text()],
    ] as const) {
      for (const leaked of ['driverPayout', 'totalCommissionAmount', 'driverCommissionRate']) {
        expect(text, `${label} must not carry ${leaked}`).not.toContain(leaked);
      }
    }
  } finally {
    await legacy.dispose();
  }
});
