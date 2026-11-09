// CUTGUARD v2 G1 — the serialization boundary, asserted as a SET.
//
// The defect this closes was not "one field was wrong". It was that the
// payload's shape was decided by SUBTRACTION — `getMe` named two columns
// to drop and shipped whatever remained, `verifyOtp` named none and
// shipped the row. Under subtraction, every column added to `model User`
// joined the wire silently, and any column the client needed but nobody
// re-added was simply missing.
//
// So the assertions here are set-equality, not spot-checks. A test that
// says "moneyPinHash is absent" would pass forever while the NEXT
// credential column shipped. A test that says "the key set is exactly
// this" fails the day the set changes, in either direction — which is
// the only shape of assertion that could have caught B-1 and U-2 with
// one rule.

jest.mock('../prisma', () => {
  const db: any = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    deletionRequest: { findFirst: jest.fn(async () => null) },
    driverProfile: { findUnique: jest.fn(async () => null) },
  };
  return { __esModule: true, default: db };
});

import prisma from '../prisma';
import {
  CLIENT_USER_KEYS,
  CLIENT_DRIVER_PROFILE_KEYS,
  toClientUser,
} from '../services/client-user';
import { getMe } from '../services/user.service';
import { encrypt } from '../utils/crypto';

const db = prisma as any;

/**
 * A user row carrying EVERY column the model has, credentials included.
 * Deliberately built by hand rather than from a factory: the point of
 * this fixture is that it contains the things that must not travel.
 */
function fullUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    phoneEncrypted: encrypt('+250788000111'),
    phoneHash: 'a-phone-hash',
    nickname: 'Ineza',
    role: 'CUSTOMER',
    language: 'rw',
    idVerified: true,
    licenseVerified: false,
    emergencyContactsEncrypted: encrypt(JSON.stringify(['+250788000222', '+250788000333'])),
    completedRides: 4,
    cancellationCount: 0,
    totalRequests: 6,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    privacyConsentAt: new Date('2026-01-01T00:00:00Z'),
    privacyConsentVersion: '1',
    termsAcceptedAt: new Date('2026-01-01T00:00:00Z'),
    termsAcceptedVersion: '1',
    driverTermsAcceptedAt: null,
    driverTermsVersion: null,
    accountDeletedAt: null,
    isDeleted: false,
    // The fraud block — U-3's contradiction with the export's own notice.
    disputeCount: 2,
    disputeRate: 0.5,
    isFlagged: true,
    flagReason: 'RETURNED_AFTER_DELETION_WHILE_SUSPENDED',
    // The money-PIN block — U-2. `moneyPinHash` is hmacOtp(pin) with no
    // per-user salt, over a four-digit space.
    moneyPinHash: 'hmac-of-the-pin',
    moneyPinPendingHash: 'hmac-of-the-pending-pin',
    moneyPinPendingActivatesAt: new Date('2026-08-02T00:00:00Z'),
    moneyPinAttempts: 1,
    moneyPinLockedUntil: null,
    // The freeze block.
    frozenAt: null,
    frozenReason: null,
    frozenBy: null,
    frozenCategory: null,
    suspendedUntil: null,
    payoutPreference: 'AT_SHIFT_END',
    completedShifts: 3,
    scheduledCancellationCount: 0,
    customerInitiatedCompletionCount: 0,
    lateCompletionCount: 0,
    noShowCount: 0,
    driverInitiatedCancellationCount: 0,
    wrongVehicleCount: 0,
    lateMarkCount: 0,
    smsOptOut: false,
    cooperativeId: null,
    driverProfile: null,
    ...overrides,
  };
}

const FORBIDDEN = [
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
  'frozenReason',
  'frozenBy',
  'frozenCategory',
  'suspendedUntil',
  'payoutPreference',
  'completedShifts',
  'smsOptOut',
  'cooperativeId',
  'isDeleted',
  'accountDeletedAt',
];

beforeEach(() => jest.clearAllMocks());

/* --------------------------------------------------- the set, exactly ----- */

describe('toClientUser emits exactly its allowlist', () => {
  test('the key set is EXACTLY CLIENT_USER_KEYS — widening fails this test', () => {
    const out = toClientUser(fullUserRow() as any);
    // Sorted set-equality in both directions: a key added to the
    // serializer without being added to CLIENT_USER_KEYS fails here, and
    // so does the reverse.
    expect(Object.keys(out).sort()).toEqual([...CLIENT_USER_KEYS].sort());
  });

  test('every credential and fraud column is absent — named one by one', () => {
    const out = toClientUser(fullUserRow() as any) as unknown as Record<string, unknown>;
    for (const key of FORBIDDEN) {
      expect(Object.prototype.hasOwnProperty.call(out, key)).toBe(false);
    }
  });

  test('the two encrypted columns come back as the plaintext contract', () => {
    const out = toClientUser(fullUserRow() as any);
    expect(out.phone).toBe('+250788000111');
    expect(out.emergencyContacts).toEqual(['+250788000222', '+250788000333']);
  });

  test('a user with no driver profile gets null — never an absent key', () => {
    // U-6's mechanism: SettingsPage reads `user?.driverProfile?.…`. An
    // ABSENT key and a null profile read the same to the screen, but only
    // one of them is a statement. The serializer always makes the
    // statement.
    const out = toClientUser(fullUserRow() as any);
    expect(Object.prototype.hasOwnProperty.call(out, 'driverProfile')).toBe(true);
    expect(out.driverProfile).toBeNull();
  });

  test('the driver profile is projected to exactly CLIENT_DRIVER_PROFILE_KEYS', () => {
    const out = toClientUser(
      fullUserRow({
        driverProfile: {
          id: 'dp1',
          userId: 'u1',
          vehicleType: 'MOTO',
          registrationPlate: 'RAB123A',
          vehicleDescription: 'Red Boxer',
          avgRating: 4.8,
          totalRides: 12,
          isOnline: true,
          lastLat: -1.9,
          lastLng: 30.1,
          lastLocationAt: new Date('2026-08-01T00:00:00Z'),
          drivingLicenseNumber: 'DL-99',
          ruraAuthorizationNumber: 'RURA-1',
          cooperativeName: 'Kigali Moto',
          insuranceConfirmed: true,
          verificationStatus: 'VERIFIED',
          drivingLicensePhotoUrl: '/uploads/licence.jpg',
          ruraAuthorizationPhotoUrl: '/uploads/rura.jpg',
          insurancePhotoUrl: '/uploads/insurance.jpg',
          verifiedAt: new Date('2026-02-01T00:00:00Z'),
          rejectionReason: null,
          revokedAt: null,
          active: true,
          cooperativeId: 'coop1',
        },
      }) as any,
    );
    expect(Object.keys(out.driverProfile!).sort()).toEqual(
      [...CLIENT_DRIVER_PROFILE_KEYS].sort(),
    );
    // The document trail belongs to the admin verification queue, which
    // has its own endpoint and its own payload for it.
    for (const key of [
      'drivingLicenseNumber',
      'drivingLicensePhotoUrl',
      'ruraAuthorizationPhotoUrl',
      'insurancePhotoUrl',
      'rejectionReason',
      'lastLat',
      'lastLng',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(out.driverProfile, key)).toBe(false);
    }
    // U-6's actual payload: the plate and description a save would
    // otherwise blank.
    expect(out.driverProfile!.registrationPlate).toBe('RAB123A');
    expect(out.driverProfile!.vehicleDescription).toBe('Red Boxer');
  });
});

/* ------------------------------------------------------- red-proof -------- */

describe('the pre-fix shape is what the allowlist refuses', () => {
  test('a raw {...row} spread carries every forbidden key — the shape that shipped', () => {
    // Not an assertion about the code as it stands; an assertion about
    // WHY it changed. If this ever stops holding, the model lost its
    // credentials and the guard above is measuring nothing.
    const raw = { ...(fullUserRow() as Record<string, unknown>) };
    for (const key of ['moneyPinHash', 'phoneHash', 'isFlagged', 'disputeRate']) {
      expect(Object.prototype.hasOwnProperty.call(raw, key)).toBe(true);
    }
    // …and the plaintext contract the client actually needs is NOT in it.
    expect(Object.prototype.hasOwnProperty.call(raw, 'phone')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(raw, 'emergencyContacts')).toBe(false);
  });
});

/* ----------------------------------------------------------- getMe -------- */

describe('getMe answers through the same door', () => {
  test('/me carries the allowlist plus accountDeletion, and nothing else', async () => {
    db.user.findUnique.mockResolvedValue(fullUserRow());
    db.deletionRequest.findFirst.mockResolvedValue(null);

    const me = await getMe('u1');

    expect(Object.keys(me).sort()).toEqual(
      [...CLIENT_USER_KEYS, 'accountDeletion'].sort(),
    );
    for (const key of FORBIDDEN) {
      expect(Object.prototype.hasOwnProperty.call(me, key)).toBe(false);
    }
    expect(me.emergencyContacts).toEqual(['+250788000222', '+250788000333']);
  });

  test('/me loads the driver profile relation — the U-6 half of the same defect', async () => {
    db.user.findUnique.mockResolvedValue(fullUserRow());
    await getMe('u1');
    const arg = db.user.findUnique.mock.calls[0][0];
    expect(arg.include).toEqual({ driverProfile: true });
  });
});
