// FLIGHT-RECORDER G2 — the consented background upload, tested at the
// only seam that can betray a user: the network.
//
// The load-bearing case is the negative one. "Consent OFF means nothing
// leaves the device" is not a property of a comment, it is a property of
// fetch never being called, so that is what is asserted — no request, of
// any shape, to any URL.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// Connectivity is faked so the tests can be online without a network and
// can fire a reconnect on demand. Everything else in the module is the
// real thing (lib/api reports its own outcomes through it).
let onlineState = true;
const connectivityListeners: Array<(online: boolean) => void> = [];
vi.mock('../sync/connectivity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sync/connectivity')>();
  return {
    ...actual,
    getIsOnline: () => onlineState,
    onConnectivityChange: (cb: (online: boolean) => void) => {
      connectivityListeners.push(cb);
      return () => {
        const i = connectivityListeners.indexOf(cb);
        if (i >= 0) connectivityListeners.splice(i, 1);
      };
    },
  };
});

import {
  MAX_SESSION_ENTRIES,
  MIN_UPLOAD_INTERVAL_MS,
  BOOT_DELAY_MS,
  flushDiagnostics,
  isDiagnosticsUploadEnabled,
  startDiagnosticsUpload,
  _resetDiagnosticsUploadForTests,
} from '../services/diagnostics-upload';
import {
  initErrorLedger,
  recordError,
  readErrorLedger,
  _resetErrorLedgerForTests,
} from '../services/error-ledger';
import { buildErrorReport } from '../services/error-report-payload';
import { useAuthStore } from '../stores/auth.store';
import { PREF_KEYS } from '../hooks/usePreferences';

const fetchMock = vi.fn();

const BASE_TIME = new Date('2026-08-16T09:00:00Z');

/** The JSON body of the nth POST the uploader made. */
function postedBody(call: number): { entries: Array<Record<string, unknown>> } {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}

/** Fire a real reconnect at every listener the module registered. */
function reconnect(): void {
  onlineState = true;
  connectivityListeners.forEach((cb) => cb(true));
}

function advance(ms: number): void {
  vi.setSystemTime(new Date(Date.now() + ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_TIME);
  window.localStorage.clear();
  connectivityListeners.length = 0;
  onlineState = true;
  _resetDiagnosticsUploadForTests();
  _resetErrorLedgerForTests();
  initErrorLedger();
  useAuthStore.setState({ token: 'tok', isAuthenticated: true, isLoading: false });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'r1' }) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  _resetDiagnosticsUploadForTests();
  _resetErrorLedgerForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('consent gates the network absolutely', () => {
  test('consent OFF sends nothing at all — not one request', async () => {
    window.localStorage.setItem(PREF_KEYS.diagnosticsUpload, 'false');
    recordError({ kind: 'window-error', message: 'boom' });

    expect(isDiagnosticsUploadEnabled()).toBe(false);
    await expect(flushDiagnostics({ force: true })).resolves.toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('consent OFF silences the boot attempt and the reconnect trigger', async () => {
    window.localStorage.setItem(PREF_KEYS.diagnosticsUpload, 'false');
    recordError({ kind: 'window-error', message: 'boom' });

    startDiagnosticsUpload();
    await vi.advanceTimersByTimeAsync(BOOT_DELAY_MS + 1);
    reconnect();
    await vi.runAllTicks();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('unset consent is ON — the pilot default, stated at signup', () => {
    expect(window.localStorage.getItem(PREF_KEYS.diagnosticsUpload)).toBeNull();
    expect(isDiagnosticsUploadEnabled()).toBe(true);
  });

  test('the manual send path does not consult consent at all', () => {
    window.localStorage.setItem(PREF_KEYS.diagnosticsUpload, 'false');
    recordError({ kind: 'window-error', message: 'boom' });
    // What ErrorLogSection posts when the button is tapped: the same
    // serializer, with no consent check anywhere in its path.
    const body = buildErrorReport(readErrorLedger());
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].message).toBe('boom');
  });
});

describe('what goes on the wire', () => {
  test('an authenticated online session uploads the unsent entries once', async () => {
    recordError({ kind: 'window-error', message: 'boom' });
    recordError({ kind: 'api-server', message: 'server said no', status: 500 });

    await expect(flushDiagnostics({ force: true })).resolves.toBe('sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/diagnostics/error-report');
    expect(init.method).toBe('POST');
    expect(postedBody(0).entries).toHaveLength(2);
  });

  test('the uploaded bytes ARE the shared serializer, not a second format', async () => {
    recordError({ kind: 'window-error', message: 'boom' });
    await flushDiagnostics({ force: true });

    // Identity, not similarity: same function, same output, same bytes
    // the Diagnostics screen previews.
    expect(fetchMock.mock.calls[0][1].body).toBe(
      JSON.stringify(buildErrorReport(readErrorLedger())),
    );
  });

  test('a reconnect flushes what accumulated while offline', async () => {
    startDiagnosticsUpload();
    onlineState = false;
    recordError({ kind: 'api-network', message: 'no response' });
    await vi.advanceTimersByTimeAsync(BOOT_DELAY_MS + 1);
    expect(fetchMock).not.toHaveBeenCalled();

    reconnect();
    await vi.runAllTicks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(postedBody(0).entries[0].message).toBe('no response');
  });

  test('entries already accepted are not sent again', async () => {
    recordError({ kind: 'window-error', message: 'boom' });
    await flushDiagnostics({ force: true });
    await expect(flushDiagnostics({ force: true })).resolves.toBe('skipped');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('an entry recorded after a successful upload is sent on its own', async () => {
    recordError({ kind: 'window-error', message: 'first' });
    await flushDiagnostics({ force: true });

    advance(5_000);
    recordError({ kind: 'window-error', message: 'second' });
    await expect(flushDiagnostics({ force: true })).resolves.toBe('sent');

    const second = postedBody(1).entries;
    expect(second).toHaveLength(1);
    expect(second[0].message).toBe('second');
  });

  test('a same-millisecond sibling of an uploaded entry is not mistaken for it', async () => {
    recordError({ kind: 'window-error', message: 'first' });
    await flushDiagnostics({ force: true });

    // No clock advance at all: the new entry shares the high-water
    // timestamp and is distinguished by its fingerprint alone.
    recordError({ kind: 'window-error', message: 'a different fault' });
    await expect(flushDiagnostics({ force: true })).resolves.toBe('sent');
    expect(postedBody(1).entries).toHaveLength(1);
    expect(postedBody(1).entries[0].message).toBe('a different fault');
  });

  test('duplicates collapse into one row that still says how many', async () => {
    for (let i = 0; i < 4; i += 1) {
      recordError({ kind: 'unhandled-rejection', message: 'the same fault' });
    }
    await flushDiagnostics({ force: true });

    const entries = postedBody(0).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].dup).toBe(4);
    expect(entries[0].fp).toEqual(expect.any(String));
  });

  test('distinct faults are not collapsed', async () => {
    recordError({ kind: 'unhandled-rejection', message: 'first fault' });
    recordError({ kind: 'unhandled-rejection', message: 'second fault' });
    await flushDiagnostics({ force: true });
    expect(postedBody(0).entries).toHaveLength(2);
  });
});

describe('bounds', () => {
  test('the session cap stops the uploader after MAX_SESSION_ENTRIES', async () => {
    // Short letter pairs, deliberately: the fingerprint normaliser
    // flattens digits (so numbered messages would be ONE group), and the
    // ledger's own redaction eats any run of 32+ word characters (so a
    // growing filler string would be one group too). Neither would ever
    // reach the cap this test is about.
    const label = (i: number) =>
      `fault ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`;
    for (let i = 0; i < MAX_SESSION_ENTRIES; i += 1) {
      recordError({ kind: 'window-error', message: label(i) });
    }
    await expect(flushDiagnostics({ force: true })).resolves.toBe('sent');
    expect(postedBody(0).entries.length).toBe(MAX_SESSION_ENTRIES);

    advance(5_000);
    recordError({ kind: 'window-error', message: 'one fault too many' });
    // The ledger has an unsent entry and the interval is forced open;
    // the session cap is the only thing that can stop this.
    await expect(flushDiagnostics({ force: true })).resolves.toBe('skipped');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('an unforced attempt inside the minimum interval does not fire', async () => {
    recordError({ kind: 'window-error', message: 'boom' });
    await flushDiagnostics({ force: true });

    advance(1_000);
    recordError({ kind: 'window-error', message: 'another' });
    await expect(flushDiagnostics()).resolves.toBe('skipped');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    advance(MIN_UPLOAD_INTERVAL_MS);
    await expect(flushDiagnostics()).resolves.toBe('sent');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('failure leaves the device exactly as it was', () => {
  test('a non-2xx marks nothing as sent — the same entries go again', async () => {
    recordError({ kind: 'window-error', message: 'boom' });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });

    await expect(flushDiagnostics({ force: true })).resolves.toBe('failed');
    await expect(flushDiagnostics({ force: true })).resolves.toBe('sent');
    expect(postedBody(1).entries).toHaveLength(1);
  });

  test('a thrown fetch is swallowed and marks nothing', async () => {
    recordError({ kind: 'window-error', message: 'boom' });
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    await expect(flushDiagnostics({ force: true })).resolves.toBe('failed');
    await expect(flushDiagnostics({ force: true })).resolves.toBe('sent');
  });

  test('a signed-out session uploads nothing', async () => {
    useAuthStore.setState({ token: null, isAuthenticated: false });
    recordError({ kind: 'window-error', message: 'boom' });
    await expect(flushDiagnostics({ force: true })).resolves.toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('an offline device uploads nothing', async () => {
    onlineState = false;
    recordError({ kind: 'window-error', message: 'boom' });
    await expect(flushDiagnostics({ force: true })).resolves.toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('an empty ledger produces no request', async () => {
    await expect(flushDiagnostics({ force: true })).resolves.toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
