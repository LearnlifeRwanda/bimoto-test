// SUPPLY-CHAIN G3 — something finally watches the tree beneath the guards.
//
// AUDIT-BATTERY §K-5: at 0cd6efd `.github/` contained `workflows/` and
// nothing else — no dependabot.yml, no renovate.json, no `pnpm audit`
// step in any of the five workflows, no licence check. The repo had
// EIGHT bespoke guards for its own invariants (wiring, constants, route
// rules 1+2, txn, i18n, map, landmarks, pilot-updater) and zero
// automation watching the ~1,400 packages underneath them.
//
// The rule:
//
//   Every advisory at `high` or above against the PRODUCTION dependency
//   tree either does not exist, or carries a baseline entry naming the
//   advisory, the package, a path, the severity, a REASON and an OWNER.
//   A new one FAILS. A baseline entry whose advisory no longer appears
//   also FAILS, as stale — the route-guard precedent (#183): these
//   entries are human judgements about accepted risk, and one that no
//   longer describes anything real is an unexamined claim sitting in the
//   tree that the next reader would trust.
//
// `--prod` is the whole point. The installed tree carries dev and build
// tooling that never reaches a user — ts-jest, @capacitor/cli,
// vite-plugin-pwa, vitest, postcss, esbuild, jsdom. Auditing all of it
// reports ~159 advisories and gating on that number teaches everyone to
// ignore the gate. `--prod` cuts it to the surface that actually ships.
//
// Two boundaries this guard does NOT claim to cross, stated so nobody
// reads more into a green run than it means:
//   - reachability is not exploitability. An advisory against a package
//     in the production tree says the code is installed, not that any
//     input reaches it. No exploit analysis is implied.
//   - moderates are recorded but not gated. Baselining one is how the
//     residue stays visible and how the stale rule keeps watching it.
//
// Run: pnpm deps:check

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Severities this guard FAILS on when unbaselined. */
export const GATED = ['high', 'critical'] as const;

export interface Advisory {
  id: number | string;
  module_name: string;
  severity: string;
  title: string;
  /** Every dependency path the audit reported for this advisory. */
  paths: string[];
}

export interface BaselineEntry {
  /** Advisory id, as `pnpm audit --json` reports it. */
  id: number | string;
  package: string;
  /** One representative dependency path, so the entry can be recognised. */
  path: string;
  severity: string;
  /** Why this advisory is still here. Never "known" or "accepted". */
  reason: string;
  /** The decision, migration or wave that owns the fix. */
  owner: string;
}

export interface CheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Every advisory the audit reported, gated or not. */
  seen: Advisory[];
}

const key = (id: number | string) => String(id);

export function runCheck(advisories: Advisory[], baseline: BaselineEntry[]): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const byId = new Map<string, BaselineEntry>();
  for (const entry of baseline) {
    if (entry.id === undefined || entry.id === null || key(entry.id).trim() === '') {
      errors.push(`baseline entry with no advisory id: ${JSON.stringify(entry)}`);
      continue;
    }
    const k = key(entry.id);
    for (const field of ['package', 'path', 'severity', 'reason', 'owner'] as const) {
      const v = entry[field];
      if (typeof v !== 'string' || v.trim() === '') {
        errors.push(
          `baseline entry '${k}' has no ${field}. Every entry must say which package, on which ` +
            `path, at which severity, WHY it is still here and WHO owns the fix. An entry that ` +
            `cannot answer those is an advisory nobody has actually looked at.`,
        );
      }
    }
    if (byId.has(k)) warnings.push(`duplicate baseline entry for advisory ${k}`);
    byId.set(k, entry);
  }

  const seenIds = new Set<string>();
  for (const adv of advisories) {
    const k = key(adv.id);
    seenIds.add(k);
    const entry = byId.get(k);
    const gated = (GATED as readonly string[]).includes(adv.severity);

    if (!entry && gated) {
      errors.push(
        `NEW ${adv.severity.toUpperCase()} ADVISORY ${k} against ${adv.module_name}: ${adv.title}\n` +
          `    path: ${adv.paths[0] ?? '(none reported)'}\n` +
          `    Fix it if a bounded, same-major bump reaches the patched version — never a '>=' ` +
          `floor, which can cross a major. If it cannot be reached without a major migration, ` +
          `add an entry to scripts/dep-guard/baseline.json with the reason and the owner.`,
      );
      continue;
    }
    if (!entry) continue; // an ungated moderate/low nobody has recorded: fine.

    if (entry.severity !== adv.severity) {
      errors.push(
        `advisory ${k} (${adv.module_name}) is now '${adv.severity}', but its baseline entry says ` +
          `'${entry.severity}'. A severity that moved is a judgement that needs re-making.`,
      );
    }
    if (entry.package !== adv.module_name) {
      errors.push(
        `advisory ${k} is against '${adv.module_name}', but its baseline entry names ` +
          `'${entry.package}'. Advisory ids are not stable across packages — re-check it.`,
      );
    }
  }

  // The #183 rule: a claim that no longer describes anything must go.
  for (const [k, entry] of byId) {
    if (seenIds.has(k)) continue;
    errors.push(
      `STALE baseline entry ${k} (${entry.package}): the advisory no longer appears in the ` +
        `production tree — it was fixed, or the package left. Remove the entry. Owner was: ` +
        `${entry.owner}.`,
    );
  }

  return { ok: errors.length === 0, errors, warnings, seen: advisories };
}

/**
 * `pnpm audit --prod --audit-level high --json`.
 *
 * The exit code is deliberately ignored: pnpm exits non-zero when it
 * finds ANY advisory, not only one at or above --audit-level, so a tree
 * carrying nothing but baselined moderates still exits 1. This guard
 * decides from the JSON, not from the code.
 */
export function readAudit(root: string): Advisory[] {
  let stdout: string;
  try {
    stdout = execFileSync(
      'pnpm',
      ['audit', '--prod', '--audit-level', 'high', '--json'],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch (err) {
    const e = err as { stdout?: string; message?: string };
    if (!e.stdout) {
      throw new Error(
        `pnpm audit produced no output (${e.message ?? 'unknown error'}). This guard needs the ` +
          `registry; it fails rather than reporting a clean tree it never actually saw.`,
      );
    }
    stdout = e.stdout;
  }
  return parseAudit(stdout);
}

export function parseAudit(stdout: string): Advisory[] {
  let parsed: { advisories?: Record<string, unknown> };
  try {
    parsed = JSON.parse(stdout) as { advisories?: Record<string, unknown> };
  } catch {
    throw new Error(`pnpm audit did not return JSON. First 200 chars: ${stdout.slice(0, 200)}`);
  }
  return Object.values(parsed.advisories ?? {}).map((raw) => {
    const a = raw as {
      id: number | string;
      module_name: string;
      severity: string;
      title: string;
      findings?: { paths?: string[] }[];
    };
    const paths = new Set<string>();
    for (const f of a.findings ?? []) for (const p of f.paths ?? []) paths.add(p);
    return {
      id: a.id,
      module_name: a.module_name,
      severity: a.severity,
      title: a.title,
      paths: [...paths],
    };
  });
}

export function loadBaseline(file: string): BaselineEntry[] {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${file}: expected a JSON array of baseline entries`);
  }
  return parsed as BaselineEntry[];
}

/* istanbul ignore next — CLI entry */
if (require.main === module) {
  const root = path.resolve(__dirname, '..', '..');
  const advisories = readAudit(root);
  const baseline = loadBaseline(path.join(__dirname, 'baseline.json'));
  const result = runCheck(advisories, baseline);

  for (const w of result.warnings) console.warn(`WARN: ${w}`);
  for (const e of result.errors) console.error(`FAIL: ${e}`);

  const counts: Record<string, number> = {};
  for (const a of result.seen) counts[a.severity] = (counts[a.severity] ?? 0) + 1;
  const summary =
    Object.keys(counts).length === 0
      ? 'none'
      : Object.entries(counts)
          .sort()
          .map(([s, n]) => `${n} ${s}`)
          .join(', ');

  if (!result.ok) {
    console.error(`\ndeps:check: ${result.errors.length} unattested or stale advisory finding(s).`);
    process.exit(1);
  }
  console.log(
    `deps:check: OK (production tree: ${summary}; ${baseline.length} baselined with a reason ` +
      `and an owner; 0 unattested at ${GATED.join('/')})`,
  );
}
