// LOCATION-LIFE A G6 — the location-heartbeat ownership gate.
//
// The defect this wave closes was not a wrong line; it was a wrong
// OWNER. A 15 s `setInterval` that wrote PUT /me/location lived inside
// DashboardPage, so the motari's existence for discovery was a property
// of which screen he happened to be looking at — and all seven
// consumers of `driverProfile.lastLocationAt` inherited that coupling.
// The fix moved the beat into services/driver-liveness.ts, where no
// component teardown can reach it.
//
// This test makes putting it back a CI failure: no file under pages/
// may drive a location write FROM an interval.
//
// The rule is deliberately that precise rather than "no page may
// contain both". A page may legitimately write location once — the
// go-online handler does, and must — and a page may legitimately run
// intervals for other things: the dashboard polls the request feed on
// its own clock. What may never happen again is the pairing: a timer
// on a page whose callback reaches the location write.
//
// HONEST ABOUT ITS LIMITS. Lifecycle coupling has no full oracle. This
// follows call chains TRANSITIVELY but only WITHIN one file — the real
// pre-fix shape was two hops deep (setInterval → trackingTick →
// updateLocation → apiFetch), and a guard that resolved one hop would
// have passed it, which is worth knowing about guards in general. A
// heartbeat rebuilt in a component under components/, or assembled
// across module boundaries, would still slip past. It closes the exact
// shape that reached the field. The behavioural pin is
// LocationLife-driver-liveness.test.tsx, where the driver goes online,
// the dashboard unmounts, and the pings must continue.
//
// If you are adding a periodic location write: it belongs in the
// liveness module, not on a page.

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..');
const PAGES = join(SRC, 'pages');
const LIVENESS_MODULE = join(SRC, 'services', 'driver-liveness.ts');

const LOCATION_WRITE = /['"`][^'"`]*\/me\/location/;
const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

/** Source of the balanced expression starting at `open` (an index of '('). */
function balanced(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

/** The body of `const <name> = ...` / `function <name>(...)`, brace-balanced. */
function definitionBody(src: string, name: string): string | null {
  const def = new RegExp(`(?:const|let|function)\\s+${name}\\b`).exec(src);
  if (!def) return null;
  const brace = src.indexOf('{', def.index);
  if (brace === -1) return null;
  return balanced(src, brace);
}

/**
 * Does this expression reach a location write — inline, or through any
 * chain of functions defined in the same file? Transitive, with a
 * visited set: the pre-fix chain was setInterval → trackingTick →
 * updateLocation → apiFetch('/api/users/me/location').
 */
function reachesLocationWrite(
  src: string,
  expr: string,
  seen: Set<string>,
): boolean {
  if (LOCATION_WRITE.test(expr)) return true;
  for (const id of expr.match(IDENTIFIER) ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    const body = definitionBody(src, id);
    if (body && reachesLocationWrite(src, body, seen)) return true;
  }
  return false;
}

/**
 * Does this file start an interval whose callback reaches a location
 * write?
 */
function intervalDrivesLocationWrite(src: string): boolean {
  const re = /setInterval\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const args = balanced(src, m.index + m[0].length - 1);
    const callback = args.split(/,(?![^(]*\))/)[0] ?? args;
    if (reachesLocationWrite(src, callback, new Set())) return true;
  }
  return false;
}

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

describe('liveness ownership guard (LOCATION-LIFE A G6)', () => {
  test('no page drives a location write from an interval', () => {
    const offenders: string[] = [];
    for (const file of walk(PAGES)) {
      if (intervalDrivesLocationWrite(readFileSync(file, 'utf8'))) {
        offenders.push(relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the guard catches the pre-fix shape, and clears the legitimate ones', () => {
    // What DashboardPage did until this wave: a 15 s interval whose
    // callback wrote the location. This MUST be caught, or the guard
    // proves nothing.
    const prefixShape = `
      const trackingTick = useCallback(async () => {
        const coords = await geolocation.getCurrentPosition({ enableHighAccuracy: true });
        await apiFetch('/api/users/me/location', { method: 'PUT' });
      }, []);
      locationIntervalRef.current = setInterval(() => void trackingTick(), 15000);
    `;
    expect(intervalDrivesLocationWrite(prefixShape)).toBe(true);

    // The same write, inlined into the interval — the shape a rewrite
    // would most plausibly take.
    const inlined = `
      setInterval(() => { apiFetch('/api/users/me/location', { method: 'PUT' }); }, 15000);
    `;
    expect(intervalDrivesLocationWrite(inlined)).toBe(true);

    // The REAL pre-fix DashboardPage is the control that matters, and
    // it is why this resolves transitively: its chain was setInterval →
    // trackingTick → updateLocation → apiFetch. A one-hop guard passed
    // it. This one must not.
    const realPreFixChain = `
      const updateLocation = useCallback(async (lat, lng) => {
        const res = await apiFetch('/api/users/me/location', { method: 'PUT' });
        if (!res.ok) throw await apiErrorFromResponse(res);
      }, []);
      const trackingTick = useCallback(async () => {
        const coords = await geolocation.getCurrentPosition({ enableHighAccuracy: true });
        await updateLocation(coords.lat, coords.lng);
      }, [updateLocation]);
      const startLocationTracking = useCallback(() => {
        locationIntervalRef.current = setInterval(
          () => void trackingTick(),
          LOCATION_UPDATE_INTERVAL,
        );
      }, [trackingTick]);
    `;
    expect(intervalDrivesLocationWrite(realPreFixChain)).toBe(true);

    // A page that writes location ONCE, on a deliberate tap, is fine —
    // that is exactly what handleGoOnline must keep doing.
    const oneShot = `
      const handleGoOnline = async () => {
        await apiFetch('/api/users/me/location', { method: 'PUT' });
      };
    `;
    expect(intervalDrivesLocationWrite(oneShot)).toBe(false);

    // And a page polling something else on a timer is fine.
    const feedPoll = `
      const tick = () => fetchNearbyRequests(lat, lng);
      const interval = setInterval(tick, 5000);
    `;
    expect(intervalDrivesLocationWrite(feedPoll)).toBe(false);
  });

  test('the heartbeat does live in the liveness module', () => {
    // The other half of the assertion: the shape was MOVED, not merely
    // deleted. A guard that passed because nothing writes location
    // periodically at all would be worthless.
    const src = readFileSync(LIVENESS_MODULE, 'utf8');
    expect(intervalDrivesLocationWrite(src)).toBe(true);
  });
});
