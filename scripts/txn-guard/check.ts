// MONEY-ATOMIC G5 — the rule the six defects broke.
//
//   A function that writes to two or more DISTINCT models through the
//   shared prisma client, outside any $transaction, must either be fixed
//   or carry an allowlist entry saying which class it is and why.
//
// The classes are the AUDIT-BATTERY §D census's own:
//
//   (a) atomicity genuinely needed, and absent. NOT allowlistable — this
//       is the defect. Fix it by composing the writes into one
//       $transaction, using the *Tx variants where the callee offers one.
//   (b) best-effort by design: the second write is a diagnostic, a log or
//       a notification whose failure must NOT roll the first one back.
//       The swallow is the point.
//   (c) idempotent or self-healing: a failure between the writes leaves
//       state a retry, a later tick or another job converges from.
//
// One escape hatch, deliberately loud: class `a-parked`. A class-(a)
// defect that is KNOWN, has an owner, and is not this dispatch's to fix
// is recorded with `parkedBy` naming the decision or wave that owns it,
// and is printed as a WARNING on every run. It exists so a known defect
// cannot be quietly relabelled (b) or (c) to get CI green; it is not a
// resting place. An entry without `parkedBy` fails.
//
// A stale entry FAILS, on the route-guard precedent (#183): this
// allowlist records human judgements about where a failure may land, and
// one that no longer describes any function is an unexamined claim
// sitting in the tree that the next reader would trust.
//
// Run: pnpm txn:check

import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildTxnMap, DEFAULT_CONFIG, functionKey, type FunctionRecord } from './extract';

export const CLASSES = ['b', 'c', 'a-parked'] as const;
export type AllowedClass = (typeof CLASSES)[number];

export interface AllowlistEntry {
  /** `<name> in <file>` — see functionKey(). */
  key: string;
  /** §D class letter. 'a' is not accepted: class (a) is the defect. */
  class: AllowedClass | string;
  /** For 'a-parked': the decision or wave that owns the fix. */
  parkedBy?: string;
  reason: string;
}

export interface CheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Every function the rule requires an entry for. */
  findings: string[];
}

/** The rule: two or more distinct models written outside a transaction. */
export function isFinding(f: FunctionRecord): boolean {
  return f.models.length >= 2;
}

export function runCheck(functions: FunctionRecord[], allowlist: AllowlistEntry[]): CheckResult {
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
    if (entry.class === 'a') {
      errors.push(
        `allowlist entry '${entry.key}' is class (a): atomicity is genuinely needed here, so it ` +
          `must be FIXED, not allowlisted. Compose the writes into one $transaction. If the fix ` +
          `belongs to another decision, use class 'a-parked' with parkedBy naming its owner.`,
      );
    } else if (!(CLASSES as readonly string[]).includes(entry.class)) {
      errors.push(
        `allowlist entry '${entry.key}' has class '${entry.class}' — expected one of ` +
          `${CLASSES.join(', ')}.`,
      );
    }
    if (entry.class === 'a-parked' && (!entry.parkedBy || entry.parkedBy.trim() === '')) {
      errors.push(
        `allowlist entry '${entry.key}' is class 'a-parked' but names no owner. Set parkedBy to ` +
          `the decision or wave that owns the fix.`,
      );
    }
    if (byKey.has(entry.key)) warnings.push(`duplicate allowlist entry: '${entry.key}'`);
    byKey.set(entry.key, entry);
  }

  const findings: string[] = [];
  const byFunction = new Map<string, FunctionRecord>();
  for (const f of functions) byFunction.set(functionKey(f), f);

  for (const f of functions) {
    if (!isFinding(f)) continue;
    const key = functionKey(f);
    findings.push(key);
    const entry = byKey.get(key);
    if (!entry) {
      errors.push(
        `UNBATCHED CROSS-MODEL WRITES: ${key}:${f.line} writes ${f.models.join(' + ')} ` +
          `(${f.writes.map((w) => `${w.model}.${w.method}@${w.line}`).join(', ')}) with no ` +
          `$transaction around them. If a failure between them leaves state no retry can reach, ` +
          `that is class (a) and it must be fixed — one $transaction, composing the *Tx variant ` +
          `where the callee has one. If it is best-effort (b) or idempotent/self-healing (c), add ` +
          `an entry with the class letter and the reason to scripts/txn-guard/allowlist.json.`,
      );
      continue;
    }
    if (entry.class === 'a-parked') {
      warnings.push(
        `PARKED class-(a) defect: ${key}:${f.line} writes ${f.models.join(' + ')} unbatched. ` +
          `Owned by: ${entry.parkedBy}. ${entry.reason}`,
      );
    }
  }

  const findingSet = new Set(findings);
  for (const key of byKey.keys()) {
    if (findingSet.has(key)) continue;
    const reason = byFunction.has(key)
      ? 'the function no longer writes two distinct models outside a transaction — it was batched, ' +
        'or the second write moved'
      : 'no such function — it was renamed or removed';
    errors.push(`STALE allowlist entry '${key}': ${reason}. Remove it.`);
  }

  return { ok: errors.length === 0, errors, warnings, findings };
}

export function loadAllowlist(file: string): AllowlistEntry[] {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${file}: expected a JSON array of {key, class, reason} entries`);
  }
  return parsed as AllowlistEntry[];
}

/* istanbul ignore next — CLI entry */
if (require.main === module) {
  const root = path.resolve(__dirname, '..', '..');
  const map = buildTxnMap({ root, ...DEFAULT_CONFIG });
  const allowlist = loadAllowlist(path.join(__dirname, 'allowlist.json'));
  const result = runCheck(map.functions, allowlist);
  for (const w of result.warnings) console.warn(`WARN: ${w}`);
  for (const e of result.errors) console.error(`FAIL: ${e}`);
  if (!result.ok) {
    console.error(`\ntxn-check: ${result.errors.length} unbatched cross-model write site(s).`);
    process.exit(1);
  }
  console.log(
    `txn-check: OK (${map.functions.length} functions writing through prisma in ` +
      `${map.files.length} files, ${result.findings.length} attested, ` +
      `${result.warnings.length} warnings)`,
  );
}
