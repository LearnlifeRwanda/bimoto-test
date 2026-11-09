import { create } from 'zustand';
import type { DeferralReason } from '@bimoto/shared';
import { deregisterPush } from '../hooks/usePushNotifications';
import { clearStoredRefreshToken } from '../lib/secure-token-store';
import { prefs, PREF_KEYS } from '../hooks/usePreferences';
import { resetSessionState } from '../lib/session-reset';
import {
  writeSessionSnapshot,
  clearSessionSnapshot,
  type SessionSnapshot,
} from '../lib/session-snapshot';

interface DriverProfile {
  vehicleType: string;
  registrationPlate?: string;
  vehicleDescription: string;
  avgRating: number;
  totalRides: number;
  isOnline: boolean;
  verificationStatus?: string;
  ruraAuthorizationNumber?: string | null;
  insuranceConfirmed?: boolean;
  cooperativeName?: string | null;
}

export interface User {
  id: string;
  phone?: string;
  nickname: string;
  role: string;
  language: string;
  idVerified: boolean;
  licenseVerified: boolean;
  emergencyContacts?: string[];
  completedRides: number;
  cancellationCount: number;
  totalRequests: number;
  privacyConsentAt?: string | null;
  privacyConsentVersion?: string | null;
  termsAcceptedAt?: string | null;
  termsAcceptedVersion?: string | null;
  driverTermsAcceptedAt?: string | null;
  driverTermsVersion?: string | null;
  driverProfile?: DriverProfile;
  /**
   * ACCOUNT-RIGHTS-SURFACE G2 — the live deletion request, or null/absent
   * for the overwhelming majority of accounts that have never asked.
   *
   * Purely additive, and deliberately no new store plumbing: `GET /me` has
   * carried this field since #195 and every path that writes the user
   * writes it — boot restore (App.tsx), login, and each profile refetch.
   * So the banner reads it from store state alone; there is no poll and no
   * socket behind the countdown.
   *
   * `deferredReason` is null until the 72 hours have run out AND the
   * execution job found something in the way. Typed as the shared union so
   * the reason-to-wording map is exhaustive at compile time.
   */
  accountDeletion?: {
    requestedAt: string;
    executesAt: string;
    deferredReason: DeferralReason | null;
  } | null;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  /** AUTH-UX G1 — id of the user whose registration (RegisterPage) has
   * not completed yet, or null. Keyed by user id — not a boolean — so a
   * half-registered account re-logging in on this device (verify-otp now
   * answers isNewUser=false because the row exists) is still walked back
   * to /register, while a DIFFERENT account never inherits the flag.
   * Durable (prefs) so an app kill mid-registration cannot skip it. */
  registrationPendingUserId: string | null;
  /** OUTBOX G4 — a remembered identity standing in for a session the
   * network could not confirm. Set ONLY by the boot path, and only when
   * the confirmation attempt failed for want of a connection. It carries
   * no credential and grants no API access: it exists so the app can
   * draw this person's own home instead of the welcome carousel. Cleared
   * the moment a real session (or a real rejection) arrives. */
  offlineSession: SessionSnapshot | null;
  setUser: (user: User | null) => void;
  setOfflineSession: (snapshot: SessionSnapshot | null) => void;
  setToken: (token: string | null) => void;
  setLoading: (loading: boolean) => void;
  setRegistrationPending: (userId: string | null) => void;
  /**
   * LOCATION-LIFE A G2 — keep this store's copy of the server's
   * `driverProfile.isOnline` column current when the driver toggles.
   *
   * The column was already mirrored here, but only ever written by
   * setUser — login, boot restore, a profile refetch. The toggle itself
   * lived in DashboardPage's `useState` and wrote through to nothing,
   * so the one store-level fact about whether a motari is working went
   * stale the moment he used the switch. The app-lived heartbeat reads
   * this field (App.tsx), so it has to mean what the switch says.
   *
   * A no-op when there is no user or no driver profile: this patches a
   * known driver's status, it does not invent one.
   */
  setDriverOnline: (isOnline: boolean) => void;
  logout: () => void;
}

/** True when the signed-in user still has the register step ahead. */
export function isRegistrationPending(
  state: Pick<AuthState, 'user' | 'registrationPendingUserId'>,
): boolean {
  return state.user != null && state.registrationPendingUserId === state.user.id;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  token: null,
  registrationPendingUserId: prefs.getSync(PREF_KEYS.registrationPending),
  offlineSession: null,
  // LIVE-WIRE G5 — a new number is a new person on this phone.
  //
  // The field report ("logging in with a new number kept the previous
  // profile") is not an auth failure — #159 proved the auth level
  // switches correctly. It is that NOTHING below auth was keyed by user
  // or cleared with them: the journey, bid, chat, alert and diagnostics
  // stores and the Dexie read caches all belonged to whoever logged in
  // first (see lib/session-reset.ts for the full enumeration).
  //
  // Keyed on IDENTITY CHANGE, not on every setUser: a token refresh, a
  // profile edit, or a session restore re-sets the same user, and
  // wiping a live ride's state for those would be its own defect.
  setUser: (user) => {
    const previousId = get().user?.id;
    if (previousId && user?.id !== previousId) resetSessionState();
    // OUTBOX G4 — remember who this is, so the next cold boot in a dead
    // zone draws their home. Identity only, no credential. Written on
    // every setUser (login, boot restore, profile refresh) so a role
    // change or a renamed nickname is current on the next relaunch.
    if (user) writeSessionSnapshot(user);
    // A real session outranks a remembered one, always: the moment the
    // server has spoken, the stand-in goes.
    set({ user, isAuthenticated: !!user, offlineSession: user ? null : get().offlineSession });
  },
  setOfflineSession: (offlineSession) => set({ offlineSession }),
  setToken: (token) => set({ token }),
  setLoading: (isLoading) => set({ isLoading }),
  setRegistrationPending: (userId) => {
    // Persist first (fire-and-forget: the localStorage write inside is
    // sync, only the native write-through is async) so a relaunch
    // mid-registration still sees the flag.
    void (userId
      ? prefs.set(PREF_KEYS.registrationPending, userId)
      : prefs.remove(PREF_KEYS.registrationPending));
    set({ registrationPendingUserId: userId });
  },
  setDriverOnline: (isOnline) => {
    const user = get().user;
    if (!user?.driverProfile) return;
    if (user.driverProfile.isOnline === isOnline) return;
    // Deliberately NOT setUser: this is the same person with a changed
    // status, and setUser carries identity semantics (the session-reset
    // check, the snapshot write) that a toggle has no business firing.
    set({ user: { ...user, driverProfile: { ...user.driverProfile, isOnline } } });
  },
  logout: () => {
    // Tear down push first so the server stops sending to a token the
    // user can no longer act on. Fire-and-forget — the auth state must
    // clear regardless of whether the deregister network call succeeds.
    void deregisterPush();
    // PREPROTO-AUTH G6 — drop the persisted refresh token (native secure
    // storage; no-op on web). Server-side family revocation happens in
    // the /api/auth/logout call the settings page makes.
    void clearStoredRefreshToken();
    // OUTBOX G4 — and forget who was here. Signing out on a borrowed
    // phone must leave the next person's cold boot with nothing to
    // restore; without this the snapshot would outlive the session it
    // describes, which is the one thing it must never do.
    clearSessionSnapshot();
    // The pending-registration flag stays in prefs across logout: it is
    // keyed by user id, so a different account can never inherit it,
    // while the half-registered account re-logging in is still guarded.
    //
    // LIVE-WIRE G5 — and everything that was NOT keyed by user goes
    // here. Logging out is the other half of the identity change
    // setUser watches for: without this, a logout followed by a login
    // as somebody else inside one app session never crosses setUser's
    // previousId check, because previousId is already null by then.
    resetSessionState();
    set({ user: null, isAuthenticated: false, token: null, offlineSession: null });
  },
}));

// Dev/test handle for Playwright: lets the e2e suite seed auth state
// without driving the OTP UI. Stripped from production builds.
if (typeof window !== 'undefined' && (import.meta.env.MODE !== 'production' || import.meta.env.VITE_E2E_TESTING === 'true')) {
  (window as unknown as { __BIMOTO_AUTH_STORE__?: typeof useAuthStore }).__BIMOTO_AUTH_STORE__ =
    useAuthStore;
}
