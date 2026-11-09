// CUTGUARD v2 G1 — the two wire responses, over HTTP.
//
// The serializer test asserts the FUNCTION. This one asserts what a
// phone actually receives, because that is where B-1 happened: `getMe`
// was serialized and `verifyOtp` was not, and no test looked at both
// responses side by side and asked whether they agreed.
//
// So the load-bearing assertion here is the COMPARISON — the login user
// and the /me user carry the same key set. B-1 was exactly the failure
// of that equality, and nothing in the suite could see it.

jest.mock('../prisma', () => {
  const db: any = {
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    accountTombstone: { findUnique: jest.fn(async () => null) },
    refreshToken: { create: jest.fn(async () => ({})), findUnique: jest.fn(async () => null) },
    deletionRequest: { findFirst: jest.fn(async () => null) },
    otpCode: {
      create: jest.fn(async () => ({})),
      findFirst: jest.fn(),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
  };
  return { __esModule: true, default: db };
});

jest.mock('../services/otp.service', () => ({
  sendLoginOtp: jest.fn(async () => ({ testOnlyCode: '123456' })),
  verifyLoginOtp: jest.fn(async () => ({ verified: true })),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import authRoutes from '../routes/auth.routes';
import userRoutes from '../routes/user.routes';
import { errorHandler } from '../middleware/error-handler';
import { _resetAuthStatusCacheForTests } from '../middleware/auth';
import { generateAccessToken } from '../utils/jwt';
import { encrypt } from '../utils/crypto';
import { CLIENT_USER_KEYS } from '../services/client-user';

const db = prisma as any;

const USER_ID = '33333333-3333-4333-8333-333333333333';
const PHONE = '+250788444555';
const CONTACTS = ['+250788111222', '+250788333444'];

/** A pre-existing rider with real emergency contacts and a real motari profile. */
function existingUser() {
  return {
    id: USER_ID,
    phoneEncrypted: encrypt(PHONE),
    phoneHash: 'the-phone-hash',
    nickname: 'Mukamana',
    role: 'BOTH',
    language: 'rw',
    idVerified: true,
    licenseVerified: true,
    emergencyContactsEncrypted: encrypt(JSON.stringify(CONTACTS)),
    completedRides: 9,
    cancellationCount: 1,
    totalRequests: 11,
    createdAt: new Date('2026-03-01T00:00:00Z'),
    updatedAt: new Date('2026-08-20T00:00:00Z'),
    privacyConsentAt: new Date('2026-03-01T00:00:00Z'),
    privacyConsentVersion: '1',
    termsAcceptedAt: new Date('2026-03-01T00:00:00Z'),
    termsAcceptedVersion: '1',
    driverTermsAcceptedAt: new Date('2026-03-02T00:00:00Z'),
    driverTermsVersion: '1',
    isDeleted: false,
    frozenAt: null,
    disputeCount: 0,
    disputeRate: 0,
    isFlagged: false,
    flagReason: null,
    moneyPinHash: 'hmac-of-the-pin',
    moneyPinPendingHash: null,
    moneyPinPendingActivatesAt: null,
    moneyPinAttempts: 0,
    moneyPinLockedUntil: null,
    suspendedUntil: null,
    payoutPreference: 'AT_SHIFT_END',
    completedShifts: 2,
    smsOptOut: false,
    cooperativeId: null,
    driverProfile: {
      id: 'dp-1',
      userId: USER_ID,
      vehicleType: 'MOTO',
      registrationPlate: 'RAC456B',
      vehicleDescription: 'Blue Bajaj',
      avgRating: 4.6,
      totalRides: 9,
      isOnline: false,
      lastLat: null,
      lastLng: null,
      lastLocationAt: null,
      drivingLicenseNumber: 'DL-77',
      ruraAuthorizationNumber: 'RURA-77',
      cooperativeName: null,
      insuranceConfirmed: true,
      verificationStatus: 'VERIFIED',
      drivingLicensePhotoUrl: '/uploads/l.jpg',
      ruraAuthorizationPhotoUrl: '/uploads/r.jpg',
      insurancePhotoUrl: '/uploads/i.jpg',
      verifiedAt: new Date('2026-03-05T00:00:00Z'),
      rejectionReason: null,
      revokedAt: null,
      active: true,
      cooperativeId: null,
    },
  };
}

/** Every key that must never appear on either response. */
const SENSITIVE = [
  'phoneEncrypted',
  'emergencyContactsEncrypted',
  'phoneHash',
  'moneyPinHash',
  'moneyPinPendingHash',
  'moneyPinPendingActivatesAt',
  'moneyPinAttempts',
  'moneyPinLockedUntil',
  'disputeCount',
  'disputeRate',
  'isFlagged',
  'flagReason',
  'frozenAt',
  'suspendedUntil',
  'payoutPreference',
  'completedShifts',
  'smsOptOut',
  'cooperativeId',
  'isDeleted',
];

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use(errorHandler);

beforeEach(() => {
  jest.clearAllMocks();
  _resetAuthStatusCacheForTests();
  db.user.findUnique.mockResolvedValue(existingUser());
  db.deletionRequest.findFirst.mockResolvedValue(null);
});

describe('POST /api/auth/verify-otp — the login payload', () => {
  test('carries the plaintext contract a returning rider’s screens seed from', async () => {
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: PHONE, otp: '123456' });

    expect(res.status).toBe(200);
    // B-1: these three were ABSENT from the login user, which is what let
    // SettingsPage seed `[]` and PUT it back over her real contacts.
    expect(res.body.user.phone).toBe(PHONE);
    expect(res.body.user.emergencyContacts).toEqual(CONTACTS);
    // U-6: and this was absent too, which blanked a motari's plate.
    expect(res.body.user.driverProfile).not.toBeNull();
    expect(res.body.user.driverProfile.registrationPlate).toBe('RAC456B');
    expect(res.body.user.driverProfile.vehicleDescription).toBe('Blue Bajaj');
  });

  test('carries no credential and no fraud field', async () => {
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: PHONE, otp: '123456' });

    for (const key of SENSITIVE) {
      expect(Object.prototype.hasOwnProperty.call(res.body.user, key)).toBe(false);
    }
    // The driver document trail is not on this payload either.
    for (const key of ['drivingLicenseNumber', 'drivingLicensePhotoUrl', 'insurancePhotoUrl']) {
      expect(Object.prototype.hasOwnProperty.call(res.body.user.driverProfile, key)).toBe(false);
    }
  });

  test('the login payload is EXACTLY the allowlist', async () => {
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: PHONE, otp: '123456' });
    expect(Object.keys(res.body.user).sort()).toEqual([...CLIENT_USER_KEYS].sort());
  });
});

describe('GET /api/users/me — the profile payload', () => {
  const token = generateAccessToken({ userId: USER_ID, role: 'BOTH' });

  test('carries the same plaintext contract and no credential', async () => {
    const res = await request(app).get('/api/users/me').set('Cookie', [`accessToken=${token}`]);

    expect(res.status).toBe(200);
    expect(res.body.phone).toBe(PHONE);
    expect(res.body.emergencyContacts).toEqual(CONTACTS);
    expect(res.body.driverProfile.registrationPlate).toBe('RAC456B');
    for (const key of SENSITIVE) {
      expect(Object.prototype.hasOwnProperty.call(res.body, key)).toBe(false);
    }
  });
});

describe('the two payloads agree — the equality B-1 broke', () => {
  test('login and /me carry the same user key set', async () => {
    const login = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: PHONE, otp: '123456' });

    const token = generateAccessToken({ userId: USER_ID, role: 'BOTH' });
    const me = await request(app).get('/api/users/me').set('Cookie', [`accessToken=${token}`]);

    const loginKeys = Object.keys(login.body.user).sort();
    // `/me` adds exactly one key — the deletion banner's countdown — and
    // is otherwise the same object. Anything else diverging is the class
    // this dispatch closed.
    const meKeys = Object.keys(me.body)
      .filter((k) => k !== 'accountDeletion')
      .sort();

    expect(meKeys).toEqual(loginKeys);
  });
});
