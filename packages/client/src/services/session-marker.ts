// FLIGHT-RECORDER G3 — the footprint a dead session leaves.
//
// Every source the ledger has needs JavaScript to still be running:
// componentDidCatch, window.onerror, unhandledrejection, apiFetch. The
// failures that produce nothing are exactly the ones the recorder was
// built for — the WebView renderer dying, the OS reclaiming a
// foregrounded app, a phone whose battery ends the session mid-sentence.
// Those leave no entry because there is nobody left to write one.
//
// This module writes the entry on the NEXT boot instead. A marker says
// "a session is open"; a clean departure clears it; a marker still open
// at the next start is a session that ended without one.
//
// THE FALSE-POSITIVE PROBLEM, and why this is not one:
//
//   On Android, an app being killed while backgrounded is not a crash,
//   it is Tuesday. If "the app stopped running" counted as abnormal,
//   this would report an incident every time someone took a phone call.
//   So backgrounding IS the clean exit. visibilitychange→hidden and
//   pagehide both fire in the Capacitor WebView when the Activity leaves
//   the foreground (and on web for a reload or a tab close), and either
//   one closes the marker. Coming back to the foreground reopens it.
//
//   What survives that filter is narrow and worth knowing about: the
//   process died while the app was in FRONT of the user. That is a
//   renderer crash, an OOM kill under load, or a hard power-off — and
//   in all three the person was looking at the screen when it happened.
//
// Rule zero, as everywhere in the recorder: this cannot hurt the app.
// Fire-and-forget, every path wrapped, nothing awaited. A marker that
// cannot be read or written costs one diagnostic and nothing else.
//
// Storage is localStorage for the ledger's own reason
// (error-ledger.ts:38): the write happens at the moment the page may be
// about to be destroyed, and an IndexedDB write can be lost precisely in
// the case this exists for.

import { recordError } from './error-ledger';

const MARKER_KEY = 'bimoto-session-marker-v1';

interface SessionMarker {
  /** True while the app is in the foreground with JS alive. */
  open: boolean;
  /** ms since epoch of the last transition — the last moment we know
   *  the previous session was alive. */
  t: number;
  /** location.pathname at that moment. No query string, ever. */
  route: string;
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readMarker(): SessionMarker | null {
  try {
    const raw = safeStorage()?.getItem(MARKER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionMarker> | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.open !== 'boolean') return null;
    return {
      open: parsed.open,
      t: typeof parsed.t === 'number' ? parsed.t : 0,
      route: typeof parsed.route === 'string' ? parsed.route : '',
    };
  } catch {
    return null;
  }
}

function writeMarker(open: boolean): void {
  try {
    const marker: SessionMarker = {
      open,
      t: Date.now(),
      // pathname only — the ledger's route field keeps the same rule.
      route: typeof window === 'undefined' ? '' : window.location.pathname,
    };
    safeStorage()?.setItem(MARKER_KEY, JSON.stringify(marker));
  } catch {
    // Quota, private mode, a locked store. The next boot simply finds no
    // marker and reports nothing, which is the safe direction to fail:
    // a missing incident is quieter than an invented one.
  }
}

/**
 * An ISO timestamp, chosen over epoch milliseconds on purpose: the
 * ledger's redaction masks any run of nine or more digits as a phone
 * number, so `1786000000000` would reach the entry as `**********000`.
 * An ISO string survives the same pass intact.
 */
function describe(marker: SessionMarker): string {
  const when = marker.t > 0 ? new Date(marker.t).toISOString() : 'an unknown time';
  const where = marker.route || '/';
  return `previous session ended without a clean exit — last seen on ${where} at ${when}`;
}

let started = false;

function onHidden(): void {
  // document.hidden is false on the 'visible' half of the same event.
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    writeMarker(true);
    return;
  }
  writeMarker(false);
}

function onPageHide(): void {
  writeMarker(false);
}

/**
 * Read the previous session's verdict, record it if it was abnormal, and
 * open the marker for this one.
 *
 * Called from main.tsx immediately after initErrorLedger(): this module
 * imports nothing but the ledger, so it cannot front-run the
 * hydrate-then-init boot ordering, and running it early means an
 * abnormal end is recorded even if THIS boot goes on to fail.
 *
 * Idempotent. Returns whether an abnormal end was recorded, for tests.
 */
export function startSessionMarker(): boolean {
  if (started) return false;
  started = true;
  let reported = false;
  try {
    const previous = readMarker();
    if (previous?.open) {
      recordError({ kind: 'abnormal-end', message: describe(previous) });
      reported = true;
    }
    // Written immediately, and unconditionally, so one abnormal end
    // produces one entry: the next boot reads an open marker belonging
    // to THIS session, never the one just reported.
    writeMarker(true);

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onHidden);
    }
    if (typeof window !== 'undefined') {
      // Belt and braces for the web case (reload, tab close) and for
      // WebViews that skip the visibility transition on teardown.
      window.addEventListener('pagehide', onPageHide);
    }
  } catch {
    // No marker this session. Boot continues exactly as it did before.
  }
  return reported;
}

/** Test-only: rewind module + storage state between cases. */
export function _resetSessionMarkerForTests(): void {
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onHidden);
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('pagehide', onPageHide);
  }
  started = false;
  try {
    safeStorage()?.removeItem(MARKER_KEY);
  } catch {
    // ignore
  }
}

/** Test-only: the raw marker, for asserting the lifecycle. */
export function _readSessionMarkerForTests(): SessionMarker | null {
  return readMarker();
}
