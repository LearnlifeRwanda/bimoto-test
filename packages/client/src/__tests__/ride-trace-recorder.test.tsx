// __TESTS__/RIDE-TRACE-RECORDER.TEST.TSX
//
// RIDE-TRACE G2 — the ride leaves a trace, and leaves nothing else.
//
// The claims here are about a recorder with no socket in it. The one
// that matters most is the SINGLE-PATH property: connected and
// disconnected must produce identical behaviour, because unlike the
// broadcast hook there is no emit to collide with a buffered copy. A
// test that only asserted "a row was written" would pass on a hook
// that quietly branched; these assert that the two runs agree row for
// row, and that the socket module is never so much as touched.
//
// Against REAL Dexie over fake-indexeddb, never a mocked table — the
// binding rule from #171. A mocked table returns what it was told to,
// so a writer that stamps the wrong owner still passes.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { renderHook, act } from '@testing-library/react';

// --- The network, mocked at the fetch boundary only. ---
const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  apiErrorFromResponse: vi.fn(),
  isConnectivityError: () => false,
  getFreshAccessToken: async () => 'jwt',
}));

vi.mock('../lib/auth-refresh', () => ({ refreshSession: async () => null }));

let online = true;
vi.mock('../sync/connectivity', () => ({
  getIsOnline: () => online,
  onConnectivityChange: vi.fn(),
  checkConnectivity: async () => online,
  reportApiFailure: vi.fn(),
  reportApiSuccess: vi.fn(),
}));

// --- socket.io-client. Mocked ONLY so that any touch is observable:
// `io` must never be called from this hook, connected or not. ---
const ioMock = vi.fn(() => {
  throw new Error('the ride-trace recorder opened a socket');
});
vi.mock('socket.io-client', () => ({ io: () => ioMock() }));

// --- geolocation: capture the watch callback so positions fire on
// demand, and count watches so teardown is provable. ---
let capturedOnPos: ((c: unknown) => void) | null = null;
let watchCount = 0;
let clearedIds: string[] = [];
vi.mock('../hooks/useGeolocation', () => ({
  geolocation: {
    watchPosition: async (onPos: (c: unknown) => void) => {
      capturedOnPos = onPos;
      watchCount += 1;
      return `watch-${watchCount}`;
    },
    clearWatch: async (id: string) => {
      clearedIds.push(id);
    },
  },
}));

import { useRideTraceRecorder, _intervalMsForTests } from '../hooks/useRideTraceRecorder';
import { db } from '../db/dexie';
import { eventQueue } from '../sync/EventQueue';
import { SyncManager } from '../sync/SyncManager';
import { useAuthStore } from '../stores/auth.store';
import {
  readErrorLedger,
  initErrorLedger,
  _resetErrorLedgerForTests,
} from '../services/error-ledger';

const ALICE = 'user-alice';
const BROTHER = 'user-brother';
const JOURNEY = '22222222-2222-4222-8222-222222222222';

function signIn(userId: string): void {
  useAuthStore.setState({
    user: { id: userId } as never,
    isAuthenticated: true,
    token: 'jwt',
  } as never);
}

function signOut(): void {
  useAuthStore.setState({ user: null, isAuthenticated: false, token: null } as never);
}

function pos(lat: number, lng: number, accuracy = 8) {
  return { lat, lng, accuracy, speed: null, heading: null, timestamp: Date.now() };
}

/** Mount the recorder on an in-progress leg. */
async function mountRecording(active = true) {
  const view = renderHook(
    ({ a }: { a: boolean }) => useRideTraceRecorder(JOURNEY, a),
    { initialProps: { a: active } },
  );
  await act(async () => { await Promise.resolve(); });
  return view;
}

/** Fire one position and let both React and Dexie's own turn land. */
async function tick(coords: ReturnType<typeof pos>): Promise<void> {
  await act(async () => {
    capturedOnPos!(coords);
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(async () => {
  online = true;
  capturedOnPos = null;
  watchCount = 0;
  clearedIds = [];
  ioMock.mockClear();
  apiFetchMock.mockReset();
  localStorage.clear();
  _resetErrorLedgerForTests();
  initErrorLedger();
  await db.gpsBuffer.clear();
  await db.syncEvents.clear();
  await db.syncMeta.clear();
  signIn(ALICE);
});

afterEach(() => {
  signOut();
  _resetErrorLedgerForTests();
});

describe('RIDE-TRACE G2 — the recorder writes, throttles, and stamps', () => {
  test('active + a position tick → one row, stamped with the signed-in user', async () => {
    await mountRecording();
    await tick(pos(-1.95, 30.06));

    const rows = await db.gpsBuffer.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: ALICE,
      journeyId: JOURNEY,
      lat: -1.95,
      lng: 30.06,
      accuracy: 8,
      synced: false,
    });
    // A real ISO instant, not a placeholder: the drain sorts on it and
    // the server dedupes on it.
    expect(new Date(rows[0].timestamp).toISOString()).toBe(rows[0].timestamp);
  });

  test('two ticks inside the 8s window → one row; the third, past it → two', async () => {
    const realNow = Date.now;
    let t = 1_000_000;
    Date.now = () => t;
    try {
      await mountRecording();

      capturedOnPos!(pos(1, 1));
      t += 1_000;
      capturedOnPos!(pos(2, 2));
      t += 1_000;
      await tick(pos(3, 3));

      expect(await db.gpsBuffer.count()).toBe(1);

      t += 8_000;
      await tick(pos(4, 4));

      expect(await db.gpsBuffer.count()).toBe(2);
    } finally {
      Date.now = realNow;
    }
  });

  test('active=false → no watch is ever started and nothing is written', async () => {
    await mountRecording(false);

    expect(watchCount).toBe(0);
    expect(capturedOnPos).toBeNull();
    expect(await db.gpsBuffer.count()).toBe(0);
  });

  test('the leg ending tears the watch down — no trace after in-progress', async () => {
    const view = await mountRecording(true);
    await tick(pos(-1.95, 30.06));
    expect(await db.gpsBuffer.count()).toBe(1);

    // The motari taps end. `active` goes false.
    await act(async () => {
      view.rerender({ a: false });
      await Promise.resolve();
    });

    expect(clearedIds).toEqual(['watch-1']);

    // A late position from a watch the plugin has not stopped yet must
    // not be recorded: the recorder's own gate is closed.
    await tick(pos(-1.99, 30.09));
    expect(await db.gpsBuffer.count()).toBe(1);
  });

  test('unmount tears the watch down', async () => {
    const view = await mountRecording(true);
    await act(async () => {
      view.unmount();
      await Promise.resolve();
    });
    expect(clearedIds).toEqual(['watch-1']);
  });

  test('nobody signed in → nothing is written and nothing is guessed', async () => {
    await mountRecording();
    // The session ends between the watch starting and the point arriving.
    signOut();

    await tick(pos(-1.95, 30.06));

    expect(await db.gpsBuffer.count()).toBe(0);
    expect(readErrorLedger().filter((e) => e.kind === 'gps-buffer')).toHaveLength(1);
  });

  test('the owner is read at write time, not captured when the effect ran', async () => {
    await mountRecording();
    // The phone changes hands mid-watch. The point that arrives now is
    // the brother's movement and must leave under the brother's name.
    signIn(BROTHER);

    await tick(pos(-1.95, 30.06));

    const rows = await db.gpsBuffer.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(BROTHER);
  });

  test("a row written as Alice is not returned by the brother's scoped read", async () => {
    await mountRecording();
    await tick(pos(-1.95, 30.06));

    expect(await eventQueue.getUnsyncedGps(ALICE)).toHaveLength(1);
    expect(await eventQueue.getUnsyncedGps(BROTHER)).toHaveLength(0);
  });

  test('VITE_RIDE_TRACE_MS is honoured only when it is a usable duration', () => {
    expect(_intervalMsForTests(undefined, 8_000)).toBe(8_000);
    expect(_intervalMsForTests('', 8_000)).toBe(8_000);
    expect(_intervalMsForTests('nonsense', 8_000)).toBe(8_000);
    expect(_intervalMsForTests('0', 8_000)).toBe(8_000);
    expect(_intervalMsForTests('-5', 8_000)).toBe(8_000);
    expect(_intervalMsForTests('4000', 8_000)).toBe(4_000);
  });
});

describe('RIDE-TRACE G2 — one path: connected and disconnected are the same code', () => {
  test('connected vs disconnected → identical rows, and no socket either way', async () => {
    async function runOnce(isOnline: boolean) {
      online = isOnline;
      await db.gpsBuffer.clear();
      const view = await mountRecording();
      await tick(pos(-1.95, 30.06));
      const rows = (await db.gpsBuffer.toArray()).map(
        ({ userId, journeyId, lat, lng, accuracy, synced }) => ({
          userId, journeyId, lat, lng, accuracy, synced,
        }),
      );
      await act(async () => {
        view.unmount();
        await Promise.resolve();
      });
      return rows;
    }

    const offlineRows = await runOnce(false);
    const onlineRows = await runOnce(true);

    // Not "both non-empty" — identical. This is the single-path
    // property: with nothing to emit there is no branch to take, and a
    // future edit that reintroduces one fails here.
    expect(offlineRows).toEqual(onlineRows);
    expect(onlineRows).toHaveLength(1);

    // Neither run touched socket.io at all.
    expect(ioMock).not.toHaveBeenCalled();
  });

  test('the recorder never opens a socket, connected or not', async () => {
    await mountRecording();
    await tick(pos(-1.95, 30.06));
    online = false;
    await tick(pos(-1.96, 30.07));

    expect(ioMock).not.toHaveBeenCalled();
  });
});

describe('RIDE-TRACE G2 — recorder → POST /api/sync/gps → marked synced', () => {
  test('the drain sends what the endpoint validates, and marks exactly those rows', async () => {
    const realNow = Date.now;
    let t = 1_000_000;
    Date.now = () => t;
    try {
      await mountRecording();
      capturedOnPos!(pos(-1.95, 30.06));
      t += 8_000;
      await tick(pos(-1.96, 30.07, 12));
    } finally {
      Date.now = realNow;
    }

    const buffered = await db.gpsBuffer.toArray();
    expect(buffered).toHaveLength(2);
    const bufferedIds = buffered.map((p) => p.id!);

    // A row belonging to somebody else may not travel in Alice's batch.
    await db.gpsBuffer.add({
      userId: BROTHER, journeyId: JOURNEY, lat: -1.94, lng: 30.05,
      accuracy: 5, timestamp: '2026-08-17T09:00:00.000Z', synced: false,
    } as never);

    apiFetchMock.mockResolvedValue({
      ok: true, status: 200, json: async () => ({ saved: 2, processed: [], rejected: [], events: [] }),
    });

    await new SyncManager().sync();

    const gpsCalls = apiFetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/sync/gps'));
    expect(gpsCalls).toHaveLength(1);

    const [, init] = gpsCalls[0];
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);

    // The field-by-field contract: journeyId + points[{lat, lng,
    // accuracy, timestamp}]. No userId on the wire — the server derives
    // the caller from the cookie and 403s a non-participant.
    expect(Object.keys(body).sort()).toEqual(['journeyId', 'points']);
    expect(body.journeyId).toBe(JOURNEY);
    expect(body.points).toHaveLength(2);
    for (const p of body.points) {
      expect(Object.keys(p).sort()).toEqual(['accuracy', 'lat', 'lng', 'timestamp']);
      expect(typeof p.lat).toBe('number');
      expect(typeof p.lng).toBe('number');
      expect(typeof p.accuracy).toBe('number');
      expect(new Date(p.timestamp).toISOString()).toBe(p.timestamp);
    }
    // Oldest first, as getUnsyncedGps sorts them.
    expect(body.points[0].lat).toBe(-1.95);
    expect(body.points[1].lat).toBe(-1.96);

    // Exactly the two rows that travelled are flipped.
    const after = await db.gpsBuffer.toArray();
    for (const row of after) {
      expect(row.synced).toBe(bufferedIds.includes(row.id!));
    }
    expect(await eventQueue.getUnsyncedGps(ALICE)).toHaveLength(0);
    expect(await eventQueue.getUnsyncedGps(BROTHER)).toHaveLength(1);
  });
});
