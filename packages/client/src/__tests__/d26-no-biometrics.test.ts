// D26 — THIS PROJECT IS COMPLETELY FREE FROM BIOMETRICS.
//
// A standing constraint, not a preference, so it is asserted mechanically
// rather than trusted to review. The money PIN and the app lock are both
// places where "just add a fingerprint unlock" is the obvious next
// suggestion, and this test is what makes that suggestion fail loudly
// instead of shipping.
//
// It greps the CLIENT SOURCE — every .ts/.tsx under src — because that is
// where a biometric API would have to be called from: the plugins are
// device-side, and no server code can reach a fingerprint reader.

import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

const SRC = resolve(__dirname, '..');

/**
 * Patterns that would mean a biometric API had entered the client.
 *
 * REGEXES, NOT BARE SUBSTRINGS, and the reason is worth recording: the
 * first version of this test matched the substring "Fingerprint" and
 * failed on `errorFingerprint` — the error-grouping hash in
 * @bimoto/shared, which has nothing to do with anybody's thumb. A guard
 * that cries wolf gets weakened or deleted, so it matches the shapes a
 * biometric API actually takes: plugin names, credential APIs, and
 * fingerprint/face words bound to authentication rather than to hashing.
 */
const FORBIDDEN: Array<[string, RegExp]> = [
  // capacitor-native-biometric, BiometricAuth, NativeBiometric, ...
  ['Biometric', /biometric/i],
  // FingerprintAIO, fingerprintAuth, fingerprint scanner/sensor/unlock
  ['Fingerprint auth', /fingerprint\s*(aio|auth|scanner|sensor|unlock|prompt)/i],
  ['FaceID', /face\s*id\b/i],
  ['TouchID', /touch\s*id\b/i],
  // WebAuthn — platform authenticators are biometric by design.
  ['WebAuthn', /webauthn|PublicKeyCredential|navigator\.credentials/i],
];

/**
 * Strips comments and reads CODE only.
 *
 * Also learned from a failing run: the first precise version flagged
 * LockScreen.tsx and app-lock.ts — for the comments that DOCUMENT the
 * ban ("D26 — NO BIOMETRICS", "no fingerprint prompt, no face prompt").
 * D26 forbids a biometric API, not the sentence explaining why there
 * isn't one, and a guard that punishes its own documentation teaches
 * people to stop writing the documentation.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('D26 — no biometrics, anywhere in the client', () => {
  const files = sourceFiles(SRC).filter((f) => !f.endsWith('d26-no-biometrics.test.ts'));

  test('the sweep actually reads a meaningful number of files', () => {
    // Guards the guard: a broken walker that finds nothing would make
    // every assertion below vacuously true.
    expect(files.length).toBeGreaterThan(100);
  });

  test.each(FORBIDDEN)('no client source uses %s', (_label, pattern) => {
    const offenders = files.filter((f) => pattern.test(codeOnly(readFileSync(f, 'utf8'))));
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  test('the app lock offers a code and nothing else', () => {
    // The screen most likely to grow a fingerprint prompt.
    const lock = codeOnly(readFileSync(join(SRC, 'components/lock/LockScreen.tsx'), 'utf8'));
    for (const [, pattern] of FORBIDDEN) {
      expect(pattern.test(lock)).toBe(false);
    }
  });

  test('no biometric plugin is even installed', () => {
    // Belt to the source sweep's braces: a dependency is how one would
    // arrive in the first place.
    const pkg = readFileSync(resolve(SRC, '..', 'package.json'), 'utf8');
    expect(/biometric|fingerprint|face-?id|touch-?id/i.test(pkg)).toBe(false);
  });
});
