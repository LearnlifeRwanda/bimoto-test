// PROFILE-RESCUE G1 — drive the REAL built bundle in Chromium.
// Scenario (BIMOTO_MOCK_ROLE=DRIVER):
//   boot -> role home -> tap Profile tab -> capture pageerror
//   -> boundary fallback -> Retry -> reload lands back on /profile
//   -> crash recurs (the field trap).
// Control (BIMOTO_MOCK_ROLE=CUSTOMER): profile renders.
import { createRequire } from 'node:module';
// Borrow Playwright from the e2e workspace package.
const require = createRequire(new URL('../../../e2e/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const ROLE = process.env.BIMOTO_MOCK_ROLE || 'DRIVER';

// PLAYWRIGHT_CHROMIUM overrides for environments with a pre-installed
// browser (e.g. /opt/pw-browsers/chromium).
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (err) => {
  pageErrors.push(err);
  console.log(`[pageerror] ${err.message}\n${(err.stack || '').split('\n').slice(0, 4).join('\n')}`);
});
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    const text = msg.text();
    pageErrors.push({ message: text });
    console.log(`[console.error] ${text.slice(0, 600)}`);
  }
});

await page.goto('http://localhost:4173/');
// Wait for boot (users/me resolved -> shell rendered).
await page.waitForSelector('nav, [role="main"]', { timeout: 15000 });
console.log(`[repro] booted at ${page.url()}`);

// Tap the Profile tab in the bottom nav (real user gesture).
await page.click('a[href="/profile"], [data-testid="nav-profile"], nav >> text=/profil/i').catch(async () => {
  console.log('[repro] nav tab not found by selector, navigating directly');
  await page.goto('http://localhost:4173/profile');
});
await page.waitForTimeout(2500);
console.log(`[repro] after Profile tap: url=${page.url()} errors=${pageErrors.length}`);

const boundaryVisible = await page
  .getByText(/Something went wrong|Ikibazo/i)
  .first()
  .isVisible()
  .catch(() => false);
const profileVisible = await page
  .locator('[data-testid="profile-logout-button"]')
  .isVisible()
  .catch(() => false);
console.log(`[repro] boundary=${boundaryVisible} profileRendered=${profileVisible}`);

if (ROLE === 'DRIVER' && boundaryVisible) {
  // Demonstrate the trap: Retry reloads into the crashed route.
  await page.getByRole('button', { name: /Retry|Ongera/i }).click();
  await page.waitForTimeout(3500);
  const stillTrapped = await page
    .getByText(/Something went wrong|Ikibazo/i)
    .first()
    .isVisible()
    .catch(() => false);
  console.log(`[repro] after Retry: url=${page.url()} trappedAgain=${stillTrapped} totalErrors=${pageErrors.length}`);
}

console.log('[repro] RESULT', {
  role: ROLE,
  crashed: pageErrors.length > 0,
  firstError: pageErrors[0]?.message ?? null,
});
await browser.close();
