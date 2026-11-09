// DOC-GUARD G5 — what the upload paths accept, and what they do with it.
//
// The check being replaced tested `file.mimetype`, the Content-Type the
// uploading client writes into its own multipart part header. These
// tests send a payload whose header says one thing and whose bytes say
// another, which is the only interesting case and the one the old
// filter always passed.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn(async () => ({ frozenAt: null })) },
    driverProfile: { findUnique: jest.fn(), update: jest.fn() },
    journey: { findUnique: jest.fn(), update: jest.fn() },
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
import userRoutes from '../routes/user.routes';
import uploadRoutes from '../routes/upload.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import { _resetAuthStatusCacheForTests } from '../middleware/auth';
import { isEncryptedDocument, decryptDocument } from '../utils/document-crypto';
import { DOCUMENT_DIR } from '../utils/document-store';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/users', userRoutes);
app.use('/api/journeys', uploadRoutes);
app.use(errorHandler);

const DRIVER = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = '33333333-3333-4333-8333-333333333333';
const JOURNEY = '99999999-9999-4999-8999-999999999999';

const driverToken = generateAccessToken({ userId: DRIVER, role: 'DRIVER' });

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('real jpeg')]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('real png'),
]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x1a, 0, 0, 0]),
  Buffer.from('WEBP'),
  Buffer.from('real webp'),
]);
const PDF = Buffer.from('%PDF-1.4\na licence from a scanner app\n');
const EXECUTABLE = Buffer.from('MZ\x90\x00a windows binary calling itself a jpeg');

const written: string[] = [];

function trackWritten(url: string | undefined): void {
  if (url) written.push(path.join(DOCUMENT_DIR, path.basename(url)));
}

afterAll(() => {
  for (const f of written) fs.rmSync(f, { force: true });
});

beforeEach(() => {
  jest.clearAllMocks();
  _resetAuthStatusCacheForTests();
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ frozenAt: null });
  (prisma.driverProfile.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.driverProfile.update as jest.Mock).mockResolvedValue({});
  (prisma.journey.findUnique as jest.Mock).mockResolvedValue({
    id: JOURNEY,
    customerId: CUSTOMER,
    driverId: DRIVER,
    pickupPhotoUrl: null,
    deliveryPhotoUrl: null,
  });
  (prisma.journey.update as jest.Mock).mockResolvedValue({});
});

function uploadVerification(bytes: Buffer, claimedType: string) {
  return request(app)
    .post('/api/users/me/driver-verification/upload/driving-license')
    .set('Authorization', `Bearer ${driverToken}`)
    .attach('document', bytes, { filename: 'doc', contentType: claimedType });
}

function uploadPickupPhoto(bytes: Buffer, claimedType: string) {
  return request(app)
    .post(`/api/journeys/${JOURNEY}/upload/pickup-photo`)
    .set('Authorization', `Bearer ${driverToken}`)
    .attach('photo', bytes, { filename: 'photo', contentType: claimedType });
}

describe('a verification document', () => {
  it.each([
    ['JPEG', JPEG],
    ['PNG', PNG],
    ['PDF — the scanner-app case', PDF],
  ])('accepts %s', async (_label, bytes) => {
    const res = await uploadVerification(bytes, 'image/jpeg');
    trackWritten(res.body.url);

    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(
      /^\/api\/documents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('rejects WebP — the accepted set is unchanged from before', async () => {
    const res = await uploadVerification(WEBP, 'image/webp');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('rejects an executable that claims to be a JPEG', async () => {
    // The old fileFilter passed this: the header said image/jpeg and
    // the header was the whole check.
    const res = await uploadVerification(EXECUTABLE, 'image/jpeg');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(prisma.driverProfile.update).not.toHaveBeenCalled();
  });

  it('writes ciphertext, never the uploaded bytes', async () => {
    const res = await uploadVerification(JPEG, 'image/jpeg');
    trackWritten(res.body.url);

    const onDisk = fs.readFileSync(
      path.join(DOCUMENT_DIR, path.basename(res.body.url)),
    );

    expect(isEncryptedDocument(onDisk)).toBe(true);
    expect(onDisk.includes(Buffer.from('real jpeg'))).toBe(false);
    expect(decryptDocument(onDisk)).toEqual(JPEG);
  });

  it('records the opaque URL on the right profile column', async () => {
    const res = await uploadVerification(PDF, 'application/pdf');
    trackWritten(res.body.url);

    expect(prisma.driverProfile.update).toHaveBeenCalledWith({
      where: { userId: DRIVER },
      data: { drivingLicensePhotoUrl: res.body.url },
    });
  });

  it('deletes the document it supersedes', async () => {
    const first = await uploadVerification(JPEG, 'image/jpeg');
    const firstPath = path.join(DOCUMENT_DIR, path.basename(first.body.url));
    trackWritten(first.body.url);
    expect(fs.existsSync(firstPath)).toBe(true);

    // The profile now points at the first document.
    (prisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
      drivingLicensePhotoUrl: first.body.url,
    });

    const second = await uploadVerification(PNG, 'image/png');
    trackWritten(second.body.url);

    // Opaque keys mean a replacement no longer overwrites in place, so
    // the old file would otherwise sit on disk forever — unreadable
    // through the route and invisible to the account-deletion erasure,
    // which follows the URL columns.
    expect(fs.existsSync(firstPath)).toBe(false);
    expect(
      fs.existsSync(path.join(DOCUMENT_DIR, path.basename(second.body.url))),
    ).toBe(true);
  });
});

// SUPPLY-CHAIN G5 — the multer 1.x -> 2.x boundary.
//
// multer 1.4.5-lts is deprecated/EOL and no longer receives fixes, and
// it sits on the KYC-document and parcel-photo upload paths. The used
// API surface is three things and nothing else — `multer({storage,
// limits})`, `memoryStorage()`, `.single(field)` — plus `req.file.buffer`
// downstream: no fileFilter, no diskStorage, no `req.files`, and no
// MulterError branch anywhere in the repo. All three are unchanged in
// 2.x, which is why the bump was safe to take.
//
// The one option whose *behaviour* (not just its shape) could have
// differed is `limits.fileSize`, and nothing exercised it. It is pinned
// here, and a future multer bump that silently alters the shape still
// fails here.
//
// VALIDATE-MEND G4 — the deliberate change these two pins were written
// to make deliberate.
//
// What they pinned before was `500 INTERNAL_ERROR`: with no MulterError
// branch anywhere in the repo, LIMIT_FILE_SIZE fell through to the
// generic error handler and a motari whose licence photo was too large
// read a server fault. #186 measured that on both multer majors —
// 1.4.5-lts.2 and 2.x return the same 500, which is what made the
// migration provably behaviour-preserving — and said in as many words
// that an honest status code belongs to its own dispatch. This is that
// dispatch. middleware/error-handler.ts now answers 413 FILE_TOO_LARGE,
// and what the pins guard is unchanged in kind: the limit is still
// enforced before the route body, so nothing is encrypted and nothing
// is written.
describe('an upload larger than the 10 MB limit', () => {
  const OVERSIZE = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(11 * 1024 * 1024, 0x41),
  ]);

  it('is refused on the KYC document path, and nothing is stored', async () => {
    const before = fs.existsSync(DOCUMENT_DIR) ? fs.readdirSync(DOCUMENT_DIR).length : 0;

    const res = await uploadVerification(OVERSIZE, 'image/jpeg');

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    // The message is an i18n key, so the client's error presenter
    // renders it as words instead of falling back to the generic
    // "not accepted" — a 413 is a REJECTED, not a SERVER, error.
    expect(res.body.error.message).toBe('errors.fileTooLarge');
    // The limit is enforced before the route body runs, so the
    // encryption path is never entered and no ciphertext is written.
    expect(prisma.driverProfile.update).not.toHaveBeenCalled();
    const after = fs.existsSync(DOCUMENT_DIR) ? fs.readdirSync(DOCUMENT_DIR).length : 0;
    expect(after).toBe(before);
  });

  it('is refused on the journey photo path too', async () => {
    const res = await uploadPickupPhoto(OVERSIZE, 'image/jpeg');

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(prisma.journey.update).not.toHaveBeenCalled();
  });
});

// VALIDATE-MEND G4 — the other half of the branch. LIMIT_FILE_SIZE is
// the case the field hit, but it is not the only MulterError, and the
// rest were falling through to the same 500. A malformed multipart
// request is the caller's, not the server's: 400, carrying multer's own
// code so a log names the real cause rather than "INTERNAL_ERROR".
describe('an upload multer rejects for a reason other than size', () => {
  const JPEG_BYTES = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from('small enough'),
  ]);

  it('answers 400 with multer\'s code, not 500', async () => {
    // The field name the route did not ask for — what a client sends
    // when its form and the API disagree.
    const res = await request(app)
      .post('/api/users/me/driver-verification/upload/driving-license')
      .set('Authorization', `Bearer ${driverToken}`)
      .attach('wrongFieldName', JPEG_BYTES, { filename: 'doc', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LIMIT_UNEXPECTED_FILE');
    expect(prisma.driverProfile.update).not.toHaveBeenCalled();
  });
});

describe('a journey pickup photo', () => {
  it.each([
    ['JPEG', JPEG],
    ['PNG', PNG],
    ['WebP', WEBP],
  ])('accepts %s', async (_label, bytes) => {
    const res = await uploadPickupPhoto(bytes, 'image/jpeg');
    trackWritten(res.body.url);
    expect(res.status).toBe(200);
  });

  it('rejects a PDF — a pickup photograph is a photograph', async () => {
    // The boundary that differs from verification documents.
    const res = await uploadPickupPhoto(PDF, 'image/jpeg');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(prisma.journey.update).not.toHaveBeenCalled();
  });

  it('rejects an executable that claims to be a JPEG', async () => {
    const res = await uploadPickupPhoto(EXECUTABLE, 'image/jpeg');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('still refuses a caller who is not a party to the journey', async () => {
    (prisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: JOURNEY,
      customerId: 'someone-else',
      driverId: 'another-driver',
      pickupPhotoUrl: null,
    });

    const res = await uploadPickupPhoto(JPEG, 'image/jpeg');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_JOURNEY_PARTICIPANT');
  });
});
