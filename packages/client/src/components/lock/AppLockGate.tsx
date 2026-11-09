import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { LockScreen } from './LockScreen';
import { useAppLockStore } from '../../stores/app-lock.store';
import { isAppLockArmed, getAppLockTimeout } from '../../lib/app-lock';

// APP-LOCK G4 — the yield-all gate.
//
// HOW EVERY ROUTE IS COVERED WITHOUT RESTRUCTURING THE ROUTER. App.tsx's
// shell is `<BrowserRouter>` → banners → `<ScreenErrorBoundary>` →
// `<Routes>`. This component wraps the `<Routes>` subtree, and when the
// app is locked it renders the LockScreen INSTEAD of its children. The
// route table is not consulted at all.
//
// That is what makes deep links and notification taps yield too, and it
// is worth being precise about why: a deep link to /journey/abc/chat
// still SETS the URL, but no <Route> is ever mounted to match it, so
// nothing behind the lock renders, mounts, fetches or paints. There is no
// per-route opt-in to forget on the next screen someone adds — a route
// added tomorrow is covered by construction, because coverage is not a
// list.
//
// AND UNLOCK RESTORES NOTHING BUT HOME. The URL that was in the bar when
// the lock came down is deliberately not honoured: whoever handed the
// phone over may have been on a chat, and reopening it on unlock would
// make the lock a delay rather than a door.
//
// It is done through the ROUTER, not through history.replaceState. That
// distinction is load-bearing and was found by the test: replaceState
// does not notify React Router (only popstate does), so clearing the URL
// that way changed the address bar while leaving the deep-linked route
// mounted underneath. `navigate('/', { replace: true })` is the only form
// that actually re-renders — and `replace` means the covered screen is
// not left one Back press away.

export const AppLockGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const armed = useAppLockStore((s) => s.armed);
  const locked = useAppLockStore((s) => s.locked);
  const timeoutMinutes = useAppLockStore((s) => s.timeoutMinutes);
  const setArmed = useAppLockStore((s) => s.setArmed);
  const lock = useAppLockStore((s) => s.lock);
  const setBackgroundedAt = useAppLockStore((s) => s.setBackgroundedAt);
  const navigate = useNavigate();
  const wasLocked = useRef(false);

  // The locked → unlocked transition, and only that. A mount that was
  // never locked must not redirect anyone away from where they are.
  useEffect(() => {
    if (wasLocked.current && !locked) navigate('/', { replace: true });
    wasLocked.current = locked;
  }, [locked, navigate]);

  // COLD START. Reads device storage once at boot; if a code is set, the
  // store lands `armed: true, locked: true` in the same update, so a real
  // screen is never painted first and then covered.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const isArmed = await isAppLockArmed();
      const timeout = isArmed ? await getAppLockTimeout() : 0;
      if (!cancelled) setArmed(isArmed, timeout);
    })();
    return () => {
      cancelled = true;
    };
  }, [setArmed]);

  // BACKGROUND TIMEOUT, opt-in. `timeoutMinutes === 0` is the default and
  // means cold start only — the app does not lock in the middle of a
  // working day just because a driver took a call.
  useEffect(() => {
    if (!armed) return;
    let listener: { remove: () => void } | null = null;
    let disposed = false;

    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        setBackgroundedAt(Date.now());
        return;
      }
      if (timeoutMinutes <= 0) return;
      const since = useAppLockStore.getState().backgroundedAt;
      if (since && Date.now() - since >= timeoutMinutes * 60_000) lock();
      setBackgroundedAt(null);
    }).then((handle) => {
      if (disposed) handle.remove();
      else listener = handle;
    });

    return () => {
      disposed = true;
      listener?.remove();
    };
  }, [armed, timeoutMinutes, lock, setBackgroundedAt]);

  if (armed && locked) return <LockScreen />;
  return <>{children}</>;
};
