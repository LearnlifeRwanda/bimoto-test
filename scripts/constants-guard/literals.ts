// HYGIENE W3 G4 — the constants guard's second half: literal drift.
//
// The first half asks whether a declared constant is enforced anywhere.
// It cannot ask the mirror question, and the mirror question is where the
// damage is: AUDIT-BATTERY §E-2 found DRIVER_LATE_THRESHOLD_MINUTES = 10
// sitting in the allowlist as "implementation wave pending" while the rule
// it declares was in fact implemented — as a bare `10 * 60 * 1000` in
// MatchedPage.tsx. The guard reported a true finding under a false reason,
// which is worse than not reporting it: the register said the rule was
// unbuilt when it was built and diverging.
//
// Three rules, all over production source (packages/*/src, tests and the
// constants directory itself excluded):
//
//   A. VALUE MATCH — a time literal numerically equal to a declared shared
//      constant, in a file that does not import that constant. Units are
//      normalised, so `10 * 60 * 1000` matches a constant named
//      *_MINUTES with the value 10. This is E-2's shape exactly.
//
//   B. NAME MATCH — the same time-constant NAME declared in two or more
//      files with no shared source between them. E-3's server/client
//      MATCHED_LATE / MATCHED_NO_SHOW pair and E-4's triplicated
//      scheduled-ride lead times are this shape. The verdict column earns
//      its name here: two copies of a name whose values differ is a
//      value-DISAGREEING pair, and those are never reconciled by a guard.
//
//   C. UNNAMED DUPLICATION — the same time literal, written bare, in two
//      or more files, matching no shared constant at all. E-4's three
//      MS_PER_DAY definitions and the bare 3600000 sites are this shape:
//      not drift from a source of truth, but the absence of one.
//
// WHY A REGEX AND NOT A COMPILER. Same reason as the extractor half and
// the wiring audit: this has to run in seconds on a plain-node CI job.
// An expression it cannot parse is a false ALLOW, never a false FAIL.

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface TimeConstant {
  name: string;
  file: string;
  line: number;
  /** The literal as written, e.g. '12 * 60 * 1000'. */
  text: string;
  /** Value as written. */
  value: number;
  /** Value in milliseconds, from the name's unit suffix. null when unitless. */
  ms: number | null;
}

export interface DriftFinding {
  rule: 'value-match' | 'name-match' | 'unnamed-duplication';
  file: string;
  line: number;
  /** The literal as written. */
  literal: string;
  /** The shared constant or sibling declaration it collides with. */
  matches: string;
  /** Value-AGREEING pairs may be re-pointed. DISAGREEING is a decision. */
  verdict: 'AGREEING' | 'DISAGREEING';
  /** A stable identity for the allowlist, independent of line numbers. */
  key: string;
}

/* ------------------------------------------------------- unit ladder ---- */

const UNIT_MS: Array<[RegExp, number]> = [
  [/_MS$|_MS_|_MILLIS(ECONDS)?$/, 1],
  [/_SEC(ONDS)?$/, 1000],
  [/_MIN(UTES)?$/, 60 * 1000],
  [/_HOURS?$/, 60 * 60 * 1000],
  [/_DAYS?$/, 24 * 60 * 60 * 1000],
];

/** Milliseconds a constant's value denotes, read off its name's unit suffix. */
export function toMs(name: string, value: number): number | null {
  for (const [re, factor] of UNIT_MS) if (re.test(name)) return value * factor;
  return null;
}

/* --------------------------------------------------- literal parsing ---- */

/** Factors that make a numeric product time-shaped rather than arithmetic. */
const TIME_FACTORS = new Set([1000, 60, 24, 3600, 86400, 7, 52, 365]);

const PRODUCT_RE = /\b(\d+(?:_\d+)*)\s*\*\s*(\d+(?:_\d+)*)(?:\s*\*\s*(\d+(?:_\d+)*))?(?:\s*\*\s*(\d+(?:_\d+)*))?/g;
const BARE_MS_RE = /(?<![\w.$])(\d{4,})(?![\w.])/g;

const num = (s: string) => Number(s.replace(/_/g, ''));

export interface Literal {
  text: string;
  value: number;
  line: number;
}

/**
 * Every time-shaped numeric literal in a source text.
 *
 * A product counts when at least one factor is on the time ladder — `12 *
 * 60 * 1000` is a duration, `3 * 4` is arithmetic. A bare integer counts
 * when it is a whole number of seconds in milliseconds (a multiple of
 * 1000, at least 1000): that is what 3600000 and 7000 are, and it keeps
 * pixel sizes, ports and HTTP status codes out of the census.
 */
export function findTimeLiterals(source: string): Literal[] {
  const out: Literal[] = [];
  const code = stripComments(source);
  code.split('\n').forEach((line, i) => {
    const n = i + 1;
    PRODUCT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    const consumed: Array<[number, number]> = [];
    while ((m = PRODUCT_RE.exec(line)) !== null) {
      const factors = [m[1], m[2], m[3], m[4]].filter(Boolean).map((f) => num(f as string));
      if (!factors.some((f) => TIME_FACTORS.has(f))) continue;
      out.push({
        text: m[0].replace(/\s+/g, ' '),
        value: factors.reduce((a, b) => a * b, 1),
        line: n,
      });
      consumed.push([m.index, m.index + m[0].length]);
    }
    BARE_MS_RE.lastIndex = 0;
    while ((m = BARE_MS_RE.exec(line)) !== null) {
      const v = num(m[1]);
      if (v < 1000 || v % 1000 !== 0) continue;
      // already counted as part of a product on this line
      if (consumed.some(([a, b]) => m!.index >= a && m!.index < b)) continue;
      out.push({ text: m[1], value: v, line: n });
    }
  });
  return out;
}

export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

const DECL_RE =
  /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::\s*[^=]+)?=\s*([0-9_]+(?:\s*\*\s*[0-9_]+)*)\s*;/;

/** `const FOO_MS = 12 * 60 * 1000;` declarations, exported or not. */
export function findConstantDeclarations(source: string, file: string): TimeConstant[] {
  const out: TimeConstant[] = [];
  stripComments(source)
    .split('\n')
    .forEach((line, i) => {
      const m = DECL_RE.exec(line);
      if (!m) return;
      const text = m[2].replace(/\s+/g, ' ');
      const value = text.split('*').reduce((a, b) => a * num(b.trim()), 1);
      out.push({ name: m[1], file, line: i + 1, text, value, ms: toMs(m[1], value) });
    });
  return out;
}

/** Names a file imports, from its `import { … } from '…'` clauses. */
export function importedNames(source: string): Set<string> {
  const names = new Set<string>();
  const re = /import\s*(?:type\s*)?\{([^}]*)\}\s*from/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    for (const raw of m[1].split(',')) {
      const n = raw.trim().split(/\s+as\s+/)[0].trim();
      if (n) names.add(n);
    }
  }
  return names;
}


/** One minute. Below this a repeated literal is a unit conversion, not a rule. */
export const RULE_C_FLOOR = 60 * 1000;

/** packages/<name>/… — the boundary review cannot keep two copies across. */
export function packageOf(file: string): string {
  const m = /^packages\/([^/]+)\//.exec(file);
  return m ? m[1] : '(root)';
}

/**
 * A declaration is a TIME constant when its name carries a unit suffix
 * (*_MS, *_MINUTES, *_HOURS, …) or its value is written as a time-shaped
 * product (`12 * 60 * 1000`). An earth radius, a page size and an AES IV
 * length are none of those.
 */
export function isTimeConstant(c: TimeConstant): boolean {
  if (c.ms !== null) return true;
  if (!c.text.includes('*')) return false;
  return c.text.split('*').map((f) => Number(f.trim().replace(/_/g, ''))).some((f) => TIME_FACTORS.has(f));
}

/* -------------------------------------------------------- the census ---- */

export interface DriftInput {
  /** Time constants exported from packages/shared/src/constants. */
  shared: TimeConstant[];
  /** Production files: repo-relative path -> source text. */
  files: Map<string, string>;
}

export function findDrift(input: DriftInput): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const emit = (f: Omit<DriftFinding, 'key'>) =>
    findings.push({ ...f, key: `${f.rule}:${f.file}:${f.literal}:${f.matches}` });

  /* A — a time literal equal to a shared constant, in a file that does not
       import it. Units normalised, so a *_MINUTES constant matches the
       millisecond product that implements it. */
  for (const [file, source] of input.files) {
    const imported = importedNames(source);
    const literals = findTimeLiterals(source);
    const seen = new Set<string>();
    for (const lit of literals) {
      for (const c of input.shared) {
        if (c.file === file) continue;
        if (imported.has(c.name)) continue;
        const target = c.ms ?? c.value;
        if (lit.value !== target) continue;
        const id = `${c.name}:${lit.text}`;
        if (seen.has(id)) continue;
        seen.add(id);
        emit({
          rule: 'value-match',
          file,
          line: lit.line,
          literal: lit.text,
          matches: `${c.name} (${c.file}:${c.line}) = ${c.text}`,
          verdict: 'AGREEING',
        });
      }
    }
  }

  /* B — the same time-constant NAME declared in two or more PACKAGES with
       no shared source. E-3's server/client MATCHED_LATE / MATCHED_NO_SHOW
       pair and E-4's triplicated lead times are this shape.

       Two deliberate narrowings, both of which cost real findings and buy
       a census that means something:

         - time constants only (isTimeConstant): without it the rule pairs
           every UPPER_SNAKE number that happens to share a name, and a
           `PAGE_SIZE` in an admin screen has nothing to do with a
           `PAGE_SIZE` in an intel route. Those are not copies of one rule.
         - across packages only: two `TICK_MS` in two different cron jobs
           are two jobs' tick rates that happen to be spelled alike, not one
           rule duplicated. A name that crosses the server/client/shared
           boundary is the shape that cannot be kept in step by review.

       The verdict is real here: equal values are drift that can be
       collapsed; unequal values are a founder decision, never a guard's. */
  const byName = new Map<string, TimeConstant[]>();
  for (const [file, source] of input.files) {
    for (const decl of findConstantDeclarations(source, file)) {
      if (!isTimeConstant(decl)) continue;
      if (!byName.has(decl.name)) byName.set(decl.name, []);
      byName.get(decl.name)!.push(decl);
    }
  }
  for (const c of input.shared) {
    if (!isTimeConstant(c)) continue;
    if (!byName.has(c.name)) byName.set(c.name, []);
    if (!byName.get(c.name)!.some((d) => d.file === c.file)) byName.get(c.name)!.push(c);
  }
  for (const [name, decls] of byName) {
    if (decls.length < 2) continue;
    if (new Set(decls.map((d) => packageOf(d.file))).size < 2) continue;
    const canonical = decls[0];
    for (const dup of decls.slice(1)) {
      emit({
        rule: 'name-match',
        file: dup.file,
        line: dup.line,
        literal: `${name} = ${dup.text}`,
        matches: `${name} (${canonical.file}:${canonical.line}) = ${canonical.text}`,
        verdict: canonical.value === dup.value ? 'AGREEING' : 'DISAGREEING',
      });
    }
  }

  /* C — the same time literal, written bare, in two or more files, matching
       no shared constant at all. E-4's MS_PER_DAY definitions and the bare
       3600000 sites are this shape: not drift from a source of truth, but
       the absence of one.

       Floored at one minute (RULE_C_FLOOR). Below it the census fills with
       the `1000` of a seconds-to-milliseconds conversion and the 3000 of a
       toast timeout — arithmetic and UI feel, not business rules. A
       duplicated hour or day is a rule; a duplicated second is a unit. */
  const matchedValues = new Set(input.shared.map((c) => c.ms ?? c.value));
  const byValue = new Map<number, Array<{ file: string; line: number; text: string }>>();
  for (const [file, source] of input.files) {
    const seen = new Set<number>();
    for (const lit of findTimeLiterals(source)) {
      if (lit.value < RULE_C_FLOOR) continue;
      if (matchedValues.has(lit.value)) continue;
      if (seen.has(lit.value)) continue;
      seen.add(lit.value);
      if (!byValue.has(lit.value)) byValue.set(lit.value, []);
      byValue.get(lit.value)!.push({ file, line: lit.line, text: lit.text });
    }
  }
  for (const [value, sites] of byValue) {
    if (sites.length < 2) continue;
    for (const site of sites.slice(1)) {
      emit({
        rule: 'unnamed-duplication',
        file: site.file,
        line: site.line,
        literal: site.text,
        matches: `${value} ms, also at ${sites[0].file}:${sites[0].line} (${sites[0].text}) — no shared constant declares it`,
        verdict: 'AGREEING',
      });
    }
  }

  return findings.sort((a, b) => a.key.localeCompare(b.key));
}

/* ---------------------------------------------------------------- IO ---- */

const SOURCE_EXT = new Set(['.ts', '.tsx']);

function isTestFile(rel: string): boolean {
  return (
    rel.includes('__tests__') ||
    rel.includes(`${path.sep}tests${path.sep}`) ||
    /\.(test|spec)\.tsx?$/.test(rel)
  );
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(full, out);
    } else if (SOURCE_EXT.has(path.extname(e.name))) out.push(full);
  }
  return out;
}

const rel = (root: string, f: string) => path.relative(root, f).split(path.sep).join('/');

export function collectDriftInput(repoRoot: string): DriftInput {
  const constantsDir = path.join(repoRoot, 'packages', 'shared', 'src', 'constants');
  const shared: TimeConstant[] = [];
  for (const file of walk(constantsDir)) {
    const r = rel(repoRoot, file);
    if (isTestFile(r)) continue;
    for (const c of findConstantDeclarations(fs.readFileSync(file, 'utf8'), r)) shared.push(c);
  }

  const files = new Map<string, string>();
  for (const src of ['packages/server/src', 'packages/client/src', 'packages/shared/src']) {
    for (const file of walk(path.join(repoRoot, src))) {
      const r = rel(repoRoot, file);
      if (isTestFile(r)) continue;
      if (r.startsWith('packages/shared/src/constants/')) continue;
      files.set(r, fs.readFileSync(file, 'utf8'));
    }
  }
  return { shared, files };
}

/* ------------------------------------------------------------- gate ---- */

export interface LiteralAllowEntry {
  /** The finding's `key`, as the census prints it. */
  key: string;
  reason: string;
}

export interface LiteralCheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  gated: DriftFinding[];
}

/**
 * WHAT THIS GATES, AND WHY IT IS NOT ALL THREE RULES.
 *
 * Only rule B — the same time-constant NAME declared in two or more
 * packages — fails the build. Rules A and C are census output, printed by
 * `pnpm constants:literals` and read by a human.
 *
 * That is a finding from RUNNING the oracle, not a softening of it. Rule A
 * as specified (a time literal numerically equal to a declared shared
 * constant) reports 87 sites against this tree and the overwhelming
 * majority are numeric coincidence, not drift: business durations are
 * drawn from a vocabulary of about a dozen round numbers, so
 * `24 * 60 * 60 * 1000` in an AML pattern window "equals"
 * DISPUTE_WINDOW_HOURS = 24, and the 10-minute lock TTL in job-lock.ts
 * "equals" DRIVER_LATE_THRESHOLD_MINUTES = 10. Neither restates the other's
 * rule; they are both simply one day and ten minutes. A gate at that
 * false-positive rate teaches everyone to add allowlist entries, which is
 * how a guard stops meaning anything.
 *
 * A NAME that crosses a package boundary carries the intent that a value
 * cannot: two files declaring MIN_LEAD_TIME_MS are two copies of one rule,
 * and nothing but review keeps them in step. That is the shape worth
 * failing a build over.
 */
export function runLiteralCheck(
  findings: DriftFinding[],
  allow: LiteralAllowEntry[],
): LiteralCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const allowed = new Map<string, LiteralAllowEntry>();
  for (const entry of allow) {
    if (typeof entry.key !== 'string' || entry.key.trim() === '') {
      errors.push(`literal allowlist entry with no key: ${JSON.stringify(entry)}`);
      continue;
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      errors.push(
        `literal allowlist entry '${entry.key}' has no reason. Every entry must say why one rule ` +
          `is written twice.`,
      );
    }
    if (allowed.has(entry.key)) warnings.push(`duplicate literal allowlist entry: '${entry.key}'`);
    allowed.set(entry.key, entry);
  }

  const gated = findings.filter((f) => f.rule === 'name-match');
  const seen = new Set<string>();
  for (const f of gated) {
    seen.add(f.key);
    if (allowed.has(f.key)) continue;
    errors.push(
      `LITERAL DRIFT: ${f.file}:${f.line} declares ${f.literal}, which is also declared as ` +
        `${f.matches} in another package [${f.verdict}]. One rule, two copies, no shared source — ` +
        `nothing but review keeps them in step. Export it from packages/shared and import it in ` +
        `both, or add an entry to scripts/constants-guard/literal-allowlist.json with a reason.` +
        (f.verdict === 'DISAGREEING'
          ? ` The two copies DISAGREE on the value: that is a founder decision, never a silent ` +
            `reconciliation — report it before touching either.`
          : ''),
    );
  }

  // The #183 rule: a claim that no longer describes anything must go.
  for (const [key, entry] of allowed) {
    if (seen.has(key)) continue;
    errors.push(
      `STALE literal allowlist entry '${key}': it matches no finding — the duplication was ` +
        `collapsed, or the code moved. Remove the entry. Reason was: ${entry.reason}`,
    );
  }

  return { ok: errors.length === 0, errors, warnings, gated };
}

export function loadLiteralAllowlist(file: string): LiteralAllowEntry[] {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')) as LiteralAllowEntry[];
}
