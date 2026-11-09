// BLACKBOX G2/G5 — the ledger's own guarantees, tested at the seam that
// matters: what ends up in storage. Every case here asserts against the
// PERSISTED bytes, not against the input, because "redaction happens at
// write time" is only true if the stored row never held the secret.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MAX_ENTRIES,
  MAX_MESSAGE_CHARS,
  MAX_STACK_CHARS,
  MAX_TOTAL_BYTES,
  byteLength,
  clearErrorLedger,
  errorLedgerCount,
  initErrorLedger,
  isErrorLedgerEnabled,
  readErrorLedger,
  recordError,
  redact,
  sameThrow,
  useErrorLedgerStore,
  _resetErrorLedgerForTests,
} from '../services/error-ledger';

const STORAGE_KEY = 'bimoto-error-ledger-v1';

/** The bytes actually on disk — the only place a leak could hide. */
function stored(): string {
  return window.localStorage.getItem(STORAGE_KEY) ?? '';
}

beforeEach(() => {
  window.localStorage.clear();
  _resetErrorLedgerForTests();
  initErrorLedger();
});

afterEach(() => {
  _resetErrorLedgerForTests();
  window.localStorage.clear();
});

describe('ring-buffer caps', () => {
  test(`keeps at most ${MAX_ENTRIES} entries, newest first`, () => {
    for (let i = 0; i < MAX_ENTRIES + 25; i++) {
      recordError({ kind: 'window-error', message: `boom ${i}` });
    }
    expect(errorLedgerCount()).toBe(MAX_ENTRIES);
    const entries = readErrorLedger();
    expect(entries[0].message).toBe(`boom ${MAX_ENTRIES + 24}`);
    expect(entries[entries.length - 1].message).toBe('boom 25');
    expect(JSON.parse(stored())).toHaveLength(MAX_ENTRIES);
  });

  test('the byte cap holds even when the entry cap would not', () => {
    // Each entry carries a ~1 KB stack: 50 of them would blow 64 KiB,
    // so the byte cap must bite before the entry cap does.
    const fatStack = 'at someFrame (app.js)\n'.repeat(120);
    const fatMessage = ' the widget was undefined again and again'.repeat(12);
    for (let i = 0; i < MAX_ENTRIES; i++) {
      recordError({ kind: 'render', message: `crash ${i}${fatMessage}`, stack: fatStack });
    }
    expect(byteLength(stored())).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
    expect(errorLedgerCount()).toBeLessThan(MAX_ENTRIES);
    // Oldest-first eviction: the newest crash is always still there.
    expect(readErrorLedger()[0].message.startsWith(`crash ${MAX_ENTRIES - 1}`)).toBe(true);
  });

  test('a runaway stack is bounded, and bounded fast', () => {
    const started = Date.now();
    recordError({
      kind: 'render',
      message: 'one enormous crash',
      stack: 'at frame (app.js)\n'.repeat(MAX_TOTAL_BYTES),
    });
    // Redaction never scans the whole thing: the crash path must not
    // become the slow path.
    expect(Date.now() - started).toBeLessThan(1000);
    const entries = readErrorLedger();
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('one enormous crash');
    expect(entries[0].stack).toHaveLength(MAX_STACK_CHARS + 1);
    expect(byteLength(stored())).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });

  test('a ring restored from disk is put back through the caps', () => {
    // A hand-edited or foreign ring does not get to spend more of this
    // device's storage than one we wrote ourselves.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          t: Date.now(),
          build: 'deadbee',
          route: '/',
          kind: 'render',
          message: 'a b '.repeat(MAX_MESSAGE_CHARS),
          stack: 'at x (y)\n'.repeat(MAX_STACK_CHARS),
        },
      ]),
    );
    useErrorLedgerStore.setState({ entries: [] });
    initErrorLedger();
    const [entry] = readErrorLedger();
    expect(entry.message).toHaveLength(MAX_MESSAGE_CHARS + 1);
    expect(entry.stack).toHaveLength(MAX_STACK_CHARS + 1);
  });
});

describe('truncation caps', () => {
  test('message and stack are capped', () => {
    // Ordinary prose, not one long opaque run — a 32+ char unbroken
    // token is a secret shape and redact() collapses it by design.
    recordError({
      kind: 'window-error',
      message: 'the widget was undefined '.repeat(MAX_MESSAGE_CHARS),
      stack: 'at render (App.tsx)\n'.repeat(MAX_STACK_CHARS),
    });
    const [entry] = readErrorLedger();
    // +1 for the ellipsis the truncation appends.
    expect(entry.message).toHaveLength(MAX_MESSAGE_CHARS + 1);
    expect(entry.stack).toHaveLength(MAX_STACK_CHARS + 1);
  });

  test('redaction runs BEFORE truncation, so a cut cannot leave half a token', () => {
    const token = `eyJhbGciOiJIUzI1NiJ9.${'a'.repeat(MAX_MESSAGE_CHARS)}.sIgNaTuReXyZ123`;
    recordError({ kind: 'window-error', message: `login failed with ${token}` });
    expect(stored()).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(stored()).not.toContain('sIgNaTuReXyZ123');
    expect(readErrorLedger()[0].message).toContain('[redacted]');
  });
});

describe('redaction at write time', () => {
  test('a planted bearer token never reaches storage', () => {
    const secret = 'Bearer sk-live-9f2c4d8e1a6b3f70c5d9e2a4b6c8d0f1';
    recordError({
      kind: 'api-network',
      message: `request rejected — ${secret}`,
      path: '/api/journeys',
      method: 'POST',
    });
    expect(stored()).not.toContain('sk-live-9f2c4d8e1a6b3f70c5d9e2a4b6c8d0f1');
    expect(readErrorLedger()[0].message).toContain('[redacted]');
  });

  test('a planted JWT never reaches storage', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    recordError({ kind: 'render', message: 'crash', stack: `at auth (${jwt})` });
    expect(stored()).not.toContain('dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    expect(stored()).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  test('key=value secrets are stripped, whatever the spelling', () => {
    recordError({
      kind: 'window-error',
      message:
        'failed: {"accessToken":"abc123def456","refresh_token":"zzz999","password":"hunter2","otp":"483920"}',
    });
    const raw = stored();
    for (const secret of ['abc123def456', 'zzz999', 'hunter2', '483920']) {
      expect(raw).not.toContain(secret);
    }
  });

  test('a planted phone number is masked, keeping only its last three digits', () => {
    recordError({ kind: 'api-server', message: 'no user for +250781234567', status: 500 });
    const raw = stored();
    expect(raw).not.toContain('250781234567');
    expect(raw).not.toContain('0781234567');
    expect(readErrorLedger()[0].message).toContain('567');
    expect(readErrorLedger()[0].message).toMatch(/\*{3,}567/);
  });

  test('query strings are stripped from every field', () => {
    recordError({
      kind: 'api-server',
      message: 'GET https://api.bimoto.rw/api/journeys?token=leaky&phone=%2B250781234567 failed',
      path: '/api/journeys?token=leaky',
      status: 502,
    });
    const raw = stored();
    expect(raw).not.toContain('leaky');
    expect(raw).not.toContain('token=');
    expect(readErrorLedger()[0].path).toBe('/api/journeys');
  });

  test('a request body has nowhere to go in an entry', () => {
    // The input type has no body field, and extra keys are ignored by
    // the write path rather than filtered on the way out.
    recordError({
      kind: 'api-server',
      message: 'HTTP 500',
      method: 'POST',
      path: '/api/journeys',
      status: 500,
      // @ts-expect-error — deliberately smuggling a body past the type.
      body: { pickupName: 'Kimironko market', recipientPhone: '+250781234567' },
      requestBody: 'wishPrice=3000',
    });
    const raw = stored();
    expect(raw).not.toContain('Kimironko');
    expect(raw).not.toContain('wishPrice');
    expect(raw).not.toContain('recipientPhone');
    expect(Object.keys(readErrorLedger()[0]).sort()).toEqual(
      ['build', 'kind', 'message', 'method', 'path', 'route', 'status', 't'].sort(),
    );
  });

  test('redact() leaves ordinary diagnostic prose alone', () => {
    const prose = 'Cannot read properties of undefined (reading pickupName)';
    expect(redact(prose)).toBe(prose);
  });
});

describe('entry shape', () => {
  test('every entry carries time, build, route and kind', () => {
    window.history.replaceState(null, '', '/journey/abc/bids');
    recordError({ kind: 'screen-render', message: 'boom' });
    const [entry] = readErrorLedger();
    expect(typeof entry.t).toBe('number');
    expect(typeof entry.build).toBe('string');
    expect(entry.route).toBe('/journey/abc/bids');
    expect(entry.kind).toBe('screen-render');
  });

  test('API entries carry status, method and path; render entries do not', () => {
    recordError({ kind: 'api-server', message: 'HTTP 503', status: 503, method: 'post', path: '/api/bids' });
    recordError({ kind: 'render', message: 'boom' });
    const [render, api] = readErrorLedger();
    expect(api.status).toBe(503);
    expect(api.method).toBe('POST');
    expect(api.path).toBe('/api/bids');
    expect(render.status).toBeUndefined();
    expect(render.path).toBeUndefined();
  });
});

describe('the ledger cannot hurt the app', () => {
  test('a ledger that cannot initialise stays off and records nothing', () => {
    // A WebView with storage disabled: touching window.localStorage
    // throws, which is exactly what private mode does.
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage');
    _resetErrorLedgerForTests();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage disabled');
      },
    });
    try {
      expect(() => initErrorLedger()).not.toThrow();
      expect(isErrorLedgerEnabled()).toBe(false);
      expect(() => recordError({ kind: 'render', message: 'boom' })).not.toThrow();
      expect(errorLedgerCount()).toBe(0);
    } finally {
      if (real) Object.defineProperty(window, 'localStorage', real);
      _resetErrorLedgerForTests();
    }
  });

  test('a failing setItem (quota) does not throw out of recordError', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => recordError({ kind: 'render', message: 'boom' })).not.toThrow();
    setItem.mockRestore();
    // The in-memory ring stayed correct so the screen can still show it.
    expect(errorLedgerCount()).toBe(1);
  });

  test('a corrupt persisted ring is discarded, not thrown', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    _resetErrorLedgerForTests();
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    expect(() => initErrorLedger()).not.toThrow();
    expect(isErrorLedgerEnabled()).toBe(true);
    expect(errorLedgerCount()).toBe(0);
  });

  test('entries survive a reload, and clear empties both memory and disk', () => {
    recordError({ kind: 'render', message: 'crash before reload' });
    // A fresh boot against the same localStorage: drop the in-memory
    // ring without touching the stored bytes.
    useErrorLedgerStore.setState({ entries: [] });
    initErrorLedger();
    expect(readErrorLedger()[0].message).toBe('crash before reload');
    clearErrorLedger();
    expect(errorLedgerCount()).toBe(0);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('global handlers', () => {
  test('an unhandled rejection lands in the ledger', () => {
    window.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), {
        reason: new Error('lost promise'),
      }),
    );
    const entries = readErrorLedger();
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('unhandled-rejection');
    expect(entries[0].message).toBe('lost promise');
  });

  test('a window error lands in the ledger', () => {
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'window boom', error: new Error('window boom') }),
    );
    const entries = readErrorLedger();
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('window-error');
  });

  test('a failed resource load is not an app error and is ignored', () => {
    window.dispatchEvent(new ErrorEvent('error', { message: '' }));
    expect(errorLedgerCount()).toBe(0);
  });
});

describe('one throw, one line', () => {
  // A development React build re-throws every error a boundary catches
  // through a synthetic event, so window.onerror fires FIRST — and the
  // browser prefixes the message it hands over. The after-table run in
  // docs/error-ledger.md §5 caught this: a real Chromium reports
  // "Uncaught Error: X" where jsdom reports "X", and matching on the
  // raw string left three rows for one crash.
  test('sameThrow sees through the browser\'s Uncaught prefix', () => {
    expect(sameThrow('Uncaught Error: the widget was undefined', 'the widget was undefined')).toBe(true);
    expect(sameThrow('Uncaught TypeError: x is not a function', 'x is not a function')).toBe(true);
    expect(sameThrow('Uncaught (in promise) boom', 'boom')).toBe(true);
    expect(sameThrow('the widget was undefined', 'the widget was undefined')).toBe(true);
    expect(sameThrow('Uncaught Error: a different crash', 'the widget was undefined')).toBe(false);
  });

  test('sameThrow tolerates the two truncation offsets the prefix causes', () => {
    const long = 'the widget was undefined '.repeat(40);
    const boundary = long.slice(0, MAX_MESSAGE_CHARS) + '…';
    const fromWindow = `Uncaught Error: ${long}`.slice(0, MAX_MESSAGE_CHARS) + '…';
    expect(sameThrow(fromWindow, boundary)).toBe(true);
  });

  test('a render crash the browser also reported leaves exactly one entry', () => {
    // The order a real browser produces: window.onerror twice (React
    // renders once more before giving up), then componentDidCatch.
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'Uncaught Error: the widget was undefined',
        error: new Error('the widget was undefined'),
      }),
    );
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'Uncaught Error: the widget was undefined',
        error: new Error('the widget was undefined'),
      }),
    );
    expect(errorLedgerCount()).toBe(2);

    recordError({ kind: 'screen-render', message: 'the widget was undefined' });

    const entries = readErrorLedger();
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('screen-render');
  });

  test('an unrelated window error a second later is NOT superseded', () => {
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'Uncaught Error: something else', error: new Error('something else') }),
    );
    recordError({ kind: 'render', message: 'the widget was undefined' });
    expect(errorLedgerCount()).toBe(2);
  });
});
