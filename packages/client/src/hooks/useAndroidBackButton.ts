// PROFILE-RESCUE G4 — give Android's hardware Back button its expected
// meaning inside the Capacitor WebView.
//
// Without a 'backButton' listener, Capacitor's Android default finishes
// the Activity — the Kigali field report showed that turning any crash
// into a trap (Back exits, relaunch restores the same state). With this
// listener registered, Capacitor hands the event to us:
//   - when router history exists, navigate back one entry;
//   - on a root screen (nothing to go back to), send the app to the
//     background (Android's expected home/minimise behaviour) — never
//     exit into a dead state.
//
// Web/PWA behaviour is untouched: the listener is only registered when
// Capacitor reports a native platform, and the browser's own Back
// button never reaches this code.

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';

/**
 * Whether hardware Back should navigate the router rather than
 * background the app. React Router keys the initial history entry
 * 'default'; any navigated-to entry gets a generated key — so a
 * 'default' key means we are on the root entry of this app session.
 * Exported for unit tests.
 */
export function shouldNavigateBack(location: Pick<Location, 'key'>): boolean {
  return location.key !== 'default';
}

export function useAndroidBackButton(): void {
  const navigate = useNavigate();
  const location = useLocation();

  // The listener is registered once; it reads the CURRENT location via
  // a ref so re-registration on every navigation isn't needed.
  const canGoBackRef = useRef(shouldNavigateBack(location));
  canGoBackRef.current = shouldNavigateBack(location);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let removeListener: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('backButton', () => {
        if (canGoBackRef.current) {
          navigate(-1);
        } else {
          // Root screen: background the app (never App.exitApp() — a
          // killed task relaunches into restored state, which is how
          // the crash trap sealed shut).
          void App.minimizeApp().catch(() => {
            // minimizeApp is Android-only; on any other native
            // platform the event should not fire, but never throw.
          });
        }
      });
      if (cancelled) {
        void handle.remove();
      } else {
        removeListener = () => void handle.remove();
      }
    })();

    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, [navigate]);
}
