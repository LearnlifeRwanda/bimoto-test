// AUTH-REFRESH G1 — central authenticated fetch.
//
// Every authenticated API call in the client goes through apiFetch (a
// grep-based guard test enforces this). It prefixes API_URL, injects
// the CURRENT access token from the auth store, and — the reason it
// exists — transparently recovers from access-token expiry: access
// tokens live 15 minutes, and before this helper the only refresh was
// the boot-time exchange, so every authenticated action started failing
// at minute 16 until an app restart.
//
// Recovery contract:
//   - proactive: when the stored token's exp (decoded locally from the
//     JWT payload — no dependency) is within 60s, refresh BEFORE the
//     request, making the 401 path the rare case;
//   - on 401: run the shared single-flight refresh exchange
//     (lib/auth-refresh.ts), then retry the original request ONCE with
//     the new token. A failed refresh or a second 401 takes the
//     existing logout path and propagates the 401 response;
//   - /api/auth/* is never intercepted (no recursion into the refresh
//     endpoint, and login/logout must see their own 401s).

import { useAuthStore } from '../stores/auth.store';
import { refreshSession } from './auth-refresh';
import { getConnectionState, reportApiFailure, reportApiSuccess } from '../sync/connectivity';
import { recordError } from '../services/error-ledger';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// NET-UX G2 — the one failure taxonomy. Every way an API call can fail
// maps to exactly one kind, so pages never have to guess (and never
// again blame "Could not create the ride" for a dead tunnel):
//   OFFLINE     — the device has no network; the request never left.
//   UNREACHABLE — network is up but no response came back (dead tunnel,
//                 stale DNS, server down).
//   SERVER      — the server answered 5xx: Bimoto's problem.
//   REJECTED    — the server answered 4xx: a real answer, carrying the
//                 server's error code and i18n message key when present.
//   AUTH        — post-refresh 401; apiFetch has already routed this to
//                 the logout path before the caller sees it.
export type ApiErrorKind = 'OFFLINE' | 'UNREACHABLE' | 'SERVER' | 'REJECTED' | 'AUTH';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP status, when a response was received. */
  readonly status: number | null;
  /** Server error code (e.g. 'FORBIDDEN'), when the body carried one. */
  readonly code: string | null;
  /** Server i18n message key (e.g. 'errors.notJourneyCustomer'). */
  readonly messageKey: string | null;

  constructor(
    kind: ApiErrorKind,
    opts: { status?: number | null; code?: string | null; messageKey?: string | null } = {},
  ) {
    // Plain-English fallback so any site that blindly renders
    // err.message degrades to something humane, never "Failed to fetch".
    // Localized copy comes from the presenter, not from here.
    super(
      {
        OFFLINE: 'No connection',
        UNREACHABLE: "Can't reach Bimoto — connection problem",
        SERVER: 'Bimoto server problem — try again in a moment',
        REJECTED: 'The request was not accepted',
        AUTH: 'Session expired',
      }[kind],
    );
    this.name = 'ApiError';
    this.kind = kind;
    this.status = opts.status ?? null;
    this.code = opts.code ?? null;
    this.messageKey = opts.messageKey ?? null;
  }
}

/** True for failures where the request never got an answer — the cases
 * where an offline-first caller should queue instead of giving up. */
export function isConnectivityError(err: unknown): boolean {
  return err instanceof ApiError && (err.kind === 'OFFLINE' || err.kind === 'UNREACHABLE');
}

/**
 * Classify a non-OK response into an ApiError, reading the server's
 * error envelope where present. The dominant server shape is
 * `{ error: { code, message: 'errors.<key>' } }`; a few legacy routes
 * send `{ message: '<prose>' }` or `{ error: '<prose>' }` — prose is
 * kept in messageKey and simply won't resolve as an i18n key, which the
 * presenter turns into the honest generic-rejection copy.
 */
export async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  let code: string | null = null;
  let messageKey: string | null = null;
  try {
    // clone() keeps the original body readable for the caller; fall
    // back to the response itself where clone is unavailable.
    const readable = typeof res.clone === 'function' ? res.clone() : res;
    const body = await readable.json();
    const errField = (body as Record<string, unknown> | null)?.error;
    if (errField && typeof errField === 'object') {
      const e = errField as Record<string, unknown>;
      if (typeof e.code === 'string') code = e.code;
      if (typeof e.message === 'string') messageKey = e.message;
    } else if (typeof errField === 'string') {
      messageKey = errField;
    } else if (typeof (body as Record<string, unknown> | null)?.message === 'string') {
      messageKey = (body as Record<string, unknown>).message as string;
    }
  } catch {
    // Non-JSON body — classification by status alone.
  }
  const kind: ApiErrorKind =
    res.status === 401 ? 'AUTH' : res.status >= 500 ? 'SERVER' : 'REJECTED';
  return new ApiError(kind, { status: res.status, code, messageKey });
}

// Refresh ahead of expiry by this much. Must be far smaller than the
// 15-minute access-token TTL and large enough to absorb clock skew and
// request latency.
const PROACTIVE_REFRESH_WINDOW_MS = 60_000;

/**
 * Decode the `exp` claim (ms since epoch) from a JWT without a library:
 * split + base64url-decode the payload. Null for anything that doesn't
 * parse — an opaque token just skips the proactive path and relies on
 * the 401 path.
 */
export function tokenExpiryMs(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isNearExpiry(token: string): boolean {
  const exp = tokenExpiryMs(token);
  return exp !== null && exp - Date.now() < PROACTIVE_REFRESH_WINDOW_MS;
}

/** Current in-memory access token (null on the cookie-only web session). */
export function getCurrentAccessToken(): string | null {
  return useAuthStore.getState().token;
}

/**
 * G3 — token accessor for socket connects: returns the current access
 * token, refreshing first when it is near (or past) expiry so a
 * reconnect never presents a stale token.
 */
export async function getFreshAccessToken(): Promise<string | null> {
  const token = getCurrentAccessToken();
  if (token && isNearExpiry(token)) {
    return (await refreshSession()) ?? token;
  }
  return token;
}

function normalizeHeaders(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) {
    const out: Record<string, string> = {};
    h.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(h)) {
    // Object.fromEntries needs WebView 73; the pinned floor is 63
    // (docs/webview-floor.md) and build.target only lowers syntax,
    // not runtime APIs.
    const out: Record<string, string> = {};
    for (const [k, v] of h) out[k] = v;
    return out;
  }
  return { ...h };
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

// NET-UX G1 — every apiFetch outcome feeds the connectivity source of
// truth (sync/connectivity.ts): a request that never got a response
// marks the API unreachable (banner + backoff probe take over); ANY
// response — success or error status — proves the server is reachable
// and flips recovery immediately.
// (G2) A request that never got a response surfaces as a typed ApiError
// — OFFLINE vs UNREACHABLE by the connectivity module's device-network
// knowledge — so no caller ever sees a raw "Failed to fetch".
//
// MAP-TRUTH G5 — an ABORT is not a network signal, and treating it as
// one was the root of both Kigali field reports. fetch() rejects the
// same way whether the network died or WE cancelled the request, and
// this used to call reportApiFailure() for both. Two shipped paths abort
// as normal, correct behaviour: useGeocodeSearch aborts the in-flight
// request on every keystroke, and cancelling the offline-map download
// aborts its stream. So typing a destination drove connectivity to
// 'unreachable', which turned the map into a gray rectangle and put the
// word "Offline" on the header of a phone with a perfect connection —
// for up to 30s of backoff ladder, per keystroke.
//
// An aborted request tells us nothing about the server, so it now
// reports nothing and leaves the connection state exactly as it was.
function isAbort(err: unknown): boolean {
  return (
    err instanceof DOMException
      ? err.name === 'AbortError'
      : typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError'
  );
}

// BLACKBOX G2 — what the ledger is allowed to learn about a request:
// the method, the path, and the status. Never a request body, never a
// response body, never a header, never a query string. `path` is the
// server path apiFetch was called with, and recordError strips any
// query string from it a second time at write time.
function recordApiFailure(
  kind: 'api-network' | 'api-server',
  path: string,
  init: RequestInit,
  status?: number,
): void {
  recordError({
    kind,
    message: kind === 'api-server' ? `HTTP ${status}` : 'request failed',
    method: typeof init.method === 'string' ? init.method : 'GET',
    path,
    ...(status === undefined ? {} : { status }),
  });
}

async function trackedFetch(url: string, init: RequestInit, path: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (isAbort(err)) {
      // We cancelled it. Say nothing about the network, and let the
      // caller's own abort handling deal with it.
      throw err;
    }
    reportApiFailure();
    recordApiFailure('api-network', path, init);
    throw new ApiError(getConnectionState() === 'offline' ? 'OFFLINE' : 'UNREACHABLE');
  }
  reportApiSuccess();
  if (res.status >= 500) recordApiFailure('api-server', path, init, res.status);
  return res;
}

/**
 * CUTGUARD v2 G6 — the app's own version, baked at build time.
 *
 * `__APP_VERSION__` is defined by vite.config from
 * `android/app/build.gradle`'s `bimotoDefaultVersionCode` — the number
 * the APK actually ships and the number that workflow's smoke step reads
 * back out of the assembled binary. One source of truth; this file
 * declares nothing.
 *
 * 0 when the define is missing (an older bundle, a test harness, a
 * web-only build). 0 is LEGACY, which is the safe direction in every
 * gate that reads it.
 */
declare const __APP_VERSION__: number;

export function appVersion(): number {
  return typeof __APP_VERSION__ === 'number' && Number.isFinite(__APP_VERSION__)
    ? __APP_VERSION__
    : 0;
}

/** The header name. Exported so the server-side test can name the same string. */
export const APP_VERSION_HEADER = 'X-App-Version';

function buildInit(init: RequestInit, token: string | null): RequestInit {
  const headers = normalizeHeaders(init.headers);
  if (
    init.body != null &&
    !(typeof FormData !== 'undefined' && init.body instanceof FormData) &&
    !hasHeader(headers, 'Content-Type')
  ) {
    headers['Content-Type'] = 'application/json';
  }
  if (token && !hasHeader(headers, 'Authorization')) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  // CUTGUARD v2 G6 — the marker, on EVERY request.
  //
  // Until this there was no app-version signal anywhere in the product
  // (grep for X-App-Version at abb6a26: zero hits), so the server could
  // not tell a v13 phone from a v14 one and had to answer both the same.
  // During a rollout that is not a preference, it is a choice between
  // breaking the old client and withholding the new behaviour from the
  // new one. This is the seam that ends it.
  //
  // Sent unconditionally, including as 0: a header that is present and
  // says "old" is easier to reason about than one that is sometimes
  // absent, and the server treats absent and 0 identically anyway.
  if (!hasHeader(headers, APP_VERSION_HEADER)) {
    headers[APP_VERSION_HEADER] = String(appVersion());
  }
  return {
    ...init,
    credentials: init.credentials ?? 'include',
    headers,
  };
}

/**
 * Authenticated fetch. `path` is the server path (`/api/...`); the
 * API_URL prefix, credentials, Content-Type (when a body is present)
 * and Authorization header are injected here. Everything else in
 * `init` (method, body, signal, ...) passes through untouched.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${API_URL}${path}`;
  // No recursion into the refresh endpoint, and the auth endpoints'
  // own 401s (bad OTP, dead refresh token, logout without session) are
  // real answers, not expiry.
  const isAuthEndpoint = path.startsWith('/api/auth/');

  let token = getCurrentAccessToken();
  if (!isAuthEndpoint && token && isNearExpiry(token)) {
    token = (await refreshSession()) ?? token;
  }

  const res = await trackedFetch(url, buildInit(init, token), path);
  if (res.status !== 401 || isAuthEndpoint) return res;

  const refreshed = await refreshSession();
  if (refreshed === null) {
    // The session is unrecoverable — existing logout path (push
    // deregistration, secure-store clear, state reset → /login).
    useAuthStore.getState().logout();
    return res;
  }

  const retry = await trackedFetch(url, buildInit(init, refreshed), path);
  if (retry.status === 401) {
    useAuthStore.getState().logout();
  }
  return retry;
}
