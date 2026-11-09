// DOC-GUARD G1/G2/G3 — the exposure, inverted.
//
// G1 wrote this file to pin what `main` (e67eb37) actually did:
//
//     app.use('/uploads', express.static('uploads'));   // index.ts:163
//
// with no middleware in front of it. Its three assertions were `200`,
// `200` and "the bytes on disk are the bytes uploaded". They are now
// `404`, `404` and "the bytes on disk are ciphertext" — same scenarios,
// opposite answers.
//
// The scenarios matter as much as the codes. An anonymous caller
// holding a real, currently-valid document URL — the licence of a
// motari whose profile row points at it — gets 404. Not 401, not 403:
// a distinguishable refusal would confirm that a driving licence exists
// at that address, which for identity documents is itself the leak.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn(async () => ({ frozenAt: null })) },
    driverProfile: { findFirst: jest.fn() },
    journey: { findFirst: jest.fn() },
  },
}));

jest.mock('../config', () => ({
  config: {
    DATABASE_URL: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16-chars',
    ENCRYPTION_KEY: 'a'.repeat(64),
    PORT: 3000,
    CLIENT_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
  },
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import prisma from '../prisma';
import documentRoutes from '../routes/document.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import { _resetAuthStatusCacheForTests } from '../middleware/auth';
import { encryptDocument } from '../utils/document-crypto';
import { DOCUMENT_DIR } from '../utils/document-store';

// The mount from index.ts, as the server declares it. Note what is NOT
// here: '/uploads' has no handler at all any more.
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/documents', documentRoutes);
app.use(errorHandler);

/** The route key for a pre-DOC-GUARD storage path. */
function legacyKey(storedUrl: string): string {
  return `legacy.${Buffer.from(storedUrl, 'utf8').toString('base64url')}`;
}

const OWNER_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const LICENCE_KEY = '11111111-2222-4333-8444-555555555555';
const LICENCE_URL = `/api/documents/${LICENCE_KEY}`;

// A real JPEG signature, so the route answers with a real content type.
const LICENCE_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('JFIF-the-scan-of-his-actual-driving-licence'),
]);

const ownerToken = generateAccessToken({ userId: OWNER_ID, role: 'DRIVER' });

beforeAll(() => {
  fs.mkdirSync(DOCUMENT_DIR, { recursive: true });
  fs.writeFileSync(path.join(DOCUMENT_DIR, LICENCE_KEY), encryptDocument(LICENCE_BYTES));
});

afterAll(() => {
  fs.rmSync(path.join(DOCUMENT_DIR, LICENCE_KEY), { force: true });
});

beforeEach(() => {
  jest.clearAllMocks();
  _resetAuthStatusCacheForTests();
  // The document exists and belongs to OWNER_ID.
  (prisma.driverProfile.findFirst as jest.Mock).mockResolvedValue({ userId: OWNER_ID });
  (prisma.journey.findFirst as jest.Mock).mockResolvedValue(null);
});

describe('DOC-GUARD — the G1 exposure, inverted', () => {
  it("refuses a motari's driving licence to a caller with no credentials", async () => {
    const res = await request(app).get(LICENCE_URL);

    // G1 asserted 200 here, and returned the bytes.
    expect(res.status).toBe(404);
    expect(res.body).toEqual({});
  });

  it('refuses a pre-DOC-GUARD document to an anonymous caller too', async () => {
    const res = await request(app).get(
      `/api/documents/${legacyKey(`/uploads/verification/${OWNER_ID}/driving-license.jpg`)}`,
    );

    expect(res.status).toBe(404);
  });

  it('has no handler on /uploads at all — the static mount is gone', async () => {
    // G1 asserted 200 on this exact path.
    const res = await request(app).get(
      `/uploads/verification/${OWNER_ID}/driving-license.jpg`,
    );

    expect(res.status).toBe(404);
  });

  it('refuses a legacy key naming a path no row claims', async () => {
    (prisma.driverProfile.findFirst as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/documents/${legacyKey('/uploads/verification/someone-else/insurance.jpg')}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // The key decodes fine; the database does not recognise it. Being
    // able to spell a path is not entitlement.
    expect(res.status).toBe(404);
  });

  it('refuses a key that tries to escape the upload root', async () => {
    (prisma.driverProfile.findFirst as jest.Mock).mockResolvedValue({ userId: OWNER_ID });

    for (const evil of [
      legacyKey('/uploads/../../etc/passwd'),
      legacyKey('/etc/passwd'),
      'not-a-uuid',
      'legacy.!!!not-base64!!!',
    ]) {
      const res = await request(app)
        .get(`/api/documents/${encodeURIComponent(evil)}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(404);
    }
  });

  it('still serves it to the motari it belongs to', async () => {
    const res = await request(app)
      .get(LICENCE_URL)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.body).toEqual(LICENCE_BYTES);
  });

  it('stores the licence on disk as ciphertext — a stolen laptop reads nothing', () => {
    const onDisk = fs.readFileSync(path.join(DOCUMENT_DIR, LICENCE_KEY));

    // G1 asserted these were equal.
    expect(onDisk).not.toEqual(LICENCE_BYTES);
    expect(onDisk.includes(Buffer.from('JFIF-the-scan-of-his-actual-driving-licence'))).toBe(
      false,
    );
    // And it is our envelope, not some other accident.
    expect(onDisk.subarray(0, 12).toString('ascii')).toBe('BIMOTO-DOC-1');
  });
});
