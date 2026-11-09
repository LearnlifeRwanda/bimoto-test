// LIB/APP-LOCK.TS
//
// APP-LOCK G4 — the optional second code that covers the whole app.
// Founder ruling D25; sits beside secure-token-store.ts and uses the
// same storage posture.
//
// A DIFFERENT THING FROM THE MONEY PIN, on purpose:
//
//   money PIN   server-side, mandatory for drivers, 4 digits, guards the
//               money surfaces only.
//   app lock    DEVICE-LOCAL, optional for everyone, default OFF, 6+
//               digits, covers every route.
//
// NEVER SENT TO ANY SERVER, in any form. There is no endpoint, no field,
// no sync. The hash is written to the same secure device storage the
// refresh token uses and read back on the same device. That is what makes
// it work OFFLINE, which is the point: a motari in a place with no signal
// must still be able to open his own phone.
//
// D26 — NO BIOMETRICS. Not here, not anywhere, ever. This project is
// completely free of biometric APIs, and a test greps the client to prove
// it. The lock is a number you know, never a part of your body.
//
// THE FORMAT SEPARATION IS THE CONFUSION MITIGATION, and it is forced
// rather than checked. The money PIN is never on the device, so this
// module CANNOT compare a candidate code against it to reject a
// duplicate — there is nothing here to compare with. So it rejects by
// SHAPE: 4-digit codes are refused outright and 6+ is required, which
// makes a code equal to the money PIN impossible to enter by
// construction. The setup screen says exactly that, because a rule the
// user cannot see is a rule that reads as a bug.

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { APP_LOCK_MIN_LENGTH, MONEY_PIN_LENGTH } from '@bimoto/shared';

const CODE_KEY = 'bimoto.appLock.code';
const TIMEOUT_KEY = 'bimoto.appLock.timeoutMinutes';

/**
 * Background-timeout options, in minutes. `0` means "cold start only" —
 * the default, and the least surprising: the app locks when it is
 * genuinely restarted and never in the middle of a working day.
 */
export const APP_LOCK_TIMEOUT_OPTIONS = [0, 1, 5, 15] as const;
export type AppLockTimeout = (typeof APP_LOCK_TIMEOUT_OPTIONS)[number];

interface SecureStoragePlugin {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<unknown>;
  remove(options: { key: string }): Promise<unknown>;
}

// Same runtime detection as secure-token-store: installing a
// hardware-backed plugin upgrades storage without a code change.
function getSecureStoragePlugin(): SecureStoragePlugin | null {
  try {
    if (Capacitor.isPluginAvailable('SecureStoragePlugin')) {
      const plugins = (Capacitor as unknown as { Plugins?: Record<string, unknown> }).Plugins;
      const plugin = plugins?.SecureStoragePlugin as SecureStoragePlugin | undefined;
      if (plugin && typeof plugin.get === 'function') return plugin;
    }
  } catch {
    // Fall through to Preferences.
  }
  return null;
}

async function readKey(key: string): Promise<string | null> {
  const secure = getSecureStoragePlugin();
  if (secure) {
    try {
      const { value } = await secure.get({ key });
      return value || null;
    } catch {
      // Secure plugins commonly throw on a missing key.
      return null;
    }
  }
  const { value } = await Preferences.get({ key });
  return value || null;
}

async function writeKey(key: string, value: string): Promise<void> {
  const secure = getSecureStoragePlugin();
  if (secure) {
    await secure.set({ key, value });
    return;
  }
  await Preferences.set({ key, value });
}

async function removeKey(key: string): Promise<void> {
  const secure = getSecureStoragePlugin();
  if (secure) {
    try {
      await secure.remove({ key });
    } catch {
      // Missing key — already clear.
    }
    return;
  }
  await Preferences.remove({ key });
}

export type CodeRejection =
  /** Exactly the money-PIN length. Refused by shape — see the header. */
  | 'LOOKS_LIKE_MONEY_PIN'
  /** Shorter than the minimum but not the money-PIN length. */
  | 'TOO_SHORT'
  | 'NOT_DIGITS';

/**
 * The shape rule, exported so the setup screen can explain a refusal in
 * the words that match the reason rather than one generic message.
 */
export function validateAppLockCode(code: string): CodeRejection | null {
  if (!/^\d+$/.test(code)) return 'NOT_DIGITS';
  if (code.length === MONEY_PIN_LENGTH) return 'LOOKS_LIKE_MONEY_PIN';
  if (code.length < APP_LOCK_MIN_LENGTH) return 'TOO_SHORT';
  return null;
}

/**
 * SHA-256 of the code, hex.
 *
 * HONEST ABOUT WHAT THIS BUYS. It is a bare hash, not a KDF, and a 6-digit
 * space is small enough to enumerate offline in moments. It is NOT
 * pretending to resist an attacker who has extracted the device's secure
 * storage — such an attacker has already lost you more than this code
 * protects. What it buys is that the code is not sitting in plaintext in
 * app storage where a backup, a file browser or a support dump would show
 * it. The threat this whole feature answers is the person holding the
 * unlocked phone, and against that person a hash and a KDF are identical.
 *
 * (The money PIN, which guards something worth attacking, is HMAC'd with a
 * server-held key and never touches the device at all.)
 */
async function hashCode(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function isAppLockArmed(): Promise<boolean> {
  return (await readKey(CODE_KEY)) !== null;
}

/** Arms the lock. Returns the rejection when the code fails the shape rule. */
export async function armAppLock(code: string): Promise<CodeRejection | null> {
  const rejection = validateAppLockCode(code);
  if (rejection) return rejection;
  await writeKey(CODE_KEY, await hashCode(code));
  return null;
}

/**
 * Device-local verify. No network, so it works with no signal — which is
 * the requirement, not a nice-to-have.
 */
export async function verifyAppLockCode(code: string): Promise<boolean> {
  const stored = await readKey(CODE_KEY);
  if (!stored) return false;
  return stored === (await hashCode(code));
}

/**
 * Disarms. Called by the Settings toggle AFTER a successful verify, and
 * unconditionally by logout.
 *
 * LOGOUT IS THE RECOVERY PATH, and the only one (ruling D25): there is no
 * custom reset, no support override, no backdoor. Someone who forgets the
 * code logs out — which disarms the lock — and logs back in with an SMS
 * OTP. A device-local secret with a remote recovery path is not a
 * device-local secret, and every backdoor built for a forgetful owner is
 * a backdoor for the person holding his phone.
 */
export async function disarmAppLock(): Promise<void> {
  await removeKey(CODE_KEY);
  await removeKey(TIMEOUT_KEY);
}

export async function getAppLockTimeout(): Promise<AppLockTimeout> {
  const raw = await readKey(TIMEOUT_KEY);
  const parsed = Number(raw);
  return (APP_LOCK_TIMEOUT_OPTIONS as readonly number[]).includes(parsed)
    ? (parsed as AppLockTimeout)
    : 0;
}

export async function setAppLockTimeout(minutes: AppLockTimeout): Promise<void> {
  await writeKey(TIMEOUT_KEY, String(minutes));
}
