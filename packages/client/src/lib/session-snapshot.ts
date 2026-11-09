// LIB/SESSION-SNAPSHOT.TS
//
// OUTBOX G4 — the app remembering who you are when it cannot ask.
//
// A motari kills the app in a dead zone and reopens it. Before this,
// the boot did the only thing it could: `apiFetch('/api/users/me')`
// failed, `setUser(null)` ran, and a man who has been using Bimoto for
// three months got the welcome carousel — or the login form — because
// nothing on the phone said who had been signed in.
//
// WHAT THIS IS NOT: a credential. It holds a user id, a role and a
// display name, and it authenticates NOTHING. There is no token here,
// no way to derive one, and no request the app can make with it. The
// access token stays memory-only and the refresh token stays exactly
// where secure-token-store already put it — this dispatch persists no
// new secret, which is the condition it was allowed to exist under.
//
// So what does it buy? Exactly one thing: the app can decide which
// screen to draw before the network answers. Every API-backed panel on
// that screen is still empty and still says so, because none of them
// can be filled without a real session. The moment the network returns,
// the normal bootstrap runs and the SERVER decides — and if the server
// says the session is dead, the normal logout path runs and this is
// erased. The snapshot never outranks a server verdict; it only covers
// the gap where there is no verdict to be had.

import { prefs, PREF_KEYS } from '../hooks/usePreferences';

export interface SessionSnapshot {
  userId: string;
  role: string;
  displayName: string;
}

function isSnapshot(value: unknown): value is SessionSnapshot {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === 'string' &&
    v.userId.length > 0 &&
    typeof v.role === 'string' &&
    v.role.length > 0 &&
    typeof v.displayName === 'string'
  );
}

/**
 * Synchronous read, for the boot decision. Safe before React renders:
 * `prefs.hydrate()` in main.tsx has already copied the durable native
 * value into the localStorage cache (same contract `hasSeenWelcome`
 * relies on).
 */
export function readSessionSnapshot(): SessionSnapshot | null {
  const raw = prefs.getSync(PREF_KEYS.sessionSnapshot);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Record who is signed in. Called on every successful `setUser`, so a
 * role change or a nickname edit is reflected on the next cold boot.
 * Fire-and-forget: the localStorage write inside is synchronous and
 * only the native write-through is async, and a failed write must never
 * break a login.
 */
export function writeSessionSnapshot(user: {
  id: string;
  role: string;
  nickname?: string;
}): void {
  const snapshot: SessionSnapshot = {
    userId: user.id,
    role: user.role,
    displayName: user.nickname ?? '',
  };
  void prefs.set(PREF_KEYS.sessionSnapshot, JSON.stringify(snapshot));
}

/**
 * Forget. Called from the logout path, so signing out on a borrowed
 * phone leaves nothing for the next person's cold boot to restore.
 */
export function clearSessionSnapshot(): void {
  void prefs.remove(PREF_KEYS.sessionSnapshot);
}
