// MAP-TRUTH G1 — tile measurement harness.
//
// Drives a real Chromium at a mobile viewport with an Android WebView
// user-agent and records, for a given Leaflet tile URL template: every
// tile request the browser issues, its status or failure, the timing
// from page load, the resolved container geometry, and Leaflet's own
// tileload/tileerror counts.
//
// This exists because "the map is not visible" is a claim about what the
// browser does, and reading the component cannot answer it. Findings from
// the first run are written up in docs/map-visibility-measurement.md.
//
// Usage (from packages/e2e):
//   node tile-probe.mjs                                   # ships-today URL
//   node tile-probe.mjs 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
//
// CHROMIUM env var overrides the browser binary when Playwright's own
// download is absent or version-mismatched.

import { chromium } from '@playwright/test';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const LEAFLET = resolve(HERE, '../client/node_modules/leaflet/dist/leaflet.js');
const PORT = 4599;
// Kigali city centre — the pilot's actual map, not an arbitrary tile.
const KIGALI = [-1.9441, 30.0619];
const ZOOM = 14;
const SETTLE_MS = 8000;

const urlUnderTest =
  process.argv[2] || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

const harness = (tileUrl) => `<!doctype html><html><head>
<style>html,body{margin:0}#map{width:390px;height:640px}</style>
</head><body><div id="map"></div>
<script src="/leaflet.js"></script>
<script>
  window.__tiles = [];
  const map = L.map('map').setView(${JSON.stringify(KIGALI)}, ${ZOOM});
  const layer = L.tileLayer(${JSON.stringify(tileUrl)}, { attribution: 'osm' });
  layer.on('tileerror', () => window.__tiles.push('tileerror'));
  layer.on('tileload', () => window.__tiles.push('tileload'));
  layer.addTo(map);
  window.__geom = () => {
    const el = document.getElementById('map');
    const r = el.getBoundingClientRect();
    return {
      width: r.width,
      height: r.height,
      tilesInDom: el.querySelectorAll('img.leaflet-tile').length,
    };
  };
</script></body></html>`;

const leafletJs = readFileSync(LEAFLET, 'utf8');
const server = http.createServer((req, res) => {
  if (req.url === '/leaflet.js') {
    res.writeHead(200, { 'content-type': 'application/javascript' });
    res.end(leafletJs);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(harness(urlUnderTest));
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ['--no-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  userAgent:
    'Mozilla/5.0 (Linux; Android 11; SM-A125F) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
});

const net = [];
const t0 = Date.now();
const interesting = (u) => /tile|pmtiles/.test(u);
page.on('request', (r) => {
  if (interesting(r.url())) net.push({ url: r.url(), t: Date.now() - t0, phase: 'request' });
});
page.on('response', (r) => {
  if (interesting(r.url()))
    net.push({ url: r.url(), status: r.status(), t: Date.now() - t0, phase: 'response' });
});
page.on('requestfailed', (r) => {
  if (interesting(r.url()))
    net.push({
      url: r.url(),
      failure: r.failure()?.errorText,
      t: Date.now() - t0,
      phase: 'failed',
    });
});

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForTimeout(SETTLE_MS);

const geom = await page.evaluate(() => window.__geom());
const events = await page.evaluate(() => window.__tiles);

console.log('URL UNDER TEST:', urlUnderTest);
console.log('CONTAINER GEOMETRY:', JSON.stringify(geom));
console.log('--- NETWORK ---');
for (const n of net) console.log(JSON.stringify(n));
const tally = {};
for (const n of net) {
  const key =
    n.phase === 'response' ? `HTTP ${n.status}` : n.phase === 'failed' ? `FAILED ${n.failure}` : null;
  if (key) tally[key] = (tally[key] || 0) + 1;
}
console.log('STATUS TALLY:', JSON.stringify(tally));
console.log(
  'LEAFLET tileload:', events.filter((e) => e === 'tileload').length,
  ' tileerror:', events.filter((e) => e === 'tileerror').length,
);

await browser.close();
server.close();
