import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import { loginAs, applyAuthToContext, disconnectPrisma } from './helpers';

/**
 * MAP-RWANDA G5 — the walk this dispatch exists for.
 *
 * A motari picks their province by its own name, sees how many megabytes
 * before they say yes, downloads it, loses all signal, and still has a
 * map. Everything below is the real UI against the real server:
 *
 *   1. The offline-map screen lists the country and the provinces, by
 *      name, with the sizes the SERVER reports — no estimate anywhere.
 *   2. A region the server has not got says "not available yet" and
 *      offers no button; a provisioned one offers a download.
 *   3. Tapping one province downloads that province and nothing else,
 *      and the archive lands in IndexedDB.
 *   4. AIRPLANE MODE: the map is open, the signal goes, the rider pans —
 *      and it keeps drawing from the downloaded archive, never reaching
 *      for OSM. That is the field case: you keep the map you paid for.
 *
 * The archives are FIXTURES, not real maps. A real province is tens of
 * megabytes built from OSM data by the operator; the executor
 * environment's egress denies Geofabrik and every OSM host, and a real
 * archive must never be committed. So the server's /api/map routes are
 * fulfilled with small, genuine PMTiles v3 bytes generated here — which
 * is enough to prove the whole path, because what is being proved is the
 * download, the cache, the selection and the offline render, not
 * cartography.
 */

let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  await disconnectPrisma();
});

// ---------------------------------------------------------------- fixture

/**
 * A minimal, spec-valid PMTiles v3 archive, built in the browser.
 *
 * Mirrors packages/server/src/__tests__/helpers/pmtiles-fixture.ts — the
 * same 127-byte header layout — so the bytes the client stores here are
 * the same SHAPE it stores in the field. The bbox is what matters for
 * this spec: it is what the renderer reads to decide which archive
 * covers the view.
 */
/**
 * A minimal, spec-valid PMTiles v3 archive — built here in Node.
 *
 * Mirrors packages/server/src/__tests__/helpers/pmtiles-fixture.ts (the
 * same 127-byte header layout), so the bytes the client stores are the
 * same SHAPE it stores in the field. The header bbox is the part this
 * spec depends on: it is what the renderer reads to decide which archive
 * covers the view.
 */
function buildArchive(region: string, bbox: [number, number, number, number]): Buffer {
  const HEADER = 127;
  const tile = Buffer.from(`${region}-tile`, 'utf8');
  // Root directory, one entry: count, tileId delta, runLength, length,
  // offset+1 (varints, all single-byte at this size).
  const dir = Buffer.from([1, 0, 1, tile.length, 1]);
  const meta = Buffer.from(JSON.stringify({ name: region }), 'utf8');

  const header = Buffer.alloc(HEADER);
  header.write('PMTiles', 0, 'utf8');
  header.writeUInt8(3, 7);
  const rootOff = HEADER;
  const metaOff = rootOff + dir.length;
  const tileOff = metaOff + meta.length;
  const u64 = (o: number, v: number) => header.writeBigUInt64LE(BigInt(v), o);
  u64(8, rootOff);
  u64(16, dir.length);
  u64(24, metaOff);
  u64(32, meta.length);
  u64(40, tileOff);
  u64(48, 0);
  u64(56, tileOff);
  u64(64, tile.length);
  u64(72, 1);
  u64(80, 1);
  u64(88, 1);
  header.writeUInt8(1, 96); // clustered
  header.writeUInt8(1, 97); // internal compression: none
  header.writeUInt8(1, 98); // tile compression: none
  header.writeUInt8(1, 99); // tile type: MVT
  header.writeUInt8(0, 100);
  header.writeUInt8(14, 101);
  const [w, s, e, n] = bbox;
  header.writeInt32LE(Math.round(w * 1e7), 102);
  header.writeInt32LE(Math.round(s * 1e7), 106);
  header.writeInt32LE(Math.round(e * 1e7), 110);
  header.writeInt32LE(Math.round(n * 1e7), 114);
  header.writeUInt8(14, 118);
  header.writeInt32LE(Math.round(((w + e) / 2) * 1e7), 119);
  header.writeInt32LE(Math.round(((s + n) / 2) * 1e7), 123);

  return Buffer.concat([header, dir, meta, tile]);
}

/** Northern Province, roughly — Musanze is inside it. */
const NORTH_BBOX: [number, number, number, number] = [29.3, -1.9, 30.1, -1.05];
const NORTH_ARCHIVE = buildArchive('north', NORTH_BBOX);
// Measured, never guessed — the same discipline the server uses.
const NORTH_SIZE = NORTH_ARCHIVE.length;

/**
 * Stand in for a server that has `north` provisioned and nothing else.
 * This is exactly the state the founder creates by dropping ONE file in
 * data/ — the point of the whole design.
 */
async function provisionNorthOnly(page: Page): Promise<void> {
  await page.route('**/api/map/regions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        regions: [
          {
            key: 'north',
            nameKey: 'map.regions.north',
            sizeBytes: NORTH_SIZE,
            lastModified: 'Mon, 10 Aug 2026 09:00:00 GMT',
            etag: '"e2e-north"',
          },
        ],
      }),
    });
  });

  await page.route('**/api/map/north.pmtiles', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      headers: { 'accept-ranges': 'bytes', etag: '"e2e-north"' },
      body: NORTH_ARCHIVE,
    });
  });

  // Any other region 404s, exactly as an unprovisioned server does.
  await page.route(/\/api\/map\/(?!north\.pmtiles|regions)[a-z-]+\.pmtiles/, (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'MAP_NOT_AVAILABLE', message: 'errors.mapNotAvailable' },
      }),
    }),
  );
}

test.describe('MAP-RWANDA — a province in your pocket', () => {
  test('pick a province by name, download it, then lose all signal', async () => {
    const session = await loginAs('TestCustomer');
    const context = await browser.newContext();
    await applyAuthToContext(context, session, 'en');
    const page = await context.newPage();
    await provisionNorthOnly(page);

    // ---------------------------------------------- 1. the list, by name
    await page.goto('/profile');
    const card = page.getByTestId('offline-map-card');
    await expect(card).toBeVisible();

    // MAP-REACH G4 — the OFFERED set is the five single provinces.
    // Faustin, 24 August: "Let have single provinces only." The
    // all-Rwanda bundle is the redundancy — every square metre of it is
    // already in one of the five, at several times the bytes — so it is
    // no longer offered. The route still serves it and a phone that
    // already holds it keeps its row; that half is pinned in
    // client/__tests__/OfflineMapCard.test.tsx, since it needs a seeded
    // cache rather than a fresh browser profile.
    await expect(page.getByTestId('offline-map-tier-province')).toBeVisible();
    await expect(page.getByTestId('offline-map-tier-country')).toHaveCount(0);
    await expect(page.getByTestId('offline-map-row-rwanda')).toHaveCount(0);

    for (const key of ['kigali', 'north', 'south', 'east', 'west']) {
      await expect(page.getByTestId(`offline-map-row-${key}`)).toBeVisible();
    }

    // ------------------------- 2. real sizes, and honest unavailability
    const northRow = page.getByTestId('offline-map-row-north');
    await expect(northRow).toContainText('Northern Province');
    // The size is the SERVER's byte count, rendered in MB.
    await expect(page.getByTestId('offline-map-row-north-size')).toHaveText(
      `${(NORTH_SIZE / (1024 * 1024)).toFixed(1)} MB`,
    );
    // A region this server has not got says so, and has no button.
    await expect(page.getByTestId('offline-map-row-west-unavailable')).toBeVisible();
    await expect(page.getByTestId('offline-map-row-west-download')).toHaveCount(0);
    // No estimate survives anywhere on this screen.
    await expect(card).not.toContainText('40 MB');

    // ------------------------------------- 3. download THAT province only
    const archiveRequests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('.pmtiles')) archiveRequests.push(r.url());
    });

    await page.getByTestId('offline-map-row-north-download').click();
    await expect(page.getByTestId('offline-map-row-north-ready')).toBeVisible({
      timeout: 15_000,
    });

    // Exactly one archive was fetched, and it was Northern Province.
    expect(archiveRequests.filter((u) => u.includes('.pmtiles'))).toHaveLength(1);
    expect(archiveRequests[0]).toContain('/api/map/north.pmtiles');

    // The bytes really are in IndexedDB, under the region's own key.
    const cached = await page.evaluate(async () => {
      const openDb = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('bimoto');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      const db = await openDb();
      return new Promise<Array<{ key: string; size: number }>>((resolve) => {
        const tx = db.transaction('mapCache', 'readonly');
        const req = tx.objectStore('mapCache').getAll();
        req.onsuccess = () =>
          resolve(
            (req.result as Array<{ key: string; sizeBytes: number }>).map((r) => ({
              key: r.key,
              size: r.sizeBytes,
            })),
          );
        req.onerror = () => resolve([]);
      });
    });
    expect(cached.map((c) => c.key)).toEqual(['north']);
    expect(cached[0].size).toBe(NORTH_SIZE);

    // ------------------------------------------------ 4. airplane mode
    //
    // The real field case: the map is already open and the signal goes.
    //
    // OUTBOX G4 — the fence that used to stand here is gone. It read:
    // "a cold boot with no network lands on /welcome — the app's own
    // auth bootstrap needs the API — which is an app-wide concern and
    // not this dispatch's". That concern has now been answered: a
    // previously signed-in user who opens the app with no network gets
    // their own home from the remembered session snapshot, not the
    // carousel. So this spec no longer has to work around it, and the
    // assertion below checks the thing the fence used to excuse — the
    // app stays where it is when the signal goes.
    await page.goto('/');
    const canvas = page.getByTestId('map-canvas');
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    // The VECTOR archive is what draws, not the raster fallback:
    // protomaps-leaflet publishes its own attribution when its layer is
    // on the map, and BaseTileLayer renders one or the other, never both.
    await expect(page.locator('.leaflet-control-attribution')).toContainText(
      'Protomaps',
      { timeout: 15_000 },
    );

    // Now cut everything.
    await context.setOffline(true);

    // OUTBOX G4 — and the home screen stays mounted. Before the session
    // snapshot, losing the network could take the user out of the app
    // shell entirely; the map cannot keep a promise on a screen that is
    // no longer there.
    await expect(canvas).toBeVisible();
    // Not on the welcome screen, and not on the login form.
    await expect(page.getByTestId('welcome-guide-link')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/');
    const reachedOut: string[] = [];
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith('http') && !url.includes('localhost:5173')) {
        reachedOut.push(url);
        return route.abort();
      }
      return route.continue();
    });

    // Move the map around: panning is what forces new tiles, so this is
    // where a map that secretly needed the network would go blank.
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(320, 300, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(2500);

    // Still drawing, still from the archive, still no placeholder.
    await expect(page.getByTestId('map-offline-hint')).toHaveCount(0);
    await expect(page.locator('.leaflet-control-attribution')).toContainText('Protomaps');

    // And it never reached for OSM: the archive answered every tile.
    expect(reachedOut.filter((u) => u.includes('tile.openstreetmap'))).toHaveLength(0);

    await context.setOffline(false);
    await context.close();
  });
});
