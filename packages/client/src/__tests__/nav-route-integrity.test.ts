// PILOT-UX-2 G1 — nav-target ↔ route-table agreement gate.
//
// The bottom nav shipped pointing at '/home' and '/requests', neither of
// which exists in the App route table, so the home tab landed on the 404
// page on the pilot phone. Nothing tested that nav targets are real
// routes — this test closes that hole permanently:
//
//   1. the route table is extracted from App.tsx source (every declared
//      <Route path="…">), so it can never drift from what actually ships;
//   2. every BottomNav target (all role variants, via the exported
//      NAV_TABS_BY_ROLE) must match a declared route;
//   3. every navigate('…')/<Link to="…"> literal in the layout
//      components must match a declared route;
//   4. NotFoundPage's recovery link must point at '/' — and match too.
//
// Matching goes through react-router's own matchPath so param routes
// ('/journey/:id/bids') behave exactly as they do at runtime.

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { matchPath } from 'react-router-dom';
import { NAV_TABS_BY_ROLE } from '../components/layout/BottomNav';

const SRC = join(__dirname, '..');

// ------------------------------------------------------------ route table

function declaredRoutePaths(): string[] {
  const appSource = readFileSync(join(SRC, 'App.tsx'), 'utf8');
  const paths = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
  return paths.filter((p) => p !== '*');
}

const routePaths = declaredRoutePaths();

function matchesDeclaredRoute(target: string): boolean {
  // Strip any query/hash a nav target might carry (e.g. '?tier=priority').
  const pathname = target.split(/[?#]/)[0];
  return routePaths.some((route) => matchPath({ path: route, end: true }, pathname) !== null);
}

// --------------------------------------------- literal targets in layouts

function literalNavTargets(dir: string): Array<{ target: string; where: string }> {
  const out: Array<{ target: string; where: string }> = [];
  for (const entry of readdirSync(dir)) {
    if (!/\.tsx?$/.test(entry) || /\.test\./.test(entry)) continue;
    const file = join(dir, entry);
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/navigate\(\s*['"`](\/[^'"`]*)['"`]/g)) {
        out.push({ target: m[1], where: `${entry}:${i + 1}` });
      }
      for (const m of line.matchAll(/\bto="(\/[^"]*)"/g)) {
        out.push({ target: m[1], where: `${entry}:${i + 1}` });
      }
    });
  }
  return out;
}

// ------------------------------------------------------------------ tests

describe('nav targets always exist in the route table (PILOT-UX-2 G1)', () => {
  test('route-table extraction sanity: it still sees the app', () => {
    // 41 routes at the time of writing; a floor guards against the
    // regex silently matching nothing after a refactor.
    expect(routePaths.length).toBeGreaterThan(30);
    expect(routePaths).toContain('/');
    expect(routePaths).toContain('/driver');
  });

  for (const [role, tabs] of Object.entries(NAV_TABS_BY_ROLE)) {
    test(`every ${role} bottom-nav target matches a declared route`, () => {
      const broken = tabs
        .filter((tab) => !matchesDeclaredRoute(tab.path))
        .map((tab) => `${tab.path} (${tab.labelKey})`);
      expect(broken).toEqual([]);
    });
  }

  test('every literal navigate()/<Link> target in layout components matches a declared route', () => {
    const targets = literalNavTargets(join(SRC, 'components/layout'));
    const broken = targets
      .filter(({ target }) => !matchesDeclaredRoute(target))
      .map(({ target, where }) => `${target} at ${where}`);
    expect(broken).toEqual([]);
  });

  test("NotFoundPage's recovery link points at '/' and matches a route", () => {
    const source = readFileSync(join(SRC, 'pages/NotFoundPage.tsx'), 'utf8');
    const link = source.match(/\bto="([^"]+)"/);
    expect(link?.[1]).toBe('/');
    expect(matchesDeclaredRoute(link![1])).toBe(true);
  });
});
