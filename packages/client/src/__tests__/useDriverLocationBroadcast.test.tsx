import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// --- Mock auth store: hook reads token + isAuthenticated. ---
vi.mock('../stores/auth.store', () => {
  const state = { token: 'jwt', isAuthenticated: true };
  return {
    useAuthStore: (selector?: (s: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});

// --- Mock socket.io-client. We capture the instance to drive its
// lifecycle from the test. ---
type MockSocket = {
  emitted: Array<[string, any]>;
  handlers: Record<string, (arg?: any) => void>;
  connected: boolean;
  on: (event: string, h: (arg?: any) => void) => void;
  emit: (event: string, payload?: any) => void;
  disconnect: () => void;
  __triggerConnect: () => void;
};

const sockets: MockSocket[] = [];
function makeSocket(): MockSocket {
  const s: MockSocket = {
    emitted: [],
    handlers: {},
    connected: false,
    on(event, h) {
      this.handlers[event] = h;
    },
    emit(event, payload) {
      this.emitted.push([event, payload]);
    },
    disconnect() {
      this.connected = false;
    },
    __triggerConnect() {
      this.connected = true;
      this.handlers['connect']?.();
    },
  };
  sockets.push(s);
  return s;
}

vi.mock('socket.io-client', () => ({
  io: () => makeSocket(),
}));

// --- Mock geolocation: capture the watch callback so the test can
// fire fake positions on demand. ---
let capturedOnPos: ((c: any) => void) | null = null;
let capturedOnErr: ((e: any) => void) | null = null;
const watchPosition = vi.fn(async (onPos: any, onErr: any, _opts?: any) => {
  capturedOnPos = onPos;
  capturedOnErr = onErr;
  return 'watch-1';
});
const clearWatch = vi.fn(async (_id: string) => undefined);

vi.mock('../hooks/useGeolocation', () => ({
  geolocation: {
    watchPosition: (onPos: any, onErr: any, opts?: any) => watchPosition(onPos, onErr, opts),
    clearWatch: (id: string) => clearWatch(id),
  },
}));

import { JourneyStatus } from '@bimoto/shared';
import { useDriverLocationBroadcast } from '../hooks/useDriverLocationBroadcast';

beforeEach(() => {
  sockets.length = 0;
  capturedOnPos = null;
  capturedOnErr = null;
  watchPosition.mockClear();
  clearWatch.mockClear();
});

function pos(lat: number, lng: number) {
  return { lat, lng, accuracy: 5, speed: null, heading: null, timestamp: Date.now() };
}

describe('useDriverLocationBroadcast', () => {
  test('mounted in MATCHED → emits update-location after position arrives', async () => {
    const { unmount } = renderHook(() =>
      useDriverLocationBroadcast('j1', JourneyStatus.MATCHED),
    );

    // Wait one microtask for the async watchPosition to resolve.
    await act(async () => { await Promise.resolve(); });
    expect(watchPosition).toHaveBeenCalledTimes(1);

    const sock = sockets[0];
    expect(sock).toBeDefined();
    sock.__triggerConnect();
    expect(sock.emitted).toContainEqual(['join-journey', { journeyId: 'j1' }]);

    capturedOnPos!(pos(-1.95, 30.06));
    const update = sock.emitted.find((e) => e[0] === 'update-location');
    expect(update).toBeTruthy();
    expect(update![1]).toMatchObject({ lat: -1.95, lng: 30.06, accuracy: 5 });

    unmount();
    expect(clearWatch).toHaveBeenCalledWith('watch-1');
  });

  test('IN_PROGRESS state → no watch, no emits (state-machine guard)', async () => {
    renderHook(() => useDriverLocationBroadcast('j1', JourneyStatus.IN_PROGRESS));
    await act(async () => { await Promise.resolve(); });
    expect(watchPosition).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(0);
  });

  test('transition MATCHED → IN_PROGRESS clears the watch and stops emitting', async () => {
    const { rerender } = renderHook(
      ({ state }) => useDriverLocationBroadcast('j1', state),
      { initialProps: { state: JourneyStatus.MATCHED } },
    );
    await act(async () => { await Promise.resolve(); });
    expect(watchPosition).toHaveBeenCalledTimes(1);
    const sock = sockets[0];
    sock.__triggerConnect();

    // First position emits.
    capturedOnPos!(pos(1, 1));
    const before = sock.emitted.filter((e) => e[0] === 'update-location').length;
    expect(before).toBe(1);

    // Transition to IN_PROGRESS — watch must be cleared, no further emits.
    rerender({ state: JourneyStatus.IN_PROGRESS });
    await act(async () => { await Promise.resolve(); });
    expect(clearWatch).toHaveBeenCalledWith('watch-1');
    // The captured callback may still exist, but the socket has been
    // disconnected; further emits shouldn't reach the server. Verify
    // that no new socket was created and nothing else emitted.
    expect(sockets).toHaveLength(1);
    const after = sock.emitted.filter((e) => e[0] === 'update-location').length;
    expect(after).toBe(before);
  });

  test('permission denied → lastError populated, no emits', async () => {
    const { result } = renderHook(() =>
      useDriverLocationBroadcast('j1', JourneyStatus.MATCHED),
    );
    await act(async () => { await Promise.resolve(); });
    expect(capturedOnErr).toBeTruthy();

    await act(async () => {
      capturedOnErr!({ code: 'permission-denied', message: 'denied' });
    });

    expect(result.current.lastError).toMatchObject({ code: 'permission-denied' });
    const sock = sockets[0];
    sock.__triggerConnect();
    const updates = sock.emitted.filter((e) => e[0] === 'update-location');
    expect(updates).toHaveLength(0);
  });

  test('coalesces emits to at most one per 8 second window', async () => {
    const realNow = Date.now;
    let t = 1_000_000;
    Date.now = () => t;

    try {
      renderHook(() =>
        useDriverLocationBroadcast('j1', JourneyStatus.MATCHED),
      );
      await act(async () => { await Promise.resolve(); });
      const sock = sockets[0];
      sock.__triggerConnect();

      capturedOnPos!(pos(1, 1));
      t += 1_000;
      capturedOnPos!(pos(2, 2));
      t += 1_000;
      capturedOnPos!(pos(3, 3));

      // Only the first should have been emitted (subsequent ones inside
      // the 8s window are dropped).
      const updates = sock.emitted.filter((e) => e[0] === 'update-location');
      expect(updates).toHaveLength(1);

      t += 8_000;
      capturedOnPos!(pos(4, 4));
      const after = sock.emitted.filter((e) => e[0] === 'update-location');
      expect(after).toHaveLength(2);
    } finally {
      Date.now = realNow;
    }
  });
});
