// DOC-GUARD G5 — the authorisation matrix, one case per cell.
//
// The mission's first half is a claim about who can see a motari's
// identity documents: "himself, the admin who reviews him, and nobody
// else". This is that claim, enumerated.
//
// Every refusal asserts 404 rather than 403 on purpose. A caller who
// can tell "exists but forbidden" from "does not exist" can enumerate
// which userIds are drivers by probing document URLs, which is the
// leak the status code itself would create.

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

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/documents', documentRoutes);
app.use(errorHandler);

const DRIVER = '11111111-1111-4111-8111-111111111111';
const OTHER_DRIVER = '22222222-2222-4222-8222-222222222222';
const CUSTOMER = '33333333-3333-4333-8333-333333333333';
const OTHER_CUSTOMER = '44444444-4444-4444-8444-444444444444';
const ADMIN = '55555555-5555-4555-8555-555555555555';

const KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const URL = `/api/documents/${KEY}`;
const BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('the document')]);

const tokens = {
  driver: generateAccessToken({ userId: DRIVER, role: 'DRIVER' }),
  otherDriver: generateAccessToken({ userId: OTHER_DRIVER, role: 'DRIVER' }),
  customer: generateAccessToken({ userId: CUSTOMER, role: 'CUSTOMER' }),
  otherCustomer: generateAccessToken({ userId: OTHER_CUSTOMER, role: 'CUSTOMER' }),
  admin: generateAccessToken({ userId: ADMIN, role: 'ADMIN' }),
};

function get(token?: string) {
  const req = request(app).get(URL);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
}

/** The document is a verification document belonging to DRIVER. */
function asVerificationDocument() {
  (prisma.driverProfile.findFirst as jest.Mock).mockResolvedValue({ userId: DRIVER });
  (prisma.journey.findFirst as jest.Mock).mockResolvedValue(null);
}

/** The document is a photo on a journey between CUSTOMER and DRIVER. */
function asJourneyPhoto() {
  (prisma.driverProfile.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.journey.findFirst as jest.Mock).mockResolvedValue({
    customerId: CUSTOMER,
    driverId: DRIVER,
  });
}

beforeAll(() => {
  fs.mkdirSync(DOCUMENT_DIR, { recursive: true });
  fs.writeFileSync(path.join(DOCUMENT_DIR, KEY), encryptDocument(BYTES));
});

afterAll(() => {
  fs.rmSync(path.join(DOCUMENT_DIR, KEY), { force: true });
});

beforeEach(() => {
  jest.clearAllMocks();
  _resetAuthStatusCacheForTests();
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ frozenAt: null });
});

describe('a verification document', () => {
  beforeEach(asVerificationDocument);

  it('is served to the motari it belongs to', async () => {
    const res = await get(tokens.driver);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(BYTES);
  });

  it('is served to an admin — this is the review surface', async () => {
    const res = await get(tokens.admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(BYTES);
  });

  it('is refused to another driver', async () => {
    expect((await get(tokens.otherDriver)).status).toBe(404);
  });

  it('is refused to a customer — including one he has carried', async () => {
    // A customer learns driverId from any journey they were matched to.
    // That is precisely the attack the old URL scheme enabled.
    expect((await get(tokens.customer)).status).toBe(404);
  });

  it('is refused to an anonymous caller', async () => {
    expect((await get()).status).toBe(404);
  });

  it('is refused to a caller with a garbage token', async () => {
    expect((await get('not-a-jwt')).status).toBe(404);
  });

  it('is refused to a frozen account', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ frozenAt: new Date() });
    expect((await get(tokens.driver)).status).toBe(404);
  });

  it('never distinguishes a stranger from a document that does not exist', async () => {
    const stranger = await get(tokens.otherDriver);

    (prisma.driverProfile.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.journey.findFirst as jest.Mock).mockResolvedValue(null);
    const missing = await get(tokens.otherDriver);

    expect(stranger.status).toBe(missing.status);
    expect(stranger.text).toBe(missing.text);
    expect(stranger.headers['content-type']).toBe(missing.headers['content-type']);
  });
});

describe("a journey's pickup/delivery photo", () => {
  beforeEach(asJourneyPhoto);

  it('is served to that journey\'s customer', async () => {
    expect((await get(tokens.customer)).status).toBe(200);
  });

  it('is served to that journey\'s driver', async () => {
    expect((await get(tokens.driver)).status).toBe(200);
  });

  it('is served to an admin — the conflict resolver compares the two', async () => {
    expect((await get(tokens.admin)).status).toBe(200);
  });

  it('is refused to a customer on a different journey', async () => {
    expect((await get(tokens.otherCustomer)).status).toBe(404);
  });

  it('is refused to a driver who did not carry it', async () => {
    expect((await get(tokens.otherDriver)).status).toBe(404);
  });

  it('is refused to an anonymous caller', async () => {
    expect((await get()).status).toBe(404);
  });

  it('does not treat a journey with no driver as readable by everyone', async () => {
    // driverId is null on an unmatched journey. A null must never widen
    // the grant — filtering it out is what stops that.
    (prisma.journey.findFirst as jest.Mock).mockResolvedValue({
      customerId: CUSTOMER,
      driverId: null,
    });

    expect((await get(tokens.otherDriver)).status).toBe(404);
    expect((await get(tokens.customer)).status).toBe(200);
  });
});

describe('the response itself', () => {
  beforeEach(asVerificationDocument);

  it('is never cached by a proxy or a shared disk cache', async () => {
    const res = await get(tokens.driver);
    expect(res.headers['cache-control']).toBe('private, no-store, max-age=0');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('reports the type read from the decrypted bytes, not from a stored claim', async () => {
    const res = await get(tokens.driver);
    expect(res.headers['content-type']).toBe('image/jpeg');
  });

  it('refuses when the row survived but the file is gone', async () => {
    (prisma.driverProfile.findFirst as jest.Mock).mockResolvedValue({ userId: DRIVER });

    const res = await request(app)
      .get('/api/documents/ffffffff-ffff-4fff-8fff-ffffffffffff')
      .set('Authorization', `Bearer ${tokens.driver}`);

    expect(res.status).toBe(404);
  });
});
