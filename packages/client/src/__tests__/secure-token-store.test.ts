// PREPROTO-AUTH G6 — refresh-token containment: persisted only on a
// native platform (secure plugin when installed, Preferences fallback),
// never localStorage, and a strict no-op on the web where the httpOnly
// cookies carry the session.

import { describe, test, expect, beforeEach, vi } from 'vitest';

const isNativeRef = { value: false };
const securePluginRef = { value: null as null | Record<string, any> };
const prefStore = new Map<string, string>();

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNativeRef.value,
    isPluginAvailable: (name: string) =>
      name === 'SecureStoragePlugin' && securePluginRef.value !== null,
    get Plugins() {
      return securePluginRef.value ? { SecureStoragePlugin: securePluginRef.value } : {};
    },
  },
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: prefStore.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      prefStore.set(key, value);
    }),
    remove: vi.fn(async ({ key }: { key: string }) => {
      prefStore.delete(key);
    }),
  },
}));

import {
  getStoredRefreshToken,
  storeRefreshToken,
  clearStoredRefreshToken,
} from '../lib/secure-token-store';

beforeEach(() => {
  isNativeRef.value = false;
  securePluginRef.value = null;
  prefStore.clear();
  localStorage.clear();
  vi.clearAllMocks();
});

describe('web (non-native) platform', () => {
  test('never persists anything — store/get/clear are no-ops', async () => {
    await storeRefreshToken('some-refresh-token');
    expect(prefStore.size).toBe(0);
    expect(localStorage.length).toBe(0);
    expect(await getStoredRefreshToken()).toBeNull();
    await clearStoredRefreshToken();
  });
});

describe('native platform — Preferences fallback', () => {
  beforeEach(() => {
    isNativeRef.value = true;
  });

  test('round-trips the refresh token via Capacitor Preferences', async () => {
    await storeRefreshToken('refresh-token-1');
    expect(await getStoredRefreshToken()).toBe('refresh-token-1');
    // Sandboxed Preferences, never the WebView's localStorage.
    expect(localStorage.length).toBe(0);
  });

  test('clear removes the stored token', async () => {
    await storeRefreshToken('refresh-token-1');
    await clearStoredRefreshToken();
    expect(await getStoredRefreshToken()).toBeNull();
  });

  test('returns null when nothing is stored', async () => {
    expect(await getStoredRefreshToken()).toBeNull();
  });
});

describe('native platform — secure storage plugin preferred', () => {
  const secureStore = new Map<string, string>();

  beforeEach(() => {
    isNativeRef.value = true;
    secureStore.clear();
    securePluginRef.value = {
      get: vi.fn(async ({ key }: { key: string }) => {
        if (!secureStore.has(key)) throw new Error('Item with given key does not exist');
        return { value: secureStore.get(key)! };
      }),
      set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
        secureStore.set(key, value);
        return { value: true };
      }),
      remove: vi.fn(async ({ key }: { key: string }) => {
        secureStore.delete(key);
        return { value: true };
      }),
    };
  });

  test('uses the plugin instead of Preferences when installed', async () => {
    await storeRefreshToken('refresh-token-2');
    expect(secureStore.get('bimoto.refreshToken')).toBe('refresh-token-2');
    expect(prefStore.size).toBe(0);
    expect(await getStoredRefreshToken()).toBe('refresh-token-2');
  });

  test('missing-key throw from the plugin reads as null', async () => {
    expect(await getStoredRefreshToken()).toBeNull();
  });
});
