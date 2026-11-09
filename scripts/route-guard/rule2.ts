// INCLUDE-REACH G2 — rule 2's judgement layer.
//
// include-reach.ts records WHERE the reads are and how far they reach. This
// file answers the two questions that turn a record into a verdict:
//
//   1. Is this read reachable from a GET route?  (blind spot c — the walker
//      must cross the route→service boundary that AUTH-READ's rule 1 could
//      not, or rule 2 would see nothing, because no over-reaching `include`
//      has ever lived in a handler body.)
//   2. Did anything on the way restrict by caller?
//
// Reachability is a NAME-BASED call graph, and that is a deliberate
// over-approximation stated out loud: `journeyService.getJourneyById`,
// `getJourneyById` and a barrel re-export of either all reduce to the last
// segment `getJourneyById`, so a read is attributed to every GET route that
// can reach a function of that name. Two same-named functions in different
// files therefore share each other's routes. The walker over-reports rather
// than under-reports; an over-report is an allowlist entry, an under-report
// is the bug this whole dispatch exists to stop being surprised by.

import * as fs from 'node:fs';
import type { RouteRecord } from './extract';
import {
  lastSegment,
  type ReachFunctionRecord,
  type ReachMap,
  type ReadRecord,
} from './include-reach';

/** How deep the route→service call graph is followed. */
const MAX_DEPTH = 8;

/**
 * Middleware that closes a route to ordinary accounts entirely.
 *
 * This is the one calibration rule 2 needs and does not get from its
 * mechanical definition. The class being hunted is the IDOR: an
 * over-reaching read on a route ANY AUTHENTICATED ACCOUNT can call. An
 * `adminOnly` route (auth.ts:144 — `req.user.role !== 'ADMIN'` → 403) is not
 * that: the escrow rows and GPS traces an ops screen reads are the whole
 * point of an ops screen, and the caller restriction is the middleware.
 *
 * `driverOnly` and `customerOnly` are deliberately NOT here. They narrow the
 * ROLE, not the ACCOUNT — every driver on the platform passes `driverOnly`,
 * so an IDOR between two drivers survives it untouched. Only a gate that
 * admits a privileged operator counts.
 *
 * Role-gated rows are never hidden: they stay in the census with their
 * models listed and `role-gated` as the stated reason.
 */
export const PRIVILEGED_MIDDLEWARE = new Set(['adminOnly']);

export interface Rule2AllowlistEntry {
  /** `<function> in <file> → <Model>.<method>` — see censusKey(). */
  key: string;
  /** Protected models this attestation covers, as reported by the walker. */
  models?: string[];
  /**
   * For a read whose check lives somewhere the walker cannot see: the
   * function that carries it. Checked against the recorded call graph, so
   * re-pointing the code invalidates the attestation.
   */
  restrictedBy?: string;
  reason: string;
}

export type Verdict = 'finding' | 'unknown' | 'attested-safe' | 'restricted' | 'unreachable';

export interface CensusRow {
  key: string;
  file: string;
  line: number;
  fn: string;
  /** GET routes that reach this read, `GET /path in <routes file>`. */
  routes: string[];
  /** Protected models reached via a relation hop — rule 2's subject. */
  traversed: string[];
  /** Protected models the read targets directly — reported, not rule 2. */
  direct: string[];
  restrictions: string[];
  unknowns: string[];
  verdict: Verdict;
}

export interface Rule2Result {
  ok: boolean;
  errors: string[];
  warnings: string[];
  rows: CensusRow[];
}

export function censusKey(fn: ReachFunctionRecord, read: ReadRecord): string {
  return `${fn.name} in ${fn.file} → ${read.model}.${read.method}`;
}

const ROUTES_FILE = /\/routes\/[^/]+\.routes\.ts$/;

/** A GET route handler, as txn-guard's nameOf names them: `GET /:id`. */
export function isGetRoute(fn: ReachFunctionRecord): boolean {
  return fn.name.startsWith('GET ') && ROUTES_FILE.test(fn.file);
}

export function routeLabel(fn: ReachFunctionRecord): string {
  return `${fn.name} in ${fn.file}`;
}

/** `GET /:id in packages/server/src/routes/journey.routes.ts` for a RouteRecord. */
export function recordLabel(r: RouteRecord): string {
  return `${r.method} ${r.path} in ${r.file}`;
}

export function privilegedRoutes(routes: RouteRecord[]): Set<string> {
  const out = new Set<string>();
  for (const r of routes) {
    const gates = [...r.middleware, ...r.routerMiddleware];
    if (gates.some((g) => PRIVILEGED_MIDDLEWARE.has(g))) out.add(recordLabel(r));
  }
  return out;
}

/**
 * For every function, the GET routes that can reach it. Breadth-first from
 * each GET handler over `calls`, matched by last segment.
 */
export function routeReachability(functions: ReachFunctionRecord[]): Map<ReachFunctionRecord, Set<string>> {
  const byName = new Map<string, ReachFunctionRecord[]>();
  for (const f of functions) {
    const list = byName.get(f.name);
    if (list) list.push(f);
    else byName.set(f.name, [f]);
  }

  const out = new Map<ReachFunctionRecord, Set<string>>();
  const add = (f: ReachFunctionRecord, label: string) => {
    const s = out.get(f);
    if (s) s.add(label);
    else out.set(f, new Set([label]));
  };

  for (const entry of functions.filter(isGetRoute)) {
    const label = routeLabel(entry);
    let frontier: ReachFunctionRecord[] = [entry];
    const visited = new Set<ReachFunctionRecord>([entry]);
    add(entry, label);
    for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth += 1) {
      const next: ReachFunctionRecord[] = [];
      for (const fn of frontier) {
        for (const callee of fn.calls) {
          for (const target of byName.get(lastSegment(callee)) ?? []) {
            if (visited.has(target)) continue;
            visited.add(target);
            add(target, label);
            next.push(target);
          }
        }
      }
      frontier = next;
    }
  }
  return out;
}

/**
 * Restrictions that count for a read: the read's own (`scoped-where`,
 * `scoped-projection`), plus any caller-conditioned denial or guard call
 * that the read actually sits BELOW. A denial further down the function
 * cannot have gated a query that already ran.
 */
function restrictionsFor(fn: ReachFunctionRecord, read: ReadRecord): string[] {
  const out = [...read.restrictions, ...fn.restrictions];
  if (fn.denialLines.some((l) => l < read.line)) out.push('inline-denial');
  if (fn.assertLines.some((l) => l < read.line)) out.push('caller-scope');
  return [...new Set(out)];
}

export function census(map: ReachMap, routes: RouteRecord[] = []): CensusRow[] {
  const reach = routeReachability(map.functions);
  const privileged = privilegedRoutes(routes);
  const rows: CensusRow[] = [];

  for (const fn of map.functions) {
    for (const read of fn.reads) {
      if (read.protectedReach.length === 0 && read.directReach.length === 0 && read.unknowns.length === 0) {
        continue;
      }
      const reached = [...(reach.get(fn) ?? new Set<string>())].sort();
      const restrictions = restrictionsFor(fn, read);
      // Every GET route that reaches this read is closed to ordinary
      // accounts → the caller restriction is the middleware.
      const roleGated = reached.length > 0 && reached.every((r) => privileged.has(r));
      if (roleGated) restrictions.push('role-gated');
      let verdict: Verdict;
      if (reached.length === 0) verdict = 'unreachable';
      else if (read.unknowns.length > 0) verdict = 'unknown';
      else if (read.protectedReach.length === 0) verdict = 'restricted';
      else if (restrictions.length > 0) verdict = 'restricted';
      else verdict = 'finding';

      rows.push({
        key: censusKey(fn, read),
        file: fn.file,
        line: read.line,
        fn: fn.name,
        routes: reached,
        traversed: read.protectedReach,
        direct: read.directReach,
        restrictions,
        unknowns: read.unknowns,
        verdict,
      });
    }
  }
  rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return rows;
}

export function runRule2(
  map: ReachMap,
  allowlist: Rule2AllowlistEntry[],
  routes: RouteRecord[] = [],
): Rule2Result {
  const errors: string[] = [];
  const warnings: string[] = [];

  const byKey = new Map<string, Rule2AllowlistEntry>();
  for (const entry of allowlist) {
    if (typeof entry.key !== 'string' || entry.key.trim() === '') {
      errors.push(`rule-2 allowlist entry with missing/empty key: ${JSON.stringify(entry)}`);
      continue;
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      errors.push(`rule-2 allowlist entry '${entry.key}' has no reason — every entry must say why`);
    }
    if (byKey.has(entry.key)) warnings.push(`duplicate rule-2 allowlist entry: '${entry.key}'`);
    byKey.set(entry.key, entry);
  }

  const rows = census(map, routes);
  const byFn = new Map<string, ReachFunctionRecord>();
  for (const f of map.functions) byFn.set(`${f.name} in ${f.file}`, f);

  const attestable = new Set<string>();

  for (const row of rows) {
    if (row.verdict !== 'finding' && row.verdict !== 'unknown') continue;
    attestable.add(row.key);
    const entry = byKey.get(row.key);
    if (!entry) {
      if (row.verdict === 'finding') {
        errors.push(
          `RULE 2 — over-reaching read: ${row.key} (${row.file}:${row.line}) traverses into ` +
            `${row.traversed.join(', ')} and nothing in the enclosing function restricts by caller. ` +
            `Reachable from ${row.routes.join('; ')}. Scope the projection to the viewer, or add an ` +
            `entry with a reason to scripts/route-guard/include-allowlist.json.`,
        );
      } else {
        errors.push(
          `RULE 2 — UNKNOWN read: ${row.key} (${row.file}:${row.line}) could not be resolved — ` +
            `${row.unknowns.join('; ')}. Reachable from ${row.routes.join('; ')}. An unresolved read ` +
            `is not a clean read: make the selector resolvable, or attest it in ` +
            `scripts/route-guard/include-allowlist.json.`,
        );
      }
      continue;
    }
    if (entry.models) {
      const seen = [...new Set([...row.traversed, ...row.direct])].sort();
      const attested = [...entry.models].sort();
      if (seen.join(',') !== attested.join(',')) {
        errors.push(
          `STALE rule-2 entry '${row.key}': it attests ${attested.join(', ') || 'no models'}, but the ` +
            `read now reaches ${seen.join(', ') || 'nothing'}. Re-verify and update the entry.`,
        );
      }
    }
    if (entry.restrictedBy) {
      const fn = byFn.get(row.key.split(' → ')[0]);
      const carries = fn?.calls.some((c) => lastSegment(c) === lastSegment(entry.restrictedBy!)) ?? false;
      if (!carries) {
        errors.push(
          `STALE rule-2 entry '${row.key}': it attests the check lives in '${entry.restrictedBy}', but ` +
            `the function no longer calls it. Re-verify the new callee and update the entry.`,
        );
      }
    }
  }

  // #183's staleness rule: an entry that no longer describes any finding is
  // an unexamined human claim sitting in the tree, and the next reader would
  // trust it. It fails.
  for (const key of byKey.keys()) {
    if (attestable.has(key)) continue;
    errors.push(
      `STALE rule-2 entry '${key}': it no longer matches any finding — the read was removed, or it ` +
        `now restricts by caller. Remove it.`,
    );
  }

  return { ok: errors.length === 0, errors, warnings, rows };
}

export function loadRule2Allowlist(file: string): Rule2AllowlistEntry[] {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${file}: expected a JSON array of {key, reason} entries`);
  }
  return parsed as Rule2AllowlistEntry[];
}
