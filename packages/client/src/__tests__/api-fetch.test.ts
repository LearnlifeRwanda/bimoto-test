// AUTH-REFRESH G1/G4 — unit tests for the central authenticated fetch.
//
// Field bug these guard: access tokens live 15 minutes and nothing ever
// refreshed after boot, so every authenticated action failed from
// minute 16 until an app restart. apiFetch must refresh-and-retry on
// 401 (sharing ONE in-flight refresh — the server rotates the refresh
// token, so parallel refreshes would invalidate each other), refresh
// proactively near expiry, and never intercept /api/auth/*.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { apiFetch, getFreshAccessToken, tokenExpiryMs } from '../lib/api';
import { useAuthStore } from '../stores/auth.store';

const API = 'http://localhost:3000';

/** Minimal JWT-shaped token whose payload carries the given exp (seconds). */
function fakeJwt(expSeconds: number): string {
  const payload = btoa(JSON.stringify({ sub: 'u1', exp: expSeconds }));
  return `header.${payload}.sig`;
}

const farFuture = () => fakeJwt(Math.floor(Date.now() / 1000) + 10 * 60);
const nearExpiry = () => fakeJwt(Math.floor(Date.now() / 1000) + 30);

const json200 = (body: unknown = {}) =>
  new Response(JSON.stringify(body), { status: 200 });
const status401 = () => new Response('{"message":"Unauthorized"}', { status: 401 });

let fetchMock: ReturnType<typeof vi.fn>;

function installFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  fetchMock = vi.fn(impl);
  (globalThis as any).fetch = fetchMock;
  return fetchMock;
}

function refreshCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/auth/refresh'));
}

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.[name];
}

beforeEach(() => {
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, token: null });
});

describe('tokenExpiryMs', () => {
  test('decodes exp from a JWT payload without a library', () => {
    expect(tokenExpiryMs(fakeJwt(1_000_000))).toBe(1_000_000_000);
  });

  test('returns null for opaque tokens', () => {
    expect(tokenExpiryMs('not-a-jwt')).toBeNull();
    expect(tokenExpiryMs('a.%%%.c')).toBeNull();
  });
});

describe('apiFetch', () => {
  test('prefixes API_URL, injects Authorization, Content-Type and credentials', async () => {
    useAuthStore.getState().setToken(farFuture());
    installFetch(async () => json200());

    await apiFetch('/api/journeys', { method: 'POST', body: JSON.stringify({ a: 1 }) });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/api/journeys`);
    expect(init.credentials).toBe('include');
    expect(headerOf(init, 'Authorization')).toBe(`Bearer ${useAuthStore.getState().token}`);
    expect(headerOf(init, 'Content-Type')).toBe('application/json');
    expect(init.method).toBe('POST');
  });

  test('does not force Content-Type without a body and keeps caller headers', async () => {
    useAuthStore.getState().setToken(farFuture());
    installFetch(async () => json200());

    await apiFetch('/api/journeys', { headers: { 'X-Custom': 'yes' } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(headerOf(init, 'Content-Type')).toBeUndefined();
    expect(headerOf(init, 'X-Custom')).toBe('yes');
  });

  test('401 → refresh → retry once → success, with the rotated token', async () => {
    const oldToken = farFuture();
    const newToken = farFuture();
    useAuthStore.getState().setToken(oldToken);
    useAuthStore.getState().setUser({ id: 'u1' } as any);

    let journeysCalls = 0;
    installFetch(async (url) => {
      if (String(url).includes('/api/auth/refresh')) {
        return json200({ success: true, accessToken: newToken });
      }
      journeysCalls += 1;
      return journeysCalls === 1 ? status401() : json200({ ok: true });
    });

    const res = await apiFetch('/api/journeys');

    expect(res.status).toBe(200);
    expect(refreshCalls()).toHaveLength(1);
    expect(journeysCalls).toBe(2);
    // The retry carried the rotated token, and the store holds it now.
    const retryInit = fetchMock.mock.calls[2][1] as RequestInit;
    expect(headerOf(retryInit, 'Authorization')).toBe(`Bearer ${newToken}`);
    expect(useAuthStore.getState().token).toBe(newToken);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  test('refresh failure → logout path, original 401 propagated', async () => {
    useAuthStore.getState().setToken(farFuture());
    useAuthStore.getState().setUser({ id: 'u1' } as any);

    installFetch(async (url) => {
      if (String(url).includes('/api/auth/refresh')) return status401();
      return status401();
    });

    const res = await apiFetch('/api/journeys');

    expect(res.status).toBe(401);
    expect(refreshCalls()).toHaveLength(1);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().token).toBeNull();
  });

  test('second 401 after a successful refresh → logout path', async () => {
    useAuthStore.getState().setToken(farFuture());
    useAuthStore.getState().setUser({ id: 'u1' } as any);

    installFetch(async (url) => {
      if (String(url).includes('/api/auth/refresh')) {
        return json200({ success: true, accessToken: farFuture() });
      }
      return status401();
    });

    const res = await apiFetch('/api/journeys');

    expect(res.status).toBe(401);
    expect(refreshCalls()).toHaveLength(1); // retried once, not in a loop
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  test('SINGLE-FLIGHT: two parallel 401s share ONE refresh exchange', async () => {
    const newToken = farFuture();
    useAuthStore.getState().setToken(farFuture());
    useAuthStore.getState().setUser({ id: 'u1' } as any);

    const firstAttempt = new Set<string>();
    installFetch(async (url, init) => {
      const u = String(url);
      if (u.includes('/api/auth/refresh')) {
        // Resolve on a later tick so both 401 handlers are in flight
        // while the exchange is pending.
        await new Promise((r) => setTimeout(r, 10));
        return json200({ success: true, accessToken: newToken });
      }
      if (!firstAttempt.has(u)) {
        firstAttempt.add(u);
        return status401();
      }
      expect(headerOf(init, 'Authorization')).toBe(`Bearer ${newToken}`);
      return json200({ ok: true });
    });

    const [a, b] = await Promise.all([
      apiFetch('/api/journeys'),
      apiFetch('/api/bids/mine'),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // The subtle bug under test: the endpoint ROTATES the refresh
    // token, so a second parallel exchange would present a dead token.
    expect(refreshCalls()).toHaveLength(1);
  });

  test('PROACTIVE: refreshes before the request when exp is within 60s', async () => {
    const newToken = farFuture();
    useAuthStore.getState().setToken(nearExpiry());

    installFetch(async (url) => {
      if (String(url).includes('/api/auth/refresh')) {
        return json200({ success: true, accessToken: newToken });
      }
      return json200({ ok: true });
    });

    const res = await apiFetch('/api/journeys');

    expect(res.status).toBe(200);
    // Refresh ran FIRST, then the request with the fresh token.
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/auth/refresh');
    const reqInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(headerOf(reqInit, 'Authorization')).toBe(`Bearer ${newToken}`);
  });

  test('no proactive refresh with a far-future exp', async () => {
    useAuthStore.getState().setToken(farFuture());
    installFetch(async () => json200());

    await apiFetch('/api/journeys');

    expect(refreshCalls()).toHaveLength(0);
  });

  test('never intercepts /api/auth/*: a 401 there is propagated untouched', async () => {
    useAuthStore.getState().setToken(farFuture());
    useAuthStore.getState().setUser({ id: 'u1' } as any);
    installFetch(async () => status401());

    const res = await apiFetch('/api/auth/logout', { method: 'POST' });

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Not treated as expiry: the session stays.
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
});

describe('getFreshAccessToken (socket connect accessor)', () => {
  test('returns the current token when it is not near expiry', async () => {
    const token = farFuture();
    useAuthStore.getState().setToken(token);
    installFetch(async () => json200());

    await expect(getFreshAccessToken()).resolves.toBe(token);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('refreshes first when the token is near expiry', async () => {
    const newToken = farFuture();
    useAuthStore.getState().setToken(nearExpiry());
    installFetch(async () => json200({ success: true, accessToken: newToken }));

    await expect(getFreshAccessToken()).resolves.toBe(newToken);
    expect(refreshCalls()).toHaveLength(1);
  });
});
