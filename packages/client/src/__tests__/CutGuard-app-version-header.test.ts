// CUTGUARD v2 G6 — the marker actually leaves the phone.
//
// At abb6a26 a grep for `X-App-Version` across the whole repository
// returned nothing: there was no version signal in either direction, so
// the server could not tell a v13 phone from a v14 one and had to answer
// both the same. B-2 and B-3 are the two halves of what that cost.
//
// The server-side half is tested in packages/server
// (cutguard-app-version-gates). This is the half that has to be true for
// any of it to matter: that every authenticated request carries the
// header, and that the number in it is the one the APK bakes rather than
// a second constant somebody has to remember to bump.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_VERSION_HEADER, appVersion, apiFetch } from '../lib/api';

/** Every fetch the module made, with its headers normalised to an object. */
function headersOf(call: [RequestInfo | URL, RequestInit?]): Record<string, string> {
  const raw = call[1]?.headers ?? {};
  if (raw instanceof Headers) return Object.fromEntries(raw.entries());
  if (Array.isArray(raw)) return Object.fromEntries(raw);
  return { ...(raw as Record<string, string>) };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the app version is the APK’s, not a second constant', () => {
  test('appVersion() matches android/app/build.gradle', () => {
    // THE POINT OF THE WHOLE MECHANISM. `bimotoDefaultVersionCode` is the
    // number the APK ships and the number the android-build workflow reads
    // back OUT of the assembled binary. Declaring a version in TypeScript
    // beside it would be a third place to keep in step and the first one
    // to go stale, so vite.config parses the gradle file. This asserts the
    // two agree — which is the only way to notice if that ever stops
    // being true.
    const gradle = readFileSync(
      resolve(__dirname, '..', '..', 'android', 'app', 'build.gradle'),
      'utf8',
    );
    const match = /def\s+bimotoDefaultVersionCode\s*=\s*(\d+)/.exec(gradle);
    expect(match).not.toBeNull();
    expect(appVersion()).toBe(Number(match![1]));
  });

  test('the version is a real number, not a placeholder', () => {
    expect(Number.isInteger(appVersion())).toBe(true);
    expect(appVersion()).toBeGreaterThan(0);
  });
});

describe('every request carries the marker', () => {
  test('a GET carries X-App-Version', async () => {
    await apiFetch('/api/users/me');
    expect(fetchMock).toHaveBeenCalled();
    const headers = headersOf(fetchMock.mock.calls[0] as never);
    expect(headers[APP_VERSION_HEADER]).toBe(String(appVersion()));
  });

  test('a POST with a body carries it too, alongside Content-Type', async () => {
    await apiFetch('/api/journeys/j1/accept-bid', {
      method: 'POST',
      body: JSON.stringify({ bidId: 'b1' }),
    });
    const headers = headersOf(fetchMock.mock.calls[0] as never);
    expect(headers[APP_VERSION_HEADER]).toBe(String(appVersion()));
    expect(headers['Content-Type']).toBe('application/json');
  });

  test('an explicit header from the caller wins', async () => {
    // The injection is a default, not an override — the same posture
    // buildInit already takes with Content-Type and Authorization.
    await apiFetch('/api/users/me', { headers: { [APP_VERSION_HEADER]: '99' } });
    const headers = headersOf(fetchMock.mock.calls[0] as never);
    expect(headers[APP_VERSION_HEADER]).toBe('99');
  });

  test('the header name is exactly what the server reads', () => {
    // The server matches on the lower-cased form (express normalises
    // incoming header names); this is the same string.
    expect(APP_VERSION_HEADER.toLowerCase()).toBe('x-app-version');
  });
});
