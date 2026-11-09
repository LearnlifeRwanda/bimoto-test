// FLIGHT-RECORDER G3 — the abnormal-end marker.
//
// The whole design is one distinction, and these tests are mostly about
// the wrong side of it: an app that was BACKGROUNDED and then killed is
// not an incident, it is an Android phone doing its job. Only a session
// that died while it was in front of the user leaves an entry.
//
// So the load-bearing cases here are the ones that must record NOTHING.

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  startSessionMarker,
  _resetSessionMarkerForTests,
  _readSessionMarkerForTests,
} from '../services/session-marker';
import {
  initErrorLedger,
  readErrorLedger,
  _resetErrorLedgerForTests,
} from '../services/error-ledger';

const MARKER_KEY = 'bimoto-session-marker-v1';

/** Everything the ledger holds that describes an abnormal end. */
function abnormalEntries() {
  return readErrorLedger().filter((e) => e.kind === 'abnormal-end');
}

/** The app leaves the foreground — the clean exit, on device and on web. */
function background(): void {
  Object.defineProperty(document, 'visibilityState', {
    value: 'hidden',
    configurable: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

function foreground(): void {
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible',
    configurable: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

const LEDGER_KEY = 'bimoto-error-ledger-v1';

/**
 * The process dies with the app in front of the user: no event of any
 * kind fires, and the next boot is all that ever runs again.
 *
 * The test resets rewind module state by clearing storage, which a real
 * restart does not do — so both durable keys are carried across by hand.
 * That is the honest simulation: a restart keeps what is on disk and
 * loses only what was in memory.
 */
function reboot(): boolean {
  const marker = window.localStorage.getItem(MARKER_KEY);
  const ledger = window.localStorage.getItem(LEDGER_KEY);
  _resetSessionMarkerForTests();
  _resetErrorLedgerForTests();
  if (marker) window.localStorage.setItem(MARKER_KEY, marker);
  if (ledger) window.localStorage.setItem(LEDGER_KEY, ledger);
  initErrorLedger();
  return startSessionMarker();
}

beforeEach(() => {
  window.localStorage.clear();
  _resetSessionMarkerForTests();
  _resetErrorLedgerForTests();
  initErrorLedger();
  foreground();
});

afterEach(() => {
  _resetSessionMarkerForTests();
  _resetErrorLedgerForTests();
  window.localStorage.clear();
});

describe('a clean cycle leaves nothing behind', () => {
  test('a first-ever boot records nothing', () => {
    expect(startSessionMarker()).toBe(false);
    expect(abnormalEntries()).toHaveLength(0);
  });

  test('boot, background, boot again — nothing recorded', () => {
    startSessionMarker();
    background();
    expect(_readSessionMarkerForTests()?.open).toBe(false);

    expect(reboot()).toBe(false);
    expect(abnormalEntries()).toHaveLength(0);
  });

  test('a web reload (pagehide) is a clean exit too', () => {
    startSessionMarker();
    window.dispatchEvent(new Event('pagehide'));
    expect(_readSessionMarkerForTests()?.open).toBe(false);

    expect(reboot()).toBe(false);
    expect(abnormalEntries()).toHaveLength(0);
  });

  test('backgrounding then returning reopens the marker', () => {
    startSessionMarker();
    background();
    expect(_readSessionMarkerForTests()?.open).toBe(false);
    foreground();
    expect(_readSessionMarkerForTests()?.open).toBe(true);
  });
});

describe('a foreground death leaves exactly one entry', () => {
  test('the next boot records it once', () => {
    startSessionMarker();
    // No background, no pagehide: the process simply stops.
    expect(reboot()).toBe(true);

    const entries = abnormalEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toContain('without a clean exit');
  });

  test('it carries the previous session\'s route and timestamp', () => {
    window.history.pushState({}, '', '/ride/active');
    startSessionMarker();
    const died = _readSessionMarkerForTests();

    window.history.pushState({}, '', '/');
    reboot();

    const [entry] = abnormalEntries();
    expect(entry.message).toContain('/ride/active');
    expect(entry.message).toContain(new Date(died!.t).toISOString());
    // The entry's own route is where the app is NOW — the previous one
    // lives in the message, because recordError stamps the current path.
    expect(entry.route).toBe('/');
  });

  test('a third boot does not report the same death again', () => {
    startSessionMarker();
    expect(reboot()).toBe(true);
    // This boot exited cleanly; the one before it is already accounted for.
    background();
    expect(reboot()).toBe(false);
    expect(abnormalEntries()).toHaveLength(1);
  });

  test('two separate foreground deaths record two entries, not four', () => {
    startSessionMarker();
    reboot(); // first death reported
    reboot(); // second death reported
    expect(abnormalEntries()).toHaveLength(2);
  });
});

describe('it cannot hurt the app', () => {
  test('a corrupt marker is ignored rather than reported', () => {
    window.localStorage.setItem(MARKER_KEY, 'not json at all');
    expect(startSessionMarker()).toBe(false);
    expect(abnormalEntries()).toHaveLength(0);
    // …and the session still opens its own marker.
    expect(_readSessionMarkerForTests()?.open).toBe(true);
  });

  test('a marker missing its open flag is ignored', () => {
    window.localStorage.setItem(MARKER_KEY, JSON.stringify({ t: 1, route: '/x' }));
    expect(startSessionMarker()).toBe(false);
    expect(abnormalEntries()).toHaveLength(0);
  });

  test('calling start twice in one session is a no-op the second time', () => {
    startSessionMarker();
    expect(startSessionMarker()).toBe(false);
    expect(abnormalEntries()).toHaveLength(0);
  });

  test('the marker survives the ledger being cleared and reinitialised', () => {
    startSessionMarker();
    _resetErrorLedgerForTests();
    initErrorLedger();
    expect(_readSessionMarkerForTests()?.open).toBe(true);
  });
});
