// GROUNDSKEEPER G3 — the guard that was in one hook of three.
//
// All three location hooks share the same shape: geolocation.watchPosition
// behind a promise, a throttle ref, and a cleanup that calls the async
// clearWatch. That shape has a gap in it. clearWatch is honoured when the
// plugin gets round to it, so a position already in flight when the effect
// tore down still lands in the callback afterwards.
//
// useRideTraceRecorder closed that gap with a `cancelled` flag checked at
// the top of its position callback, and said why: "the trace must stop
// where the disclosure says it stops". The other two had the identical
// shape and no such gate. This file is the proof that they do now.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../stores/auth.store', () => {
  const state = { token: 'jwt', isAuthenticated: true, user: { id: 'u1' } };
  const useAuthStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

vi.mock('../stores/emergency-follow.store', () => {
  const state = { active: { j1: 'alert-1' } as Record<string, string>, clear: vi.fn() };
  const useEmergencyFollowStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  useEmergencyFollowStore.getState = () => state;
  return { useEmergencyFollowStore };
});

vi.mock('../lib/api', () => ({ getFreshAccessToken: async () => 'jwt' }));
vi.mock('../lib/auth-refresh', () => ({ refreshSession: async () => 'jwt' }));
vi.mock('../hooks/useSocket', () => ({ SOCKET_AUTH_ERRORS: new Set<string>() }));

// --- The Dexie write is the thing that must NOT happen. ---
const gpsAdd = vi.fn(async (_row: unknown) => 1);
vi.mock('../db/dexie', () => ({ db: { gpsBuffer: { add: (r: unknown) => gpsAdd(r) } } }));

const recordError = vi.fn((_entry: unknown) => {});
vi.mock('../services/error-ledger', () => ({ recordError: (e: unknown) => recordError(e) }));

// --- Socket double. `connected` is driveable so the offline branch of the
// broadcast hook (the one that writes to Dexie) can be exercised. ---
type MockSocket = {
  emitted: Array<[string, unknown]>;
  handlers: Record<string, (arg?: unknown) => void>;
  connected: boolean;
  on: (e: string, h: (arg?: unknown) => void) => void;
  emit: (e: string, p?: unknown) => void;
  disconnect: () => void;
  connect: () => void;
};
const sockets: MockSocket[] = [];
vi.mock('socket.io-client', () => ({
  io: () => {
    const s: MockSocket = {
      emitted: [],
      handlers: {},
      connected: false,
      on(e, h) { this.handlers[e] = h; },
      emit(e, p) { this.emitted.push([e, p]); },
      disconnect() { this.connected = false; },
      connect() { this.connected = true; },
    };
    sockets.push(s);
    return s;
  },
}));

// --- Geolocation double. The captured callback is what a late position
// arrives through: the test calls it AFTER teardown, which is precisely
// what the plugin does when clearWatch has not landed yet. ---
let capturedOnPos: ((c: unknown) => void) | null = null;
let watchRejects = false;
const clearWatch = vi.fn(async (_id: string) => undefined);
vi.mock('../hooks/useGeolocation', () => ({
  geolocation: {
    watchPosition: async (onPos: (c: unknown) => void) => {
      if (watchRejects) throw new Error('permission denied');
      capturedOnPos = onPos;
      return 'watch-1';
    },
    clearWatch: (id: string) => clearWatch(id),
  },
}));

import { JourneyStatus, SOCKET_EVENTS } from '@bimoto/shared';
import { useDriverLocationBroadcast } from '../hooks/useDriverLocationBroadcast';
import { useEmergencyFollowStream } from '../hooks/useEmergencyFollowStream';
import { useRideTraceRecorder } from '../hooks/useRideTraceRecorder';

const POS = { lat: -1.94, lng: 30.06, accuracy: 5 };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  sockets.length = 0;
  capturedOnPos = null;
  watchRejects = false;
  gpsAdd.mockClear();
  clearWatch.mockClear();
  recordError.mockClear();
});

describe('useDriverLocationBroadcast — the post-teardown point is not persisted', () => {
  // The privacy consequence, stated as a test. At MATCHED->IN_PROGRESS the
  // broadcast is meant to stop so the customer can no longer watch the
  // driver. A late position used to take the !socket.connected branch, get
  // buffered by bufferPointOffline, drain via SyncManager and persist as a
  // GpsPoint on a leg that had ended.
  test('a position arriving after the MATCHED->IN_PROGRESS transition writes nothing and emits nothing', async () => {
    const { rerender } = renderHook(
      ({ state }: { state: JourneyStatus }) => useDriverLocationBroadcast('j1', state),
      { initialProps: { state: JourneyStatus.MATCHED } },
    );
    await flush();

    expect(capturedOnPos).not.toBeNull();
    const late = capturedOnPos!;
    const socket = sockets[0];
    socket.connected = false; // the offline branch — the one that writes

    // Pickup happens: the leg moves on and the broadcast tears down.
    rerender({ state: JourneyStatus.IN_PROGRESS });
    await flush();

    const emittedBefore = socket.emitted.length;
    late(POS);
    await flush();

    expect(gpsAdd).not.toHaveBeenCalled();
    expect(socket.emitted.length).toBe(emittedBefore);
  });

  test('a position arriving after unmount writes nothing', async () => {
    const { unmount } = renderHook(() =>
      useDriverLocationBroadcast('j1', JourneyStatus.MATCHED),
    );
    await flush();
    const late = capturedOnPos!;
    sockets[0].connected = false;

    unmount();
    await flush();

    late(POS);
    await flush();
    expect(gpsAdd).not.toHaveBeenCalled();
  });

  // The guard must gate the teardown, not the hook. A position arriving
  // while the leg is genuinely under way still has to be buffered.
  test('a position arriving while still MATCHED and offline IS buffered', async () => {
    renderHook(() => useDriverLocationBroadcast('j1', JourneyStatus.MATCHED));
    await flush();
    sockets[0].connected = false;

    capturedOnPos!(POS);
    await flush();

    expect(gpsAdd).toHaveBeenCalledTimes(1);
  });
});

describe('useEmergencyFollowStream — the post-teardown frame is not emitted', () => {
  // Honest framing of what this guard is worth here, because it differs
  // from the broadcast hook. On the ordinary teardown the cleanup calls
  // socket.disconnect() first, so `!socket.connected` already swallows a
  // late position and no frame goes out — the emergency hook had no live
  // defect the way the broadcast hook did.
  //
  // What it did have was a gate that depends entirely on disconnect()
  // having already landed. The socket is created with `reconnection: true`
  // and survives in this closure; a connected socket plus a late position
  // is one ordering away, and it would put a frame on the admins room for
  // an emergency ops has already resolved. The test therefore drives
  // exactly that ordering — connected socket, torn-down effect — which is
  // the only state in which the two implementations differ.
  test('a position arriving after teardown emits nothing even if the socket is connected', async () => {
    const { unmount } = renderHook(() => useEmergencyFollowStream('j1'));
    await flush();

    const late = capturedOnPos!;
    const socket = sockets[0];

    unmount();
    await flush();

    socket.connected = true; // reconnected under us after the follow ended
    const emittedBefore = socket.emitted.length;
    late(POS);
    await flush();

    expect(socket.emitted.length).toBe(emittedBefore);
  });

  test('a position arriving while the alert is live IS emitted', async () => {
    renderHook(() => useEmergencyFollowStream('j1'));
    await flush();
    sockets[0].connected = true;

    capturedOnPos!(POS);
    await flush();

    const frames = sockets[0].emitted.filter(([e]) => e === SOCKET_EVENTS.EMERGENCY_LOCATION);
    expect(frames.length).toBe(1);
  });

  // The breadcrumb that replaced a bare `.catch(() => {})`. On the SOS path
  // a watch that never starts means the follow streams nothing at all,
  // which used to be invisible everywhere.
  test('a watch that fails to start leaves a ledger breadcrumb', async () => {
    watchRejects = true;
    renderHook(() => useEmergencyFollowStream('j1'));
    await flush();

    expect(recordError).toHaveBeenCalledTimes(1);
    const entry = recordError.mock.calls[0][0] as { kind: string; message: string };
    expect(entry.kind).toBe('gps-buffer');
    expect(entry.message).toMatch(/emergency follow watch failed to start/);
  });
});

describe('useRideTraceRecorder — the hook the guard came from, unchanged', () => {
  test('a position arriving after the leg ends writes nothing', async () => {
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useRideTraceRecorder('j1', active),
      { initialProps: { active: true } },
    );
    await flush();
    const late = capturedOnPos!;

    rerender({ active: false });
    await flush();

    late(POS);
    await flush();
    expect(gpsAdd).not.toHaveBeenCalled();
  });
});
