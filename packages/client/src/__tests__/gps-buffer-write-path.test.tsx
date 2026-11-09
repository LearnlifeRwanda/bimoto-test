// __TESTS__/GPS-BUFFER-WRITE-PATH.TEST.TSX
//
// GHOST-TRACE G2 — the offline ride leaves a trace.
//
// The driver's position pipeline used to drop every point it could not
// emit: `if (!socket.connected) return`. The Dexie buffer, the ownership
// stamp, the drain and the server endpoint all existed; nothing ever
// wrote the first row. These are claims about the writer that closes
// that gap, and about what it must never write.
//
// Against REAL Dexie over fake-indexeddb, deliberately — the binding
// rule from #171. A mocked table returns what it was told to, so a
// writer that stamps the wrong owner, or writes a row the scoped read
// cannot see, still passes. Both are exactly what this file is for.

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

// --- socket.io-client. The test drives `connected` directly: that flag
// is the whole subject of this file. ---
type MockSocket = {
  emitted: Array<[string, unknown]>;
  handlers: Record<string, (arg?: unknown) => void>;
  connected: boolean;
  on: (event: string, h: (arg?: unknown) => void) => void;
  emit: (event: string, payload?: unknown) => void;
  disconnect: () => void;
  connect: () => void;
};

const sockets: MockSocket[] = [];
function makeSocket(): MockSocket {
  const s: MockSocket = {
    emitted: [],
    handlers: {},
    connected: false,
    on(event, h) { this.handlers[event] = h; },
    emit(event, payload) { this.emitted.push([event, payload]); },
    disconnect() { this.connected = false; },
    connect() { this.connected = true; },
  };
  sockets.push(s);
  return s;
}

vi.mock('socket.io-client', () => ({ io: () => makeSocket() }));

// --- geolocation: capture the watch callback so positions fire on demand. ---
let capturedOnPos: ((c: unknown) => void) | null = null;
vi.mock('../hooks/useGeolocation', () => ({
  geolocation: {
    watchPosition: async (onPos: (c: unknown) => void) => {
      capturedOnPos = onPos;
      return 'watch-1';
    },
    clearWatch: async () => undefined,
  },
}));

import { JourneyStatus } from '@bimoto/shared';
import { useDriverLocationBroadcast } from '../hooks/useDriverLocationBroadcast';
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
const JOURNEY = '11111111-1111-4111-8111-111111111111';

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

/** Mount the hook in MATCHED and hand back the socket it opened. */
async function mountBroadcasting(): Promise<MockSocket> {
  renderHook(() => useDriverLocationBroadcast(JOURNEY, JourneyStatus.MATCHED));
  await act(async () => { await Promise.resolve(); });
  return sockets[0];
}

/** Fire one position and let both the React state update and Dexie's
 *  own turn land before the assertion reads the table. */
async function tick(coords: ReturnType<typeof pos>): Promise<void> {
  await act(async () => {
    capturedOnPos!(coords);
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(async () => {
  online = true;
  sockets.length = 0;
  capturedOnPos = null;
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

describe('GHOST-TRACE G2 — the offline point is written, stamped, and only once', () => {
  test('disconnected + a position tick → one row, stamped with the signed-in user', async () => {
    const sock = await mountBroadcasting();
    expect(sock.connected).toBe(false);

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

    // The connected path is untouched: nothing was emitted.
    expect(sock.emitted.filter((e) => e[0] === 'update-location')).toHaveLength(0);
  });

  test('connected → the point is emitted and NOT buffered (no double-recording)', async () => {
    const sock = await mountBroadcasting();
    sock.connect();

    await tick(pos(-1.95, 30.06));

    expect(sock.emitted.filter((e) => e[0] === 'update-location')).toHaveLength(1);
    // The server writes this one itself, with ITS clock. saveGpsBatch
    // dedupes on journeyId + timestamp, so a buffered copy carrying the
    // phone's clock would be saved a second time rather than collapsed.
    expect(await db.gpsBuffer.count()).toBe(0);
  });

  test('two ticks inside the 8s window → one row (a buffered point obeys the same cadence)', async () => {
    const realNow = Date.now;
    let t = 1_000_000;
    Date.now = () => t;
    try {
      await mountBroadcasting();

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

  test("a row written as Alice is not returned by the brother's scoped read", async () => {
    await mountBroadcasting();
    await tick(pos(-1.95, 30.06));

    expect(await eventQueue.getUnsyncedGps(ALICE)).toHaveLength(1);
    expect(await eventQueue.getUnsyncedGps(BROTHER)).toHaveLength(0);
  });

  test('nobody signed in → nothing is written and nothing is guessed', async () => {
    const sock = await mountBroadcasting();
    // The session ends between the watch starting and the point arriving.
    signOut();

    await tick(pos(-1.95, 30.06));

    expect(await db.gpsBuffer.count()).toBe(0);
    expect(readErrorLedger().filter((e) => e.kind === 'gps-buffer')).toHaveLength(1);
    expect(sock.emitted.filter((e) => e[0] === 'update-location')).toHaveLength(0);
  });

  test('the owner is read at write time, not captured when the effect ran', async () => {
    await mountBroadcasting();
    // The phone changes hands mid-watch. The point that arrives now is
    // the brother's movement and must leave under the brother's name.
    signIn(BROTHER);

    await tick(pos(-1.95, 30.06));

    const rows = await db.gpsBuffer.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(BROTHER);
  });
});

describe('GHOST-TRACE G2 — buffer → POST /api/sync/gps → marked synced', () => {
  test('the drain sends what the endpoint validates, and marks exactly those rows', async () => {
    // Two points buffered offline across one journey.
    const sock = await mountBroadcasting();
    expect(sock.connected).toBe(false);

    const realNow = Date.now;
    let t = 1_000_000;
    Date.now = () => t;
    try {
      capturedOnPos!(pos(-1.95, 30.06));
      t += 8_000;
      await tick(pos(-1.96, 30.07, 12));
    } finally {
      Date.now = realNow;
    }

    const buffered = await db.gpsBuffer.toArray();
    expect(buffered).toHaveLength(2);
    const bufferedIds = buffered.map((p) => p.id!);

    // A row belonging to somebody else, and one already synced: neither
    // may travel in Alice's batch.
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

    // The field-by-field contract (G1c): journeyId + points[{lat, lng,
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
