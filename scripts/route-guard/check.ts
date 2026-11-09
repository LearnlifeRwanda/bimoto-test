// AUTH-READ G4 — rule 1: read-sibling ownership parity.
//
//   A read route whose same-path write sibling enforces ownership must
//   enforce ownership too.
//
// This is the rule the chat IDOR broke. `POST /api/journeys/:id/messages`
// verified the caller was a party to the journey before writing;
// `GET /api/journeys/:id/messages`, one file and thirty lines away, never
// asked who was calling. The check existed and was deliberate — the read
// path simply did not call it.
//
// The oracle sees handler bodies, not service internals (extract.ts says
// so at length). So a read that hands the caller's id to a service is not
// PROVEN safe here — it is ALLOWLISTED, with the service function that
// carries the check named in the entry. A read that never mentions
// `req.user` at all needs no service knowledge to condemn: it cannot be
// scoping by caller, because it never says who is asking.
//
// Rule 1 lives in this file. Rule 2 — over-reaching reads, the `include`
// that traverses into data the route's own path never names — lives in
// rule2.ts and include-reach.ts, and runs from the same CLI below.
//
// Run: pnpm routes:check

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  buildRouteMap,
  DEFAULT_CONFIG,
  READ_METHODS,
  WRITE_METHODS,
  type RouteRecord,
} from './extract';
import { buildReachMap, DEFAULT_REACH_CONFIG } from './include-reach';
import { loadRule2Allowlist, runRule2 } from './rule2';
// CUTGUARD v2 G4 — rule 3, the ownership tautology. See rule3.ts.
import { findRule3, loadRule3Allowlist, runRule3 } from './rule3';

export interface AllowlistEntry {
  /** `<METHOD> <path> in <file>` — see routeKey(). */
  key: string;
  /**
   * For a route that delegates the check to a service: the callee the
   * caller's id is passed to, exactly as it appears in the handler. The
   * check verifies the route still delegates to it, so re-pointing the
   * route at a different service invalidates the attestation.
   */
  delegatesTo?: string;
  reason: string;
}

export interface CheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Every read route that rule 1 requires an entry for. */
  findings: string[];
}

export interface RouteFamily {
  key: string;
  routes: RouteRecord[];
}

export function routeKey(r: RouteRecord): string {
  return `${r.method} ${r.path} in ${r.file}`;
}

/**
 * A "path family" is one router-relative path within one routes file —
 * the sibling relationship in `GET /:id/messages` ↔ `POST /:id/messages`.
 * Deliberately narrow: routes at DIFFERENT paths are not siblings, so
 * rule 1 never fires on a resemblance.
 */
export function groupFamilies(routes: RouteRecord[]): RouteFamily[] {
  const byKey = new Map<string, RouteRecord[]>();
  for (const r of routes) {
    const key = `${r.path} in ${r.file}`;
    const list = byKey.get(key);
    if (list) list.push(r);
    else byKey.set(key, [r]);
  }
  return [...byKey.entries()]
    .map(([key, rs]) => ({ key, routes: rs }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** A write sibling "enforces ownership" if its handler knows who is calling. */
function enforces(r: RouteRecord): boolean {
  return r.posture !== 'none';
}

export function runCheck(routes: RouteRecord[], allowlist: AllowlistEntry[]): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const byKey = new Map<string, AllowlistEntry>();
  for (const entry of allowlist) {
    if (typeof entry.key !== 'string' || entry.key.trim() === '') {
      errors.push(`allowlist entry with missing/empty key: ${JSON.stringify(entry)}`);
      continue;
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      errors.push(
        `allowlist entry '${entry.key}' has no reason — every entry must say why it is allowed`,
      );
    }
    if (byKey.has(entry.key)) warnings.push(`duplicate allowlist entry: '${entry.key}'`);
    byKey.set(entry.key, entry);
  }

  const findings: string[] = [];
  const routeByKey = new Map<string, RouteRecord>();
  for (const r of routes) routeByKey.set(routeKey(r), r);

  for (const family of groupFamilies(routes)) {
    const reads = family.routes.filter((r) => READ_METHODS.has(r.method));
    const guardedWrites = family.routes.filter((r) => WRITE_METHODS.has(r.method) && enforces(r));
    if (reads.length === 0 || guardedWrites.length === 0) continue;

    const witness = guardedWrites[0];
    for (const read of reads) {
      // The handler enforces ownership itself, visibly. Nothing to attest.
      if (read.posture === 'inline') continue;

      const key = routeKey(read);
      findings.push(key);
      const entry = byKey.get(key);

      if (!entry) {
        if (read.posture === 'none') {
          errors.push(
            `RULE 1 — unguarded read sibling: ${key} (${read.file}:${read.line}) never mentions ` +
              `req.user, but its write sibling ${witness.method} ${witness.path} ` +
              `(${witness.file}:${witness.line}) enforces ownership. A read that never asks who is ` +
              `calling cannot be scoped to them. Enforce it, or add an entry with a reason to ` +
              `scripts/route-guard/allowlist.json.`,
          );
        } else {
          errors.push(
            `RULE 1 — unattested delegated read: ${key} (${read.file}:${read.line}) passes the ` +
              `caller to ${read.delegatesTo.join(', ') || 'a service'}, which this walker cannot ` +
              `read into. Its write sibling ${witness.method} ${witness.path} enforces ownership. ` +
              `Add an entry to scripts/route-guard/allowlist.json naming the function that carries ` +
              `the check (delegatesTo) and why it is trusted.`,
          );
        }
        continue;
      }

      // An attestation that names a function must still be true.
      if (entry.delegatesTo && !read.delegatesTo.includes(entry.delegatesTo)) {
        errors.push(
          `STALE allowlist entry '${key}': it attests the check lives in ` +
            `'${entry.delegatesTo}', but the handler no longer passes the caller there ` +
            `(now: ${read.delegatesTo.join(', ') || 'nothing'}). Re-verify the new callee and ` +
            `update the entry.`,
        );
      }
    }
  }

  // A stale entry FAILS here — unlike wiring-audit, where the finding is
  // dormancy and a stale entry is merely untidy. This allowlist records
  // human attestations about who may read what; one that no longer
  // describes any route is an unexamined claim sitting in the tree, and
  // the next reader would trust it.
  const findingSet = new Set(findings);
  for (const key of byKey.keys()) {
    if (findingSet.has(key)) continue;
    const reason = routeByKey.has(key)
      ? 'the route now enforces ownership inline, or its write sibling no longer does'
      : 'no such route — it was renamed or removed';
    errors.push(`STALE allowlist entry '${key}': ${reason}. Remove it.`);
  }

  return { ok: errors.length === 0, errors, warnings, findings };
}

export function loadAllowlist(file: string): AllowlistEntry[] {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${file}: expected a JSON array of {key, reason} entries`);
  }
  return parsed as AllowlistEntry[];
}

/* istanbul ignore next — CLI entry */
if (require.main === module) {
  const root = path.resolve(__dirname, '..', '..');
  const map = buildRouteMap({ root, ...DEFAULT_CONFIG });
  const allowlist = loadAllowlist(path.join(__dirname, 'allowlist.json'));
  const result = runCheck(map.routes, allowlist);

  // INCLUDE-REACH G6 — rule 2, over the data-access layer.
  const reach = buildReachMap({ root, ...DEFAULT_REACH_CONFIG });
  const rule2 = runRule2(
    reach,
    loadRule2Allowlist(path.join(__dirname, 'include-allowlist.json')),
    map.routes,
  );

  // CUTGUARD v2 G4 — rule 3, over the route handlers themselves.
  const rule3Findings = map.files
    .filter((f) => f.endsWith('.routes.ts'))
    .flatMap((f) => findRule3(f, fs.readFileSync(path.join(root, f), 'utf8')));
  const rule3 = runRule3(
    rule3Findings,
    loadRule3Allowlist(path.join(__dirname, 'rule3-allowlist.json')),
  );

  for (const w of [...result.warnings, ...rule2.warnings, ...rule3.warnings]) {
    console.warn(`WARN: ${w}`);
  }
  for (const e of [...result.errors, ...rule2.errors, ...rule3.errors]) {
    console.error(`FAIL: ${e}`);
  }

  const failures = result.errors.length + rule2.errors.length + rule3.errors.length;
  if (failures > 0) {
    console.error(
      `\nroutes-check: ${result.errors.length} violation(s) of rule 1, ` +
        `${rule2.errors.length} of rule 2, ${rule3.errors.length} of rule 3.`,
    );
    process.exit(1);
  }

  const attested = rule2.rows.filter((r) => r.verdict === 'finding' || r.verdict === 'unknown');
  console.log(
    `routes-check: OK\n` +
      `  rule 1 — ${map.routes.length} routes in ${map.files.length} files, ` +
      `${result.findings.length} read(s) attested\n` +
      `  rule 2 — ${reach.files.length} files in ${reach.roots.length} roots, ` +
      `${reach.functions.length} functions, ${rule2.rows.length} census rows, ` +
      `${attested.length} attested\n` +
      `  rule 3 — ${rule3Findings.length} record-sourced owner argument(s), ` +
      `${rule3.cleared.length} attested`,
  );
}
