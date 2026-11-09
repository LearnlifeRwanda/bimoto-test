// SOCKET-FIX G6 — the socket event-name contract gate.
//
// Every app-defined socket event name must be a SOCKET_EVENTS constant
// (constants/socket-events.ts): this test walks the server AND client
// source trees and fails on any raw string literal used as the event
// argument of .emit(...) / .on(...) / emitToJourney(...). Free-floating
// event-name literals are exactly how the discovery feed shipped
// severed — the server emitting 'journey:available' while the client
// listened for 'journey:nearby' — so a raw literal is a CI failure,
// not a code-review hope.
//
// Runs under the server's jest (its roots include shared/src, the
// established home for cross-package source-reading guards — see the
// client's i18n-used-keys gate for the client-side sibling pattern).

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { SOCKET_EVENTS } from '../constants/socket-events.js';

const SERVER_SRC = join(__dirname, '../../../server/src');
const CLIENT_SRC = join(__dirname, '../../../client/src');

// Socket.io lifecycle events (never app-defined). 'error' doubles as a
// socket.io builtin and an app event; it is also a SOCKET_EVENTS value.
const SOCKETIO_BUILTINS = new Set([
  'connect',
  'connection',
  'disconnect',
  'connect_error',
  'error',
]);

// Node EventEmitter/stream/process events that share the .on() spelling
// but are not socket traffic. Each entry names its non-socket emitter;
// additions need the same justification.
const NODE_RUNTIME_EVENTS = new Set([
  'SIGTERM', // process.on — graceful shutdown (server index.ts)
  'SIGINT', // process.on — graceful shutdown (server index.ts)
  'unhandledRejection', // process.on — DB-RESILIENCE safety net (server index.ts)
  'uncaughtException', // process.on — DB-RESILIENCE safety net (server index.ts)
  'finish', // fs WriteStream — BNR PDF builder
]);

const KNOWN = new Set<string>([
  ...Object.values(SOCKET_EVENTS),
  ...SOCKETIO_BUILTINS,
  ...NODE_RUNTIME_EVENTS,
]);

// Event-name literal in the first argument of .emit(/.on(, the first
// argument of emitToAdmins-style helpers, or the second argument of
// emitToJourney-style helpers. Backtick literals WITHOUT interpolation
// count too; templates with ${} cannot be checked statically and none
// exist today.
const PATTERNS = [
  /\.(?:emit|on)\(\s*['"]([^'"]+)['"]/g,
  /\.(?:emit|on)\(\s*`([^`$]+)`/g,
  /\bemitTo\w+\(\s*['"]([^'"]+)['"]/g,
  /\bemitTo\w+\(\s*[^,()]+,\s*['"]([^'"]+)['"]/g,
];

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    if (['__tests__', 'node_modules', 'dist'].includes(entry)) continue;
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

interface Scan {
  offenders: string[]; // "literal (file:line)" for literals outside the contract
  literalCount: number;
  constantRefCount: number;
  fileCount: number;
}

function scan(): Scan {
  const offenders: string[] = [];
  let literalCount = 0;
  let constantRefCount = 0;
  const files = [...sourceFiles(SERVER_SRC), ...sourceFiles(CLIENT_SRC)];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      constantRefCount += (line.match(/\bSOCKET_EVENTS\./g) ?? []).length;
      for (const pattern of PATTERNS) {
        for (const m of line.matchAll(pattern)) {
          literalCount++;
          if (!KNOWN.has(m[1])) {
            offenders.push(`'${m[1]}' (${file}:${i + 1})`);
          }
        }
      }
    });
  }
  return { offenders, literalCount, constantRefCount, fileCount: files.length };
}

// ── SOCKET-HYGIENE G4 — emit↔listen orphan guard ──────────────────
//
// The literal check above guarantees every event NAME resolves to a
// constant, but not that every listened event has an emitter or every
// emitted event a handler — which is exactly how dead wires persisted
// (see docs/socket-wiring-audit.md). This pass resolves every
// constant-referencing emit/listen site on both sides of the wire,
// helpers included, and fails CI on:
//   * a client listener whose constant NO server emit site uses;
//   * a client→server emit with no server socket.on handler;
//   * an EMIT-ONLY server event missing from (or stale in) the
//     intentional-orphan registry below.

// The intentional-orphan registry: server events emitted today with no
// client listener — forward wiring for unbuilt UI. Adding an entry is a
// deliberate, reviewed act; wiring a listener up requires REMOVING the
// entry (a stale entry fails the exactness check).
const EMIT_ONLY_SERVER_EVENTS = new Set<keyof typeof SOCKET_EVENTS>([
  'ERROR', // socket.emit on unauthorised join-journey/update-location; no client error surface yet
  'SUGGEST_UP_AVAILABLE', // suggest-up prompt to the customer; customer-modes UI not built
  'JOURNEY_CREATED', // journey lifecycle for future live journey surfaces (W4/W5)
  'JOURNEY_STARTED', // journey lifecycle (W4/W5)
  // JOURNEY_ENDED and JOURNEY_CONFIRMED used to sit here as "journey
  // lifecycle (W4/W5)" forward wiring. TEAM-ANSWERS G5 (OPEN DECISIONS
  // item 16b) built the surface they were waiting for: the passenger's
  // "Confirm arrival" affordance needs to know the driver has ended the
  // ride, and to clear itself once the confirm lands. useSocket now
  // listens for both, so their entries are removed — which is exactly
  // what this registry's rule says wiring a listener requires.
  'JOURNEY_DISPUTED', // journey lifecycle / admin conflict surfaces
  'JOURNEY_INTERRUPTED', // journey lifecycle / resilience surfaces
  'JOURNEY_CANCELLED', // journey lifecycle (W4/W5)
  'JOURNEY_EXPIRED', // journey lifecycle (W4/W5)
  'JOURNEY_AUTO_CONFIRMED', // auto-confirm job notice; no client surface yet
  // JOURNEY_CUSTOMER_COMPLETED left this registry the only way an entry
  // may leave it other than by gaining a listener: the EVENT was retired.
  // Founder decision D10 deleted POST /:id/customer-complete and the
  // service function behind it, and that function held the constant's ONLY
  // emit site (journey.service.ts:2132). The constant, this row and the
  // socket-wiring-audit row moved in ONE commit — #195's lesson, and this
  // registry's own rule that a stale entry fails the exactness check just
  // as loudly as a missing one.
  'JOURNEY_RECONCILED', // resilience reconciliation outcome; no client surface yet
  'JOURNEY_RECONCILIATION_REQUIRED', // resilience reconciliation prompt; no client surface yet
  // LIVE-WIRE G2 — BID_ACCEPTED, BID_WITHDRAWN and BID_DECLINED left
  // this registry: all three now have client listeners in
  // hooks/useSocket.ts. The baseline shrinks, as it may only do.
  'BID_EXPIRED', // bid lifecycle (W4)
  'SCHEDULED_RIDE_REMINDER', // scheduled-ride wave; client surfaces not built
  'SCHEDULED_RIDE_MATCHED', // scheduled-ride wave
  'SCHEDULED_RIDE_EXPIRED', // scheduled-ride wave
  'SCHEDULED_RIDE_CANCELLED', // scheduled-ride wave
  'SCHEDULED_RIDE_BID_WINDOW_OPENED', // scheduled-ride wave
]);

// Constant-referencing wiring sites. `[\s\S]` inside the argument gap
// keeps multi-line calls visible; `emitTo\w+` covers emitToJourney,
// emitToAdmins, and any future emitTo* helper (first- or second-arg
// event position).
const EMIT_REF = [
  /\.emit\(\s*SOCKET_EVENTS\.(\w+)/g,
  /\bemitTo\w+\(\s*SOCKET_EVENTS\.(\w+)/g,
  /\bemitTo\w+\(\s*[^,()]+,\s*SOCKET_EVENTS\.(\w+)/g,
];
const LISTEN_REF = [/\.on\(\s*SOCKET_EVENTS\.(\w+)/g];

interface Wiring {
  serverEmits: Set<string>;
  serverListens: Set<string>;
  clientEmits: Set<string>;
  clientListens: Set<string>;
  unknownKeys: string[]; // SOCKET_EVENTS.<key> refs where <key> is not a constant
}

function scanWiring(): Wiring {
  const wiring: Wiring = {
    serverEmits: new Set(),
    serverListens: new Set(),
    clientEmits: new Set(),
    clientListens: new Set(),
    unknownKeys: [],
  };
  const collect = (root: string, emits: Set<string>, listens: Set<string>) => {
    for (const file of sourceFiles(root)) {
      const content = readFileSync(file, 'utf8');
      for (const [patterns, bucket] of [
        [EMIT_REF, emits],
        [LISTEN_REF, listens],
      ] as const) {
        for (const pattern of patterns) {
          for (const m of content.matchAll(pattern)) {
            if (!(m[1] in SOCKET_EVENTS)) {
              wiring.unknownKeys.push(`SOCKET_EVENTS.${m[1]} (${file})`);
              continue;
            }
            bucket.add(m[1]);
          }
        }
      }
    }
  };
  collect(SERVER_SRC, wiring.serverEmits, wiring.serverListens);
  collect(CLIENT_SRC, wiring.clientEmits, wiring.clientListens);
  return wiring;
}

const result = scan();
const wiring = scanWiring();

describe('socket event-name contract (SOCKET-FIX G6)', () => {
  test('scanner sanity: it still sees both source trees', () => {
    // Guards against a refactor silently emptying the walk. Both trees
    // together are far above these floors today.
    expect(result.fileCount).toBeGreaterThan(100);
    expect(result.constantRefCount).toBeGreaterThan(40);
  });

  test('every emit/on event literal is a SOCKET_EVENTS value or an allowlisted builtin', () => {
    expect(result.offenders).toEqual([]);
  });

  test('SOCKET_EVENTS values are unique (one canonical name per constant)', () => {
    const values = Object.values(SOCKET_EVENTS);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('socket emit↔listen orphan guard (SOCKET-HYGIENE G4)', () => {
  test('wiring scanner sanity: it sees both sides of the wire', () => {
    // Floors guard against a refactor silently emptying a scan; today
    // the server emits ~30 constants and the client listens for ~10.
    expect(wiring.serverEmits.size).toBeGreaterThan(20);
    expect(wiring.serverListens.size).toBeGreaterThanOrEqual(3);
    expect(wiring.clientEmits.size).toBeGreaterThanOrEqual(3);
    expect(wiring.clientListens.size).toBeGreaterThanOrEqual(8);
    expect(wiring.unknownKeys).toEqual([]);
  });

  test('every client listener has a live server emit site (no LISTEN-ONLY dead wires)', () => {
    const orphans = [...wiring.clientListens].filter((k) => !wiring.serverEmits.has(k));
    expect(orphans).toEqual([]);
  });

  test('every client→server emit has a server handler (no unhandled client emits)', () => {
    const orphans = [...wiring.clientEmits].filter((k) => !wiring.serverListens.has(k));
    expect(orphans).toEqual([]);
  });

  test('EMIT-ONLY server events match the intentional-orphan registry exactly', () => {
    const emitOnly = [...wiring.serverEmits].filter((k) => !wiring.clientListens.has(k)).sort();
    // Unlisted here → either wire up a listener or register the event
    // above WITH a comment saying which future surface it feeds.
    const unregistered = emitOnly.filter((k) => !EMIT_ONLY_SERVER_EVENTS.has(k as keyof typeof SOCKET_EVENTS));
    expect(unregistered).toEqual([]);
    // Stale here → the event now has a listener (or lost its emitter);
    // remove the registry entry so the allowlist stays the truth.
    const stale = [...EMIT_ONLY_SERVER_EVENTS].filter((k) => !emitOnly.includes(k)).sort();
    expect(stale).toEqual([]);
  });
});
