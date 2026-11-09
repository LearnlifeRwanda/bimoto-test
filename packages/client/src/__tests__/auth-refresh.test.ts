// AUTH-REFRESH G1/G4 — unit tests for the shared refresh exchange on
// the NATIVE path: the refresh token lives in the secure token store,
// is presented in the request body, and the server's ROTATED
// replacement must be persisted back (a lost rotation strands the next
// app restart with a dead token).

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { refreshSession, restoreSessionAtBoot } from '../lib/auth-refresh';
import { useAuthStore } from '../stores/auth.store';
import {
  getStoredRefreshToken,
  storeRefreshToken,
  clearStoredRefreshToken,
} from '../lib/secure-token-store';

vi.mock('../lib/secure-token-store', () => ({
  getStoredRefreshToken: vi.fn(async () => null),
  storeRefreshToken: vi.fn(async () => undefined),
  clearStoredRefreshToken: vi.fn(async () => undefined),
}));

const getStoredMock = vi.mocked(getStoredRefreshToken);
const storeMock = vi.mocked(storeRefreshToken);
const clearMock = vi.mocked(clearStoredRefreshToken);

let fetchMock: ReturnType<typeof vi.fn>;

function installFetch(impl: () => Promise<Response>) {
  fetchMock = vi.fn(impl);
  (globalThis as any).fetch = fetchMock;
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  getStoredMock.mockResolvedValue(null);
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, token: null });
});

describe('refreshSession (native path)', () => {
  test('presents the stored refresh token, stores the rotated one, updates the auth store', async () => {
    getStoredMock.mockResolvedValue('stored-rt');
    installFetch(async () =>
      new Response(
        JSON.stringify({ success: true, accessToken: 'new-at', refreshToken: 'rotated-rt' }),
        { status: 200 },
      ),
    );

    await expect(refreshSession()).resolves.toBe('new-at');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/api/auth/refresh');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({ refreshToken: 'stored-rt' });
    // Rotation persisted via the secure store.
    expect(storeMock).toHaveBeenCalledWith('rotated-rt');
    expect(useAuthStore.getState().token).toBe('new-at');
  });

  test('sends an empty body on the web (cookie carries the refresh token)', async () => {
    getStoredMock.mockResolvedValue(null);
    installFetch(async () =>
      new Response(JSON.stringify({ success: true, accessToken: 'new-at' }), { status: 200 }),
    );

    await expect(refreshSession()).resolves.toBe('new-at');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({});
    expect(storeMock).not.toHaveBeenCalled();
  });

  test('a 401 means the token is dead: clears the secure store, resolves null', async () => {
    getStoredMock.mockResolvedValue('stored-rt');
    installFetch(async () => new Response('{}', { status: 401 }));

    await expect(refreshSession()).resolves.toBeNull();
    expect(clearMock).toHaveBeenCalled();
  });

  test('a network failure resolves null WITHOUT clearing the stored token', async () => {
    getStoredMock.mockResolvedValue('stored-rt');
    installFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(refreshSession()).resolves.toBeNull();
    expect(clearMock).not.toHaveBeenCalled();
  });

  test('concurrent callers share one exchange (rotation makes parallel refreshes fatal)', async () => {
    getStoredMock.mockResolvedValue('stored-rt');
    installFetch(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return new Response(
        JSON.stringify({ success: true, accessToken: 'new-at', refreshToken: 'rotated-rt' }),
        { status: 200 },
      );
    });

    const [a, b, c] = await Promise.all([refreshSession(), refreshSession(), refreshSession()]);

    expect(a).toBe('new-at');
    expect(b).toBe('new-at');
    expect(c).toBe('new-at');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('restoreSessionAtBoot', () => {
  test('no stored token (web / logged out) → no network call, resolves null', async () => {
    getStoredMock.mockResolvedValue(null);
    installFetch(async () => new Response('{}', { status: 200 }));

    await expect(restoreSessionAtBoot()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('stored token → runs the shared exchange', async () => {
    getStoredMock.mockResolvedValue('stored-rt');
    installFetch(async () =>
      new Response(
        JSON.stringify({ success: true, accessToken: 'new-at', refreshToken: 'rotated-rt' }),
        { status: 200 },
      ),
    );

    await expect(restoreSessionAtBoot()).resolves.toBe('new-at');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(storeMock).toHaveBeenCalledWith('rotated-rt');
  });
});
