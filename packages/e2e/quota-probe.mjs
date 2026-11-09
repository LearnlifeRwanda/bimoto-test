// MAP-TRUTH G4 — storage-quota measurement harness.
//
// The offline archive has to fit inside the WebView's storage quota,
// which is a fraction of free disk rather than the card's capacity. That
// makes "will it fit on a pilot handset?" a real question and not a
// formality, so this measures it rather than assuming.
//
// It must be served over a real origin: navigator.storage is undefined
// on about:blank, which is not a secure context.
//
// Usage (from packages/e2e):
//   node quota-probe.mjs
// CHROMIUM env var overrides the browser binary.
//
// The app does the same measurement at runtime via
// checkStorageFor() in packages/client/src/services/map-cache.ts, and
// refuses the download with honest copy rather than spending a rider's
// data on bytes that cannot be stored.

import { chromium } from '@playwright/test';
import http from 'node:http';
import { execSync } from 'node:child_process';

const PORT = 4601;
// docs/offline-map-extract.md: 277 tiles at 40–120 KB.
const EXTRACT_ESTIMATE_MB = { low: 11, high: 33 };

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><title>quota</title>');
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/`);

const estimate = await page.evaluate(async () => {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { quota: e.quota, usage: e.usage };
});

if (!estimate) {
  console.log('navigator.storage.estimate() unavailable in this engine.');
} else {
  const df = execSync('df -k /').toString().trim().split('\n')[1].split(/\s+/);
  const availKb = Number(df[3]);
  const quotaMb = estimate.quota / 1048576;
  console.log('navigator.storage.estimate():', JSON.stringify(estimate));
  console.log('quota:', quotaMb.toFixed(0), 'MB');
  console.log('host free disk:', (availKb / 1048576).toFixed(1), 'GB');
  console.log('quota / free disk:', (estimate.quota / 1024 / availKb).toFixed(3));
  console.log(
    `extract estimate ${EXTRACT_ESTIMATE_MB.low}-${EXTRACT_ESTIMATE_MB.high} MB fits:`,
    estimate.quota > EXTRACT_ESTIMATE_MB.high * 1048576,
    `(headroom x${(quotaMb / EXTRACT_ESTIMATE_MB.high).toFixed(0)} at the high estimate)`,
  );
}

await browser.close();
server.close();
