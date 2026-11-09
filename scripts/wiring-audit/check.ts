// WIRE-AUDIT G4 — the CI guard. Re-extracts the wiring map and fails
// when a NEW violation appears relative to the committed allowlist:
//   - a server endpoint with no statically-visible client caller and no
//     allowlist entry, or
//   - a routed screen no navigation path reaches and no allowlist entry.
// Pre-existing findings live in scripts/wiring-audit/allowlist.json so
// the guard is green on day one; only new dormancy fails. Every entry
// MUST carry a non-empty reason string — an entry without one fails the
// guard too (an allowlist that doesn't say why is just a mute button).
//
// Run: pnpm wiring:check

import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildWiringMap, DEFAULT_CONFIG, type WiringMap } from './extract';

export interface AllowlistEntry {
  /** 'endpoint <METHOD> <path>' or 'route <path>'. */
  key: string;
  reason: string;
}

export interface CheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function runCheck(map: WiringMap, allowlist: AllowlistEntry[]): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const seenKeys = new Set<string>();
  for (const entry of allowlist) {
    if (typeof entry.key !== 'string' || entry.key.trim() === '') {
      errors.push(`allowlist entry with missing/empty key: ${JSON.stringify(entry)}`);
      continue;
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      errors.push(`allowlist entry '${entry.key}' has no reason — every entry must say why it is allowed`);
    }
    if (seenKeys.has(entry.key)) warnings.push(`duplicate allowlist entry: '${entry.key}'`);
    seenKeys.add(entry.key);
  }

  const findings = new Set<string>();
  for (const e of map.analysis.endpointStatus) {
    if (e.status === 'called') continue;
    const key = `endpoint ${e.method} ${e.path}`;
    findings.add(key);
    if (!seenKeys.has(key)) {
      const detail =
        e.status === 'called-from-dead-code-only'
          ? 'its only callers are in files nothing imports'
          : 'no client caller found';
      errors.push(
        `NEW server orphan: ${key} (${e.file}:${e.line}) — ${detail}. ` +
          `Wire it, or add an allowlist entry with a reason to scripts/wiring-audit/allowlist.json.`,
      );
    }
  }
  for (const r of map.analysis.routeStatus) {
    if (r.reachable) continue;
    const key = `route ${r.path}`;
    findings.add(key);
    if (!seenKeys.has(key)) {
      errors.push(
        `NEW unreachable screen: ${key} (${r.screen}) — no navigation path reaches it. ` +
          `Add a navigation entry, or an allowlist entry with a reason to scripts/wiring-audit/allowlist.json.`,
      );
    }
  }

  // Stale entries are a warning, not a failure: the fix (removing the
  // entry) shouldn't block the PR that made the surface live again.
  for (const key of seenKeys) {
    if (!findings.has(key)) {
      warnings.push(`stale allowlist entry (no longer a finding — remove it): '${key}'`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function loadAllowlist(file: string): AllowlistEntry[] {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${file}: expected a JSON array of {key, reason} entries`);
  return parsed as AllowlistEntry[];
}

/* istanbul ignore next — CLI entry */
if (require.main === module) {
  const root = path.resolve(__dirname, '..', '..');
  const map = buildWiringMap({ root, ...DEFAULT_CONFIG });
  const allowlist = loadAllowlist(path.join(__dirname, 'allowlist.json'));
  const result = runCheck(map, allowlist);
  for (const w of result.warnings) console.warn(`WARN: ${w}`);
  for (const e of result.errors) console.error(`FAIL: ${e}`);
  if (!result.ok) {
    console.error(`\nwiring-check: ${result.errors.length} violation(s). See docs/wiring-report.md for context.`);
    process.exit(1);
  }
  console.log(`wiring-check: OK (${allowlist.length} allowlisted findings, ${result.warnings.length} warnings)`);
}
