import React from 'react';
import ReactDOM from 'react-dom/client';
import { prefs } from './hooks/usePreferences';
import './index.css';

// On native, copy durable Capacitor Preferences into the localStorage
// cache before any module reads it synchronously (i18n init, Zustand
// initial state). No-op on web.
async function bootstrap() {
  // BLACKBOX G2 — the recorder goes up first, so an error during the
  // rest of boot is itself remembered. The module it loads imports
  // nothing but zustand (no i18n, no stores, no Dexie), so it cannot
  // front-run the hydrate-then-init ordering below, and the whole
  // attempt is wrapped: a ledger that will not start is a ledger that
  // is OFF, never a boot that fails.
  try {
    const { initErrorLedger } = await import('./services/error-ledger');
    initErrorLedger();
    // FLIGHT-RECORDER G3 — immediately after, because the previous
    // session's verdict must be recorded even if THIS boot goes on to
    // fail. The module imports nothing but the ledger, so it keeps the
    // ordering rule above.
    const { startSessionMarker } = await import('./services/session-marker');
    startSessionMarker();
  } catch {
    // No ledger this session. The app boots exactly as it did before.
  }

  await prefs.hydrate().catch(() => { /* swallow — first-launch cache miss is fine */ });
  await import('./i18n');
  // PUSH-CRASH G2 — imported after i18n so the boundary's module graph
  // never front-runs the hydrate-then-init boot ordering above.
  const { ErrorBoundary } = await import('./components/ErrorBoundary');
  const { default: App } = await import('./App');
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );

  // COUNTER-READY G4(e) — the service worker, on the web only.
  //
  // After React has rendered, because it is a caching optimisation and
  // nothing on screen waits for it. On native this returns immediately
  // without touching navigator.serviceWorker, which is the whole point:
  // 51 of the field's 66 error reports were this registration failing in
  // the Android WebView. Fire-and-forget with a catch of its own on top
  // of the module's — a service worker is never worth a boot failure.
  void import('./services/register-sw')
    .then(({ registerServiceWorker }) => registerServiceWorker())
    .catch(() => { /* no service worker this session */ });

  // FLIGHT-RECORDER G2 — last, on purpose. The recorder goes up FIRST
  // (above) because it must see boot fail; the uploader goes up LAST
  // because it imports the auth store and the api layer, and nothing
  // heavier than zustand may front-run the hydrate-then-init ordering.
  // Fire-and-forget: a failure here costs this session's background
  // upload and nothing else.
  void import('./services/diagnostics-upload')
    .then(({ startDiagnosticsUpload }) => startDiagnosticsUpload())
    .catch(() => { /* no background upload this session */ });
}

// PUSH-CRASH G2 — the React error boundary can only catch exceptions
// inside the rendered tree. A failure in bootstrap() itself (module
// import, hydrate rethrow) would otherwise leave a permanently blank
// WebView, so degrade to a bare-DOM retry screen as the outermost net.
bootstrap().catch((err) => {
  console.error('[boot] bootstrap failed:', err);
  // BLACKBOX G2 — the white-screen case is the one worth remembering
  // most, and it is the one the React boundary can never see. Recording
  // is best-effort: if the ledger never came up, the retry screen below
  // renders exactly as before.
  void import('./services/error-ledger')
    .then(({ recordError }) =>
      recordError({ kind: 'boot', message: err?.message ?? err, stack: err?.stack }),
    )
    .catch(() => { /* no ledger — the recovery screen still shows */ });
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;font-family:sans-serif;color:#374151;';
  const msg = document.createElement('p');
  msg.textContent = 'Something went wrong';
  const btn = document.createElement('button');
  btn.textContent = 'Retry';
  btn.style.cssText =
    'min-height:44px;padding:10px 24px;border:0;border-radius:8px;background:#1B4F72;color:#fff;font-weight:500;';
  btn.addEventListener('click', () => window.location.reload());
  wrap.append(msg, btn);
  root.append(wrap);
});
