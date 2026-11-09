import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ADDR-FIX G3 — recurrence guard.
//
// History: the Journey model has only ever had pickupName/destinationName
// (prisma/schema.prisma), but ten client screens rendered
// journey.pickupAddress/journey.destinationAddress — fields no payload
// contains — so every ride list and detail showed blank origin and
// destination text in the field. It compiled silently because
// useJourneyStore types journeys as `any` and local page interfaces
// re-declared the wrong names. An earlier dispatch (CREATE-FIX, #117)
// even asserted the read side "legitimately" used the *Address names,
// which is why the bug survived one fix already.
//
// The full type-level guard (fail on any journey field access the shared
// Journey type doesn't declare) is not expressible while the store is
// `any`, so this is the narrower, honest version: no client source may
// reference the wrong field names at all. If you need an address-like
// field, the server sends pickupName/destinationName — use those.
const FORBIDDEN = /\b(pickupAddress|destinationAddress|dropoffAddress)\b/;

// Files allowed to mention the forbidden names: this guard itself, the
// CREATE-FIX regression test that asserts the create body does NOT
// contain them, and the ADDR-FIX G2 legacy-cache shim that reads rows
// old clients wrote under the wrong names in order to heal them.
// (hooks/useJourney.ts was a fourth entry until DEADWOOD G2 deleted it
// as dead code; db/tables.ts still carries the shim.)
const ALLOWLIST = new Set([
  '__tests__/addr-field-guard.test.ts',
  '__tests__/GoodsRequestPage.test.tsx',
  'db/tables.ts',
]);

const SRC_ROOT = join(__dirname, '..');

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('ADDR-FIX guard — journey *Address fields must not come back', () => {
  test('no client source references pickupAddress/destinationAddress', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file).replace(/\\/g, '/');
      if (ALLOWLIST.has(rel)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (FORBIDDEN.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
