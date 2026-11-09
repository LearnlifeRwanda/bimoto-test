import { test, expect, chromium, type Browser } from '@playwright/test';
import {
  loginAs,
  applyAuthToContext,
  createPassengerJourney,
  submitBid,
  acceptBid,
  verifyDriver,
  getJourney,
  interruptJourney,
  recordReconciliationResponse,
  decideConflict,
  getAuditVerification,
  disconnectPrisma,
} from './helpers';

/**
 * R3-E2E-EXPANSION (§3.5) — journey dispute + admin resolution + audit chain.
 *
 * A ride reaches IN_PROGRESS (escrow HELD from bid acceptance). The customer
 * interrupts the journey (escrow FROZEN, reconciliationOpenedAt set). Both
 * parties then record reconciliation responses with disagreement (customer
 * NEVER_ARRIVED, driver ARRIVED_SAFELY), producing a CONFLICT verdict that
 * transitions the journey to DISPUTED. A DISPUTED journey is the
 * conflict, surfaced to admins under the JOURNEY_RECONCILIATION conflict
 * type (there is no standalone Conflict table). The admin logs in (the
 * seeded ADMIN user, +250780000000 → SEED_USERS.TestAdmin), views the real
 * /admin/conflicts page, then decides RESOLVED_REFUND via the real decide
 * endpoint. The resolver refunds escrow (REFUNDED), sets the journey to
 * CANCELLED, and appends one AdminAction to the hash chain.
 *
 * DEVIATIONS FROM DISPATCH:
 *  - The "refund" decision enum is RESOLVED_REFUND (not REFUND_CUSTOMER);
 *    it sets the journey to CANCELLED (the resolver's refund branch), not a
 *    distinct REFUNDED journey status. Escrow becomes REFUNDED.
 *  - The audit verify endpoint (/api/admin/conflicts/audit/verify) verifies
 *    the AdminAction chain only and returns { valid, brokenAt, entries }
 *    (entries = chain length). We assert valid + entries grew by exactly 1.
 *
 * Pre-state:  journey IN_PROGRESS, escrow HELD.
 * Mid-state:  journey DISPUTED, escrow FROZEN, audit chain length N.
 * Post-state: journey CANCELLED, escrow REFUNDED, AdminAction appended,
 *             audit chain valid with length N+1.
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

test('disputed journey resolved by admin refund, audit chain extended', async () => {
  test.setTimeout(180_000);

  const customer = await loginAs('TestCustomer');
  const driver = await loginAs('TestDriver');
  const admin = await loginAs('TestAdmin');
  await verifyDriver('TestDriver');

  // --- Ride up to IN_PROGRESS (stops at /start; interrupt needs IN_PROGRESS) -
  const journey = await createPassengerJourney(customer.api);
  const journeyId = journey.id as string;

  const bid = await submitBid(driver.api, journeyId, 1800, 5);
  await acceptBid(customer.api, journeyId, bid.id);

  await driver.api.post(`/api/journeys/${journeyId}/start`, {
    data: { lat: -1.9536, lng: 30.0606 },
  });

  // --- PRE-STATE: IN_PROGRESS, escrow HELD ---------------------------------
  // INTERRUPT is only valid from IN_PROGRESS (journey state machine), so the
  // ride stops at /start — it deliberately does NOT call /end. Escrow is
  // already HELD from bid acceptance (markEscrowChargeSucceeded under
  // E2E_FAKE_PAYMENTS), so the held-escrow precondition still holds.
  const preState = await getJourney(customer.api, journeyId);
  expect(preState.status).toBe('IN_PROGRESS');
  expect(preState.escrow?.status).toBe('HELD');

  // --- Audit chain length BEFORE the admin decision ------------------------
  const auditBefore = await getAuditVerification(admin.api);
  expect(auditBefore.valid).toBe(true);
  const chainLenBefore = auditBefore.entries;

  // --- Customer interrupts the journey -------------------------------------
  await interruptJourney(customer.api, journeyId, { reason: 'Parcel never arrived' });

  // --- Both parties record conflicting reconciliation responses ------------
  // Customer says NEVER_ARRIVED, driver says ARRIVED_SAFELY → CONFLICT verdict.
  // The server's recordReconciliationResponse wrapper transitions the journey
  // via RECONCILE_CONFLICT to DISPUTED on the second call.
  await recordReconciliationResponse(customer.api, journeyId, 'NEVER_ARRIVED');
  const driverResp = await recordReconciliationResponse(driver.api, journeyId, 'ARRIVED_SAFELY');
  expect(driverResp.bothPartiesResponded).toBe(true);
  expect(driverResp.verdict).toBe('CONFLICT');

  // The conflict is keyed by journeyId (there is no standalone Conflict table).
  const conflictId = journeyId;

  // --- MID-STATE: DISPUTED, escrow FROZEN ----------------------------------
  const disputed = await getJourney(customer.api, journeyId);
  expect(disputed.status).toBe('DISPUTED');
  expect(disputed.escrow?.status).toBe('FROZEN');

  // The DISPUTED journey appears in the JOURNEY_RECONCILIATION conflict list.
  const listRes = await admin.api.get(
    '/api/admin/conflicts/JOURNEY_RECONCILIATION',
  );
  expect(listRes.ok()).toBeTruthy();
  const list = await listRes.json();
  const found = (list.items ?? []).some((c: { id: string }) => c.id === journeyId);
  expect(found).toBe(true);

  // --- Admin views the real /admin/conflicts page --------------------------
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
  });
  await applyAuthToContext(ctx, admin, 'en');
  const page = await ctx.newPage();
  await page.goto('/admin/conflicts');
  // The conflicts overview lists conflict-type cards; the heading is a
  // stable signal the admin page rendered past the AdminGuard.
  await expect(page.getByRole('heading', { name: /conflicts/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/Journey Reconciliation/i)).toBeVisible();
  await ctx.close();

  // --- Admin decides: refund the customer ----------------------------------
  const decision = await decideConflict(admin.api, conflictId, 'RESOLVED_REFUND');
  expect(decision.adminActionId).toBeTruthy();
  expect(decision.chainHash).toBeTruthy();
  expect(decision.conflictDecision).toBe('RESOLVED_REFUND');

  // --- POST-STATE: journey CANCELLED, escrow REFUNDED ----------------------
  const resolved = await getJourney(customer.api, journeyId);
  expect(resolved.status).toBe('CANCELLED');
  expect(resolved.escrow?.status).toBe('REFUNDED');

  // --- Audit chain valid and length grew by exactly 1 ----------------------
  const auditAfter = await getAuditVerification(admin.api);
  expect(auditAfter.valid).toBe(true);
  expect(auditAfter.entries).toBe(chainLenBefore + 1);
});
