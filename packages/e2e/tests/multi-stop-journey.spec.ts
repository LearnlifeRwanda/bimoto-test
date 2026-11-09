import { test, expect, chromium, type Browser } from '@playwright/test';
import {
  loginAs,
  createMultiStopJourney,
  submitBid,
  acceptBid,
  verifyDriver,
  getJourney,
  disconnectPrisma,
} from './helpers';

/**
 * R3-E2E-EXPANSION (§3.2) — multi-stop journey.
 *
 * A customer creates a 3-leg journey. The driver bids, the customer accepts,
 * and the driver works each leg in `sequence` order. Leg lifecycle uses the
 * REAL LegStatus enum: PENDING → ACTIVE → COMPLETED. The first leg is
 * explicitly activated; thereafter the spec activates each leg before
 * completing it (the R3-LEGS service has no auto-advance — markLegCompleted
 * only flips the named leg; markLegActive flips a leg to ACTIVE).
 *
 * Leg types are PASSENGER_DROPOFF (no parcelSize required — goods legs would
 * need one per legInputSchema).
 *
 * Pre-state:  journey REQUESTED, 3 legs PENDING.
 * Post-state: journey COMPLETED, all 3 legs COMPLETED, escrow RELEASED.
 *
 * Single chromium browser + single top-level test(), mirroring
 * cross-locale-quick-message.spec.ts. No describe blocks.
 */

let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  await disconnectPrisma();
});

test('multi-stop journey completes each leg in sequence', async () => {
  test.setTimeout(120_000);

  const customer = await loginAs('TestCustomer');
  const driver = await loginAs('TestDriver');
  await verifyDriver('TestDriver');

  // --- Customer creates a 3-leg journey ------------------------------------
  const { journeyId, legIds } = await createMultiStopJourney(customer.api, [
    { type: 'PASSENGER_DROPOFF', lat: -1.96, lng: 30.08, name: 'Remera' },
    { type: 'PASSENGER_DROPOFF', lat: -1.965, lng: 30.09, name: 'Kacyiru' },
    {
      type: 'PASSENGER_DROPOFF',
      lat: -1.9706,
      lng: 30.1044,
      name: 'Kigali Convention Centre',
    },
  ]);

  expect(legIds).toHaveLength(3);

  // --- PRE-STATE: journey REQUESTED, all legs PENDING ----------------------
  const created = await getJourney(customer.api, journeyId);
  expect(created.status).toBe('REQUESTED');
  expect(created.legs).toHaveLength(3);
  for (const leg of created.legs) {
    expect(leg.status).toBe('PENDING');
  }

  // --- Driver bids, customer accepts ---------------------------------------
  const bid = await submitBid(driver.api, journeyId, 2000, 6);
  await acceptBid(customer.api, journeyId, bid.id);

  const matched = await getJourney(customer.api, journeyId);
  expect(matched.status).toBe('MATCHED');
  expect(matched.escrow?.status).toBe('HELD');

  // --- Driver starts the journey -------------------------------------------
  const startRes = await driver.api.post(`/api/journeys/${journeyId}/start`, {
    data: { lat: -1.9536, lng: 30.0606 },
  });
  expect(startRes.ok()).toBeTruthy();
  expect((await getJourney(driver.api, journeyId)).status).toBe('IN_PROGRESS');

  // --- Work each leg in order: ACTIVE then COMPLETED -----------------------
  for (let i = 0; i < legIds.length; i++) {
    const legId = legIds[i];

    // Activate this leg (PENDING → ACTIVE) and assert the IN_PROGRESS-ish
    // intermediate state on the leg.
    const activateRes = await driver.api.post(
      `/api/journeys/${journeyId}/legs/${legId}/activate`,
      {},
    );
    expect(activateRes.ok()).toBeTruthy();

    const beforeComplete = await getJourney(driver.api, journeyId);
    const activeLeg = beforeComplete.legs.find((l: { id: string }) => l.id === legId);
    expect(activeLeg.status).toBe('ACTIVE');

    // Complete it (ACTIVE → COMPLETED).
    const completeRes = await driver.api.post(
      `/api/journeys/${journeyId}/legs/${legId}/complete`,
      {},
    );
    expect(completeRes.ok()).toBeTruthy();

    const afterComplete = await getJourney(driver.api, journeyId);
    const completedLeg = afterComplete.legs.find((l: { id: string }) => l.id === legId);
    expect(completedLeg.status).toBe('COMPLETED');

    // Any not-yet-touched later leg stays PENDING (no auto-advance).
    if (i + 1 < legIds.length) {
      const nextLeg = afterComplete.legs.find((l: { id: string }) => l.id === legIds[i + 1]);
      expect(nextLeg.status).toBe('PENDING');
    }
  }

  // --- Driver ends, customer confirms --------------------------------------
  const endRes = await driver.api.post(`/api/journeys/${journeyId}/end`, {
    data: { lat: -1.9706, lng: 30.1044 },
  });
  expect(endRes.ok()).toBeTruthy();
  expect((await getJourney(driver.api, journeyId)).status).toBe('AWAITING_CONFIRMATION');

  const confirmRes = await customer.api.post(`/api/journeys/${journeyId}/confirm`, {});
  expect(confirmRes.ok()).toBeTruthy();

  // --- POST-STATE: journey COMPLETED, all legs COMPLETED, escrow RELEASED ---
  const final = await getJourney(customer.api, journeyId);
  expect(final.status).toBe('COMPLETED');
  expect(final.legs).toHaveLength(3);
  for (const leg of final.legs) {
    expect(leg.status).toBe('COMPLETED');
  }
  expect(final.escrow?.status).toBe('RELEASED');
});
