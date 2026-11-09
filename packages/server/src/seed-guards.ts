// PILOT-GUARD Item 3 — the seed stops being a master key.
//
// prisma/seed.ts creates an ADMIN account on a fixed, published phone
// number (+250780000000), and docs/pre-prototype-runbook.md tells the
// operator to run it as step 3 of bringing the pilot up. On a keyless
// pilot — the configuration that runbook itself recommends, SMS_MODE=
// simulated — every OTP lands in the /api/sim inbox. Anyone who can read
// that inbox can log in as that admin. The seed was, in effect, shipping
// a master key with the product.
//
// Two other seed behaviours are the same class of fault:
//
//   - It is idempotent by upsert, so re-running it against a POPULATED
//     database is a supported action. On a pilot database that means
//     re-planting the admin after someone removed it.
//   - getKey() fell back to 'a'.repeat(64) when ENCRYPTION_KEY was
//     unset. That does not fail; it writes phoneEncrypted ciphertext
//     under a key the real server does not hold, so every seeded row is
//     silently undecryptable. A corruption seed, not a convenience.
//
// These are pure predicates so the refusals can be tested in both
// directions without a database. The guard's own argument, borrowed from
// startup-guard.ts: a ruling that lives only in a default is one env var
// away from being undone.

export interface SeedEnvironment {
  NODE_ENV: string | undefined;
  /** Rows already in the User table. A populated pilot DB is the tripwire. */
  existingUserCount: number;
}

/**
 * Refuse to seed a production server, or any database that already has
 * users. Returns a refusal message, or null when seeding is allowed.
 */
export function seedRefusalReason(env: SeedEnvironment): string | null {
  if (env.NODE_ENV === 'production') {
    return (
      'Refusing to seed: NODE_ENV=production. The seed plants fixed-phone ' +
      'demo accounts (including an ADMIN on a published number) and sample ' +
      'journeys. It is a development and CI fixture, never a production ' +
      'bootstrap — create the first real admin deliberately instead.'
    );
  }
  if (env.existingUserCount > 0) {
    return (
      `Refusing to seed: the User table already holds ${env.existingUserCount} ` +
      'row(s). The seed is only safe on an empty database — re-running it ' +
      'against a live pilot re-plants the fixed-phone demo accounts, ' +
      'including any admin an operator deliberately removed. Drop the ' +
      'database (or point DATABASE_URL at a fresh one) and seed that.'
    );
  }
  return null;
}

export function assertSeedAllowed(env: SeedEnvironment): void {
  const reason = seedRefusalReason(env);
  if (reason) throw new Error(reason);
}

/**
 * The fixed-phone ADMIN (and the read-only analyst beside it) are demo
 * fixtures with a published login. They are created only when the run
 * explicitly asks for them — CI's e2e job does, an operator following the
 * runbook does not.
 */
export function shouldSeedDevAdmin(seedDevAdmin: string | undefined): boolean {
  return seedDevAdmin === '1';
}

/**
 * The seeding encryption key. Refuses rather than falling back: a seed
 * that encrypts under a key the server does not hold produces rows that
 * look fine and cannot be read.
 */
export function resolveSeedEncryptionKey(encryptionKey: string | undefined): string {
  if (!encryptionKey || encryptionKey.trim() === '') {
    throw new Error(
      'Refusing to seed: ENCRYPTION_KEY is not set. The seed used to fall ' +
        "back to 'a'.repeat(64), which does not fail — it writes " +
        'phoneEncrypted values the real server cannot decrypt, so every ' +
        'seeded account becomes unreadable the moment the server starts ' +
        'with its own key. Set ENCRYPTION_KEY to the same 64-hex-character ' +
        'value the server will run with.',
    );
  }
  const key = encryptionKey.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      'Refusing to seed: ENCRYPTION_KEY must be exactly 64 hexadecimal ' +
        `characters (32 bytes for aes-256-gcm); got ${key.length} character(s). ` +
        'A malformed key throws inside createCipheriv, or worse, silently ' +
        'derives a different key than the server uses.',
    );
  }
  return key;
}
