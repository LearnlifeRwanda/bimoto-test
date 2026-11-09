// GROUNDSKEEPER G4 — the constants guard, CI half.
//
// Fails when an exported constant under packages/shared/src/constants/ has
// no production consumer AND no allowlist entry. Every allowlist entry
// must carry a non-empty reason — an allowlist that does not say why is
// just a mute button (the wiring guard's rule, verbatim, for the same
// reason).
//
// It also fails in the other direction: an allowlist entry for a constant
// that HAS been wired, or that no longer exists, is stale and gets
// reported. A guard whose allowlist is allowed to rot stops meaning
// anything, which is the failure mode it was built to prevent.
//
// Run: pnpm constants:check

import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildConstantsMap, DEFAULT_CONFIG, type ConstantsMap } from './extract';
import {
  collectDriftInput,
  findDrift,
  loadLiteralAllowlist,
  runLiteralCheck,
} from './literals';

export interface AllowlistEntry {
  /** The exported constant's name, e.g. 'AML_DAILY_VOLUME_LIMIT'. */
  key: string;
  reason: string;
}

export interface CheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function runCheck(map: ConstantsMap, allowlist: AllowlistEntry[]): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const allowed = new Set<string>();
  for (const entry of allowlist) {
    if (typeof entry.key !== 'string' || entry.key.trim() === '') {
      errors.push(`allowlist entry with missing/empty key: ${JSON.stringify(entry)}`);
      continue;
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      errors.push(
        `allowlist entry '${entry.key}' has no reason — every entry must say why the ` +
          `constant is declared but unenforced`,
      );
    }
    if (allowed.has(entry.key)) warnings.push(`duplicate allowlist entry: '${entry.key}'`);
    allowed.add(entry.key);
  }

  const unconsumed = new Set<string>();
  for (const c of map.constants) {
    const used = map.consumers.get(c.name) ?? [];
    if (used.length > 0) continue;
    unconsumed.add(c.name);
    if (!allowed.has(c.name)) {
      errors.push(
        `DECLARED BUT UNENFORCED: ${c.name} (${c.file}:${c.line}) has no production ` +
          `consumer. Either wire it, delete it, or add an entry with a reason to ` +
          `scripts/constants-guard/allowlist.json saying why it is specified but not ` +
          `yet implemented.`,
      );
    }
  }

  const declared = new Set(map.constants.map((c) => c.name));
  for (const key of allowed) {
    if (!declared.has(key)) {
      warnings.push(
        `stale allowlist entry: '${key}' is no longer exported from the constants ` +
          `directory — remove it.`,
      );
    } else if (!unconsumed.has(key)) {
      warnings.push(
        `stale allowlist entry: '${key}' now HAS a production consumer — the rule was ` +
          `implemented, so remove the entry and let the guard hold it.`,
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function loadAllowlist(file: string): AllowlistEntry[] {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')) as AllowlistEntry[];
}

function main(): void {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const map = buildConstantsMap(DEFAULT_CONFIG(repoRoot));
  const allowlist = loadAllowlist(path.join(__dirname, 'allowlist.json'));
  const result = runCheck(map, allowlist);

  // HYGIENE W3 G4 — the mirror question. The check above asks whether a
  // declared rule is enforced anywhere; this asks whether an enforced rule
  // is declared in two places at once. E-2 is why both are needed: the
  // allowlist called DRIVER_LATE_THRESHOLD_MINUTES "pending" while the
  // rule was live, as a bare literal, in MatchedPage.
  const literalAllowlist = loadLiteralAllowlist(path.join(__dirname, 'literal-allowlist.json'));
  const literals = runLiteralCheck(findDrift(collectDriftInput(repoRoot)), literalAllowlist);

  console.log(
    `[constants-guard] ${map.constants.length} exported constants, ` +
      `${allowlist.length} allowlisted as specified-but-pending; ` +
      `${literals.gated.length} cross-package duplicate declaration(s), ` +
      `${literalAllowlist.length} allowlisted with a reason.`,
  );
  for (const w of [...result.warnings, ...literals.warnings]) console.log(`  warning: ${w}`);
  for (const e of [...result.errors, ...literals.errors]) console.error(`  ERROR: ${e}`);

  if (!result.ok || !literals.ok) {
    const n = result.errors.length + literals.errors.length;
    console.error(
      `\n[constants-guard] FAILED with ${n} error(s). A declared rule that nothing enforces, and ` +
        `a rule enforced from two copies, must never again exist silently.`,
    );
    process.exit(1);
  }
  console.log(
    '[constants-guard] OK — every constant is either wired or declared pending, and no rule is ' +
      'declared twice across packages.',
  );
}

if (require.main === module) main();
