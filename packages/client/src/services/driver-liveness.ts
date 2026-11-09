// SERVICES/DRIVER-LIVENESS.TS
//
// LOCATION-LIFE A G2 — the heartbeat that says a motari is still here,
// owned by the app rather than by a screen.
//
// See stores/driver-liveness.store.ts for the defect this closes. In
// one line: liveness was a `setInterval` inside DashboardPage, so
// navigating away from the dashboard stopped the driver existing for
// discovery 300 s later, while his own screen still read "I'm online".
//
// WHAT THIS MODULE IS, AND WHY IT IS NOT A HOOK:
//
// The heartbeat must not be able to die with a component, so it is not
// mounted by one. The timer lives here, at module scope, and is driven
// by `useDriverLivenessStore.active` — a FACT about the driver, not a
// mount count. App.tsx installs the runner once and mirrors the auth
// store's truth into `active`; the dashboard sets `active` when the
// driver toggles. Nothing anywhere calls `setActive(false)` from a
// cleanup, which is the whole point: unmounting a page is not evidence
// that a motari went home.
//
// `ensureDriverLivenessRunning()` is idempotent by design and safe to
// call from more than one place. It is called from the app shell (so
// liveness holds on every screen) and from the dashboard (so the page
// is self-sufficient in isolation — its BOOK-UNBLOCK G4 contract tests
// render it alone and still exercise the periodic write).
//
// GEOLOCATION OPTIONS ARE PER-CALL, DELIBERATELY. `DEFAULT_OPTIONS` in
// hooks/useGeolocation.ts is byte-identical and stays that way: eleven
// call sites share it, including the ride-trace recorder and the
// emergency-follow stream, whose accuracy contracts (#176/#178/#180)
// must not be relaxed by a change made for a heartbeat. A liveness ping
// needs RECENCY, not precision — a two-minute-old cached fix places the
// motari in the right ring, and refusing it (maximumAge: 0) is what
// made cold phones fail.

import { DRIVER_LIVENESS_PING_MS } from '@bimoto/shared';
import { geolocation, type GeoOptions } from '../hooks/useGeolocation';
import { apiFetch, apiErrorFromResponse } from '../lib/api';
import { useDiagnosticsStore } from '../stores/diagnostics.store';
import { useDriverLivenessStore } from '../stores/driver-liveness.store';

/**
 * A heartbeat wants a position, not a survey. High accuracy is off (it
 * is what spins the GPS up and drains the battery), a fix from the last
 * two minutes is accepted rather than refused, and the ceiling is
 * generous enough that a phone indoors reports late instead of not at
 * all. Contrast DEFAULT_OPTIONS — high accuracy, 10 s, maximumAge 0 —
 * which stays exactly as it is for its other callers.
 */
const LIVENESS_GEO_OPTIONS: GeoOptions = {
  enableHighAccuracy: false,
  maximumAge: 120_000,
  timeout: 25_000,
};

let timer: ReturnType<typeof setInterval> | null = null;
let installed = false;
/** Guards against a slow ping overlapping the next beat. */
let inFlight = false;

async function ping(): Promise<boolean> {
  if (inFlight) return false;
  inFlight = true;
  try {
    const coords = await geolocation.getCurrentPosition(LIVENESS_GEO_OPTIONS);
    const res = await apiFetch('/api/users/me/location', {
      method: 'PUT',
      credentials: 'include',
      body: JSON.stringify({ lat: coords.lat, lng: coords.lng }),
    });
    if (!res.ok) throw await apiErrorFromResponse(res);
    // MATCH-CLOSE G4 — the position the server was just told, and when.
    // Nothing new is exposed: this is the value the request carried.
    useDiagnosticsStore.getState().recordLocationSent(coords.lat, coords.lng);
    useDriverLivenessStore.getState().recordPingResult({
      lat: coords.lat,
      lng: coords.lng,
    });
    return true;
  } catch {
    // A failed beat is not fatal — the freshness window tolerates two
    // (see DRIVER_LIVENESS_PING_MS). It IS visible: the dashboard turns
    // this into its existing retryable 'tracking' banner.
    useDriverLivenessStore.getState().recordPingResult(null);
    return false;
  } finally {
    inFlight = false;
  }
}

/** Ping now, outside the beat. Used by the dashboard's Retry action. */
export function pingDriverLivenessNow(): Promise<boolean> {
  return ping();
}

/**
 * (Re)start the beat. Never stacks: any existing interval is cleared
 * first — the same rule the dashboard's own tracking loop carried, for
 * the same reason (a session restore racing a manual toggle must not
 * leave two loops running).
 *
 * Restarting unconditionally, rather than returning early when a timer
 * already exists, is deliberate: "the driver went online" is the event
 * that must always produce a live beat, and reconciling here means no
 * caller has to know whether one was already running. A duplicate
 * immediate ping from two restarts in the same tick is absorbed by
 * `inFlight`.
 */
function startTimer(): void {
  if (timer) clearInterval(timer);
  // Immediately, then on the beat: going online must not cost the
  // driver a whole interval of invisibility.
  void ping();
  timer = setInterval(() => void ping(), DRIVER_LIVENESS_PING_MS);
}

function stopTimer(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

function onVisibilityChange(): void {
  // A WebView in the background gets its timers throttled — the pilot
  // accepts that degradation rather than shipping a native background
  // plugin, but it must not outlive the backgrounding. The moment the
  // motari's screen is his again, re-assert that he is here instead of
  // waiting out a beat that may have been stretched to minutes.
  if (document.hidden) return;
  if (!useDriverLivenessStore.getState().active) return;
  void ping();
}

/**
 * The one deliberate way to turn the heartbeat on or off.
 *
 * Writes the fact to the store — which is what App.tsx mirrors, what
 * session-reset clears, and what survives every navigation — and
 * reconciles the timer in the same breath, so no caller has to reason
 * about whether a beat was already running.
 */
export function setDriverLivenessOnline(online: boolean): void {
  useDriverLivenessStore.getState().setActive(online);
  if (online) startTimer();
  else stopTimer();
}

/**
 * Install the runner. Idempotent: call it from anywhere that needs
 * liveness to be running, as often as you like. The timer follows
 * `active` from here on, and no component teardown can stop it.
 */
export function ensureDriverLivenessRunning(): void {
  if (installed) return;
  installed = true;

  useDriverLivenessStore.subscribe((state, prev) => {
    if (state.active === prev.active) return;
    if (state.active) startTimer();
    else stopTimer();
  });

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  // Already online when the runner was installed (a restored session,
  // or a dashboard that toggled before the shell effect ran).
  if (useDriverLivenessStore.getState().active) startTimer();
}

/**
 * Full teardown, down to the installed listeners.
 *
 * NOTE the logout path does NOT come through here. lib/session-reset.ts
 * clears `active` on the store instead, and the subscription above
 * stops the timer — the same shape session-reset already uses for the
 * emergency-follow watch, and the reason this module imports the store
 * rather than the other way round (session-reset is reachable from
 * auth.store, which lib/api imports, so the edge has to run one way).
 *
 * This is for a genuinely cold stop: the tests use it to return the
 * module to its pre-install state between cases.
 */
export function stopDriverLiveness(): void {
  stopTimer();
  inFlight = false;
  if (installed && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
  installed = false;
}
