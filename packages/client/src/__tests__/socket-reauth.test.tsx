// AUTH-REFRESH G3/G4 — socket re-auth. The socket.io client is mocked;
// these tests assert the two G3 behaviors in useSocket:
//   1. auth is a CALLBACK (re-invoked per handshake) that resolves the
//      CURRENT store token — not a value captured at effect time;
//   2. an auth-rejected connect_error (the server middleware's
//      'Invalid token' / 'Authentication required') triggers ONE
//      refresh exchange and a connection retry, while non-auth errors
//      stay with the built-in reconnection.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { handlers, mockSocket, ioCalls, ioMock } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => void>();
  const ioCalls: Array<{ url: string; opts: any }> = [];
  const mockSocket = {
    on: (evt: string, cb: (...args: any[]) => void) => {
      handlers.set(evt, cb);
      return mockSocket;
    },
    emit: () => mockSocket,
    disconnect: () => {},
    connect: vi.fn(),
    connected: true,
  };
  return {
    handlers,
    mockSocket,
    ioCalls,
    ioMock: {
      io: (url: string, opts: any) => {
        ioCalls.push({ url, opts });
        return mockSocket;
      },
    },
  };
});

vi.mock('socket.io-client', () => ioMock);

import { useSocket, SOCKET_AUTH_ERRORS } from '../hooks/useSocket';
import { useAuthStore } from '../stores/auth.store';

function fakeJwt(expSeconds: number): string {
  return `header.${btoa(JSON.stringify({ sub: 'u1', exp: expSeconds }))}.sig`;
}
const farFuture = () => fakeJwt(Math.floor(Date.now() / 1000) + 10 * 60);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  handlers.clear();
  ioCalls.length = 0;
  mockSocket.connect.mockClear();
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ success: true, accessToken: farFuture() }), { status: 200 }),
  );
  (globalThis as any).fetch = fetchMock;
  useAuthStore.setState({
    user: null,
    token: farFuture(),
    isAuthenticated: true,
    isLoading: false,
  });
});

describe('useSocket re-auth (AUTH-REFRESH G3)', () => {
  test('auth is a callback resolving the CURRENT store token', async () => {
    renderHook(() => useSocket());
    expect(ioCalls).toHaveLength(1);
    const auth = ioCalls[0].opts.auth;
    expect(typeof auth).toBe('function');

    // Simulate a token rotation between connect attempts, then a
    // reconnect handshake: the callback must hand over the NEW token.
    const rotated = farFuture();
    useAuthStore.setState({ token: rotated });
    const handedOver = await new Promise<any>((resolve) => auth(resolve));
    expect(handedOver.token).toBe(rotated);
    // Far-future exp — no refresh round-trip needed for the handshake.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('auth-rejected connect_error refreshes once and retries the connection', async () => {
    renderHook(() => useSocket());
    const onConnectError = handlers.get('connect_error')!;

    onConnectError(new Error('Invalid token'));

    await waitFor(() => expect(mockSocket.connect).toHaveBeenCalledTimes(1));
    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/api/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);

    // A second auth rejection without an intervening successful connect
    // does NOT loop: refresh-and-retry is once per connection attempt.
    onConnectError(new Error('Invalid token'));
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSocket.connect).toHaveBeenCalledTimes(1);
  });

  test('non-auth connect_error does not trigger a refresh', async () => {
    renderHook(() => useSocket());
    const onConnectError = handlers.get('connect_error')!;

    onConnectError(new Error('xhr poll error'));
    await new Promise((r) => setTimeout(r, 20));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSocket.connect).not.toHaveBeenCalled();
  });

  test('the recognised auth-rejection messages match the server middleware', () => {
    expect(SOCKET_AUTH_ERRORS.has('Authentication required')).toBe(true);
    expect(SOCKET_AUTH_ERRORS.has('Invalid token')).toBe(true);
  });
});
