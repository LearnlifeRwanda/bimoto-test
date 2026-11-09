// SOS-FOLLOW G4 — this phone's half of the live follow.
//
// The server-side invariant (positions reach the admins room and nobody
// else) is proven over real sockets in the server package. What is
// proven here is the phone's side, and the claims that matter are all
// about STOPPING:
//
//   - it does not start unless the store says an alert is live;
//   - it stops on the ended-event, on the store clearing for any other
//     reason, on unmount, and on its own 60-minute cap;
//   - it never sends anything but its own position upward, and never
//     receives another person's.
//
// A follow that starts correctly and stops unreliably is worse than no
// follow, because it is the version that keeps a geolocation watch open
// on somebody's phone after their emergency is over.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../stores/auth.store', () => {
  const state = { token: 'jwt', isAuthenticated: true };
  return {
    useAuthStore: (selector?: (s: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});

vi.mock('../lib/api', () => ({
  apiFetch: vi.fn(),
  getFreshAccessToken: async () => 'jwt',
}));
vi.mock('../lib/auth-refresh', () => ({ refreshSession: async () => null }));

type MockSocket = {
  emitted: Array<[string, unknown]>;
  handlers: Record<string, (arg?: unknown) => void>;
  connected: boolean;
  disconnected: boolean;
  on: (event: string, h: (arg?: unknown) => void) => void;
  emit: (event: string, payload?: unknown) => void;
  disconnect: () => void;
  connect: () => void;
};

const sockets: MockSocket[] = [];
vi.mock('socket.io-client', () => ({
  io: () => {
    const s: MockSocket = {
      emitted: [],
      handlers: {},
      // Connected by default: the offline case sets it false explicitly.
      connected: true,
      disconnected: false,
      on(event, h) { this.handlers[event] = h; },
      emit(event, payload) { this.emitted.push([event, payload]); },
      disconnect() { this.disconnected = true; this.connected = false; },
      connect() { this.connected = true; },
    };
    sockets.push(s);
    return s;
  },
}));

let capturedOnPos: ((c: unknown) => void) | null = null;
const watchPosition = vi.fn(async (onPos: (c: unknown) => void) => {
  capturedOnPos = onPos;
  return 'watch-1';
});
const clearWatch = vi.fn(async (_id: string) => undefined);
vi.mock('../hooks/useGeolocation', () => ({
  geolocation: {
    watchPosition: (onPos: (c: unknown) => void) => watchPosition(onPos),
    clearWatch: (id: string) => clearWatch(id),
  },
}));

import { SOCKET_EVENTS } from '@bimoto/shared';
import { useEmergencyFollowStream } from '../hooks/useEmergencyFollowStream';
import { useEmergencyFollowStore } from '../stores/emergency-follow.store';
import { EMERGENCY_FOLLOW_MS, EMERGENCY_FOLLOW_CAP_MS } from '../config/sos';

const JOURNEY = 'j-1';
const ALERT = 'a-1';
const POS = { lat: -1.95, lng: 30.06, accuracy: 9 };

/** Frames this device sent upward. */
function framesFrom(s: MockSocket) {
  return s.emitted.filter(([e]) => e === SOCKET_EVENTS.EMERGENCY_LOCATION);
}

beforeEach(() => {
  sockets.length = 0;
  capturedOnPos = null;
  watchPosition.mockClear();
  clearWatch.mockClear();
  useEmergencyFollowStore.setState({ active: {} });
  vi.useRealTimers();
});

function mount() {
  return renderHook(() => useEmergencyFollowStream(JOURNEY));
}

function alertIsLive() {
  act(() => {
    useEmergencyFollowStore.getState().markActive(JOURNEY, ALERT);
  });
}

describe('it does not start on its own', () => {
  test('no live alert means no socket and no geolocation watch', () => {
    mount();
    expect(sockets).toHaveLength(0);
    expect(watchPosition).not.toHaveBeenCalled();
  });

  test('no journeyId means nothing either', () => {
    renderHook(() => useEmergencyFollowStream(undefined));
    expect(sockets).toHaveLength(0);
  });

  test('an alert for a DIFFERENT journey does not start this one', () => {
    act(() => {
      useEmergencyFollowStore.getState().markActive('some-other-journey', 'a-2');
    });
    mount();
    expect(sockets).toHaveLength(0);
  });
});

describe('while the alert is live', () => {
  test('it opens one socket and one watch, and joins the journey room to hear the ending', async () => {
    alertIsLive();
    mount();
    await act(async () => {});

    expect(sockets).toHaveLength(1);
    expect(watchPosition).toHaveBeenCalledTimes(1);
    expect(sockets[0].emitted.map(([e]) => e)).toContain(SOCKET_EVENTS.JOIN_JOURNEY);
  });

  test('a position becomes one frame carrying this journey and this position', async () => {
    alertIsLive();
    mount();
    await act(async () => {});
    act(() => capturedOnPos!(POS));

    expect(framesFrom(sockets[0])).toEqual([
      [SOCKET_EVENTS.EMERGENCY_LOCATION, { journeyId: JOURNEY, ...POS }],
    ]);
  });

  test('the throttle holds the second position inside the window', async () => {
    alertIsLive();
    mount();
    await act(async () => {});

    act(() => capturedOnPos!(POS));
    act(() => capturedOnPos!({ ...POS, lat: -1.96 }));
    act(() => capturedOnPos!({ ...POS, lat: -1.97 }));

    expect(framesFrom(sockets[0])).toHaveLength(1);
  });

  test('and lets the next one through once the window has passed', async () => {
    alertIsLive();
    mount();
    await act(async () => {});

    const realNow = Date.now;
    let clock = realNow();
    Date.now = () => clock;
    try {
      act(() => capturedOnPos!(POS));
      clock += EMERGENCY_FOLLOW_MS + 1;
      act(() => capturedOnPos!({ ...POS, lat: -1.96 }));
    } finally {
      Date.now = realNow;
    }

    expect(framesFrom(sockets[0])).toHaveLength(2);
  });

  test('the throttle is the follow interval, not the ride broadcast interval', () => {
    expect(EMERGENCY_FOLLOW_MS).toBe(5_000);
  });
});

describe('offline', () => {
  test('a disconnected socket sends zero frames — and does not burn the throttle', async () => {
    alertIsLive();
    mount();
    await act(async () => {});
    sockets[0].connected = false;

    act(() => capturedOnPos!(POS));
    act(() => capturedOnPos!({ ...POS, lat: -1.96 }));

    expect(framesFrom(sockets[0])).toHaveLength(0);

    // The first position after reconnection goes out immediately rather
    // than waiting out a window it never used.
    sockets[0].connected = true;
    act(() => capturedOnPos!({ ...POS, lat: -1.97 }));
    expect(framesFrom(sockets[0])).toHaveLength(1);
  });

  test('nothing is buffered for later — a late position is a trace, not a follow', async () => {
    alertIsLive();
    mount();
    await act(async () => {});
    sockets[0].connected = false;
    act(() => capturedOnPos!(POS));
    sockets[0].connected = true;

    // Reconnecting does not flush anything that was held back.
    expect(framesFrom(sockets[0])).toHaveLength(0);
  });
});

describe('it always stops', () => {
  test('the ended-event stops it — the normal path', async () => {
    alertIsLive();
    mount();
    await act(async () => {});
    const socket = sockets[0];

    act(() => {
      socket.handlers[SOCKET_EVENTS.EMERGENCY_ENDED]!({
        alertId: ALERT,
        journeyId: JOURNEY,
        status: 'RESOLVED',
      });
    });

    expect(useEmergencyFollowStore.getState().active[JOURNEY]).toBeUndefined();
    expect(socket.disconnected).toBe(true);
    expect(clearWatch).toHaveBeenCalledWith('watch-1');
  });

  test('an EXPIRED ending stops it exactly the same way', async () => {
    alertIsLive();
    mount();
    await act(async () => {});
    const socket = sockets[0];

    act(() => {
      socket.handlers[SOCKET_EVENTS.EMERGENCY_ENDED]!({
        alertId: ALERT,
        journeyId: JOURNEY,
        status: 'EXPIRED',
      });
    });

    expect(socket.disconnected).toBe(true);
  });

  test("another journey's ending does not stop this one", async () => {
    alertIsLive();
    mount();
    await act(async () => {});
    const socket = sockets[0];

    act(() => {
      socket.handlers[SOCKET_EVENTS.EMERGENCY_ENDED]!({
        alertId: 'other',
        journeyId: 'other-journey',
        status: 'RESOLVED',
      });
    });

    expect(useEmergencyFollowStore.getState().active[JOURNEY]).toBe(ALERT);
    expect(socket.disconnected).toBe(false);
  });

  test('the store clearing for any other reason stops it too', async () => {
    alertIsLive();
    mount();
    await act(async () => {});

    act(() => useEmergencyFollowStore.getState().clear(JOURNEY));

    expect(sockets[0].disconnected).toBe(true);
    expect(clearWatch).toHaveBeenCalled();
  });

  test('unmount stops it and leaves the room', async () => {
    alertIsLive();
    const { unmount } = mount();
    await act(async () => {});

    act(() => unmount());

    expect(sockets[0].emitted.map(([e]) => e)).toContain(SOCKET_EVENTS.LEAVE_JOURNEY);
    expect(sockets[0].disconnected).toBe(true);
    expect(clearWatch).toHaveBeenCalledWith('watch-1');
  });

  test('the local cap stops it with nobody having told it to', async () => {
    vi.useFakeTimers();
    alertIsLive();
    mount();
    await act(async () => { await Promise.resolve(); });

    act(() => { vi.advanceTimersByTime(EMERGENCY_FOLLOW_CAP_MS + 1); });

    expect(useEmergencyFollowStore.getState().active[JOURNEY]).toBeUndefined();
    vi.useRealTimers();
  });

  test('the cap mirrors the server valve — sixty minutes, not a number of its own', () => {
    expect(EMERGENCY_FOLLOW_CAP_MS).toBe(60 * 60 * 1000);
  });
});

describe('it only ever sends its own position upward', () => {
  test('the only events this hook emits are the join, the frames and the leave', async () => {
    alertIsLive();
    const { unmount } = mount();
    await act(async () => {});
    act(() => capturedOnPos!(POS));
    act(() => unmount());

    const names = new Set(sockets[0].emitted.map(([e]) => e));
    expect([...names].sort()).toEqual(
      [
        SOCKET_EVENTS.EMERGENCY_LOCATION,
        SOCKET_EVENTS.JOIN_JOURNEY,
        SOCKET_EVENTS.LEAVE_JOURNEY,
      ].sort(),
    );
  });

  test('it listens for the ending and for nothing that carries a position', async () => {
    alertIsLive();
    mount();
    await act(async () => {});

    const listened = Object.keys(sockets[0].handlers);
    expect(listened).toContain(SOCKET_EVENTS.EMERGENCY_ENDED);
    expect(listened).not.toContain(SOCKET_EVENTS.EMERGENCY_LOCATION_UPDATE);
    expect(listened).not.toContain(SOCKET_EVENTS.DRIVER_LOCATION);
  });
});
