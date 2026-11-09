// SERVICES/CLIENT-USER.TS
//
// CUTGUARD v2 G1 — the one door a User row passes through on its way to
// a client.
//
// WHAT WENT WRONG, precisely. `getMe` (user.service.ts) destructured the
// two encrypted columns OUT of a `{...user}` spread and re-emitted
// `phone` + `emergencyContacts` in plaintext. That is a NEGATIVE list:
// it names what must not go, and everything unnamed ships. Two
// consequences, both of which were live on the pilot:
//
//   1. `verifyOtp` (auth.service.ts) never got that treatment at all. It
//      returned the RAW Prisma row. So the login `user` had NO `phone`,
//      NO `emergencyContacts` and NO `driverProfile` — while carrying
//      every money-PIN column, the unsalted `phoneHash`, and the fraud
//      fields. Both editing screens seed their state once from that
//      object and save by whole-array replace, so a rider who added one
//      contact after login PUT `[theNewOne]` over her real contacts and
//      silenced her own SOS fan-out. Same mechanism erased a motari's
//      plate and vehicle description.
//
//   2. Every column added to the model since — moneyPinHash,
//      moneyPinPendingHash, moneyPinAttempts, moneyPinLockedUntil,
//      isFlagged, flagReason, disputeRate, frozenAt/Reason/By/Category —
//      joined the `/me` payload the day it was declared, because a
//      negative list cannot know about a field nobody thought to remove.
//      `moneyPinHash` is `hmacOtp(pin)` with NO per-user salt
//      (utils/crypto.ts), so shipping it made the product's own API a
//      reverse-table oracle over a four-digit space.
//
// THE SHAPE OF THE FIX. This module is a POSITIVE allowlist. A key
// reaches a client because it is written down here, and for no other
// reason. A column added to `model User` tomorrow is absent from every
// client payload until somebody adds it to CLIENT_USER_KEYS on purpose —
// which is a diff a reviewer can see, unlike the silence that shipped
// the PIN hash.
//
// WHY driverProfile IS REQUIRED RATHER THAN OPTIONAL. The U-6 half of
// the same defect was a caller that simply did not LOAD the relation, so
// the client received a user with no vehicle identity and saved `""`
// over the plate. Making the parameter type demand
// `driverProfile: DriverProfile | null` turns "forgot to include it"
// into a compile error at the call site, which is the only place that
// can fix it. A driver with no profile row is `null`; a caller that did
// not ask is rejected by tsc.
//
// The guard that keeps this door the ONLY door is scripts/serialization-
// guard (pnpm serialize:check). See docs/serialization-boundary.md.

import type { DriverProfile, User } from '@prisma/client';
import { decryptedPhoneOrNull, parseEmergencyContacts } from './user-phone';

/**
 * The exact key set a client receives for a user. Exported as data so
 * the test can assert set-equality against a serialized payload —
 * WIDENING this list fails that test, which is the point: adding a key
 * here is a decision, not an accident.
 *
 * Grouped by why each key is here. Every entry was verified to have a
 * live consumer in packages/client (census in the dispatch report):
 * the client's own `User` interface (stores/auth.store.ts) is the
 * contract this satisfies.
 */
export const CLIENT_USER_KEYS = [
  // Identity.
  'id',
  'nickname',
  'role',
  'language',
  // Verification badges the profile screens render.
  'idVerified',
  'licenseVerified',
  // Decrypted, and the whole reason a serializer exists: the model
  // stores ciphertext under different names, and the wire contract has
  // always been plaintext under these.
  'phone',
  'emergencyContacts',
  // Counters shown on the profile.
  'completedRides',
  'cancellationCount',
  'totalRequests',
  // Consent + terms state. The client gates screens on these.
  'privacyConsentAt',
  'privacyConsentVersion',
  'termsAcceptedAt',
  'termsAcceptedVersion',
  'driverTermsAcceptedAt',
  'driverTermsVersion',
  // Row timestamps. Not sensitive, and the shared `User` type declares
  // them non-optional.
  'createdAt',
  'updatedAt',
  // The vehicle identity, projected below. Present as `null` for a user
  // with no driver profile — never ABSENT, because absence is what the
  // U-6 clobber read as "no plate".
  'driverProfile',
] as const;

/**
 * The driver-profile keys a client receives. Same principle: the model
 * carries the licence number, three document photo URLs, the rejection
 * reason, `verifiedAt`, `revokedAt`, `cooperativeId` and `active`, none
 * of which any client screen reads off a user payload — the admin
 * verification queue has its own endpoint and its own payload for them.
 */
export const CLIENT_DRIVER_PROFILE_KEYS = [
  'vehicleType',
  'registrationPlate',
  'vehicleDescription',
  'avgRating',
  'totalRides',
  'isOnline',
  'lastLocationAt',
  'verificationStatus',
  'ruraAuthorizationNumber',
  'insuranceConfirmed',
  'cooperativeName',
] as const;

export interface ClientDriverProfile {
  vehicleType: DriverProfile['vehicleType'];
  registrationPlate: DriverProfile['registrationPlate'];
  vehicleDescription: DriverProfile['vehicleDescription'];
  avgRating: DriverProfile['avgRating'];
  totalRides: DriverProfile['totalRides'];
  isOnline: DriverProfile['isOnline'];
  lastLocationAt: DriverProfile['lastLocationAt'];
  verificationStatus: DriverProfile['verificationStatus'];
  ruraAuthorizationNumber: DriverProfile['ruraAuthorizationNumber'];
  insuranceConfirmed: DriverProfile['insuranceConfirmed'];
  cooperativeName: DriverProfile['cooperativeName'];
}

export interface ClientUser {
  id: User['id'];
  nickname: User['nickname'];
  role: User['role'];
  language: User['language'];
  idVerified: User['idVerified'];
  licenseVerified: User['licenseVerified'];
  phone: string | null;
  emergencyContacts: string[];
  completedRides: User['completedRides'];
  cancellationCount: User['cancellationCount'];
  totalRequests: User['totalRequests'];
  privacyConsentAt: User['privacyConsentAt'];
  privacyConsentVersion: User['privacyConsentVersion'];
  termsAcceptedAt: User['termsAcceptedAt'];
  termsAcceptedVersion: User['termsAcceptedVersion'];
  driverTermsAcceptedAt: User['driverTermsAcceptedAt'];
  driverTermsVersion: User['driverTermsVersion'];
  createdAt: User['createdAt'];
  updatedAt: User['updatedAt'];
  driverProfile: ClientDriverProfile | null;
}

/**
 * A user row with its driver profile loaded. `null` is a real answer
 * ("this person has no profile"); `undefined` is not an answer at all,
 * so the type does not admit it — see the header on why.
 */
export type SerializableUser = User & {
  driverProfile: DriverProfile | null;
};

function toClientDriverProfile(
  profile: DriverProfile | null,
): ClientDriverProfile | null {
  if (!profile) return null;
  return {
    vehicleType: profile.vehicleType,
    registrationPlate: profile.registrationPlate,
    vehicleDescription: profile.vehicleDescription,
    // Passed through exactly as the row holds it (Prisma Decimal), so
    // the wire value is byte-for-byte what `/me` already sent.
    avgRating: profile.avgRating,
    totalRides: profile.totalRides,
    isOnline: profile.isOnline,
    lastLocationAt: profile.lastLocationAt,
    verificationStatus: profile.verificationStatus,
    ruraAuthorizationNumber: profile.ruraAuthorizationNumber,
    insuranceConfirmed: profile.insuranceConfirmed,
    cooperativeName: profile.cooperativeName,
  };
}

/**
 * THE serializer. Every path that puts a user on the wire goes through
 * this function — login, `/me`, the profile update, the data export.
 *
 * Written as an explicit object literal rather than a loop over
 * CLIENT_USER_KEYS on purpose: a loop would type the result as
 * `Record<string, unknown>` and lose the compiler's opinion about what
 * a ClientUser is. The test asserts the two agree.
 */
export function toClientUser(user: SerializableUser): ClientUser {
  // Destructured rather than read as `user.phoneEncrypted`, which is the
  // idiom services/user-phone.ts's convention test enforces (a member
  // read of the ciphertext column outside that module is an offender;
  // a destructure into the accessor's own parameter shape is not). Same
  // move `getMe` already made, kept.
  const { phoneEncrypted, emergencyContactsEncrypted } = user;
  return {
    id: user.id,
    nickname: user.nickname,
    role: user.role,
    language: user.language,
    idVerified: user.idVerified,
    licenseVerified: user.licenseVerified,
    // `decryptedPhoneOrNull`, NOT the throwing `decryptedPhone` that
    // stood in getMe. This serializer now sits on the LOGIN path too,
    // and a stored value that will not decrypt — a legacy row, a key
    // rotation, a truncated column — must not be the reason a person
    // cannot get into their own account. A blank phone field on the
    // profile screen is recoverable; a login that 500s is not. The
    // widened behaviour is confined to that one field: everything else
    // on the payload is unaffected by an unreadable phone.
    phone: decryptedPhoneOrNull({ phoneEncrypted }),
    emergencyContacts: parseEmergencyContacts(emergencyContactsEncrypted),
    completedRides: user.completedRides,
    cancellationCount: user.cancellationCount,
    totalRequests: user.totalRequests,
    privacyConsentAt: user.privacyConsentAt,
    privacyConsentVersion: user.privacyConsentVersion,
    termsAcceptedAt: user.termsAcceptedAt,
    termsAcceptedVersion: user.termsAcceptedVersion,
    driverTermsAcceptedAt: user.driverTermsAcceptedAt,
    driverTermsVersion: user.driverTermsVersion,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    driverProfile: toClientDriverProfile(user.driverProfile),
  };
}

/**
 * The Prisma `include` every caller of `toClientUser` needs. Named so
 * the relation is loaded the same way everywhere and a new call site
 * does not have to rediscover it.
 */
export const CLIENT_USER_INCLUDE = { driverProfile: true } as const;
