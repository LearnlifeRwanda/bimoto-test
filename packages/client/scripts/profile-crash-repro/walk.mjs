// PROFILE-RESCUE G6 — the §6 walk against the REAL built bundle in
// Chromium (simulated WebView; the hardware-Back legs are native-only
// and covered by unit tests — see useAndroidBackButton.test.tsx).
//
// Leg 1 (driver, normal data): boot → tap Profile tab → the profile
//        RENDERS (pre-fix this crashed).
// Leg 2 (artificial crash — empty nickname makes ProfilePage throw):
//        tap Profile → the screen degrades IN PLACE, the bottom nav
//        stays alive, "Go to home screen" recovers in-app with NO
//        reload (window marker survives).
//
// Run mock-api.mjs (with/without BIMOTO_MOCK_NICKNAME='') and
// serve-dist.mjs first; see README.md.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../e2e/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const LEG = process.env.BIMOTO_WALK_LEG || '1';

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);
const page = await browser.newPage();
const crashes = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' && /uncaught render error/.test(msg.text())) {
    crashes.push(msg.text().slice(0, 200));
  }
});

// Boot in English so selectors are stable.
await page.addInitScript(() => window.localStorage.setItem('bimoto-lang', 'en'));
await page.goto('http://localhost:4173/');
await page.waitForSelector('[role="tablist"]', { timeout: 15000 });
await page.evaluate(() => {
  window.__walkMarker = 'alive';
});

await page.getByRole('tab', { name: 'Profile' }).click();
await page.waitForTimeout(1500);

if (LEG === '1') {
  const rating = await page.getByTestId('profile-rating-value').textContent().catch(() => null);
  const logout = await page.getByTestId('profile-logout-button').isVisible().catch(() => false);
  console.log('[walk leg1] url=%s rating=%s profileRendered=%s crashes=%d',
    page.url(), rating, logout, crashes.length);
  console.log('[walk leg1] RESULT', rating !== null && logout && crashes.length === 0 ? 'PASS' : 'FAIL');
} else {
  const fallback = await page.getByTestId('screen-error-fallback').isVisible().catch(() => false);
  const navAlive = await page.locator('[role="tablist"]').isVisible().catch(() => false);
  console.log('[walk leg2] crashed-in-place=%s navAlive=%s', fallback, navAlive);

  await page.getByTestId('screen-error-home').click();
  await page.waitForTimeout(1200);
  const marker = await page.evaluate(() => window.__walkMarker);
  const fallbackGone = !(await page.getByTestId('screen-error-fallback').isVisible().catch(() => false));
  console.log('[walk leg2] afterRecover url=%s noReload=%s fallbackGone=%s',
    page.url(), marker === 'alive', fallbackGone);
  console.log('[walk leg2] RESULT',
    fallback && navAlive && marker === 'alive' && fallbackGone ? 'PASS' : 'FAIL');
}

await browser.close();
