// SERVICES/REGISTER-SW.TS
//
// COUNTER-READY G4(e) — the loudest thing in the flight recorder was not
// a bug.
//
// THE EVIDENCE. The field's own 66-report dump (25 Aug) is 77% ONE
// entry: 51 reports of `sw.js` failing to register, scope
// `https://localhost/`, both roles, route `/`. That is the Android
// WebView refusing to install a service worker for the Capacitor
// origin — which is correct behaviour, on a build that does not need
// one. The bundled app ships its assets inside the APK; the web service
// worker exists to cache them for a browser, and there is no browser
// here. The registration attempt was pure noise, and it was drowning the
// ledger that real crashes have to surface through: 51 of 66 slots spent
// on a non-event, in a ring buffer capped at 50 entries.
//
// THE FIX IS AT THE SOURCE, not at the ledger. vite-plugin-pwa used to
// inject its own registration script into index.html (`injectRegister:
// 'auto'`); vite.config.ts now sets `injectRegister: null` and this
// module does the registering, so there is one call site and it can ask
// a question first.
//
//   NATIVE — no registration is attempted at all. Nothing to fail, so
//            nothing to report, and the WebView is never asked for a
//            capability it was right to refuse.
//   WEB    — registered exactly as before. The PWA's service-worker
//            behaviour is UNTOUCHED: the generated sw.js still carries
//            workbox's skipWaiting/clientsClaim for `registerType:
//            'autoUpdate'`, so a plain register() gives the same
//            self-updating worker the injected script gave.
//
// AND ON WEB, A FAILURE IS A BREADCRUMB. The attempt is awaited with its
// own .catch(), so it can never surface as an unhandled rejection —
// which is precisely how it used to reach the error ledger, through
// initErrorLedger's window handler. A browser that declines a service
// worker leaves a console line and a working app, not an error-class
// report.

import { Capacitor } from '@capacitor/core';

/** Where vite-plugin-pwa emits the generated worker (default filename). */
const SW_URL = '/sw.js';

export interface RegisterSwResult {
  /** False on native, and on a browser with no serviceWorker API. */
  attempted: boolean;
  /** True only when the browser accepted the registration. */
  registered: boolean;
}

export async function registerServiceWorker(): Promise<RegisterSwResult> {
  // The bundled Capacitor app does not need the web service worker, so
  // it does not ask for one.
  if (Capacitor.isNativePlatform()) {
    return { attempted: false, registered: false };
  }
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return { attempted: false, registered: false };
  }
  try {
    await navigator.serviceWorker.register(SW_URL, { scope: '/' });
    return { attempted: true, registered: true };
  } catch (err) {
    // A breadcrumb, deliberately at info level and deliberately not
    // rethrown: the app works without a service worker, and the ledger
    // is for things that stop it working.
    console.info(
      '[sw] service worker not registered (offline caching unavailable):',
      err instanceof Error ? err.message : err,
    );
    return { attempted: true, registered: false };
  }
}
