// AUTH-REFRESH G1 — the ONE client-side refresh-token exchange.
//
// Extracted from App.tsx's boot bootstrap (PREPROTO-AUTH G6) so the boot
// session restore and apiFetch's 401 recovery share a single
// implementation. The server ROTATES the refresh token on every
// exchange, so two overlapping refreshes would invalidate each other:
// the second POST would present an already-rotated token, get a 401,
// and kill the whole session. refreshSession() therefore single-flights
// — every concurrent caller awaits the same in-flight exchange.
//
// Platform split (unchanged from the boot flow):
//   - native: the refresh token lives in the secure token store and is
//     presented in the request body; the rotated replacement is written
//     back to the store on success.
//   - web: getStoredRefreshToken() is always null, the httpOnly cookie
//     carries the refresh token (the server reads it when the body has
//     none), and storeRefreshToken is a no-op — the Set-Cookie on the
//     response performs the rotation.

import { useAuthStore } from '../stores/auth.store';
import {
  getStoredRefreshToken,
  storeRefreshToken,
  clearStoredRefreshToken,
} from './secure-token-store';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function performRefresh(): Promise<string | null> {
  try {
    const stored = await getStoredRefreshToken();
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(stored ? { refreshToken: stored } : {}),
    });
    if (res.ok) {
      const data = await res.json();
      const accessToken: string | null = data.accessToken ?? null;
      useAuthStore.getState().setToken(accessToken);
      if (data.refreshToken) await storeRefreshToken(data.refreshToken);
      return accessToken;
    }
    if (res.status === 401 || res.status === 403) {
      // Revoked/rotated-elsewhere/frozen — the token is dead.
      await clearStoredRefreshToken();
    }
    return null;
  } catch {
    // Network failure — resolve null and let the caller decide (boot
    // falls through to the cookie attempt; apiFetch propagates the 401
    // and takes the logout path).
    return null;
  }
}

let inFlight: Promise<string | null> | null = null;

/**
 * Exchange the refresh token for a fresh access token. Resolves the new
 * access token (already written to the auth store) or null when the
 * exchange failed. Never rejects. Concurrent calls share one exchange.
 */
export function refreshSession(): Promise<string | null> {
  if (!inFlight) {
    inFlight = performRefresh().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/**
 * Boot-time session restore (App.tsx). Preserves the pre-extraction
 * behavior exactly: the exchange only runs when a refresh token is
 * persisted (native). On the web this resolves null without a network
 * call and the cookie flow in the boot sequence is unchanged.
 */
export async function restoreSessionAtBoot(): Promise<string | null> {
  const stored = await getStoredRefreshToken();
  if (!stored) return null;
  return refreshSession();
}
