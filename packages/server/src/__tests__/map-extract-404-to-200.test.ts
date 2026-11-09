// __TESTS__/MAP-EXTRACT-404-TO-200.TEST.TS
//
// MAP-TRUTH G3 — the proof that the dark feature lights up, with the
// actual bytes served.
//
// An entire shipped feature — download manager, Dexie cache, vector
// renderer, three languages of copy — was inert because
// GET /api/map/kigali.pmtiles answered 404 on every server in the world:
// MAP_PMTILES_PATH was empty everywhere and update-pilot.command is
// forbidden from writing it. These tests pin the transition:
//
//   no archive anywhere        → 404 MAP_NOT_AVAILABLE  (unchanged)
//   archive at the DEFAULT rung → 200, byte-for-byte, with Range
//   archive at MAP_PMTILES_PATH → 200 (the override still wins)
//
// The 200 case serves a REAL PMTiles v3 archive, and the last test reads
// it back through the same `pmtiles` package the client ships — over the
// HTTP route, by byte range, exactly as the app does. A test that served
// an arbitrary blob would prove the file server works, not that the
// offline map does.

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
import { buildPmtilesArchive } from './helpers/pmtiles-fixture';

const app = express();
app.use(cookieParser());
app.use('/api/map', mapRoutes);
app.use(errorHandler);

const cookie = `accessToken=${generateAccessToken({ userId: 'c1', role: 'CUSTOMER' })}`;

// A small but genuine Kigali-shaped archive: two z14 tiles inside the
// bounding box scripts/build-region-pmtiles.command clips kigali to.
const ARCHIVE = buildPmtilesArchive({
  tiles: [
    { z: 14, x: 9559, y: 8280, data: Buffer.from('tile-a-payload') },
    { z: 14, x: 9560, y: 8280, data: Buffer.from('tile-b-payload') },
  ],
  minzoom: 0,
  maxzoom: 14,
  bbox: [29.95, -2.1, 30.25, -1.83],
  metadata: { name: 'kigali', source: 'geofabrik:rwanda' },
});

let workDir: string;
let originalCwd: string;
const originalConfiguredPath = config.MAP_PMTILES_PATH;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'bimoto-map-'));
  originalCwd = process.cwd();
  process.chdir(workDir);
  (config as { MAP_PMTILES_PATH: string }).MAP_PMTILES_PATH = '';
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
  (config as { MAP_PMTILES_PATH: string }).MAP_PMTILES_PATH = originalConfiguredPath;
});

function placeAtDefaultRung(bytes: Buffer): string {
  mkdirSync(join(workDir, 'data'), { recursive: true });
  const path = join(workDir, 'data', 'kigali.pmtiles');
  writeFileSync(path, bytes);
  return path;
}

describe('GET /api/map/kigali.pmtiles — 404 to 200 (MAP-TRUTH G3)', () => {
  test('BEFORE: nothing provisioned → 404 MAP_NOT_AVAILABLE', async () => {
    const res = await request(app)
      .get('/api/map/kigali.pmtiles')
      .set('Cookie', cookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MAP_NOT_AVAILABLE');
  });

  test('AFTER: archive at the default rung → 200 with the exact bytes', async () => {
    placeAtDefaultRung(ARCHIVE);

    const res = await request(app)
      .get('/api/map/kigali.pmtiles')
      .set('Cookie', cookie)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-length']).toBe(String(ARCHIVE.length));

    // Byte for byte — not merely "some bytes arrived".
    expect(Buffer.compare(res.body as Buffer, ARCHIVE)).toBe(0);
    // And what arrived really is a PMTiles v3 archive.
    expect((res.body as Buffer).subarray(0, 7).toString()).toBe('PMTiles');
    expect((res.body as Buffer).readUInt8(7)).toBe(3);
  });

  test('no configuration was needed — MAP_PMTILES_PATH stayed empty', async () => {
    placeAtDefaultRung(ARCHIVE);

    // The whole point of the default rung: update-pilot.command promises
    // the operator's .env is untouched, so the feature must work without
    // one. If this ever needs the env set, the feature goes dark again.
    expect(config.MAP_PMTILES_PATH).toBe('');
    const res = await request(app)
      .get('/api/map/kigali.pmtiles')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  test('MAP_PMTILES_PATH still overrides the default rung', async () => {
    placeAtDefaultRung(ARCHIVE);
    const override = join(workDir, 'elsewhere.pmtiles');
    const overrideBytes = Buffer.concat([ARCHIVE, Buffer.from('EXTRA')]);
    writeFileSync(override, overrideBytes);
    (config as { MAP_PMTILES_PATH: string }).MAP_PMTILES_PATH = override;

    const res = await request(app)
      .get('/api/map/kigali.pmtiles')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(overrideBytes.length));
  });

  test('a configured-but-missing path is a clean 404, not a silent fallback', async () => {
    // An operator who set the variable meant THAT file. Quietly serving a
    // different archive would be worse than saying no.
    placeAtDefaultRung(ARCHIVE);
    (config as { MAP_PMTILES_PATH: string }).MAP_PMTILES_PATH = join(workDir, 'nope.pmtiles');

    const res = await request(app)
      .get('/api/map/kigali.pmtiles')
      .set('Cookie', cookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MAP_NOT_AVAILABLE');
  });

  test('a directory at the default location is not mistaken for an archive', async () => {
    mkdirSync(join(workDir, 'data', 'kigali.pmtiles'), { recursive: true });

    const res = await request(app)
      .get('/api/map/kigali.pmtiles')
      .set('Cookie', cookie);

    expect(res.status).toBe(404);
  });

  test('still requires auth', async () => {
    placeAtDefaultRung(ARCHIVE);
    const res = await request(app).get('/api/map/kigali.pmtiles');
    expect(res.status).toBe(401);
  });
});

describe('Range requests over the served archive (MAP-TRUTH G3)', () => {
  beforeEach(() => {
    placeAtDefaultRung(ARCHIVE);
  });

  async function range(header: string) {
    return request(app)
      .get('/api/map/kigali.pmtiles')
      .set('Cookie', cookie)
      .set('Range', header)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
  }

  test('the 127-byte header range a pmtiles client asks for first', async () => {
    // This is literally the first request the reader makes.
    const res = await range('bytes=0-126');

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-126/${ARCHIVE.length}`);
    expect(res.headers['content-length']).toBe('127');
    expect(Buffer.compare(res.body as Buffer, ARCHIVE.subarray(0, 127))).toBe(0);
    expect((res.body as Buffer).subarray(0, 7).toString()).toBe('PMTiles');
  });

  test('an interior range returns exactly those bytes', async () => {
    const res = await range('bytes=10-19');
    expect(res.status).toBe(206);
    expect(Buffer.compare(res.body as Buffer, ARCHIVE.subarray(10, 20))).toBe(0);
  });

  test('an open-ended range runs to EOF', async () => {
    const res = await range(`bytes=${ARCHIVE.length - 5}-`);
    expect(res.status).toBe(206);
    expect(Buffer.compare(res.body as Buffer, ARCHIVE.subarray(ARCHIVE.length - 5))).toBe(0);
  });

  test('a suffix range returns the last n bytes', async () => {
    const res = await range('bytes=-4');
    expect(res.status).toBe(206);
    expect(Buffer.compare(res.body as Buffer, ARCHIVE.subarray(ARCHIVE.length - 4))).toBe(0);
  });

  test('a start past EOF is 416 with the total size', async () => {
    const res = await range(`bytes=${ARCHIVE.length + 10}-`);
    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe(`bytes */${ARCHIVE.length}`);
  });
});

describe('the served archive is readable by the client pmtiles reader (MAP-TRUTH G3)', () => {
  test('header, metadata and a tile all come back over byte ranges', async () => {
    placeAtDefaultRung(ARCHIVE);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PMTiles } = require('pmtiles');

    // A Source that fetches through the real route, so every read below
    // is an actual HTTP Range request answered by map.routes.ts.
    const source = {
      getKey: () => 'kigali.pmtiles',
      getBytes: async (offset: number, length: number) => {
        const res = await request(app)
          .get('/api/map/kigali.pmtiles')
          .set('Cookie', cookie)
          .set('Range', `bytes=${offset}-${offset + length - 1}`)
          .buffer(true)
          .parse((r, cb) => {
            const chunks: Buffer[] = [];
            r.on('data', (c: Buffer) => chunks.push(c));
            r.on('end', () => cb(null, Buffer.concat(chunks)));
          });
        expect(res.status).toBe(206);
        const buf = res.body as Buffer;
        return {
          data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        };
      },
    };

    const archive = new PMTiles(source);

    const header = await archive.getHeader();
    expect(header.maxZoom).toBe(14);
    expect(header.minZoom).toBe(0);
    // The Kigali bbox the builder clips to, back out of the served bytes.
    expect(header.minLon).toBeCloseTo(29.95, 4);
    expect(header.maxLat).toBeCloseTo(-1.83, 4);

    const metadata = await archive.getMetadata();
    expect(metadata).toMatchObject({ name: 'kigali', source: 'geofabrik:rwanda' });

    const tile = await archive.getZxy(14, 9559, 8280);
    expect(tile).not.toBeNull();
    expect(Buffer.from(tile!.data).toString()).toBe('tile-a-payload');

    // A tile outside the archive is a miss, not an error.
    expect(await archive.getZxy(14, 1, 1)).toBeUndefined();
  });
});

describe('resume validators (MAP-TRUTH G4)', () => {
  beforeEach(() => {
    placeAtDefaultRung(ARCHIVE);
  });

  async function get(headers: Record<string, string> = {}) {
    const req = request(app).get('/api/map/kigali.pmtiles').set('Cookie', cookie);
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    return req;
  }

  test('serves a strong validator the client can resume against', async () => {
    const res = await get();
    expect(res.headers.etag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    expect(res.headers['last-modified']).toBeDefined();
  });

  test('If-Range matching the ETag → 206, the remainder to append', async () => {
    const { headers } = await get();
    const etag = headers.etag as string;

    const res = await get({ 'If-Range': etag, Range: 'bytes=100-' });

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 100-${ARCHIVE.length - 1}/${ARCHIVE.length}`);
  });

  test('If-Range NOT matching → 200 with the whole file, not a splice', async () => {
    // The archive changed under a paused download. Honouring the Range
    // here would append new bytes to old ones and produce a corrupt
    // archive that still looks the right size.
    const res = await get({ 'If-Range': '"stale-validator"', Range: 'bytes=100-' });

    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(ARCHIVE.length));
    expect(res.headers['content-range']).toBeUndefined();
  });

  test('the ETag changes when the archive changes', async () => {
    const before = (await get()).headers.etag;
    // A new bundle lands with different contents.
    placeAtDefaultRung(Buffer.concat([ARCHIVE, Buffer.from('MORE')]));
    const after = (await get()).headers.etag;

    expect(after).not.toBe(before);
  });
});
