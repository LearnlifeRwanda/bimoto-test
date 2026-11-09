// CUTGUARD v2 G1 — the serialization guard.
//
//   No Prisma row reaches a client unserialized.
//
// This is the class-closer for B-1/U-2/U-3/U-6. Those four were ONE
// defect wearing four faces: `getMe` used a NEGATIVE list (name the two
// ciphertext columns, ship the rest) and `verifyOtp` used no list at all.
// Everything that went wrong followed from that — the money-PIN hash
// shipping because nobody removed it, the emergency contacts missing
// because nobody added them.
//
// A fix that only rewrote those two functions would leave the class
// open: the next `res.json(row)` is one commit away, and nothing would
// object. So the fix is a rule.
//
// FOUR RULES, and each one exists because the others cannot see its case.
//
//   S1 — RESPONSE BODIES. In a `*.routes.ts` file, a value bound to a
//        Prisma model call must not reach `res.json` / `res.send`, by
//        any of the three routes a value travels: as the body itself, in
//        a `...spread`, or as a property value. This is the direct form
//        (`res.json(user)`).
//
//   S2 — SERVICE RETURNS, `user` MODEL ONLY. An EXPORTED function in a
//        services file must not return a `prisma.user.*` row. This is
//        the form B-1 actually took: `verifyOtp` returned the row, and
//        the route one file away did `res.json({ user, … })` — which S1
//        cannot condemn, because from the route's side `user` is just a
//        name from a service it cannot see into.
//
//   S3 — MONEY SHAPES (rule3.ts). A `commissionBreakdown` must be built
//        by a projector, never written out as an object literal.
//
//   S4 — THE VERSION GATE, from the SERVICE's side (rule4.ts). A
//        CUSTOMER-projected commission must be attached behind
//        `customerSavingsPreview`, or attested. S3 is what makes S4
//        possible: because every breakdown goes through a projector, the
//        projector's NAME says which audience the value is for, so S4
//        never has to guess at a shape.
//
//   S5 — THE VERSION GATE, from the ROUTE's side (rule5.ts). A route
//        calling a gated service function must pass the option. S4
//        cannot see this: from inside a correctly-gated service, a caller
//        who forgot looks exactly like a caller who meant `false`.
//
// WHY S2 IS SCOPED TO ONE MODEL. Every model has columns; only some have
// CREDENTIALS. `User` holds `moneyPinHash`, `moneyPinPendingHash`,
// `phoneHash` and the two encrypted columns — the reason this dispatch
// exists. Widening S2 to all models would flag hundreds of internal
// service returns that never touch a wire, and a guard nobody can keep
// green is a guard somebody deletes. Narrow and enforced beats broad and
// disabled. If another model grows a credential column, add it to
// S2_MODELS — that is a one-line change and a visible diff.
//
// WHAT MAKES A ROW SAFE. Three things, all of them positive acts:
//
//   1. a `select:` at the Prisma call — the columns are written down, so
//      a column added to the model tomorrow does not join the payload;
//   2. passing through a serializer named in allowlist.json;
//   3. an explicit site entry in allowlist.json, with a reason.
//
// `include:` is deliberately NOT safe. It widens a row; it never narrows
// one.
//
// THE ORACLE'S BOUNDARY is stated at length in extract.ts and repeated
// in docs/serialization-boundary.md. In one line: data flow is followed
// inside one function body, and across a module boundary only where S2
// looks. Sites outside that reach are pinned by response-shape tests,
// not by this file, and the report says which.
//
// Run: pnpm serialize:check

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  buildSerializationMap,
  DEFAULT_CONFIG,
  type FunctionRecord,
  type SerializationMap,
} from './extract';
import { describeRule3, findRule3, type Rule3Finding } from './rule3';
import { findRule4, runRule4, type Rule4AllowlistEntry, type Rule4Finding } from './rule4';
import {
  findGatedFunctions,
  findRule5,
  runRule5,
  type Rule5AllowlistEntry,
  type Rule5Finding,
} from './rule5';

/**
 * Models whose rows S2 refuses to let an exported service function
 * return. See the header for why this is a list and not "all".
 */
export const S2_MODELS = new Set(['user']);

export interface SiteAllowlistEntry {
  /** `<rule> <file>:<line-ish>` — see siteKey(). */
  key: string;
  reason: string;
}

export interface Allowlist {
  /**
   * Functions that launder a raw row into a client-safe shape. A value
   * assigned from one of these is safe to emit.
   */
  serializers: string[];
  /** Per-site exemptions, each with a stated reason. */
  sites: SiteAllowlistEntry[];
  /**
   * S4's exemptions live apart from S1/S2/S3's because S4 warns on any
   * key of its own that matched nothing, and a shared array would make
   * every S1 entry look stale to it.
   */
  gateSites: Rule4AllowlistEntry[];
  /** S5's exemptions, apart from S4's for the same stale-warning reason. */
  gateCallSites: Rule5AllowlistEntry[];
}

export interface Violation {
  rule: 'S1' | 'S2' | 'S3' | 'S4' | 'S5';
  key: string;
  message: string;
}

export interface CheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  violations: Violation[];
  /** Every site the rules examined and cleared, for the census output. */
  cleared: string[];
}

/** Stable identity for an allowlist entry: rule, file, function, model. */
export function siteKey(
  rule: 'S1' | 'S2',
  fn: FunctionRecord,
  binding: string,
  model: string,
): string {
  return `${rule} ${fn.file} ${fn.name} ${binding}:${model}`;
}

export function runCheck(map: SerializationMap, allowlist: Allowlist): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const violations: Violation[] = [];
  const cleared: string[] = [];

  const allowedSites = new Map<string, SiteAllowlistEntry>();
  for (const entry of allowlist.sites ?? []) {
    if (typeof entry.key !== 'string' || entry.key.trim() === '') {
      errors.push(`allowlist site with missing/empty key: ${JSON.stringify(entry)}`);
      continue;
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      errors.push(
        `allowlist site '${entry.key}' has no reason — every entry must say why it is allowed`,
      );
    }
    if (allowedSites.has(entry.key)) warnings.push(`duplicate allowlist site: '${entry.key}'`);
    allowedSites.set(entry.key, entry);
  }

  const usedSites = new Set<string>();

  for (const fn of map.functions) {
    if (fn.bindings.length === 0) continue;

    const byName = new Map<string, FunctionRecord['bindings'][number]>();
    for (const b of fn.bindings) byName.set(b.name, b);
    const serialized = new Set(fn.serialized);

    for (const emission of fn.emissions) {
      const rule: 'S1' | 'S2' =
        emission.kind === 'return' ? 'S2' : 'S1';

      // S1 only applies inside routes files; S2 only to exported
      // service functions, and only for the credential-bearing models.
      if (rule === 'S1' && !fn.isRoute) continue;
      if (rule === 'S2' && (!fn.exported || fn.isRoute)) continue;

      for (const name of emission.carries) {
        const binding = byName.get(name);
        if (!binding) continue;
        if (rule === 'S2' && !S2_MODELS.has(binding.model)) continue;

        const key = siteKey(rule, fn, name, binding.model);

        // A `select:` is an explicit positive projection — the whole
        // discipline this rule is asking for, already applied.
        if (binding.hasSelect) {
          cleared.push(`${key} — select: at ${fn.file}:${binding.line}`);
          continue;
        }
        // Laundered by a serializer.
        if (serialized.has(name)) {
          cleared.push(`${key} — serializer`);
          continue;
        }
        // Allowlisted, with a reason.
        const allowed = allowedSites.get(key);
        if (allowed) {
          usedSites.add(key);
          cleared.push(`${key} — allowlisted: ${allowed.reason}`);
          continue;
        }

        const carriedAs = emission.how[name] ?? 'direct';
        violations.push({
          rule,
          key,
          message:
            rule === 'S1'
              ? `${fn.file}:${emission.line} — ${emission.kind} carries '${name}' (${carriedAs}), a raw ` +
                `prisma.${binding.model}.${binding.method}() row bound at line ${binding.line}. ` +
                `Give the Prisma call a 'select:', pass it through a serializer from allowlist.json, ` +
                `or add '${key}' to allowlist.json with a reason.`
              : `${fn.file}:${emission.line} — exported '${fn.name}' returns '${name}' (${carriedAs}), a raw ` +
                `prisma.${binding.model}.${binding.method}() row bound at line ${binding.line}. ` +
                `A ${binding.model} row carries credentials; serialize it (toClientUser) or add ` +
                `'${key}' to allowlist.json with a reason.`,
        });
      }
    }
  }

  for (const key of allowedSites.keys()) {
    if (!usedSites.has(key)) {
      warnings.push(
        `stale allowlist site '${key}' — nothing matched it. Remove it, or fix the key.`,
      );
    }
  }

  return {
    ok: errors.length === 0 && violations.length === 0,
    errors,
    warnings,
    violations,
    cleared: cleared.sort(),
  };
}

/**
 * Rule S3 — see rule3.ts. Kept as its own pass because it is a
 * SYNTACTIC rule about where a shape is written, not a data-flow rule
 * about where a row goes; mixing them would blur two different oracles
 * and two different boundaries.
 */
export function runRule3(
  findings: Rule3Finding[],
  allowlist: Allowlist,
): { violations: Violation[]; cleared: string[]; usedSites: Set<string> } {
  const allowed = new Map<string, SiteAllowlistEntry>();
  for (const entry of allowlist.sites ?? []) allowed.set(entry.key, entry);

  const violations: Violation[] = [];
  const cleared: string[] = [];
  const usedSites = new Set<string>();

  for (const f of findings) {
    const entry = allowed.get(f.siteKey);
    if (entry) {
      usedSites.add(f.siteKey);
      cleared.push(`${f.siteKey} — allowlisted: ${entry.reason}`);
      continue;
    }
    violations.push({ rule: 'S3', key: f.siteKey, message: describeRule3(f) });
  }

  return { violations, cleared, usedSites };
}

export function loadAllowlist(file: string): Allowlist {
  if (!fs.existsSync(file)) {
    return { serializers: [], sites: [], gateSites: [], gateCallSites: [] };
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    serializers: Array.isArray(parsed.serializers) ? parsed.serializers : [],
    sites: Array.isArray(parsed.sites) ? parsed.sites : [],
    gateSites: Array.isArray(parsed.gateSites) ? parsed.gateSites : [],
    gateCallSites: Array.isArray(parsed.gateCallSites) ? parsed.gateCallSites : [],
  };
}

function main(): void {
  const root = path.resolve(__dirname, '..', '..');
  const allowlist = loadAllowlist(path.join(__dirname, 'allowlist.json'));
  const map = buildSerializationMap({
    root,
    dirs: DEFAULT_CONFIG.dirs,
    serializers: allowlist.serializers,
  });
  const result = runCheck(map, allowlist);

  // S3 reads the same file set the map was built from.
  const rule3Findings: Rule3Finding[] = [];
  for (const rel of map.files) {
    rule3Findings.push(...findRule3(rel, fs.readFileSync(path.join(root, rel), 'utf8')));
  }
  const s3 = runRule3(rule3Findings, allowlist);
  result.violations.push(...s3.violations);
  result.cleared.push(...s3.cleared);
  if (s3.violations.length > 0) result.ok = false;

  // S4 reads the same file set again. It is a second pass rather than a
  // branch of S3 because it asks a different question — S3 asks how the
  // shape was BUILT, S4 asks who is allowed to SEE it — and because a
  // site can be clean for one and dirty for the other.
  const rule4Findings: Rule4Finding[] = [];
  for (const rel of map.files) {
    rule4Findings.push(...findRule4(rel, fs.readFileSync(path.join(root, rel), 'utf8')));
  }
  const s4 = runRule4(rule4Findings, allowlist.gateSites);
  result.violations.push(...s4.violations.map((v) => ({ rule: 'S4' as const, ...v })));
  result.cleared.push(...s4.cleared);
  result.warnings.push(...s4.warnings);
  result.errors.push(...s4.errors);
  if (s4.violations.length > 0 || s4.errors.length > 0) result.ok = false;

  // S5 needs the gated SET first, derived from the services themselves so
  // a sixth gated function is covered the day it is written.
  const gated = new Set<string>();
  for (const rel of map.files) {
    if (!/[\\/]services[\\/]/.test(rel)) continue;
    for (const fn of findGatedFunctions(rel, fs.readFileSync(path.join(root, rel), 'utf8'))) {
      gated.add(fn);
    }
  }
  const rule5Findings: Rule5Finding[] = [];
  for (const rel of map.files) {
    if (!rel.endsWith('.routes.ts')) continue;
    rule5Findings.push(
      ...findRule5(rel, fs.readFileSync(path.join(root, rel), 'utf8'), gated),
    );
  }
  const s5 = runRule5(rule5Findings, allowlist.gateCallSites);
  result.violations.push(...s5.violations.map((v) => ({ rule: 'S5' as const, ...v })));
  result.cleared.push(...s5.cleared);
  result.warnings.push(...s5.warnings);
  result.errors.push(...s5.errors);
  if (s5.violations.length > 0 || s5.errors.length > 0) result.ok = false;

  const census = process.argv.includes('--census');
  if (census) {
    console.log(
      `[serialize] ${map.files.length} files, ${map.functions.length} functions, ` +
        `${rule4Findings.length} customer-commission attach(es), ` +
        `${gated.size} gated service fn(s) called from ${rule5Findings.length} route site(s)`,
    );
    for (const line of result.cleared) console.log(`  cleared: ${line}`);
  }

  for (const w of result.warnings) console.warn(`[serialize] warning: ${w}`);
  for (const e of result.errors) console.error(`[serialize] error: ${e}`);
  for (const v of result.violations) console.error(`[serialize] ${v.rule}: ${v.message}`);

  if (!result.ok) {
    console.error(
      `\n[serialize] FAILED — ${result.violations.length} raw-row emission(s), ${result.errors.length} allowlist error(s).`,
    );
    process.exit(1);
  }
  console.log(
    `[serialize] OK — ${map.functions.length} functions across ${map.files.length} files; ` +
      `${result.cleared.length} row emission(s) cleared, 0 raw.`,
  );
}

if (require.main === module) main();
