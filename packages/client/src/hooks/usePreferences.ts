import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

/**
 * Cross-platform preferences with a sync read cache.
 *
 * - Web: localStorage is the only storage. Sync and async getters both
 *   read from localStorage; async setters write back to localStorage.
 * - Native: Capacitor Preferences is the durable backing store
 *   (survives app updates). localStorage in the WebView mirrors the
 *   durable values so synchronous reads at module-load time
 *   (initial Zustand state, i18n init, useState initial values) keep
 *   working without an `await`.
 *
 * Call `prefs.hydrate()` once at app boot, before React renders, so
 * the localStorage cache reflects any values that survived a native
 * app update.
 */

const safeLocalStorage = (() => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

export const prefs = {
  /**
   * Synchronous read from the localStorage cache. Safe to call from
   * Zustand initialisers, useState initial values, and module-load
   * code. Returns null if the key is unset or the cache hasn't been
   * hydrated yet on native.
   */
  getSync(key: string): string | null {
    return safeLocalStorage?.getItem(key) ?? null;
  },

  /**
   * Async read. On native, falls back to Capacitor Preferences (the
   * durable store) when the localStorage cache misses, then back-fills
   * the cache so subsequent sync reads succeed.
   */
  async get(key: string): Promise<string | null> {
    const cached = safeLocalStorage?.getItem(key);
    if (cached !== null && cached !== undefined) return cached;
    if (Capacitor.isNativePlatform()) {
      const { value } = await Preferences.get({ key });
      if (value !== null && value !== undefined) {
        safeLocalStorage?.setItem(key, value);
        return value;
      }
    }
    return null;
  },

  /**
   * Async write. Updates localStorage immediately so the next sync
   * read sees the new value; on native, also writes through to
   * Capacitor Preferences so the value survives app updates.
   */
  async set(key: string, value: string): Promise<void> {
    safeLocalStorage?.setItem(key, value);
    if (Capacitor.isNativePlatform()) {
      await Preferences.set({ key, value });
    }
  },

  async remove(key: string): Promise<void> {
    safeLocalStorage?.removeItem(key);
    if (Capacitor.isNativePlatform()) {
      await Preferences.remove({ key });
    }
  },

  /**
   * One-shot hydration: copies every Capacitor Preferences key into
   * localStorage. Call this at app boot before React renders so
   * synchronous initial-state reads see the durable values that
   * survived a native app update. No-op on web.
   */
  async hydrate(): Promise<void> {
    if (!Capacitor.isNativePlatform() || !safeLocalStorage) return;
    const { keys } = await Preferences.keys();
    for (const key of keys) {
      const { value } = await Preferences.get({ key });
      if (value !== null && value !== undefined) {
        safeLocalStorage.setItem(key, value);
      }
    }
  },
};

/**
 * Known preference keys. Centralised here so call sites don't repeat
 * string literals and so the set of durable-storage entries is
 * grep-able from one place.
 */
export const PREF_KEYS = {
  language: 'bimoto-lang',
  hasSeenWelcome: 'hasSeenWelcome',
  // AUTH-UX G1 — set when verify-otp answers isNewUser=true, cleared when
  // RegisterPage completes (or on logout). Durable so killing the app
  // mid-registration cannot skip the register step on relaunch.
  registrationPending: 'registrationPending',
  // OUTBOX G4 — who was signed in last, so a cold boot with no network
  // can draw this person's own home instead of the welcome carousel.
  // Identity only (id, role, display name) — NO credential: see
  // lib/session-snapshot.ts. Cleared by the logout path.
  sessionSnapshot: 'sessionSnapshot',
  // FLIGHT-RECORDER G2 — consent for the background diagnostics upload.
  // Durable (a reinstalled preference must not silently re-enable it)
  // and sync-readable, because the batcher checks it before it does
  // anything at all. Unset means ON: the signup consent screen states
  // it plainly and this key only ever holds the user's own 'false'.
  diagnosticsUpload: 'diagnosticsUpload',
  // MAP-REACH G1 — PREFIX, not a key. The map-download chip is
  // dismissible per region, so the real key is
  // `mapOfferDismissed:<region>` (see mapOfferDismissedKey below).
  //
  // Per region rather than one global flag because dismissing "download
  // Kigali" says nothing about whether a motari riding north wants
  // Amajyaruguru. A preference, not cache: it is the rider's answer to a
  // question, and it belongs beside hasSeenWelcome — durable, sync-
  // readable, and NOT in Dexie, which is where the map BYTES live and
  // which session-reset deliberately never touches.
  mapOfferDismissed: 'mapOfferDismissed',
  // NOTIFY G4 — the "Notification sounds" toggle. Same string-backed,
  // sync-readable, default-ON shape as diagnosticsUpload above, and for
  // the same reason: lib/notification-sound.ts reads it from inside a
  // socket handler that cannot await, and an unset key must mean the
  // documented default rather than a silence nobody chose.
  notificationSounds: 'notificationSounds',
} as const;

/** The durable key holding "this rider dismissed the offer for <region>". */
export function mapOfferDismissedKey(region: string): string {
  return `${PREF_KEYS.mapOfferDismissed}:${region}`;
}

export interface UsePreferenceResult<T extends string = string> {
  value: T | null;
  setValue: (next: T) => Promise<void>;
  remove: () => Promise<void>;
  loading: boolean;
}

/**
 * React hook around a single preference key. Reads the sync cache for
 * the initial render, then refreshes from the durable store on mount
 * (no-op on web).
 */
export function usePreference<T extends string = string>(key: string): UsePreferenceResult<T> {
  const [value, setStateValue] = useState<T | null>(() => prefs.getSync(key) as T | null);
  const [loading, setLoading] = useState(Capacitor.isNativePlatform());

  useEffect(() => {
    let cancelled = false;
    if (!Capacitor.isNativePlatform()) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    prefs.get(key).then((next) => {
      if (!cancelled) {
        setStateValue((next as T | null) ?? null);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const setValue = useCallback(
    async (next: T) => {
      await prefs.set(key, next);
      setStateValue(next);
    },
    [key],
  );

  const remove = useCallback(async () => {
    await prefs.remove(key);
    setStateValue(null);
  }, [key]);

  return { value, setValue, remove, loading };
}

/**
 * First-launch welcome flag. Stored as a string so it fits the same
 * Capacitor/localStorage shape as every other pref; consumers see a
 * boolean and a single `markSeen()` setter.
 */
export interface UseHasSeenWelcomeResult {
  hasSeen: boolean;
  loading: boolean;
  markSeen: () => Promise<void>;
}

export function useHasSeenWelcome(): UseHasSeenWelcomeResult {
  const { value, setValue, loading } = usePreference(PREF_KEYS.hasSeenWelcome);
  return {
    hasSeen: value === 'true',
    loading,
    markSeen: () => setValue('true'),
  };
}

/**
 * FLIGHT-RECORDER G2 — the diagnostics-upload consent toggle.
 *
 * Same string-backed shape as every other preference; consumers see a
 * boolean. Default ON, and only the explicit string 'false' turns it
 * off — an unset key is a user who read the consent screen and did not
 * object, and a half-written value fails towards the documented default
 * rather than towards a silence nobody chose.
 */
export interface UseDiagnosticsUploadResult {
  enabled: boolean;
  loading: boolean;
  setEnabled: (next: boolean) => Promise<void>;
}

export function useDiagnosticsUpload(): UseDiagnosticsUploadResult {
  const { value, setValue, loading } = usePreference(PREF_KEYS.diagnosticsUpload);
  return {
    enabled: value !== 'false',
    loading,
    setEnabled: (next: boolean) => setValue(next ? 'true' : 'false'),
  };
}

/**
 * MAP-REACH G1 — "I have seen the offer to download this region's map
 * and I do not want it."
 *
 * Same string-backed shape as every other preference. Unset means NOT
 * dismissed, so the offer is shown until a rider actually says no —
 * failing towards the offer rather than towards the silence that made
 * the download undiscoverable in the first place.
 *
 * There is deliberately no un-dismiss here. The full manager is one tap
 * away in Settings, and a rider who changes their mind goes there; a
 * chip that came back on its own would be the nagging this is meant not
 * to be.
 */
export interface UseMapOfferDismissedResult {
  dismissed: boolean;
  loading: boolean;
  dismiss: () => Promise<void>;
}

export function useMapOfferDismissed(region: string): UseMapOfferDismissedResult {
  const { value, setValue, loading } = usePreference(mapOfferDismissedKey(region));
  return {
    dismissed: value === 'true',
    loading,
    dismiss: () => setValue('true'),
  };
}

/**
 * NOTIFY G4 — the notification-sound consent toggle.
 *
 * Identical shape and default to useDiagnosticsUpload above. OFF means
 * playNotificationSound() returns without touching the audio graph —
 * the toast still renders, and the ~15 seconds it stays on screen are
 * unaffected. Sound is an addition to a notification, never the
 * notification itself.
 */
export type UseNotificationSoundsResult = UseDiagnosticsUploadResult;

export function useNotificationSounds(): UseNotificationSoundsResult {
  const { value, setValue, loading } = usePreference(PREF_KEYS.notificationSounds);
  return {
    enabled: value !== 'false',
    loading,
    setEnabled: (next: boolean) => setValue(next ? 'true' : 'false'),
  };
}
