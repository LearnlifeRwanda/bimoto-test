// AUTH-REFRESH G4 — raw-authenticated-fetch gate.
//
// The minute-16 field failure existed because every page hand-rolled
// fetch(`${API_URL}/...`) with a boot-time token and nothing ever
// refreshed. All authenticated calls now go through lib/api.ts's
// apiFetch (refresh-and-retry on 401, proactive refresh near expiry).
// This test makes bypassing it a CI failure: any raw fetch( that
// references API_URL in non-test client source outside the helper
// modules and the enumerated no-auth allowlist fails the suite.
//
// If you are adding an API call: use apiFetch (or add the file here
// ONLY if the endpoint genuinely runs without a session, with a
// comment saying why).

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..');

// Files allowed to call fetch(`${API_URL}...`) directly. Every entry
// must be a genuinely UNAUTHENTICATED call site (or the helper layer
// itself) — nothing here may send or depend on a session.
const RAW_FETCH_ALLOWLIST: Record<string, string> = {
  // The refresh exchange itself — routing it through apiFetch would
  // recurse (apiFetch's 401 path calls this module).
  'lib/auth-refresh.ts': 'the one sanctioned token exchange; must not recurse through apiFetch',
  // Boot-time /api/health probe for simulation-mode discovery: pre-auth,
  // fail-safe, and must not entangle with the session lifecycle.
  'App.tsx': 'public /api/health mode probe at boot (pre-auth)',
  // Connectivity heartbeat against /api/health: runs logged-out, must
  // never trigger a refresh or logout.
  'sync/connectivity.ts': 'public /api/health connectivity probe (no session involved)',
  // OTP request/verify happen BEFORE a session exists; their 401s are
  // real answers (bad code), never token expiry.
  'pages/auth/LoginPage.tsx': 'pre-auth request-otp / verify-otp',
  // Public jacket-number check — reachable without any account by design.
  'pages/public/CheckDriverPage.tsx': 'public driver-ID validity check (DRIVER-ID v3)',
};

// A raw fetch whose URL is built from API_URL (or any *apiUrl* value) —
// template form `fetch(`${API_URL}...` (possibly across lines) or the
// plain `fetch(API_URL` form.
const RAW_API_FETCH = /\bfetch\(\s*(`\$\{\s*(API_URL|[\w$.]*apiUrl[\w$.]*)\s*\}|API_URL)/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      yield* walk(full);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry) || /\.d\.ts$/.test(entry)) continue;
    yield full;
  }
}

describe('raw-fetch guard (AUTH-REFRESH G4)', () => {
  const offenders: string[] = [];
  const allowlistHits = new Set<string>();

  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split('\\').join('/');
    const source = readFileSync(file, 'utf8');
    if (!RAW_API_FETCH.test(source)) continue;
    if (rel in RAW_FETCH_ALLOWLIST || rel === 'lib/api.ts') {
      allowlistHits.add(rel);
      continue;
    }
    offenders.push(rel);
  }

  test('every authenticated API call goes through apiFetch', () => {
    expect(
      offenders,
      `Raw fetch(\`\${API_URL}...\`) outside lib/api.ts, lib/auth-refresh.ts and the ` +
        `no-auth allowlist. Use apiFetch from lib/api.ts so the call survives ` +
        `access-token expiry (refresh-and-retry), or — only for a genuinely ` +
        `unauthenticated endpoint — add an allowlist entry with a justification:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  test('the allowlist carries no stale entries', () => {
    // An entry whose file no longer raw-fetches means the file was
    // converted (or removed) — drop the entry so the gate stays tight.
    const stale = Object.keys(RAW_FETCH_ALLOWLIST).filter((f) => !allowlistHits.has(f));
    expect(stale, `Allowlist entries whose files no longer raw-fetch: ${stale.join(', ')}`).toEqual(
      [],
    );
  });
});
