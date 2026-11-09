// SENDER-MATCH G2 — the lookup, proven both ways.
//
// The point of this suite is not that the new query works. It is that the
// OLD one could not, ever, and that the difference is visible with real
// crypto rather than mocked crypto: encrypt() and hashPhone() below are the
// production functions, not stubs. A fixture that mocked them could be made
// to "pass" under either query and would prove nothing.

import { encrypt, hashPhone } from '../../../utils/crypto';
import { findUserByMsisdn, normaliseMsisdn } from '../sender-lookup';
import { RWANDA_PHONE_REGEX } from '@bimoto/shared';

const REGISTERED_PHONE = '+250788123456';

/**
 * A stand-in for the `User` row registration writes: auth.service.ts#verifyOtp
 * stores `phoneEncrypted: encrypt(phone)` and `phoneHash: hashPhone(phone)`
 * for the same `phone`.
 */
function registeredRow() {
  return {
    id: 'u-registered',
    phoneEncrypted: encrypt(REGISTERED_PHONE),
    phoneHash: hashPhone(REGISTERED_PHONE),
    role: 'CUSTOMER',
    smsOptOut: false,
  };
}

/**
 * A prisma double that answers findUnique HONESTLY: it applies the `where`
 * clause the caller actually passed against the stored row. This is what
 * lets the same fixture run the old query and the new one and disagree.
 */
function honestPrisma(row: Record<string, any>): any {
  return {
    user: {
      findUnique: jest.fn(async ({ where }: any) => {
        const [[field, value]] = Object.entries(where);
        return row[field] === value ? row : null;
      }),
    },
  };
}

describe('SENDER-MATCH — the defect (#182), reproduced', () => {
  test('encrypt() is non-deterministic: the old equality could never be true', () => {
    const a = encrypt(REGISTERED_PHONE);
    const b = encrypt(REGISTERED_PHONE);
    expect(a).not.toBe(b);
    // …and neither ciphertext is ever equal to the plaintext the webhook
    // hands us, which is what `where: { phoneEncrypted: msisdn }` compared.
    expect(a).not.toBe(REGISTERED_PHONE);
    expect(b).not.toBe(REGISTERED_PHONE);
  });

  test('the OLD query misses the very user it is looking for', async () => {
    const row = registeredRow();
    const prisma = honestPrisma(row);
    // Verbatim the query that shipped at sender-lookup.ts:57 before this fix.
    const oldResult = await prisma.user.findUnique({
      where: { phoneEncrypted: REGISTERED_PHONE },
    });
    expect(oldResult).toBeNull();
  });

  test('the NEW query matches that same user', async () => {
    const prisma = honestPrisma(registeredRow());
    const user = await findUserByMsisdn(REGISTERED_PHONE, prisma);
    expect(user).not.toBeNull();
    expect(user!.id).toBe('u-registered');
  });
});

describe('SENDER-MATCH — the hash-match precondition, proven not assumed', () => {
  test("normaliseMsisdn's output is byte-identical to registration's canonical form", () => {
    // auth.schema.ts demands RWANDA_PHONE_REGEX of the number a person
    // registers with, and auth.service.ts#verifyOtp hashes that exact string.
    // hashPhone is sha256 over the string: one byte of drift and the lookup
    // silently returns to always-null.
    expect(RWANDA_PHONE_REGEX.test(REGISTERED_PHONE)).toBe(true);

    for (const inboundForm of [
      '+250788123456', // AT's usual E.164
      '250788123456', // no leading +
      '0788123456', // Rwandan local, what a tester types
      '788123456', // bare subscriber digits
      '+250 788 123 456', // separated
      '+250-788-123-456',
      ' +250788123456 ', // whitespace
    ]) {
      const normalised = normaliseMsisdn(inboundForm);
      expect(normalised).toBe(REGISTERED_PHONE);
      expect(RWANDA_PHONE_REGEX.test(normalised)).toBe(true);
      expect(hashPhone(normalised)).toBe(hashPhone(REGISTERED_PHONE));
    }
  });

  test('normalisation is idempotent — the admin replay path re-normalises a stored msisdn', () => {
    for (const raw of ['0788123456', '788123456', '+250788123456', '15555', 'BIMOTO']) {
      expect(normaliseMsisdn(normaliseMsisdn(raw))).toBe(normaliseMsisdn(raw));
    }
  });

  test('every inbound form resolves the registered user', async () => {
    for (const inboundForm of ['+250788123456', '0788123456', '788123456', '+250 788 123 456']) {
      const prisma = honestPrisma(registeredRow());
      const user = await findUserByMsisdn(inboundForm, prisma);
      expect(user?.id).toBe('u-registered');
    }
  });
});

describe('SENDER-MATCH — who is still a stranger', () => {
  test('an alphanumeric sender id resolves to no user, without querying', async () => {
    const prisma = honestPrisma(registeredRow());
    expect(await findUserByMsisdn('BIMOTO', prisma)).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  test('an empty `from` resolves to no user, without querying', async () => {
    const prisma = honestPrisma(registeredRow());
    expect(await findUserByMsisdn('', prisma)).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  test('a short code queries but matches nobody', async () => {
    const prisma = honestPrisma(registeredRow());
    expect(await findUserByMsisdn('15555', prisma)).toBeNull();
    expect(prisma.user.findUnique).toHaveBeenCalled();
  });

  test('an unregistered Rwandan number matches nobody', async () => {
    const prisma = honestPrisma(registeredRow());
    expect(await findUserByMsisdn('+250788999999', prisma)).toBeNull();
  });
});
