// AUTH-UX G3 — the one client logout sequence, extracted verbatim from
// SettingsPage so the new Profile logout row and Settings share it. No
// new logout logic: hand the server the stored refresh token (native app
// has no cookie) for server-side family revocation, then run the
// existing auth.store logout path (push deregistration, secure-store
// clear, state reset). Best-effort by design — local state must clear
// even when the network call fails.
import { useAuthStore } from '../stores/auth.store';
import { getStoredRefreshToken } from './secure-token-store';
import { apiFetch } from './api';
import { disarmAppLock } from './app-lock';
import { useAppLockStore } from '../stores/app-lock.store';
import { useMoneyPinStore } from '../stores/money-pin.store';

export async function performLogout(): Promise<void> {
  const refreshToken = await getStoredRefreshToken().catch(() => null);
  await apiFetch(`/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(refreshToken ? { refreshToken } : {}),
  }).catch(() => {});

  // APP-LOCK G4 — LOGOUT DISARMS THE LOCK, and this is the whole recovery
  // path (ruling D25). There is no custom reset, no support override, no
  // backdoor: someone who forgets the code logs out and logs back in with
  // an SMS OTP. A device-local secret with a remote recovery path is not
  // a device-local secret, and every backdoor built for a forgetful owner
  // is a backdoor for the person holding his phone.
  //
  // Best-effort like everything else here: local state must clear even if
  // storage misbehaves.
  await disarmAppLock().catch(() => {});
  useAppLockStore.getState().setArmed(false, 0);

  // MONEY-PIN G3 — drop the client's step-up hint too. The server already
  // closes the real session on logout; this stops the next person on this
  // handset seeing a stale "already verified" and being surprised by a
  // prompt that then appears anyway.
  useMoneyPinStore.getState().clearStepUp();

  useAuthStore.getState().logout();
}
