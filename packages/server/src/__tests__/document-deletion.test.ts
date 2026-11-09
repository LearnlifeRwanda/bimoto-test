// DOC-GUARD G5 — the erasure paths, which opaque keys could have
// silently broken.
//
// docs/data-retention.md promises that account deletion hard-deletes a
// driver's verification files. That promise used to be kept by removing
// the directory `uploads/verification/<userId>`, which the naming
// scheme guaranteed was where they were. Documents are now uuids in a
// flat directory, so that `rmSync` would have kept succeeding while
// deleting nothing at all — the worst kind of regression, because the
// endpoint would still have answered 200.

// ACCOUNT-RIGHTS-CORE G3 — the document sweep moved from the route into
// account-deletion.service's executeErasure, because the erasure is now
// one transaction that runs when the 72-hour window closes rather than
// inline on the DELETE. The DOC-GUARD promise this file exists to defend
// is unchanged and still asserted below: the sweep follows the URL
// columns, reads them BEFORE the anonymisation nulls them, and still
// removes the pre-dispatch directory. Only the caller moved.
jest.mock('../prisma', () => {
  const db: any = {
    user: {
      findUnique: jest.fn(async () => ({
        id: '77777777-7777-4777-8777-777777777777',
        frozenAt: null,
        phoneHash: 'hash-of-the-original-number',
        suspendedUntil: null,
      })),
      update: jest.fn(),
    },
    driverProfile: { findUnique: jest.fn(), updateMany: jest.fn() },
    accountTombstone: { upsert: jest.fn(async () => ({ deletionCount: 1 })) },
    deviceToken: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    otpCode: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    refreshToken: { updateMany: jest.fn(async () => ({ count: 0 })) },
    deletionRequest: {
      findFirst: jest.fn(async () => null),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  db.$transaction = jest.fn(async (cb: any) => cb(db));
  return { __esModule: true, default: db };
});

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
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import { _resetAuthStatusCacheForTests } from '../middleware/auth';
import {
  deleteDocumentsForUrls,
  deleteLegacyVerificationDir,
} from '../services/document-deletion.service';
import { DOCUMENT_DIR, UPLOAD_ROOT, documentUrl } from '../utils/document-store';
import { executeErasure } from '../services/account-deletion.service';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/users', userRoutes);
app.use(errorHandler);

const DRIVER = '77777777-7777-4777-8777-777777777777';
const token = generateAccessToken({ userId: DRIVER, role: 'DRIVER' });

const KEYS = [
  '0a000000-0000-4000-8000-000000000001',
  '0a000000-0000-4000-8000-000000000002',
  '0a000000-0000-4000-8000-000000000003',
];

function writeDocs(): string[] {
  fs.mkdirSync(DOCUMENT_DIR, { recursive: true });
  for (const k of KEYS) fs.writeFileSync(path.join(DOCUMENT_DIR, k), Buffer.from('doc'));
  return KEYS.map((k) => path.join(DOCUMENT_DIR, k));
}

const LEGACY_DIR = path.join(UPLOAD_ROOT, 'verification', DRIVER);

beforeEach(() => {
  jest.clearAllMocks();
  _resetAuthStatusCacheForTests();
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ frozenAt: null });
  (prisma.user.update as jest.Mock).mockResolvedValue({});
  (prisma.driverProfile.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
});

afterEach(() => {
  for (const k of KEYS) fs.rmSync(path.join(DOCUMENT_DIR, k), { force: true });
  fs.rmSync(LEGACY_DIR, { recursive: true, force: true });
});

describe('deleteDocumentsForUrls', () => {
  it('deletes the files behind stored URLs', () => {
    const paths = writeDocs();

    const deleted = deleteDocumentsForUrls(KEYS.map(documentUrl));

    expect(deleted).toBe(3);
    for (const p of paths) expect(fs.existsSync(p)).toBe(false);
  });

  it('is idempotent and survives nulls and unknown shapes', () => {
    writeDocs();
    const urls = [documentUrl(KEYS[0]), null, undefined, '/not/a/document/url'];

    expect(() => deleteDocumentsForUrls(urls)).not.toThrow();
    // Running it again on an already-deleted file must not throw either.
    expect(() => deleteDocumentsForUrls(urls)).not.toThrow();
    expect(fs.existsSync(path.join(DOCUMENT_DIR, KEYS[0]))).toBe(false);
  });

  it('deletes a pre-dispatch file through its legacy URL too', () => {
    fs.mkdirSync(LEGACY_DIR, { recursive: true });
    const legacyFile = path.join(LEGACY_DIR, 'driving-license.jpg');
    fs.writeFileSync(legacyFile, Buffer.from('old scan'));

    deleteDocumentsForUrls([`/uploads/verification/${DRIVER}/driving-license.jpg`]);

    expect(fs.existsSync(legacyFile)).toBe(false);
  });
});

describe('deleteLegacyVerificationDir', () => {
  it('removes the pre-dispatch per-user directory when it is still there', () => {
    fs.mkdirSync(LEGACY_DIR, { recursive: true });
    fs.writeFileSync(path.join(LEGACY_DIR, 'insurance.pdf'), Buffer.from('x'));

    deleteLegacyVerificationDir(DRIVER);

    expect(fs.existsSync(LEGACY_DIR)).toBe(false);
  });

  it('is a no-op when there is nothing there', () => {
    expect(() => deleteLegacyVerificationDir(DRIVER)).not.toThrow();
  });
});

describe('executeErasure — the erasure that DELETE /api/users/me now schedules', () => {
  it("erases the driver's documents from disk, following the URL columns", async () => {
    const paths = writeDocs();
    (prisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
      drivingLicensePhotoUrl: documentUrl(KEYS[0]),
      ruraAuthorizationPhotoUrl: documentUrl(KEYS[1]),
      insurancePhotoUrl: documentUrl(KEYS[2]),
    });

    await executeErasure(DRIVER);

    for (const p of paths) expect(fs.existsSync(p)).toBe(false);
  });

  it('reads the URLs BEFORE the anonymization nulls them', async () => {
    const paths = writeDocs();
    (prisma.driverProfile.findUnique as jest.Mock).mockResolvedValue({
      drivingLicensePhotoUrl: documentUrl(KEYS[0]),
      ruraAuthorizationPhotoUrl: null,
      insurancePhotoUrl: null,
    });

    await executeErasure(DRIVER);

    // The anonymization sets those columns to null. If the read came
    // after it, there would be no URL left to follow and the licence
    // would survive the erasure.
    const readOrder = (prisma.driverProfile.findUnique as jest.Mock).mock
      .invocationCallOrder[0];
    const writeOrder = (prisma.driverProfile.updateMany as jest.Mock).mock
      .invocationCallOrder[0];
    expect(readOrder).toBeLessThan(writeOrder);
    expect(fs.existsSync(paths[0])).toBe(false);
  });

  it('still removes the pre-dispatch directory as well', async () => {
    fs.mkdirSync(LEGACY_DIR, { recursive: true });
    fs.writeFileSync(path.join(LEGACY_DIR, 'driving-license.jpg'), Buffer.from('old'));
    (prisma.driverProfile.findUnique as jest.Mock).mockResolvedValue(null);

    await executeErasure(DRIVER);

    expect(fs.existsSync(LEGACY_DIR)).toBe(false);
  });

  it('succeeds for a customer with no driver profile at all', async () => {
    (prisma.driverProfile.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(executeErasure(DRIVER)).resolves.toEqual(
      expect.objectContaining({ documentUrls: [undefined, undefined, undefined] }),
    );
  });
});
