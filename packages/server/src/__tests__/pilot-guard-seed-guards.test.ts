// PILOT-GUARD Item 3 — both refusal directions, and the boot that must
// keep working.
//
// The refusals are only useful if they cannot fire on the paths CI and a
// developer actually run, so every test below is paired: the shape that
// must refuse, and the neighbouring shape that must not.

import {
  assertSeedAllowed,
  resolveSeedEncryptionKey,
  seedRefusalReason,
  shouldSeedDevAdmin,
} from '../seed-guards';

const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('seedRefusalReason — production is never a seed target', () => {
  test('NODE_ENV=production refuses, even on an empty database', () => {
    expect(seedRefusalReason({ NODE_ENV: 'production', existingUserCount: 0 })).toMatch(
      /NODE_ENV=production/,
    );
    expect(() =>
      assertSeedAllowed({ NODE_ENV: 'production', existingUserCount: 0 }),
    ).toThrow(/Refusing to seed/);
  });

  test('the refusal names the reason an operator can act on', () => {
    const reason = seedRefusalReason({ NODE_ENV: 'production', existingUserCount: 0 })!;
    expect(reason).toMatch(/fixed-phone/);
    expect(reason).toMatch(/ADMIN/);
  });
});

describe('seedRefusalReason — a populated database is a live one', () => {
  test('any existing user refuses', () => {
    expect(seedRefusalReason({ NODE_ENV: 'development', existingUserCount: 1 })).toMatch(
      /already holds 1 row/,
    );
    expect(seedRefusalReason({ NODE_ENV: 'test', existingUserCount: 42 })).toMatch(
      /already holds 42 row/,
    );
  });
});

describe('seedRefusalReason — the paths CI and developers run must NOT refuse', () => {
  // This is the pairing that matters: e2e.yml builds an empty database
  // with `prisma migrate deploy` and seeds it with NODE_ENV=test.
  test('CI: NODE_ENV=test on an empty database is allowed', () => {
    expect(seedRefusalReason({ NODE_ENV: 'test', existingUserCount: 0 })).toBeNull();
    expect(() => assertSeedAllowed({ NODE_ENV: 'test', existingUserCount: 0 })).not.toThrow();
  });

  test('a developer: NODE_ENV unset or development on an empty database is allowed', () => {
    expect(seedRefusalReason({ NODE_ENV: undefined, existingUserCount: 0 })).toBeNull();
    expect(seedRefusalReason({ NODE_ENV: 'development', existingUserCount: 0 })).toBeNull();
  });
});

describe('shouldSeedDevAdmin — the fixed-phone admin is opt-in', () => {
  test('only the explicit "1" creates it', () => {
    expect(shouldSeedDevAdmin('1')).toBe(true);
  });

  test('unset, empty, "0", "true" and "yes" all leave it out', () => {
    for (const v of [undefined, '', '0', 'true', 'yes', 'TRUE']) {
      expect(shouldSeedDevAdmin(v)).toBe(false);
    }
  });
});

describe('resolveSeedEncryptionKey — a corruption seed refuses instead', () => {
  test('unset or blank refuses, and says why the old fallback was worse', () => {
    expect(() => resolveSeedEncryptionKey(undefined)).toThrow(/ENCRYPTION_KEY is not set/);
    expect(() => resolveSeedEncryptionKey('')).toThrow(/cannot decrypt/);
    expect(() => resolveSeedEncryptionKey('   ')).toThrow(/Refusing to seed/);
  });

  test('a malformed key refuses rather than deriving a different one', () => {
    expect(() => resolveSeedEncryptionKey('deadbeef')).toThrow(/64 hexadecimal/);
    expect(() => resolveSeedEncryptionKey('z'.repeat(64))).toThrow(/64 hexadecimal/);
  });

  test('the key CI sets is accepted, trimmed, unchanged', () => {
    expect(resolveSeedEncryptionKey(KEY)).toBe(KEY);
    expect(resolveSeedEncryptionKey(`  ${KEY}  `)).toBe(KEY);
    expect(resolveSeedEncryptionKey(KEY.toUpperCase())).toBe(KEY.toUpperCase());
  });

  test("the old fallback value is no longer accepted implicitly", () => {
    // 'a'.repeat(64) is valid hex, so it is still a usable key if an
    // operator sets it deliberately. What is gone is it being chosen for
    // them by an unset variable.
    expect(resolveSeedEncryptionKey('a'.repeat(64))).toBe('a'.repeat(64));
    expect(() => resolveSeedEncryptionKey(undefined)).toThrow();
  });
});
