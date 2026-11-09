// VALIDATE-MEND G2 — PUT /api/users/me, the route that had no schema.
//
// Two things are proved here and nothing else. First, that garbage never
// reaches encrypt(): the whole point is that validation sits BEFORE the
// write, because after encrypt() the value is opaque and utils/dialable
// only recognises the ciphertext SHAPE, which is a different question.
// Second — and this is the part that could break a screen nobody
// checked — that every payload shape a caller sends today still passes.
// The census is in the PR body; each row has a case below.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn(), update: jest.fn() },
    // ACCOUNT-RIGHTS-CORE G2 — GET /me now reports a pending deletion
    // request alongside the profile. No request pending in these
    // fixtures, so the field reads null and the contract this file
    // asserts (emergency-contact validation) is untouched.
    deletionRequest: { findFirst: jest.fn(async () => null) },
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
import prisma from '../prisma';
import userRoutes from '../routes/user.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';
import { _resetAuthStatusCacheForTests } from '../middleware/auth';
import { encrypt } from '../utils/crypto';
import { parseEmergencyContacts } from '../services/user.service';
import { assertDialable } from '../utils/dialable';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/users', userRoutes);
app.use(errorHandler);

const USER = '11111111-1111-4111-8111-111111111111';
const token = generateAccessToken({ userId: USER, role: 'CUSTOMER' });

const ROW = {
  id: USER,
  role: 'CUSTOMER',
  frozenAt: null,
  nickname: 'Aline',
  language: 'rw',
  phoneEncrypted: encrypt('+250788000111'),
  emergencyContactsEncrypted: null as string | null,
};

beforeEach(() => {
  jest.clearAllMocks();
  _resetAuthStatusCacheForTests();
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...ROW });
  (prisma.user.update as jest.Mock).mockImplementation(async ({ data }) => ({
    ...ROW,
    ...data,
    driverProfile: null,
  }));
});

const put = (body: object) =>
  request(app).put('/api/users/me').set('Cookie', [`accessToken=${token}`]).send(body);

/** What the route actually asked prisma to encrypt, decrypted back. */
function storedContacts(): string[] {
  const call = (prisma.user.update as jest.Mock).mock.calls[0][0];
  return parseEmergencyContacts(call.data.emergencyContactsEncrypted);
}

describe('an emergency contact that is not a phone number', () => {
  it('is refused, and NOTHING is written', async () => {
    // The field report: "mama" went in, was encrypted, and sat there
    // undialable until the one moment it mattered.
    const res = await put({ emergencyContacts: ['mama'] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('takes the whole list down with it — a partial save would be worse', async () => {
    const res = await put({ emergencyContacts: ['0788123456', 'KG 7 Ave'] });
    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('carries the reason as an i18n key the client can render', async () => {
    const res = await put({ emergencyContacts: ['mama'] });
    const messages = (res.body.error.details as { message: string }[]).map((d) => d.message);
    expect(messages).toContain('errors.invalidEmergencyContact');
  });

  it('refuses more than the cap', async () => {
    const res = await put({
      emergencyContacts: ['0788123451', '0788123452', '0788123453', '0788123454'],
    });
    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('a real number', () => {
  it('is accepted and stored in the dialable E.164 form', async () => {
    const res = await put({ emergencyContacts: ['0788 123 456'] });

    expect(res.status).toBe(200);
    const stored = storedContacts();
    expect(stored).toEqual(['+250788123456']);
    // The stored form must survive the last line of defence on the SOS
    // path: sms.service refuses anything shaped like ciphertext.
    for (const s of stored) expect(() => assertDialable(s, 'test')).not.toThrow();
  });

  it('accepts an international contact', async () => {
    const res = await put({ emergencyContacts: ['+44 7700 900123'] });
    expect(res.status).toBe(200);
    expect(storedContacts()).toEqual(['+447700900123']);
  });

  it('accepts an empty list — that is how the last contact is removed', async () => {
    const res = await put({ emergencyContacts: [] });
    expect(res.status).toBe(200);
    expect(storedContacts()).toEqual([]);
  });
});

describe('every payload shape a caller sends today still passes', () => {
  it('ProfilePage saving a nickname', async () => {
    expect((await put({ nickname: 'Aline' })).status).toBe(200);
  });

  it('RegisterPage sending nickname + role + language together', async () => {
    expect((await put({ nickname: 'Aline', role: 'DRIVER', language: 'rw' })).status).toBe(200);
  });

  it('a role change on its own', async () => {
    expect((await put({ role: 'BOTH' })).status).toBe(200);
  });

  it('a language change on its own', async () => {
    expect((await put({ language: 'fr' })).status).toBe(200);
  });

  it('an empty body', async () => {
    expect((await put({})).status).toBe(200);
  });

  it('a role nobody may self-assign still gets its OWN honest answer', async () => {
    // Not VALIDATION_ERROR. e2e/field-fit.spec.ts asserts this code by
    // name, and the schema is deliberately shaped so the service keeps
    // the authority on which roles a person may claim.
    const res = await put({ role: 'ADMIN' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ROLE_NOT_SELF_ASSIGNABLE');
  });
});

describe('contacts stored before this rule existed', () => {
  it('are read back unchanged — validation is a WRITE-time rule only', async () => {
    // No migration, nothing re-validated. A row holding "mama" keeps
    // showing "mama" until the person next edits their list.
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...ROW,
      emergencyContactsEncrypted: encrypt(JSON.stringify(['mama', '0788123456'])),
    });

    const res = await request(app)
      .get('/api/users/me')
      .set('Cookie', [`accessToken=${token}`]);

    expect(res.status).toBe(200);
    expect(res.body.emergencyContacts).toEqual(['mama', '0788123456']);
  });
});
