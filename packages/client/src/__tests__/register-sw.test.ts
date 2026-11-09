// COUNTER-READY G4(e) G5 — the loudest thing in the flight recorder,
// pinned in all three of its ways.
//
// 51 of the field's 66 error reports (77%) were one non-bug: sw.js
// failing to register in the Android WebView. The fix is at the source,
// so the pins are at the source too:
//
//   NATIVE      — no registration is ATTEMPTED. Not "attempted and
//                 swallowed": navigator.serviceWorker is never touched,
//                 so there is nothing to fail and nothing to report.
//   WEB         — registered, exactly as before. The PWA is unchanged.
//   WEB FAILURE — no error-class report. The rejection is caught inside
//                 the module, so it can never surface as the unhandled
//                 rejection that used to reach the error ledger.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const isNativePlatform = vi.fn(() => false);
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));

import { registerServiceWorker } from '../services/register-sw';
import {
  initErrorLedger,
  readErrorLedger,
  _resetErrorLedgerForTests,
} from '../services/error-ledger';

const registerMock = vi.fn();

function installServiceWorkerApi() {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { register: registerMock },
    configurable: true,
    writable: true,
  });
}

function removeServiceWorkerApi() {
  // A browser (or a jsdom) with no service-worker support at all.
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
}

beforeEach(() => {
  vi.clearAllMocks();
  isNativePlatform.mockReturnValue(false);
  registerMock.mockResolvedValue({ scope: 'https://example.test/' });
  installServiceWorkerApi();
  _resetErrorLedgerForTests();
  initErrorLedger();
});

afterEach(() => {
  _resetErrorLedgerForTests();
  removeServiceWorkerApi();
  vi.restoreAllMocks();
});

describe('native — the bundled app is never asked', () => {
  test('no registration is attempted at all', async () => {
    isNativePlatform.mockReturnValue(true);

    const result = await registerServiceWorker();

    expect(result).toEqual({ attempted: false, registered: false });
    // Not "called and caught" — never called. This is the 51 reports.
    expect(registerMock).not.toHaveBeenCalled();
  });

  test('and therefore nothing lands in the flight recorder', async () => {
    isNativePlatform.mockReturnValue(true);
    await registerServiceWorker();
    expect(readErrorLedger()).toEqual([]);
  });
});

describe('web — the PWA is unchanged', () => {
  test('the worker is registered, at the path the plugin emits', async () => {
    const result = await registerServiceWorker();

    expect(result).toEqual({ attempted: true, registered: true });
    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  test('a browser with no serviceWorker API is not an error either', async () => {
    removeServiceWorkerApi();
    const result = await registerServiceWorker();
    expect(result).toEqual({ attempted: false, registered: false });
    expect(readErrorLedger()).toEqual([]);
  });
});

describe('web failure — a breadcrumb, never an error-class report', () => {
  test('the ledger stays empty when the browser refuses', async () => {
    registerMock.mockRejectedValue(new Error('Failed to register a ServiceWorker'));
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    const result = await registerServiceWorker();

    expect(result).toEqual({ attempted: true, registered: false });
    // THE ASSERTION THIS WHOLE FIX EXISTS FOR.
    expect(readErrorLedger()).toEqual([]);
    // …and it is not silent either: a breadcrumb, at info level.
    expect(info).toHaveBeenCalled();
    expect(String(info.mock.calls[0][0])).toContain('[sw]');
  });

  test('the rejection never escapes, so the window handler can never see it', async () => {
    registerMock.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'info').mockImplementation(() => {});

    // If this resolved to a rejected promise the app's unhandled-
    // rejection handler would record a 'unhandled-rejection' entry —
    // which is exactly how sw.js reached the ledger before.
    await expect(registerServiceWorker()).resolves.toBeDefined();
    expect(readErrorLedger()).toEqual([]);
  });

  test('CONTROL — the ledger IS recording, so an empty ring means something', async () => {
    // Without this, every assertion above would pass just as happily
    // against a ledger that had quietly turned itself off.
    const { recordError } = await import('../services/error-ledger');
    recordError({ kind: 'window-error', message: 'a real one' });
    expect(readErrorLedger()).toHaveLength(1);
  });
});
