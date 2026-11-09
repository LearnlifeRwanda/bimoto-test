// __TESTS__/MAP-ROUTES.TEST.TS
//
// MAP-CACHE G1 — offline Kigali extract endpoint:
//   - clean 404 MAP_NOT_AVAILABLE when MAP_PMTILES_PATH is unset
//   - clean 404 when the path points at a missing file (server without
//     the ops bundle — the client must degrade to online tiles)
//   - full-file 200 with Content-Length and Accept-Ranges
//   - 206 partial responses for the byte-range forms pmtiles clients send
//   - 416 for unsatisfiable ranges
//   - parseByteRange unit coverage

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  },
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import mapRoutes, { parseByteRange } from '../routes/map.routes';
import { generateAccessToken } from '../utils/jwt';
import { config } from '../config';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/map', mapRoutes);

const cfg = config as { MAP_PMTILES_PATH: string };
const customerToken = generateAccessToken({ userId: 'cust-1', role: 'CUSTOMER' });

const CONTENT = Buffer.from('PMTiles-test-archive-0123456789');
let dir: string;
let filePath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bimoto-map-'));
  filePath = join(dir, 'kigali.pmtiles');
  writeFileSync(filePath, CONTENT);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  cfg.MAP_PMTILES_PATH = '';
});

describe('GET /api/map/kigali.pmtiles', () => {
  test('401 without a token', async () => {
    cfg.MAP_PMTILES_PATH = filePath;
    const res = await request(app).get('/api/map/kigali.pmtiles');
    expect(res.status).toBe(401);
  });

  test('404 MAP_NOT_AVAILABLE when MAP_PMTILES_PATH is unset', async () => {
    const res = await request(app)
      .get('/api/map/kigali.pmtiles')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({
      code: 'MAP_NOT_AVAILABLE',
      message: 'errors.mapNotAvailable',
    });
  });

  test('404 MAP_NOT_AVAILABLE when the file does not exist', async () => {
    cfg.MAP_PMTILES_PATH = join(dir, 'does-not-exist.pmtiles');
    const res = await request(app)
      .get('/api/map/kigali.pmtiles')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MAP_NOT_AVAILABLE');
  });

  test('streams the whole file with size headers when no Range is sent', async () => {
    cfg.MAP_PMTILES_PATH = filePath;
    const res = await request(app)
      .get('/api/map/kigali.pmtiles')
      .set('Authorization', `Bearer ${customerToken}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-length']).toBe(String(CONTENT.length));
    expect(Buffer.compare(res.body as Buffer, CONTENT)).toBe(0);
  });

  test('206 partial content for bytes=a-b', async () => {
    cfg.MAP_PMTILES_PATH = filePath;
    const res = await request(app)
      .get('/api/map/kigali.pmtiles')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Range', 'bytes=0-6')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-6/${CONTENT.length}`);
    expect(res.headers['content-length']).toBe('7');
    expect((res.body as Buffer).toString()).toBe('PMTiles');
  });

  test('206 open-ended range bytes=a-', async () => {
    cfg.MAP_PMTILES_PATH = filePath;
    const res = await request(app)
      .get('/api/map/kigali.pmtiles')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Range', `bytes=${CONTENT.length - 10}-`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(206);
    expect(res.headers['content-length']).toBe('10');
    expect((res.body as Buffer).toString()).toBe(CONTENT.subarray(CONTENT.length - 10).toString());
  });

  test('416 for a start beyond EOF', async () => {
    cfg.MAP_PMTILES_PATH = filePath;
    const res = await request(app)
      .get('/api/map/kigali.pmtiles')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Range', `bytes=${CONTENT.length + 5}-`);
    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe(`bytes */${CONTENT.length}`);
  });
});

describe('parseByteRange', () => {
  test('plain range and end clamping', () => {
    expect(parseByteRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange('bytes=10-999', 100)).toEqual({ start: 10, end: 99 });
  });

  test('open-ended and suffix forms', () => {
    expect(parseByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
  });

  test('unusable forms are null', () => {
    expect(parseByteRange('bytes=100-', 100)).toBeNull(); // start at EOF
    expect(parseByteRange('bytes=20-10', 100)).toBeNull(); // inverted
    expect(parseByteRange('bytes=-', 100)).toBeNull();
    expect(parseByteRange('bytes=-0', 100)).toBeNull();
    expect(parseByteRange('bytes=0-10,20-30', 100)).toBeNull(); // multi-range
    expect(parseByteRange('items=0-10', 100)).toBeNull();
  });
});
