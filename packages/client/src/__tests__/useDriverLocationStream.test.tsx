import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../stores/auth.store', () => {
  // AUTH-REFRESH G2 — apiFetch reads the token via useAuthStore.getState(),
  // so the mock needs the static accessor too.
  const state = { token: 'jwt', isAuthenticated: true, logout: () => {} };
  const useAuthStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

type MockSocket = {
  emitted: Array<[string, any]>;
  handlers: Record<string, (arg?: any) => void>;
  connected: boolean;
  on: (event: string, h: (arg?: any) => void) => void;
  emit: (event: string, payload?: any) => void;
  disconnect: () => void;
  __triggerConnect: () => void;
  __recvDriverLocation: (evt: any) => void;
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
    __recvDriverLocation(evt: any) {
      this.handlers['driver-location']?.(evt);
    },
  };
  sockets.push(s);
  return s;
}

vi.mock('socket.io-client', () => ({
  io: () => makeSocket(),
}));

const fetchMock = vi.fn();
(globalThis as any).fetch = fetchMock;

import { JourneyStatus } from '@bimoto/shared';
import { useDriverLocationStream } from '../hooks/useDriverLocationStream';

beforeEach(() => {
  sockets.length = 0;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ minutes: 3, confidence: 'med', asOf: new Date().toISOString() }),
  });
});

describe('useDriverLocationStream', () => {
  test('joins room and updates driverLocation on driver-location event', async () => {
    const { result } = renderHook(() =>
      useDriverLocationStream('j1', JourneyStatus.MATCHED),
    );
    const sock = sockets[0];
    expect(sock).toBeDefined();
    sock.__triggerConnect();
    expect(sock.emitted).toContainEqual(['join-journey', { journeyId: 'j1' }]);

    await act(async () => {
      sock.__recvDriverLocation({
        journeyId: 'j1',
        lat: -1.95,
        lng: 30.06,
        timestamp: new Date().toISOString(),
      });
    });

    expect(result.current.driverLocation).toMatchObject({ lat: -1.95, lng: 30.06 });
    expect(result.current.isLive).toBe(true);

    await waitFor(() => expect(result.current.etaMinutes).toBe(3));
    expect(result.current.etaConfidence).toBe('med');
  });

  test('does NOT subscribe when journeyState !== MATCHED', async () => {
    renderHook(() => useDriverLocationStream('j1', JourneyStatus.IN_PROGRESS));
    expect(sockets).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('isLive flips to false when last event ages past 30s', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useDriverLocationStream('j1', JourneyStatus.MATCHED),
      );
      const sock = sockets[0];
      sock.__triggerConnect();

      act(() => {
        sock.__recvDriverLocation({
          journeyId: 'j1',
          lat: 1,
          lng: 1,
          timestamp: new Date().toISOString(),
        });
      });
      expect(result.current.isLive).toBe(true);

      // Advance > 30 seconds; the staleness watchdog runs every 5s.
      act(() => {
        vi.advanceTimersByTime(35_000);
      });
      expect(result.current.isLive).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test('unmount disconnects socket and emits leave-journey', async () => {
    const { unmount } = renderHook(() =>
      useDriverLocationStream('j1', JourneyStatus.MATCHED),
    );
    const sock = sockets[0];
    sock.__triggerConnect();
    unmount();
    expect(sock.emitted).toContainEqual(['leave-journey', { journeyId: 'j1' }]);
    expect(sock.connected).toBe(false);
  });
});
