// PREPROTO-AUTH G6 — refresh-token persistence for the native app.
//
// The Capacitor WebView runs at https://localhost — cross-origin to the
// tunnelled backend — so the httpOnly session cookies the web client
// relies on don't apply. The native app authenticates by Bearer token
// instead, with a containment posture:
//
//   - the ACCESS token lives in memory only (auth.store), 15-minute TTL —
//     an XSS that reads it gets a short-lived credential, not a key;
//   - only the REFRESH token is persisted, and only on a native platform,
//     via a secure-storage plugin when one is installed, else Capacitor
//     Preferences (documented pilot fallback: Preferences is
//     app-sandboxed on device — NOT the browser's localStorage — and the
//     server-side rotation/reuse-detection store bounds the blast radius
//     of a leaked token);
//   - on the web this module is a no-op: cookies carry the session and
//     nothing is ever written to localStorage.

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const REFRESH_TOKEN_KEY = 'bimoto.refreshToken';

interface SecureStoragePlugin {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<unknown>;
  remove(options: { key: string }): Promise<unknown>;
}

// Optional hardware-backed storage (e.g. capacitor-secure-storage-plugin
// registering as SecureStoragePlugin). Detected at runtime so installing
// the plugin upgrades storage without a code change.
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

export async function getStoredRefreshToken(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const secure = getSecureStoragePlugin();
  if (secure) {
    try {
      const { value } = await secure.get({ key: REFRESH_TOKEN_KEY });
      return value || null;
    } catch {
      // Secure plugins commonly throw on a missing key.
      return null;
    }
  }
  const { value } = await Preferences.get({ key: REFRESH_TOKEN_KEY });
  return value || null;
}

export async function storeRefreshToken(token: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const secure = getSecureStoragePlugin();
  if (secure) {
    await secure.set({ key: REFRESH_TOKEN_KEY, value: token });
    return;
  }
  await Preferences.set({ key: REFRESH_TOKEN_KEY, value: token });
}

export async function clearStoredRefreshToken(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const secure = getSecureStoragePlugin();
  if (secure) {
    try {
      await secure.remove({ key: REFRESH_TOKEN_KEY });
    } catch {
      // Missing key — already clear.
    }
    return;
  }
  await Preferences.remove({ key: REFRESH_TOKEN_KEY });
}
