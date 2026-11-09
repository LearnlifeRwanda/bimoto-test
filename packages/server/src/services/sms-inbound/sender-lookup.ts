import type { PrismaClient, User } from '@prisma/client';
import { hashPhone } from '../../utils/crypto';

const RW_PREFIX = '+250';

/**
 * Normalise a Rwandan MSISDN to E.164. Strips all non-digits, then:
 *  - 9-digit local (e.g. "788123456")        → "+250788123456"
 *  - 10-digit local with leading 0 (07881…)   → "+250788123456"
 *  - 12-digit (250788123456)                  → "+250788123456"
 *  - already E.164 with leading "+"           → preserved
 *
 * Falls back to a "+"-prefixed version of the digits-only string for
 * non-RW numbers so we still produce something well-formed.
 *
 * SENDER-MATCH — this is the repo's ONE msisdn normaliser, and it is now
 * load-bearing twice over. The AT webhook route applies it to `from` on
 * the way in (sms-inbound.routes.ts), and findUserByMsisdn applies it
 * again below before hashing, so the admin replay path — which re-feeds a
 * stored `fromMsisdn` verbatim — reaches the same hash as a live webhook.
 * It is idempotent: normalise(normalise(x)) === normalise(x) for every
 * input, because its output always carries the leading "+" that the
 * hasPlus branch preserves.
 *
 * Not to be confused with shared/schemas/user.schema.ts#normaliseEmergency-
 * Contact, which normalises a DIFFERENT field (a user-typed emergency
 * contact, which may be international) under a stricter rule that rejects
 * bare local digits. Routing inbound msisdns through it would change what
 * ctx.fromMsisdn holds and therefore what the parcel-recipient leg match
 * compares against — a stranger-path behaviour change this dispatch
 * forbids. See the PR body's DEVIATION note.
 */
export function normaliseMsisdn(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D+/g, '');
  if (digits.length === 0) return '';

  if (hasPlus) return `+${digits}`;
  if (digits.length === 9) return `${RW_PREFIX}${digits}`;
  if (digits.length === 10 && digits.startsWith('0')) {
    return `${RW_PREFIX}${digits.slice(1)}`;
  }
  if (digits.length === 12 && digits.startsWith('250')) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

// SENDER-MATCH — the lookup starts telling the truth.
//
// What this used to be, and why it never worked:
//
//   prisma.user.findUnique({ where: { phoneEncrypted: msisdn } })
//
// `User.phoneEncrypted` is AES-256-GCM ciphertext (`iv:ct:tag`, hex — see
// utils/crypto.ts). Every encrypt() draws a fresh random IV, so the same
// number yields different ciphertext every time it is stored. Comparing a
// plaintext MSISDN to that column is not a lookup that usually misses: it
// is an equality that has never once been true. #182 found it, proved it,
// and deliberately shipped it unchanged (renaming the column reference
// without changing the query's meaning) because fixing it activates code
// that had never run — outside that dispatch's sanctioned list.
//
// This is that activation. `User.phoneHash` is `sha256(phone)` over the
// EXACT string registration validated, and it is `@unique` for precisely
// this purpose: auth.service.ts#verifyOtp writes `hashPhone(phone)` where
// `phone` has passed auth.schema.ts's RWANDA_PHONE_REGEX (/^\+250[0-9]{9}$/).
// hashPhone is exact-string, so the inbound number must be reduced to that
// same canonical E.164 form before hashing — hence the normalise() call.
//
// A msisdn that cannot be reduced to a number at all (an alphanumeric
// sender id, an empty `from`) yields '' and resolves to no user. A short
// code normalises to something well-formed but matches no registered
// phone. Both land on the stranger path, exactly as every message does
// today — the fix widens who is recognised, never who is refused.
export async function findUserByMsisdn(
  msisdn: string,
  prisma: PrismaClient,
): Promise<User | null> {
  const normalised = normaliseMsisdn(msisdn);
  if (!normalised) return null;
  return prisma.user.findUnique({ where: { phoneHash: hashPhone(normalised) } });
}
