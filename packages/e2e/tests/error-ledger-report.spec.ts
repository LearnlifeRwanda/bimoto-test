import { test, expect, chromium, type Browser } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { loginAs, applyAuthToContext, disconnectPrisma } from './helpers';

/**
 * BLACKBOX G5 / FLIGHT-RECORDER G6 — the whole walk, through the real UI.
 *
 * The error is thrown from a timer, outside React, on purpose: that is
 * the class docs/error-ledger.md §1 measured as producing NOTHING at
 * all before BLACKBOX — no user signal, no app-side console line,
 * nothing persisted. The whole point of the walk is that this class of
 * failure is now a line the team can forward.
 *
 * There are two walks now, because FLIGHT-RECORDER added a second way
 * out of the phone, and the pair of them is the actual promise:
 *
 *   1. Consent OFF — the error is recorded, the log is on screen in
 *      full, and NOT ONE request reaches the report endpoint until a
 *      finger lands on Send report. This is the invariant the privacy
 *      posture rests on, asserted where it can actually be observed.
 *   2. Consent ON — the same error, nobody touches anything, and the
 *      bundle arrives at the server by itself and is readable by the
 *      team. This is what the whole dispatch is for.
 *
 * The spec's step-4 assertion changed with the admin screen: the list
 * now lives behind an "All reports" tab, because the default view is the
 * grouped one.
 */

const prisma = new PrismaClient();
let browser: Browser;
const createdReportIds: string[] = [];

const THROWN_MESSAGE = 'BLACKBOX e2e: a lost error in Kigali';
const AUTO_MESSAGE = 'FLIGHT-RECORDER e2e: an error that flew home by itself';

/** The key services/diagnostics-upload.ts reads before it does anything. */
const CONSENT_KEY = 'diagnosticsUpload';

test.beforeAll(async () => {
  browser = await chromium.launch(
    process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  );
});

test.afterAll(async () => {
  if (createdReportIds.length > 0) {
    await prisma.errorReport.deleteMany({ where: { id: { in: createdReportIds } } });
  }
  await browser?.close();
  await disconnectPrisma();
  await prisma.$disconnect();
});

test('consent OFF: a thrown error becomes a line the team can forward, and only when tapped', async () => {
  test.setTimeout(180_000);

  // ---- the passenger's phone ------------------------------------------
  const customer = await loginAs('TestCustomer');
  const customerCtx = await browser.newContext();
  await applyAuthToContext(customerCtx, customer, 'en');
  // Set before any app code runs, so the batcher's very first look at
  // consent already sees OFF.
  await customerCtx.addInitScript(
    ([key]) => window.localStorage.setItem(key, 'false'),
    [CONSENT_KEY],
  );
  const phone = await customerCtx.newPage();

  await phone.goto('/diagnostics');
  await expect(phone.getByTestId('diagnostics-panel')).toBeVisible({ timeout: 30_000 });

  // A clean start: whatever this seeded account collected in another
  // spec is not this test's evidence.
  const clearButton = phone.getByTestId('diag-clear-log');
  if (await clearButton.isEnabled()) await clearButton.click();
  await expect(phone.getByTestId('diag-error-count')).toHaveText('0');

  // 1. Throw, outside React, the way a real lost error arrives.
  await phone.evaluate((message) => {
    setTimeout(() => {
      throw new Error(message);
    }, 0);
  }, THROWN_MESSAGE);

  // 2. The phone remembered it, and says so in the row and in the log.
  await expect(phone.getByTestId('diag-error-count')).toHaveText('1');
  const entry = phone.getByTestId('diag-error-entry').first();
  await expect(entry).toContainText(THROWN_MESSAGE);
  await expect(entry).toContainText('window-error');
  await expect(entry).toContainText('/diagnostics');

  // 3. Nothing has been transmitted. The log is on screen, in full, the
  //    background uploader has had longer than its boot delay to act,
  //    and the report endpoint has not been called once.
  const sendAttempts: string[] = [];
  phone.on('request', (req) => {
    if (req.url().includes('/api/diagnostics/error-report')) sendAttempts.push(req.method());
  });
  await expect(phone.getByTestId('diag-error-consent')).toBeVisible();
  await phone.waitForTimeout(12_000);
  expect(sendAttempts).toEqual([]);
  await expect(phone.getByTestId('diag-send-status')).toHaveText('—');

  // 4. The user's own hand. The button works whatever consent says —
  //    an explicit tap is its own consent.
  await phone.getByTestId('diag-send-report').click();
  await expect(phone.getByTestId('diag-send-status')).toHaveText('201', { timeout: 30_000 });
  expect(sendAttempts).toEqual(['POST']);

  // ---- the team's screen ----------------------------------------------
  const admin = await loginAs('TestAdmin');
  const adminCtx = await browser.newContext();
  await applyAuthToContext(adminCtx, admin, 'en');
  const desk = await adminCtx.newPage();

  // Reached the way the team reaches it: a link on the admin dashboard.
  await desk.goto('/admin');
  await desk.getByRole('link', { name: 'Error reports' }).click();
  // The grouped view is the default now; the per-report list is a tab.
  await desk.getByTestId('admin-error-tab-reports').click();
  await expect(desk.getByTestId('admin-error-reports-table')).toBeVisible({ timeout: 30_000 });

  const row = desk.getByTestId('admin-error-report-row').first();
  await expect(row).toContainText('TestCustomer');
  await expect(row).toContainText('CUSTOMER');

  // 5. Export the bundle — the thing that gets forwarded.
  await row.getByRole('button', { name: 'Export JSON' }).click();
  const json = desk.getByTestId('admin-error-report-json');
  await expect(json).toContainText(THROWN_MESSAGE, { timeout: 30_000 });
  await expect(json).toContainText('window-error');

  // And the bundle really is in the database, not just on a screen.
  const stored = await prisma.errorReport.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { id: true, entries: true, reporterRole: true, entryCount: true, fingerprint: true },
  });
  expect(stored).not.toBeNull();
  createdReportIds.push(stored!.id);
  expect(stored!.reporterRole).toBe('CUSTOMER');
  expect(JSON.stringify(stored!.entries)).toContain(THROWN_MESSAGE);
  // The server computed a grouping key for it, without being asked.
  expect(stored!.fingerprint).toBeTruthy();

  await customerCtx.close();
  await adminCtx.close();
});

test('consent ON: the error flies home by itself, and the team can group it', async () => {
  test.setTimeout(180_000);

  const customer = await loginAs('TestCustomer');
  const customerCtx = await browser.newContext();
  await applyAuthToContext(customerCtx, customer, 'en');
  // Consent left unset — the pilot default, which is ON. Nothing in this
  // test touches a send control.
  const phone = await customerCtx.newPage();

  await phone.goto('/diagnostics');
  await expect(phone.getByTestId('diagnostics-panel')).toBeVisible({ timeout: 30_000 });
  const clearButton = phone.getByTestId('diag-clear-log');
  if (await clearButton.isEnabled()) await clearButton.click();
  await expect(phone.getByTestId('diag-error-count')).toHaveText('0');

  await phone.evaluate((message) => {
    setTimeout(() => {
      throw new Error(message);
    }, 0);
  }, AUTO_MESSAGE);
  await expect(phone.getByTestId('diag-error-count')).toHaveText('1');

  // A reload, which is what a phone does all day. The ledger survives it
  // (localStorage, deliberately not Dexie), so the entry is already
  // waiting when the uploader's boot attempt comes round — no race with
  // however long this page took to become interactive the first time.
  // VALIDATE-MEND G5 — this wait used to be waitForRequest, which
  // resolves the moment the browser SENDS the POST. The row is written
  // by the handler that has not run yet, so the read below raced the
  // commit. waitForResponse resolves when the server has answered,
  // which for this endpoint means the row exists.
  const upload = phone.waitForResponse(
    (res) =>
      res.url().includes('/api/diagnostics/error-report') && res.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await phone.reload();
  await expect(phone.getByTestId('diagnostics-panel')).toBeVisible({ timeout: 30_000 });
  const uploadRes = await upload;
  expect(uploadRes.status()).toBe(201);

  // Nobody tapped anything: the manual status is still untouched.
  await expect(phone.getByTestId('diag-send-status')).toHaveText('—');

  // And the read is SCOPED. It used to be an unscoped
  // `findFirst({ orderBy: { createdAt: 'desc' } })` — "the newest row in
  // the table", which on a shared database is whatever ran last, not
  // necessarily this test's. When the timing went the other way it read
  // the previous test's row and failed on an assertion about a message
  // it never sent. The endpoint answers 201 with the id it just wrote,
  // so this test can name its own row exactly: no ordering, no window,
  // nothing another test can win.
  const { id: reportId } = (await uploadRes.json()) as { id: string };
  expect(reportId).toBeTruthy();
  createdReportIds.push(reportId);

  const stored = await prisma.errorReport.findUnique({
    where: { id: reportId },
    select: { id: true, entries: true, fingerprint: true },
  });
  expect(stored).not.toBeNull();
  expect(JSON.stringify(stored!.entries)).toContain(AUTO_MESSAGE);
  expect(stored!.fingerprint).toBeTruthy();

  // ---- and it is grouped, with the firehose behind it ------------------
  const admin = await loginAs('TestAdmin');
  const adminCtx = await browser.newContext();
  await applyAuthToContext(adminCtx, admin, 'en');
  const desk = await adminCtx.newPage();

  await desk.goto('/admin');
  await desk.getByRole('link', { name: 'Error reports' }).click();
  await expect(desk.getByTestId('admin-error-groups-table')).toBeVisible({ timeout: 30_000 });
  await expect(desk.getByTestId('admin-error-group-row').first()).toBeVisible();

  // One line per report, which is the whole promise of the export.
  await desk.getByTestId('admin-error-export-all').click();
  const jsonl = desk.getByTestId('admin-error-export-jsonl');
  await expect(jsonl).toContainText(AUTO_MESSAGE, { timeout: 30_000 });

  await customerCtx.close();
  await adminCtx.close();
});
