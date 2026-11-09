// INCLUDE-REACH G5 — the cases no journey spec had.
//
// AUTH-READ (#183) closed the chat IDOR at `GET /:id/messages`, and its
// executor then found, by hand, a SECOND door into the same room:
// `GET /api/journeys/:id` returned that same chat through its `include`,
// alongside the escrow row, every leg's contact name and phone, and every
// bidder's driver profile. Every existing journey spec reads as a
// participant, which is exactly how that shipped.
//
// Mocked suites certified the last two IDOR-class defects for months, so the
// proof runs against the real database, where a projection either narrows or
// does not. The third account is a REAL, fully authenticated seeded driver
// who simply is not on this journey: the bug was never about authentication.
//
// The second test is the one that matters most. `GET /api/journeys/:id` is
// how a motari inspects an open request before bidding (BidPage.tsx:56), so
// the fix could not be a participant gate, and the anti-regression proof
// cannot be an assertion — it has to be an actual bid, actually accepted.

import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import {
  loginAs,
  legacyApi,
  createPassengerJourney,
  createMultiStopJourney,
  submitBid,
  acceptBid,
  verifyDriver,
  releaseDriverEngagements,
  disconnectPrisma,
} from './helpers';

test.afterAll(async () => {
  await disconnectPrisma();
});

const CONTACT_NAME = 'Mukamana Alphonsine';
const CONTACT_PHONE = '+250788555001';
const CUSTOMER_LINE = 'I am at the blue gate';
const DRIVER_LINE = 'On my way';

test('a non-participant cannot read a matched journey, and none of it leaks', async () => {
  const customer = await loginAs('TestCustomer');
  const driver = await loginAs('TestDriver');
  const stranger = await loginAs('EBikeJean');
  await verifyDriver('TestDriver');
  await releaseDriverEngagements('TestDriver');

  // A multi-stop journey, so there are legs carrying a THIRD PARTY's name
  // and phone — somebody who never consented to either of these accounts,
  // let alone to a stranger's.
  const { journeyId } = await createMultiStopJourney(customer.api, [
    { type: 'PASSENGER_PICKUP', lat: -1.9536, lng: 30.0606, name: 'Kimironko Market' },
    {
      type: 'PASSENGER_DROPOFF',
      lat: -1.9706,
      lng: 30.1044,
      name: 'Kigali Convention Centre',
      contactName: CONTACT_NAME,
      contactPhone: CONTACT_PHONE,
    },
  ]);

  const bid = await submitBid(driver.api, journeyId, 1500, 5);
  await acceptBid(customer.api, journeyId, bid.id);

  // Real chat traffic, from both sides, so there is something to leak.
  expect(
    (await customer.api.post(`/api/journeys/${journeyId}/messages`, { data: { text: CUSTOMER_LINE } })).status(),
  ).toBe(201);
  expect(
    (await driver.api.post(`/api/journeys/${journeyId}/messages`, { data: { text: DRIVER_LINE } })).status(),
  ).toBe(201);

  // 1. Both participants read the whole payload — unchanged. This is
  //    invariant 1: the projection they get is the one they always got.
  for (const [who, session] of [
    ['customer', customer],
    ['driver', driver],
  ] as const) {
    const res = await session.api.get(`/api/journeys/${journeyId}`);
    expect(res.status(), `${who} must still read the journey`).toBe(200);
    // Read as RAW TEXT as well as parsed: MONEY-VIEW v2's escrow assertions
    // below are string-absence over the whole payload, so that no shape —
    // nested, wrapped, renamed — can smuggle a settlement column through.
    const rawBody = await res.text();
    const body = JSON.parse(rawBody);

    expect(body.id).toBe(journeyId);
    expect(Array.isArray(body.messages), `${who} keeps the chat`).toBe(true);
    expect(body.messages).toHaveLength(2);
    expect(body.messages.map((m: { text: string }) => m.text)).toEqual([CUSTOMER_LINE, DRIVER_LINE]);
    expect(body.escrow, `${who} keeps the escrow row`).toBeTruthy();
    expect(Array.isArray(body.bids), `${who} keeps the bid list`).toBe(true);
    expect(body.bids.length).toBeGreaterThan(0);

    // MONEY-VIEW v2 G2 — the bid rows, and whose they are.
    //
    // Both still get an ARRAY and both still get rows, so the two
    // assertions above are unchanged. What changed is WHICH rows: the
    // customer owns the auction and keeps all of them; the matched driver
    // gets his own, because a motari reading his rivals' prices is #206's
    // defect at another exit and in a sealed-bid marketplace `price` IS
    // the bid. (He is the winner here, so his own row is present — which
    // is why `body.bids.length > 0` still holds for him.)
    if (who === 'driver') {
      for (const row of body.bids) {
        expect(row.driverId, 'a matched motari reads only his own bid').toBe(
          body.driverId,
        );
      }
    }

    // And N2, for both: a bidder's profile is the CURATED set — never his
    // live position, never the internals of his verification.
    for (const row of body.bids) {
      const profile = row.driver?.driverProfile;
      if (!profile) continue;
      for (const internal of [
        'lastLat',
        'lastLng',
        'lastLocationAt',
        'rejectionReason',
        'revokedAt',
        'drivingLicensePhotoUrl',
        'ruraAuthorizationPhotoUrl',
        'insurancePhotoUrl',
        'screener',
      ]) {
        expect(
          Object.keys(profile),
          `${who}: no ${internal} on a bidder's profile`,
        ).not.toContain(internal);
      }
    }
    // The matched driver's own profile travels the same road, and is the
    // same room: it is not a bid row, and `driverProfile: true` was
    // handing the passenger her motari's live coordinates.
    if (body.driver?.driverProfile) {
      for (const internal of ['lastLat', 'lastLng', 'lastLocationAt', 'rejectionReason']) {
        expect(
          Object.keys(body.driver.driverProfile),
          `${who}: no ${internal} on the matched driver's profile`,
        ).not.toContain(internal);
      }
      // Not over-reached: what the screens render is still there.
      expect(body.driver.driverProfile.vehicleType, 'the vehicle still renders').toBeTruthy();
    }

    // MONEY-VIEW v2 G1 — the escrow row is still THERE for both, and it is
    // no longer the same row for both.
    //
    // `escrow: true` used to hand every column the model has to whoever
    // read the journey. RideReceiptPage:146 read
    // `breakdown?.driverPayout ?? escrow?.driverPayout`, and since #202
    // redacts a customer's breakdown the first arm was always undefined —
    // so the fallback printed the motari's net on the passenger's own
    // receipt. Both halves are asserted here, on the same response.
    expect(body.escrow.id, `${who} keeps the escrow id the payment poll needs`).toBeTruthy();
    expect(body.escrow.status, `${who} keeps the escrow status`).toBeTruthy();

    if (who === 'customer') {
      for (const leaked of [
        'driverPayout',
        'driverCommissionRate',
        'driverTier',
        'driverSavings',
        'totalCommissionAmount',
        'totalCommissionRate',
        'chargedCommissionAmount',
        'waivedCommissionAmount',
        'txRef',
        'flwTxId',
      ]) {
        expect(rawBody, `no ${leaked} anywhere in a passenger's journey`).not.toContain(leaked);
      }
      // The escrow's own `commission` column, as a JSON key. Spelled with
      // the quotes and colon because `commissionBreakdown` — which she
      // legitimately has — contains the word.
      expect(rawBody, "no escrow commission column").not.toContain('"commission":');
      // Key absence on the projection itself, not merely an absent value.
      for (const leaked of ['commission', 'driverPayout', 'driverTier', 'driverCommissionRate']) {
        expect(Object.keys(body.escrow), `${leaked} must be absent from her escrow view`)
          .not.toContain(leaked);
      }
      // And what she IS entitled to survived the narrowing.
      expect(typeof body.escrow.amount).toBe('number');
    } else {
      // The motari's settlement is his. What is not his is the processor's.
      expect(typeof body.escrow.amount).toBe('number');
      expect(typeof body.escrow.driverPayout, 'the motari keeps his net').toBe('number');
      expect(typeof body.escrow.commission).toBe('number');
      for (const leaked of ['txRef', 'flwTxId']) {
        expect(Object.keys(body.escrow), `${leaked} reaches no client of any role`)
          .not.toContain(leaked);
      }
      expect(rawBody, 'no processor reference on the wire').not.toContain('flwTxId');
    }
    expect(body.driver, `${who} keeps the matched driver`).toBeTruthy();

    const dropoff = body.legs.find((l: { contactName?: string }) => l.contactName);
    expect(dropoff, `${who} keeps the leg contact`).toBeTruthy();
    expect(dropoff.contactName).toBe(CONTACT_NAME);
    expect(dropoff.contactPhone).toBe(CONTACT_PHONE);

    // The commission-safety shaping is part of the contract too: the
    // passenger never learns the motari's net.
    if (who === 'customer' && body.commissionBreakdown) {
      expect(body.commissionBreakdown.driverPayout).toBeUndefined();
      expect(body.commissionBreakdown.totalCommissionAmount).toBeUndefined();
    }
  }

  // 2. The outsider. This is the assertion the class was missing.
  const denied = await stranger.api.get(`/api/journeys/${journeyId}`);
  expect(denied.status(), 'a non-participant must not read a matched journey').toBe(404);

  // Checked as RAW TEXT, so that no shape — nested, wrapped, renamed —
  // can smuggle any of it through alongside an error.
  const text = await denied.text();
  expect(text, 'no message text').not.toContain(CUSTOMER_LINE);
  expect(text, 'no message text').not.toContain(DRIVER_LINE);
  expect(text, 'no leg contact name').not.toContain(CONTACT_NAME);
  expect(text, 'no leg contact phone').not.toContain(CONTACT_PHONE);
  expect(text, 'no escrow amount').not.toContain('1500');
  expect(text, 'no bid list').not.toContain('driverPayout');
  expect(JSON.parse(text)).toEqual({
    error: { code: 'JOURNEY_NOT_FOUND', message: 'errors.journeyNotFound' },
  });
});

test('a driver who is not on the journey can still inspect it and bid — until it is matched to someone else', async () => {
  const customer = await loginAs('TestCustomer');
  const matchedDriver = await loginAs('TestDriver');
  const bidder = await loginAs('EBikeJean');
  await verifyDriver('TestDriver');
  await verifyDriver('EBikeJean');
  await releaseDriverEngagements('TestDriver');
  await releaseDriverEngagements('EBikeJean');

  // No vehicle preference, so both seeded drivers may bid on it.
  const journey = await createPassengerJourney(customer.api, { vehiclePreference: null });

  // 1. THE ANTI-REGRESSION PROOF. The bidder is not a participant — no bid,
  //    no match, no relationship at all — and must still be able to read
  //    the request well enough to price it.
  const open = await bidder.api.get(`/api/journeys/${journey.id}`);
  expect(open.status(), 'an open request must stay readable to the driver pool').toBe(200);
  const card = await open.json();

  // Everything BidPage renders off the payload.
  expect(card.id).toBe(journey.id);
  expect(card.status).toBe('REQUESTED');
  expect(card.pickupName).toBe('Kimironko Market');
  expect(card.destinationName).toBe('Kigali Convention Centre');
  expect(card.type).toBeTruthy();
  expect(card.customer?.nickname, 'the request card names the passenger').toBeTruthy();
  // LIVE-WIRE G4's exact-net arithmetic, which is driver-scoped and is the
  // reason the bid screen can quote a number instead of a band.
  expect(card.payoutContext, 'the bid screen keeps its exact-net context').toBeTruthy();
  expect(typeof card.payoutContext.totalCommissionRate).toBe('number');
  expect(typeof card.payoutContext.driverTier).toBe('string');

  // And nothing that is none of his business.
  const openText = await open.text();
  expect(card.messages, 'no chat on a journey he is not part of').toBeUndefined();
  expect(card.escrow, 'no settlement row').toBeUndefined();
  expect(card.bids, "no rivals' bids or profiles").toBeUndefined();
  expect(card.driver, 'no counterparty profile').toBeUndefined();
  expect(openText).not.toContain('driverPayout');

  // 2. The bid itself lands. An assertion about a payload shape is not
  //    proof that bidding survives; a 201 from the real bid route is.
  const placed = await bidder.api.post(`/api/journeys/${journey.id}/bids`, {
    data: { journeyId: journey.id, price: 1800, etaMinutes: 7 },
  });
  expect(placed.status(), 'a non-participant driver must still be able to bid').toBe(201);

  // Still readable while the journey is open — bidding does not change scope.
  expect((await bidder.api.get(`/api/journeys/${journey.id}`)).status()).toBe(200);

  // 3. The moment it is matched to somebody else, the door closes. This is
  //    the REQUESTED-only half of the rule, and it is where a status-blind
  //    fix would have left the journey open to every driver forever.
  const rivalBid = await submitBid(matchedDriver.api, journey.id, 1500, 5);
  await acceptBid(customer.api, journey.id, rivalBid.id);

  const shutOut = await bidder.api.get(`/api/journeys/${journey.id}`);
  expect(shutOut.status(), 'a losing bidder is an outsider once the journey is matched').toBe(404);
  expect(await shutOut.text()).not.toContain('driverPayout');

  // The matched driver, of course, reads everything.
  const winner = await matchedDriver.api.get(`/api/journeys/${journey.id}`);
  expect(winner.status()).toBe(200);
  expect((await winner.json()).escrow).toBeTruthy();
});

test('a journey that does not exist is 404, for participant and stranger alike', async () => {
  const stranger = await loginAs('EBikeJean');
  const missing = await stranger.api.get('/api/journeys/00000000-0000-4000-8000-000000000000');
  expect(missing.status()).toBe(404);
});

// PARCEL-VISIBLE G3 — the other half of the same door.
//
// #185 scoped the RELATIONS and proved it here. It could not scope the
// SCALARS, because the pre-match read is an `include` and an `include`
// returns every column the row has. A parcel booked from GoodsRequestPage
// writes its recipient onto the JOURNEY, not onto a leg, so #185's leg
// projection never came near `recipientName`/`recipientPhone` — nor
// `childGuardianPhone`, a minor's guardian.
//
// This is the ratchet for that class, and it has to be wire-level for the
// same reason #185's was: route-guard rule 2 reasons about MODELS, and a
// column that leaks out of a model the caller is entitled to read is
// invisible to it. So the assertion is on the RAW response text.
//
// The over-reach half matters as much as the leak half. A strip that also
// took the parcel's size, weight or description would leave a motari unable
// to price the job at all — which is the defect the other half of
// PARCEL-VISIBLE exists to fix. Both are asserted on the same response.

const PARCEL_RECIPIENT_NAME = 'Uwimana Claudine';
const PARCEL_RECIPIENT_PHONE = '+250788555777';
const PARCEL_GUARDIAN_PHONE = '+250788555888';
const PARCEL_DESCRIPTION = 'A wrapped box of medicine for the clinic';

test('a parcel reaches the driver pool as cargo, and not as the people in it', async () => {
  const customer = await loginAs('TestCustomer');
  const bidder = await loginAs('EBikeJean');
  await verifyDriver('EBikeJean');
  await releaseDriverEngagements('EBikeJean');

  // An ORDINARY parcel booking: recipient on the journey, exactly as
  // GoodsRequestPage sends it, plus a guardian phone. No vehicle
  // preference, so the seeded e-bike driver may bid.
  const created = await customer.api.post('/api/journeys', {
    data: {
      type: 'GOODS',
      pickupLat: -1.9536,
      pickupLng: 30.0606,
      pickupName: 'Kimironko Market',
      destinationLat: -1.9706,
      destinationLng: 30.1044,
      destinationName: 'Kigali Convention Centre',
      goodsDescription: PARCEL_DESCRIPTION,
      goodsSizeCategory: 'MEDIUM',
      // PARCEL-CATEGORY — what the sender said is in the box, sent
      // exactly as GoodsRequestPage sends it.
      parcelCategory: 'ELECTRONICS',
      goodsWeightKg: 4.5,
      goodsFragile: true,
      deliverySpeed: 'STANDARD',
      standardDeliveryHours: 2,
      recipientName: PARCEL_RECIPIENT_NAME,
      recipientPhone: PARCEL_RECIPIENT_PHONE,
      childGuardianPhone: PARCEL_GUARDIAN_PHONE,
      wishPrice: 2000,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const journey = await created.json();

  // The row really does hold all three — read back by the one viewer who
  // is entitled to them. Without this the whole spec would pass against a
  // database that simply never stored them.
  const owner = await customer.api.get(`/api/journeys/${journey.id}`);
  expect(owner.status()).toBe(200);
  const stored = await owner.json();
  expect(stored.recipientName).toBe(PARCEL_RECIPIENT_NAME);
  expect(stored.recipientPhone).toBe(PARCEL_RECIPIENT_PHONE);
  expect(stored.childGuardianPhone).toBe(PARCEL_GUARDIAN_PHONE);

  // (a1) THE DETAIL READ. A real, fully authenticated driver who is not
  //      on this journey — the bidder BidPage.tsx fetches for.
  const detail = await bidder.api.get(`/api/journeys/${journey.id}`);
  expect(detail.status(), 'an open request must stay readable to the driver pool').toBe(200);
  const detailText = await detail.text();
  const card = JSON.parse(detailText);

  expect(detailText, 'no recipient name on the wire').not.toContain(PARCEL_RECIPIENT_NAME);
  expect(detailText, 'no recipient phone on the wire').not.toContain(PARCEL_RECIPIENT_PHONE);
  expect(detailText, "no minor's guardian phone on the wire").not.toContain(PARCEL_GUARDIAN_PHONE);
  // Key ABSENCE, not an undefined value: a present-but-empty key still
  // says "this parcel has no recipient", which is a different lie.
  for (const field of ['recipientName', 'recipientPhone', 'childGuardianPhone']) {
    expect(Object.keys(card), `${field} must be absent, not null`).not.toContain(field);
  }

  // And the strip did NOT over-reach: everything that prices the job is
  // still there, on the same response.
  expect(card.type).toBe('GOODS');
  expect(card.goodsSizeCategory, 'the bidder must still see the size').toBe('MEDIUM');
  // PARCEL-CATEGORY — the contents answer joins the visible set. It is
  // CONTENT, not identity: a motari prices and accepts a parcel run from
  // what the thing IS, and the three columns that name PEOPLE stay
  // deleted on the very same response, asserted above.
  expect(
    card.parcelCategory,
    'the bidder must see what the parcel contains',
  ).toBe('ELECTRONICS');
  expect(card.goodsWeightKg, 'the bidder must still see the weight').toBe(4.5);
  expect(card.goodsDescription).toBe(PARCEL_DESCRIPTION);
  expect(card.goodsFragile).toBe(true);
  expect(card.deliverySpeed).toBe('STANDARD');
  expect(card.standardDeliveryHours).toBe(2);
  expect(typeof card.estimatedDistance).toBe('number');
  expect(card.wishPrice).toBe(2000);
  expect(card.pickupName).toBe('Kimironko Market');
  expect(card.payoutContext, 'the bid screen keeps its exact-net context').toBeTruthy();

  // (a2) THE FEED READ. The wider door: `getJourneyById` reaches a motari
  //      who opened the request, this reaches every motari in radius.
  //
  //      The cascade filter needs a FRESH driver location to place him in
  //      any ring at all, so the real chain runs first — the same
  //      PUT the dashboard makes when the motari goes online.
  expect(
    (await bidder.api.put('/api/users/me/location', {
      data: { lat: -1.9536, lng: 30.0606 },
    })).status(),
  ).toBe(200);
  const feed = await bidder.api.get('/api/journeys?viewAs=driver&lat=-1.9536&lng=30.0606');
  expect(feed.status()).toBe(200);
  const feedText = await feed.text();
  const rows = JSON.parse(feedText);
  const row = rows.find((r: { id: string }) => r.id === journey.id);
  expect(row, 'the parcel must actually be in the feed for this to prove anything').toBeTruthy();

  expect(feedText, 'no recipient name in the feed').not.toContain(PARCEL_RECIPIENT_NAME);
  expect(feedText, 'no recipient phone in the feed').not.toContain(PARCEL_RECIPIENT_PHONE);
  expect(feedText, 'no guardian phone in the feed').not.toContain(PARCEL_GUARDIAN_PHONE);
  for (const field of ['recipientName', 'recipientPhone', 'childGuardianPhone']) {
    expect(Object.keys(row), `${field} must be absent from the feed row`).not.toContain(field);
  }
  // The feed card's own reason for existing (PARCEL-VISIBLE G4).
  expect(row.type).toBe('GOODS');
  expect(row.goodsSizeCategory).toBe('MEDIUM');
  expect(row.parcelCategory).toBe('ELECTRONICS');
  expect(row.goodsWeightKg).toBe(4.5);
  expect(row.goodsFragile).toBe(true);
  expect(typeof row.estimatedDistance).toBe('number');

  // (b) BIDDING SURVIVES. An assertion about a payload shape is not proof
  //     that the projection change left the pool able to work; a 201 from
  //     the real bid route is.
  const placed = await bidder.api.post(`/api/journeys/${journey.id}/bids`, {
    data: { journeyId: journey.id, price: 1800, etaMinutes: 7 },
  });
  expect(placed.status(), 'a stripped parcel must still be biddable').toBe(201);
  const bid = await placed.json();

  // (c) THE PARTICIPANTS. The customer's read above is the first half —
  //     unchanged, with all three keys, after every projection change in
  //     this dispatch. Here is the second half: the MATCHED driver — the
  //     GoodsPickupPage viewer, who has to be able to reach the person
  //     waiting for the parcel.
  await acceptBid(customer.api, journey.id, bid.id);
  const asMatchedDriver = await bidder.api.get(`/api/journeys/${journey.id}`);
  expect(asMatchedDriver.status()).toBe(200);
  const delivering = await asMatchedDriver.json();
  expect(delivering.recipientName, 'the matched driver reaches the recipient').toBe(
    PARCEL_RECIPIENT_NAME,
  );
  expect(delivering.recipientPhone).toBe(PARCEL_RECIPIENT_PHONE);
  expect(delivering.childGuardianPhone).toBe(PARCEL_GUARDIAN_PHONE);
});

// ═══════════════════════════════════════════════════════════════════════
// MONEY-VIEW v2 G5 — the real-database pins for the two doors #206 left,
// and the debt #206 recorded rather than paid.
//
// CLEAN-SWEEP G4 narrowed `GET /journeys/:id/bids` to own-bid scope and
// closed with: "NOT ADDED, deliberately: a real-database e2e pin. This
// defect class has one by convention ... and it is the right next step —
// but no Postgres is reachable in this environment, and an unrun e2e test
// is a CI risk, not a proof." Postgres is still not reachable here, and
// the answer is not to keep deferring: these are written to the same
// convention as the suite above, typechecked, and they run on CI where
// the database is — exactly as every test in this file does.
//
// A mocked suite could not certify any of this. The header of this file
// says why in its own words: "Mocked suites certified the last two
// IDOR-class defects for months." #206 proved the point twice over — the
// mock for the bids route answered every call with both rows whatever was
// asked for, so it could see COLUMN scoping and was structurally blind to
// ROW scoping, which is the defect that was actually there.
// ═══════════════════════════════════════════════════════════════════════

// Distinctive, and DISTINCT PER TEST. These specs share one database and
// one seeded driver pool, and the first test below leaves EBikeJean
// holding a live bid on a journey that stays REQUESTED — so that journey
// is still in the feed when the second test runs, carrying his own bid
// back to him exactly as designed. A whole-feed string assertion on a
// price shared between the two tests would fail on that legitimate row.
// Hence separate constants, and hence the price assertions below are
// scoped to the ROW under test rather than to the whole feed body.
const RIVAL_PRICE = 1777;
const OWN_PRICE = 1888;
const FEED_RIVAL_PRICE = 1999;
const FEED_OWN_PRICE = 1666;

test('the bids list is scoped by ROW: her whole auction, his own offer, a stranger nothing', async () => {
  const customer = await loginAs('TestCustomer');
  const bidder = await loginAs('TestDriver');
  const stranger = await loginAs('EBikeJean');
  await verifyDriver('TestDriver');
  await verifyDriver('EBikeJean');
  await releaseDriverEngagements('TestDriver');
  await releaseDriverEngagements('EBikeJean');

  const journey = await createPassengerJourney(customer.api, { vehiclePreference: null });
  const own = await submitBid(bidder.api, journey.id, OWN_PRICE, 6);

  // 1. THE CUSTOMER owns the auction. She is choosing between the offers,
  //    so the whole list is her decision — unchanged, and the half that
  //    proves the narrowing did not break the marketplace.
  const hers = await customer.api.get(`/api/journeys/${journey.id}/bids`);
  expect(hers.status(), 'the passenger must read her own bid list').toBe(200);
  const herRows = await hers.json();
  expect(herRows.map((b: { id: string }) => b.id)).toContain(own.id);

  // MONEY-VIEW v2 G3 — and her rows now carry HER side of the sum.
  //
  // CUTGUARD v2 G6 (B-2) — this is the V14 side of a version gate. The
  // savings preview reaches a customer only when the request says it can
  // render one; `loginAs` now sends `X-App-Version: 14`, so this asks the
  // question it always meant to ask. Before the header it was asking the
  // server for the LEGACY payload and expecting the v14 one.
  const herRow = herRows.find((b: { id: string }) => b.id === own.id);
  expect(herRow.commissionBreakdown, 'her savings preview').toBeTruthy();
  expect(Object.keys(herRow.commissionBreakdown).sort()).toEqual([
    'bidPrice',
    'customerSavings',
    'customerTier',
    'feeWaiverApplied',
  ]);

  // …and the LEGACY side of the same gate, at the wire, on real Postgres.
  //
  // This is the assertion that matters for the rollout: a v13 BidListPage
  // reads `totalCommissionAmount.toLocaleString()` off this object, and
  // the customer-safe shape has no such key — so a preview sent to a
  // phone that has not updated is a white screen on the dialog where she
  // is about to pay. The key must be OMITTED, not null: v13 guards on
  // presence, so a null is still a crash.
  const legacy = await legacyApi(customer);
  try {
    const legacyRes = await legacy.get(`/api/journeys/${journey.id}/bids`);
    expect(legacyRes.status(), 'a legacy client still reads her bid list').toBe(200);
    const legacyRows = await legacyRes.json();
    const legacyRow = legacyRows.find((b: { id: string }) => b.id === own.id);
    expect(legacyRow, 'the row itself is unchanged for a legacy client').toBeTruthy();
    expect(
      Object.prototype.hasOwnProperty.call(legacyRow, 'commissionBreakdown'),
      'B-2: no savings preview to a client that cannot render it',
    ).toBe(false);
    // Everything she needs to choose an offer still arrives.
    for (const field of ['id', 'price', 'etaMinutes', 'status', 'driver']) {
      expect(legacyRow, `a legacy row keeps ${field}`).toHaveProperty(field);
    }
  } finally {
    await legacy.dispose();
  }
  // …and still nothing of his, checked as RAW TEXT over the whole list.
  const herText = await hers.text();
  for (const leaked of [
    'driverPayout',
    'driverTier',
    'driverCommissionRate',
    'driverSavings',
    'totalCommissionAmount',
    'totalCommissionRate',
  ]) {
    expect(herText, `no ${leaked} on the passenger's bid list`).not.toContain(leaked);
  }

  // 2. THE BIDDING DRIVER reads his own row, with his own money on it.
  const his = await bidder.api.get(`/api/journeys/${journey.id}/bids`);
  expect(his.status()).toBe(200);
  const hisRows = await his.json();
  expect(hisRows).toHaveLength(1);
  expect(hisRows[0].id).toBe(own.id);
  expect(hisRows[0].commissionBreakdown?.driverPayout, 'his own net is his').toBeGreaterThan(0);

  // 3. THE STRANGER — a real, fully authenticated, verified driver who
  //    simply has no bid on this journey. Refused with the 404 the journey
  //    family gives an outsider, NOT an empty array: `[]` asserts "this
  //    journey has no bids", which is false and, to a motari deciding
  //    whether to bid, useful.
  const denied = await stranger.api.get(`/api/journeys/${journey.id}/bids`);
  expect(denied.status(), 'a driver with no bid is not party to the list').toBe(404);
  expect(JSON.parse(await denied.text())).toEqual({
    error: { code: 'JOURNEY_NOT_FOUND', message: 'errors.journeyNotFound' },
  });

  // 4. AND HE CAN STILL BID. An assertion about a refusal is not proof
  //    that the marketplace still works; a 201 from the real route is.
  const placed = await stranger.api.post(`/api/journeys/${journey.id}/bids`, {
    data: { journeyId: journey.id, price: RIVAL_PRICE, etaMinutes: 4 },
  });
  expect(placed.status(), 'the refusal must not have closed the marketplace').toBe(201);

  // 5. Now that he holds a bid he reads the list — and gets HIS row, not
  //    the rival's. This is the assertion the whole narrowing exists for,
  //    and it could only be made once both drivers had bid.
  const nowHis = await stranger.api.get(`/api/journeys/${journey.id}/bids`);
  expect(nowHis.status()).toBe(200);
  const nowText = await nowHis.text();
  const nowRows = JSON.parse(nowText);
  expect(nowRows).toHaveLength(1);
  expect(nowRows[0].price).toBe(RIVAL_PRICE);
  expect(nowText, "no rival's price on a motari's read").not.toContain(String(OWN_PRICE));
  expect(nowText, "no rival's bid id").not.toContain(own.id);
});

test('the driver feed carries a bid COUNT and his own bid — never a rival row', async () => {
  const customer = await loginAs('TestCustomer');
  const rival = await loginAs('TestDriver');
  const reader = await loginAs('EBikeJean');
  await verifyDriver('TestDriver');
  await verifyDriver('EBikeJean');
  await releaseDriverEngagements('TestDriver');
  await releaseDriverEngagements('EBikeJean');

  const journey = await createPassengerJourney(customer.api, { vehiclePreference: null });
  await submitBid(rival.api, journey.id, FEED_RIVAL_PRICE, 3);

  // The cascade filter needs a FRESH driver location to place him in any
  // ring at all, so the real chain runs first — the same PUT the dashboard
  // makes when the motari goes online.
  expect(
    (await reader.api.put('/api/users/me/location', {
      data: { lat: -1.9536, lng: 30.0606 },
    })).status(),
  ).toBe(200);

  const feed = await reader.api.get('/api/journeys?viewAs=driver&lat=-1.9536&lng=30.0606');
  expect(feed.status()).toBe(200);
  const feedText = await feed.text();
  const rows = JSON.parse(feedText);
  const row = rows.find((r: { id: string }) => r.id === journey.id);
  expect(row, 'the request must actually be in the feed for this to prove anything').toBeTruthy();

  // THE SEAL. `bids: true` used to ship every rival's raw row here — his
  // price, his driverId, his ETA — to every motari in radius. This is the
  // room's WIDER door: `getJourneyById` reaches a motari who opened one
  // request, the feed reaches everyone in range.
  expect(Object.keys(row), 'the raw bid array is gone, not merely empty')
    .not.toContain('bids');
  expect(
    JSON.stringify(row),
    "no rival's price on the row",
  ).not.toContain(String(FEED_RIVAL_PRICE));

  // What replaces it: how much competition this request has, and whether
  // HE is in it. He has not bid, so:
  expect(row.bidCount, 'the count of offers already in').toBe(1);
  expect(row.myBid, 'he has not bid on this one').toBeNull();

  // No profile internals travel with the feed either.
  for (const internal of ['lastLat', 'lastLng', 'lastLocationAt', 'rejectionReason']) {
    expect(feedText, `no ${internal} in the feed`).not.toContain(internal);
  }
  // And no settlement column: the feed derives `reopenedUnpaid` from the
  // escrow and ships only that (LIVE-WIRE G5), which G3's widened SELECT
  // must not have changed.
  for (const leaked of ['driverPayout', 'txRef', 'flwTxId']) {
    expect(feedText, `no ${leaked} in the feed`).not.toContain(leaked);
  }

  // Now HE bids, and the same feed names his own offer back to him.
  await submitBid(reader.api, journey.id, FEED_OWN_PRICE, 5);
  const after = await reader.api.get('/api/journeys?viewAs=driver&lat=-1.9536&lng=30.0606');
  const mine = JSON.parse(await after.text()).find(
    (r: { id: string }) => r.id === journey.id,
  );
  expect(mine.bidCount).toBe(2);
  expect(mine.myBid?.price, 'his own bid, named back to him').toBe(FEED_OWN_PRICE);
  expect(
    JSON.stringify(mine),
    "and still not the rival's",
  ).not.toContain(String(FEED_RIVAL_PRICE));
});

// ── RIDES-REACH G3 ──────────────────────────────────────────────────────
//
// The journey-read family's last unanswered question: not "who may read
// THIS journey?" but "whose journeys come back when a motari asks for
// his own?"
//
// Until RIDES-REACH the driver arm of GET /api/journeys had one `where`
// for two questions. `{ status: REQUESTED, ...(status ? { status } : {}) }`
// carried no `driverId` at all, so a driver querying any non-REQUESTED
// status was handed EVERY such journey in radius — and the coordinate-less
// query his own rides list makes threw 400 before it ever got that far.
//
// Proved here rather than in a mocked suite for the reason the whole file
// exists: a projection either narrows or it does not, and the two IDORs
// this family has already caught were both certified green by mocks for
// months. The rival below is a real, verified, seeded driver who really
// completed a real ride on the same street on the same day.

const OWN_RIDE_PRICE = 2100;
const RIVAL_RIDE_PRICE = 2200;

/** Drive one passenger journey all the way to COMPLETED, through the real routes. */
async function completeOneRide(
  customerApi: APIRequestContext,
  driverApi: APIRequestContext,
  price: number,
) {
  // vehiclePreference null so both seeded drivers can bid (the seed has
  // one MOTO and one E_BIKE).
  const journey = await createPassengerJourney(customerApi, { vehiclePreference: null });
  const bid = await submitBid(driverApi, journey.id, price, 5);
  await acceptBid(customerApi, journey.id, bid.id);

  const started = await driverApi.post(`/api/journeys/${journey.id}/start`, {
    data: { lat: -1.9536, lng: 30.0606 },
  });
  expect(started.ok(), await started.text()).toBeTruthy();

  const ended = await driverApi.post(`/api/journeys/${journey.id}/end`, {
    data: { lat: -1.9706, lng: 30.1044 },
  });
  expect(ended.ok(), await ended.text()).toBeTruthy();

  const confirmed = await customerApi.post(`/api/journeys/${journey.id}/confirm`, {});
  expect(confirmed.ok(), await confirmed.text()).toBeTruthy();

  return journey;
}

test('a motari reads his own rides, with his money on them, and never a rival ride', async () => {
  const customer = await loginAs('TestCustomer');
  const rival = await loginAs('TestDriver');
  const motari = await loginAs('EBikeJean');
  await verifyDriver('TestDriver');
  await verifyDriver('EBikeJean');
  await releaseDriverEngagements('TestDriver');
  await releaseDriverEngagements('EBikeJean');

  const mine = await completeOneRide(customer.api, motari.api, OWN_RIDE_PRICE);
  await releaseDriverEngagements('EBikeJean');
  const theirs = await completeOneRide(customer.api, rival.api, RIVAL_RIDE_PRICE);
  await releaseDriverEngagements('TestDriver');

  // (a) THE RIDES TAB. HistoryPage's request, byte for byte: no
  //     coordinates, no viewAs, `history=true`. It used to be a 400.
  const ridesRes = await motari.api.get('/api/journeys?history=true');
  expect(ridesRes.status(), 'the rides tab reaches an answer').toBe(200);
  const ridesText = await ridesRes.text();
  const rides = JSON.parse(ridesText);

  expect(Array.isArray(rides)).toBe(true);
  expect(rides.length, 'he has driven at least the ride above').toBeGreaterThan(0);
  expect(rides.map((r: { id: string }) => r.id)).toContain(mine.id);
  // Every row his, by the `where` — not by a filter downstream of it.
  expect(
    rides.every((r: { driverId: string }) => r.driverId === motari.user.id),
    'every row on his rides list is a ride he drove',
  ).toBe(true);
  // The rival's ride is not in it, and not anywhere in the raw body.
  expect(rides.map((r: { id: string }) => r.id)).not.toContain(theirs.id);
  expect(ridesText, "no rival's journey id on his rides list").not.toContain(theirs.id);
  expect(ridesText, "no rival's price on his rides list").not.toContain(String(RIVAL_RIDE_PRICE));

  // HIS SETTLEMENT VIEW — MONEY-VIEW G3's driver block, on the only
  // screen that renders it, finally reachable.
  const row = rides.find((r: { id: string }) => r.id === mine.id);
  const money = row.commissionBreakdown;
  expect(money, 'his settlement view is attached').toBeTruthy();
  expect(money.driverPayout, 'his net, off the settlement record').toBeGreaterThan(0);
  expect(typeof money.driverTier).toBe('string');
  expect(typeof money.driverCommissionRate).toBe('number');
  expect(typeof money.totalCommissionRate).toBe('number');
  expect(typeof money.totalCommissionAmount).toBe('number');
  expect(money.bidPrice).toBe(OWN_RIDE_PRICE);
  // NOT the customer-safe four. That shape is the passenger's — it is
  // deliberately missing everything from which a motari's net could be
  // reconstructed, which is exactly what a motari needs. His row is the
  // FULL shape, which `hasFullCommissionBreakdown` (the guard HistoryPage
  // already carries) is the client-side statement of.
  expect(
    Object.keys(money).sort(),
    'his row is not limited to the customer-safe four',
  ).not.toEqual(['bidPrice', 'customerSavings', 'customerTier', 'feeWaiverApplied']);
  for (const driverOnly of [
    'driverPayout',
    'driverTier',
    'driverCommissionRate',
    'totalCommissionAmount',
    'totalCommissionRate',
  ]) {
    expect(Object.keys(money), `${driverOnly} is his to see`).toContain(driverOnly);
  }
  // And the settlement COLUMNS themselves never travel — the mapper ships
  // the derived view, never the escrow row (MONEY-VIEW G3's own seal).
  expect(Object.keys(row), 'no raw escrow on a rides-list row').not.toContain('escrow');
  for (const leaked of ['txRef', 'flwTxId']) {
    expect(ridesText, `no ${leaked} on the rides list`).not.toContain(leaked);
  }

  // (b) THE IDOR, AT THE WIRE. `status=COMPLETED` is the query whose
  //     `where` used to be `{ status: COMPLETED }` and nothing else: the
  //     rival's ride, its passenger and its route came back to anyone in
  //     radius who asked. Coordinates supplied here on purpose — under
  //     the old arm they were what let the row through the radius filter.
  expect(
    (await motari.api.put('/api/users/me/location', {
      data: { lat: -1.9536, lng: 30.0606 },
    })).status(),
  ).toBe(200);
  const completedRes = await motari.api.get(
    '/api/journeys?viewAs=driver&status=COMPLETED&lat=-1.9536&lng=30.0606',
  );
  expect(completedRes.status()).toBe(200);
  const completedText = await completedRes.text();
  const completed = JSON.parse(completedText);

  expect(completed.map((r: { id: string }) => r.id)).toContain(mine.id);
  expect(
    completed.map((r: { id: string }) => r.id),
    "the rival's completed ride is not his to read",
  ).not.toContain(theirs.id);
  expect(completedText, "no rival's journey id at the wire").not.toContain(theirs.id);
  expect(completedText, "no rival's price at the wire").not.toContain(String(RIVAL_RIDE_PRICE));
  expect(
    completed.every((r: { driverId: string; status: string }) =>
      r.driverId === motari.user.id && r.status === 'COMPLETED'),
    'his own completed rides, and only those',
  ).toBe(true);

  // (b2) THE SAME QUERY WITHOUT COORDINATES — what
  //      /driver/no-show-disputes sends. It used to 400.
  const cancelledRes = await motari.api.get('/api/journeys?viewAs=driver&status=CANCELLED');
  expect(cancelledRes.status(), 'the disputes screen reaches an answer too').toBe(200);
  const cancelled = JSON.parse(await cancelledRes.text());
  expect(
    cancelled.every((r: { driverId: string }) => r.driverId === motari.user.id),
    'and it is his cancelled rides, not everyone in radius',
  ).toBe(true);

  // (c) THE DISCOVERY FEED IS UNTOUCHED. An open request still reaches
  //     him, on the same call the dashboard makes, and his own completed
  //     rides do not ride along in it.
  const open = await createPassengerJourney(customer.api, { vehiclePreference: null });
  const feedRes = await motari.api.get('/api/journeys?viewAs=driver&lat=-1.9536&lng=30.0606');
  expect(feedRes.status()).toBe(200);
  const feedText = await feedRes.text();
  const feed = JSON.parse(feedText);
  expect(
    feed.map((r: { id: string }) => r.id),
    'the open request still reaches the feed',
  ).toContain(open.id);
  expect(
    feed.every((r: { status: string }) => r.status === 'REQUESTED'),
    'the feed is still open requests and nothing else',
  ).toBe(true);
  expect(feedText, 'his own finished ride is not in the open feed').not.toContain(mine.id);
  // And the feed's radius gate is still a gate.
  const noCoords = await motari.api.get('/api/journeys?viewAs=driver');
  expect(noCoords.status(), 'a coordinate-less DISCOVERY query is still refused').toBe(400);
  expect(JSON.parse(await noCoords.text()).error.code).toBe('LOCATION_REQUIRED');
});
