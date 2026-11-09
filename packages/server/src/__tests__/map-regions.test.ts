// __TESTS__/MAP-REGIONS.TEST.TS
//
// MAP-RWANDA G2 — the server stops knowing regions by name.
//
// What is proved here:
//   - GET /api/map/regions reflects EXACTLY the provisioned fixtures,
//     with sizes read from the files (no hardcoded number anywhere);
//   - a region the server does not have is a clean 404, not an error;
//   - GET /api/map/kigali.pmtiles behaves exactly as it did before this
//     change, including the MAP_PMTILES_PATH override and the clean 404
//     for a configured-but-missing path — an APK in the field must not
//     notice that anything happened;
//   - Range and If-Range resume work on a NON-kigali region, because the
//     whole point is that every region got the same contract and not a
//     second implementation;
//   - path traversal is structurally impossible. Express hands the route
//     a URL-DECODED path segment, so /api/map/..%2f..%2fetc%2fpasswd
//     .pmtiles arrives as the region '../../etc/passwd'. That is not a
//     hypothesis: the test below sends it and reads the 404.

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import mapRoutes from '../routes/map.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import { config } from '../config';
import {
  buildRegionArchive,
  buildRegionManifest,
} from './helpers/pmtiles-fixture';
import { isValidRegionKey, listMapRegions } from '../services/map-extract';

const app = express();
app.use(cookieParser());
app.use('/api/map', mapRoutes);
app.use(errorHandler);

const cookie = `accessToken=${generateAccessToken({ userId: 'c1', role: 'CUSTOMER' })}`;

const KIGALI = buildRegionArchive('kigali');
// Deliberately a different size as well as different bytes, so a size
// read from the wrong file cannot pass.
const NORTH = buildRegionArchive('north', 5);

let workDir: string;
let originalCwd: string;
const originalConfiguredPath = config.MAP_PMTILES_PATH;

function setConfiguredPath(value: string): void {
  (config as { MAP_PMTILES_PATH: string }).MAP_PMTILES_PATH = value;
}

/** Provision an archive (and its manifest) at the default rung. */
function provision(region: string, bytes: Buffer): string {
  const dir = join(workDir, 'data');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${region}.pmtiles`);
  writeFileSync(path, bytes);
  writeFileSync(
    `${path}.json`,
    JSON.stringify(buildRegionManifest(region, bytes.length), null, 2),
  );
  return path;
}

function raw(r: request.Test): request.Test {
  return r.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'bimoto-regions-'));
  originalCwd = process.cwd();
  process.chdir(workDir);
  setConfiguredPath('');
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
  setConfiguredPath(originalConfiguredPath);
});

describe('GET /api/map/regions', () => {
  test('401 without a token — the registry is authenticated like the archives', async () => {
    provision('kigali', KIGALI);
    const res = await request(app).get('/api/map/regions');
    expect(res.status).toBe(401);
  });

  test('an unprovisioned server lists nothing, and that is not an error', async () => {
    const res = await request(app).get('/api/map/regions').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ regions: [] });
  });

  test('reflects exactly the provisioned fixtures, with real sizes', async () => {
    provision('kigali', KIGALI);
    provision('north', NORTH);

    const res = await request(app).get('/api/map/regions').set('Cookie', cookie);
    expect(res.status).toBe(200);

    const regions = res.body.regions as Array<Record<string, unknown>>;
    expect(regions.map((r) => r.key)).toEqual(['kigali', 'north']);

    const north = regions.find((r) => r.key === 'north')!;
    // The size is the FILE's size — read by stat, never typed by a human.
    expect(north.sizeBytes).toBe(NORTH.length);
    expect(north.nameKey).toBe('map.regions.north');
    expect(typeof north.lastModified).toBe('string');
    expect(typeof north.etag).toBe('string');
    // Metadata comes from the manifest the builder wrote beside it.
    expect((north.manifest as Record<string, unknown>).source).toBe(
      'geofabrik:rwanda',
    );
    expect((north.manifest as Record<string, unknown>).maxzoom).toBe(14);

    // The two regions really are different sizes, so this test can fail.
    const kigali = regions.find((r) => r.key === 'kigali')!;
    expect(kigali.sizeBytes).not.toBe(north.sizeBytes);
    expect(kigali.sizeBytes).toBe(KIGALI.length);
  });

  test('the server holds no display strings — only name KEYS', async () => {
    provision('north', NORTH);
    const res = await request(app).get('/api/map/regions').set('Cookie', cookie);
    const body = JSON.stringify(res.body);
    // Region names (and their French and Kinyarwanda) live in the shared
    // registry on the client. If a human-readable name ever appears here
    // there are two places to change it, which is one too many.
    expect(body).not.toContain('Amajyaruguru');
    expect(body).not.toContain('Northern');
  });

  test('a file that is not a legal region key is not listed', async () => {
    provision('north', NORTH);
    const dir = join(workDir, 'data');
    writeFileSync(join(dir, 'Kigali_OLD.pmtiles'), KIGALI);
    writeFileSync(join(dir, 'notes.txt'), 'hello');

    const res = await request(app).get('/api/map/regions').set('Cookie', cookie);
    expect((res.body.regions as Array<{ key: string }>).map((r) => r.key)).toEqual([
      'north',
    ]);
  });

  test('listing and serving agree: everything listed can be fetched', async () => {
    provision('kigali', KIGALI);
    provision('north', NORTH);
    provision('rwanda', buildRegionArchive('rwanda', 3));

    const res = await request(app).get('/api/map/regions').set('Cookie', cookie);
    for (const region of res.body.regions as Array<{ key: string; sizeBytes: number }>) {
      const got = await request(app)
        .get(`/api/map/${region.key}.pmtiles`)
        .set('Cookie', cookie);
      expect(got.status).toBe(200);
      expect(got.headers['content-length']).toBe(String(region.sizeBytes));
    }
  });
});

describe('GET /api/map/:region.pmtiles', () => {
  test('serves a non-kigali region byte for byte', async () => {
    provision('north', NORTH);
    const res = await raw(request(app).get('/api/map/north.pmtiles').set('Cookie', cookie));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(Buffer.compare(res.body as Buffer, NORTH)).toBe(0);
  });

  test('404 MAP_NOT_AVAILABLE for a real region this server has not got', async () => {
    provision('kigali', KIGALI);
    const res = await request(app).get('/api/map/west.pmtiles').set('Cookie', cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MAP_NOT_AVAILABLE');
  });

  test('401 without a token — auth carries to every region', async () => {
    provision('north', NORTH);
    const res = await request(app).get('/api/map/north.pmtiles');
    expect(res.status).toBe(401);
  });

  test('206 Range on a non-kigali region', async () => {
    provision('north', NORTH);
    const res = await raw(
      request(app)
        .get('/api/map/north.pmtiles')
        .set('Cookie', cookie)
        .set('Range', 'bytes=0-6'),
    );
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-6/${NORTH.length}`);
    expect((res.body as Buffer).toString()).toBe('PMTiles');
  });

  test('If-Range resume on a non-kigali region: 206 to append, 200 when it changed', async () => {
    provision('north', NORTH);

    const head = await request(app).get('/api/map/north.pmtiles').set('Cookie', cookie);
    const etag = head.headers.etag;
    expect(etag).toBeTruthy();

    // The rider paused at 10 bytes and comes back to the same archive.
    const resumed = await raw(
      request(app)
        .get('/api/map/north.pmtiles')
        .set('Cookie', cookie)
        .set('Range', 'bytes=10-')
        .set('If-Range', etag),
    );
    expect(resumed.status).toBe(206);
    expect(Buffer.compare(resumed.body as Buffer, NORTH.subarray(10))).toBe(0);

    // The archive changed under the paused download: the whole new file,
    // so the client throws its partial away instead of splicing two.
    const stale = await raw(
      request(app)
        .get('/api/map/north.pmtiles')
        .set('Cookie', cookie)
        .set('Range', 'bytes=10-')
        .set('If-Range', '"not-the-etag"'),
    );
    expect(stale.status).toBe(200);
    expect(Buffer.compare(stale.body as Buffer, NORTH)).toBe(0);
  });

  test('416 for a start beyond EOF on a non-kigali region', async () => {
    provision('north', NORTH);
    const res = await request(app)
      .get('/api/map/north.pmtiles')
      .set('Cookie', cookie)
      .set('Range', `bytes=${NORTH.length + 5}-`);
    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe(`bytes */${NORTH.length}`);
  });
});

describe('the kigali route is unchanged (old APKs in the field)', () => {
  test('serves from the default rung with no configuration at all', async () => {
    provision('kigali', KIGALI);
    expect(config.MAP_PMTILES_PATH).toBe('');

    const res = await raw(
      request(app).get('/api/map/kigali.pmtiles').set('Cookie', cookie),
    );
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, KIGALI)).toBe(0);
  });

  test('MAP_PMTILES_PATH still overrides the default rung', async () => {
    provision('kigali', KIGALI);
    const override = join(workDir, 'elsewhere.pmtiles');
    const overrideBytes = Buffer.concat([KIGALI, Buffer.from('EXTRA')]);
    writeFileSync(override, overrideBytes);
    setConfiguredPath(override);

    const res = await request(app).get('/api/map/kigali.pmtiles').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(overrideBytes.length));
  });

  test('a configured-but-missing path is still a clean 404, not a fallback', async () => {
    provision('kigali', KIGALI);
    setConfiguredPath(join(workDir, 'nope.pmtiles'));

    const res = await request(app).get('/api/map/kigali.pmtiles').set('Cookie', cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MAP_NOT_AVAILABLE');
  });

  test('and the registry agrees with it — a kigali it cannot serve is not listed', async () => {
    provision('kigali', KIGALI);
    provision('north', NORTH);
    setConfiguredPath(join(workDir, 'nope.pmtiles'));

    const res = await request(app).get('/api/map/regions').set('Cookie', cookie);
    // The override said "that file", the file is not there, so there is
    // no kigali on this server — and the list must not claim otherwise.
    expect((res.body.regions as Array<{ key: string }>).map((r) => r.key)).not.toContain(
      'kigali',
    );
  });

  test('an override names the directory its neighbours live in', async () => {
    // The operator pointed MAP_PMTILES_PATH at their own kigali archive;
    // provinces dropped beside it must still be found, without the
    // updater ever writing .env.
    const dir = join(workDir, 'custom');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'kigali.pmtiles'), KIGALI);
    writeFileSync(join(dir, 'north.pmtiles'), NORTH);
    setConfiguredPath(join(dir, 'kigali.pmtiles'));

    const res = await request(app).get('/api/map/regions').set('Cookie', cookie);
    expect((res.body.regions as Array<{ key: string }>).map((r) => r.key)).toEqual([
      'kigali',
      'north',
    ]);
  });
});

describe('path traversal is structurally impossible', () => {
  // Every one of these reaches the handler URL-DECODED. None may produce
  // anything but a 404 — and in particular none may read a real file.
  const HOSTILE = [
    '..%2f..%2fetc%2fpasswd',
    '..%2F..%2F..%2Fetc%2Fpasswd',
    '%2e%2e%2fkigali',
    '....%2f%2f',
    'kigali%00',
    '%2fetc%2fpasswd',
    'kigali2',
    'kigali_old',
    'north.',
    '.north',
    '-north',
    'north-',
  ];

  test('a secret beside the archives is never served', async () => {
    provision('kigali', KIGALI);
    // A real, readable file in the same directory, named so that only a
    // traversal or a loose pattern could ever reach it.
    writeFileSync(join(workDir, 'data', 'secret.txt'), 'TOP-SECRET');
    writeFileSync(join(workDir, 'secret.pmtiles'), 'ALSO-SECRET');

    for (const hostile of HOSTILE) {
      const res = await request(app)
        .get(`/api/map/${hostile}.pmtiles`)
        .set('Cookie', cookie);
      expect([404, 400]).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain('SECRET');
    }
  });

  test('the URL really does decode into the handler — the pattern is load-bearing', async () => {
    provision('kigali', KIGALI);
    // Proof that these keys are not stopped by Express before us: the
    // same shape with a legal key resolves fine, so the 404s above are
    // the allowlist doing its job, not the router failing to match.
    const legal = await request(app)
      .get('/api/map/kigali.pmtiles')
      .set('Cookie', cookie);
    expect(legal.status).toBe(200);

    // And the guard itself refuses the decoded forms directly.
    expect(isValidRegionKey('../../etc/passwd')).toBe(false);
    expect(isValidRegionKey('..')).toBe(false);
    expect(isValidRegionKey('a/b')).toBe(false);
    expect(isValidRegionKey('kigali\0')).toBe(false);
    expect(isValidRegionKey('KIGALI')).toBe(false);
    expect(isValidRegionKey('kigali2')).toBe(false);
    expect(isValidRegionKey('')).toBe(false);
    expect(isValidRegionKey('a'.repeat(33))).toBe(false);
    // Legal keys, including the hyphenated shape later packs will use.
    expect(isValidRegionKey('kigali')).toBe(true);
    expect(isValidRegionKey('north')).toBe(true);
    expect(isValidRegionKey('rwanda')).toBe(true);
    expect(isValidRegionKey('kigali-city')).toBe(true);
  });

  test('uppercase gets no alias on the generic route', async () => {
    provision('north', NORTH);
    // The generic route has no case-insensitive twin to fall back on, so
    // an uppercase region is simply not a region.
    const res = await request(app).get('/api/map/NORTH.pmtiles').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  test('/KIGALI.pmtiles is Express case-insensitivity, unchanged from before', async () => {
    provision('kigali', KIGALI);
    // Express routers are case-insensitive by default, so the LITERAL
    // /kigali.pmtiles registration has always answered /KIGALI.pmtiles —
    // verified against main before this change, where it also returned
    // 200. It is not a traversal and not a regression: same archive,
    // same auth, same bytes. Pinned here so the alias is a decision on
    // the record rather than a surprise, and so that a future switch to
    // a case-sensitive router is a deliberate, visible break for any old
    // client that happens to rely on it.
    const res = await raw(
      request(app).get('/api/map/KIGALI.pmtiles').set('Cookie', cookie),
    );
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, KIGALI)).toBe(0);
    // The key itself is still illegal — nothing else reaches the disk by
    // being shouted.
    expect(isValidRegionKey('KIGALI')).toBe(false);
  });

  test('a pattern-legal key still cannot escape the enumerated list', async () => {
    // Second gate: even a perfectly legal key names nothing unless the
    // directory scan produced it.
    provision('kigali', KIGALI);
    const listed = (await listMapRegions()).map((r) => r.key);
    expect(listed).toEqual(['kigali']);

    const res = await request(app).get('/api/map/south.pmtiles').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });
});
