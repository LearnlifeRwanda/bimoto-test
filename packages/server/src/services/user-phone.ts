// DECRYPT v3 — the one sanctioned way to turn a stored phone into a
// dialable one.
//
// `User.phoneEncrypted` is AES-256-GCM ciphertext (`iv:ct:tag`, all hex —
// see utils/crypto.ts). It is never a phone number, never dialable, never
// displayable, and never a mobile-money wallet address. Before this module
// existed the field was called `phone` and had the type `string`, exactly
// like the plaintext numbers it sat next to (`Journey.recipientPhone`,
// `Leg.contactPhone`, `EMERGENCY_OPS_PHONE`), and three separate audits
// each found a different subset of the places that confused the two.
//
// The schema rename made every one of those a compile error. This module
// is what those errors are meant to be resolved with: ask for the
// plaintext explicitly, or don't get it. A source-assertion test
// (see __tests__/phone-access-convention.test.ts) keeps `decrypt(` on a
// phone out of every other file, so the convention cannot quietly rot.

import { decrypt } from '../utils/crypto';

/**
 * The minimum shape either accessor needs. Callers pass the user object
 * whole rather than reaching for the ciphertext field themselves — that
 * is what keeps `.phoneEncrypted` from appearing anywhere outside this
 * file.
 */
export interface UserWithEncryptedPhone {
  phoneEncrypted: string;
}

export interface UserWithEncryptedContacts {
  emergencyContactsEncrypted: string | null;
}

/**
 * The dialable number, or a throw.
 *
 * Use where the caller genuinely cannot proceed without it and the
 * failure should be loud: the user's own profile view, and the payment
 * boundaries where the number IS the wallet address and a silent skip
 * would strand money in a PENDING batch. Preserves the behaviour of the
 * bare `decrypt(user.phone)` this replaces at those sites.
 */
export function decryptedPhone(user: UserWithEncryptedPhone): string {
  return decrypt(user.phoneEncrypted);
}

/**
 * The dialable number, or null when it cannot be produced — either
 * because there is no user, or because the stored value does not decrypt
 * (a legacy row, a key rotation, a truncated column).
 *
 * Use for fire-and-forget notifications, where one unreadable row must
 * not take down a nightly job or a whole SMS fan-out. This is the
 * try/catch idiom that journey.routes.ts hand-rolled twice for the SOS
 * fan-out, promoted to the one place that knows encrypted-at-rest can
 * have legacy exceptions.
 */
export function decryptedPhoneOrNull(
  user: UserWithEncryptedPhone | null | undefined,
): string | null {
  if (!user?.phoneEncrypted) return null;
  try {
    return decrypt(user.phoneEncrypted);
  } catch {
    return null;
  }
}

/**
 * The user's emergency contact numbers, plaintext and dialable.
 *
 * Stored as encrypt(JSON.stringify(string[])); legacy rows may hold plain
 * JSON, which is why the fallback exists. Never throws — an unreadable
 * value yields [] so callers (profile view, SOS fan-out) degrade to "no
 * contacts" rather than failing. Moved here from user.service.ts so that
 * every decrypt of a phone-shaped column lives behind one door.
 */
export function parseEmergencyContacts(
  raw: string | null | undefined,
): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypt(raw));
  } catch {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed)
    ? parsed.filter((c): c is string => typeof c === 'string' && c.length > 0)
    : [];
}

/**
 * The contacts of a user object, for callers that hold the whole row.
 */
export function decryptedEmergencyContacts(
  user: UserWithEncryptedContacts | null | undefined,
): string[] {
  return parseEmergencyContacts(user?.emergencyContactsEncrypted);
}
