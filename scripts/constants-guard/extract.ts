// GROUNDSKEEPER G4 — the constants guard, extractor half.
//
// WHY THIS EXISTS. The sweep of 19 August found a shared constant,
// GPS_RECORD_INTERVAL_MS, that had been exported for months with zero
// consumers anywhere. It had a value (7000) that looked authoritative and
// meant nothing, because no code read it. It was not alone: thirteen more
// constants encode business rules the founder specified and nobody has
// wired yet — a late-driver threshold, cancellation penalties, an AML
// daily volume limit.
//
// Those thirteen are not the same thing as the fossil, and deleting them
// would erase specifications. But both share one property that made them
// invisible: nothing anywhere could tell you a declared rule was not being
// enforced. This guard makes that distinction explicit and permanent. A
// constant with no production consumer is either a fossil (delete it) or a
// pending rule (say so in the allowlist, with a reason). It can no longer
// be neither.
//
// WHAT COUNTS AS A CONSUMER. Production source under packages/*/src,
// excluding test files and the constants directory itself. A constant read
// only by its own tests is not wired: that is exactly the state
// GPS_RECORD_INTERVAL_MS would have been in had anyone written it a test.
// Re-exports through an index barrel are not consumption either — they are
// how a fossil stays reachable without ever being used.

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ExportedConstant {
  name: string;
  file: string;
  line: number;
}

export interface ConstantsMap {
  constants: ExportedConstant[];
  /** Constant name -> production files that reference it. */
  consumers: Map<string, string[]>;
}

export interface ExtractConfig {
  repoRoot: string;
  /** Directory whose exported constants are guarded. */
  constantsDir: string;
  /** Directories searched for consumers. */
  sourceDirs: string[];
}

export const DEFAULT_CONFIG = (repoRoot: string): ExtractConfig => ({
  repoRoot,
  constantsDir: path.join('packages', 'shared', 'src', 'constants'),
  sourceDirs: [
    path.join('packages', 'server', 'src'),
    path.join('packages', 'client', 'src'),
    path.join('packages', 'shared', 'src'),
  ],
});

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
    } else if (SOURCE_EXT.has(path.extname(e.name))) {
      out.push(full);
    }
  }
  return out;
}

// Deliberately a regex over source text rather than a TypeScript program.
// The wiring audit made the same choice for the same reason: the guard has
// to run in ten seconds on a plain-node CI job with no compiler, and a
// declaration it cannot parse is a false ALLOW (noisy, never wrong in the
// dangerous direction) rather than a false FAIL.
const EXPORT_CONST_RE = /^export\s+const\s+([A-Za-z_$][\w$]*)\s*[:=]/;

/** `export { X } from './y'` / `export * from './y'` — passing along, not using. */
const REEXPORT_RE = /^\s*export\s+(\*|\{)/;
/** `import { X } from '...'` — naming a thing is not reading it. */
const IMPORT_RE = /^\s*import\s/;

/**
 * Everything that mentions a constant without using it, removed before
 * matching: block and line comments (a doc-comment naming the threshold it
 * sits beside is documentation, not enforcement — MIN_RIDES_FOR_RATING_ACTION
 * is named in the comment above LOW_RATING_WARNING and read by nothing),
 * imports, and re-exports.
 */
function stripNonCode(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .filter((l) => !REEXPORT_RE.test(l) && !IMPORT_RE.test(l))
    .join('\n');
}

export function extractConstants(cfg: ExtractConfig): ExportedConstant[] {
  const dir = path.join(cfg.repoRoot, cfg.constantsDir);
  const found: ExportedConstant[] = [];
  for (const file of walk(dir)) {
    const rel = path.relative(cfg.repoRoot, file);
    if (isTestFile(rel)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = EXPORT_CONST_RE.exec(line);
      if (m) found.push({ name: m[1], file: rel, line: i + 1 });
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

export function buildConstantsMap(cfg: ExtractConfig): ConstantsMap {
  const constants = extractConstants(cfg);
  const declaredIn = new Map(constants.map((c) => [c.name, c.file]));

  const consumerFiles: string[] = [];
  for (const src of cfg.sourceDirs) {
    for (const file of walk(path.join(cfg.repoRoot, src))) {
      const rel = path.relative(cfg.repoRoot, file);
      if (isTestFile(rel)) continue;
      consumerFiles.push(rel);
    }
  }

  const consumers = new Map<string, string[]>();
  for (const c of constants) consumers.set(c.name, []);

  for (const rel of consumerFiles) {
    const text = fs.readFileSync(path.join(cfg.repoRoot, rel), 'utf8');
    // A constant is USED when code refers to it, not when a module merely
    // passes it along. Import and re-export lines are therefore stripped
    // before matching: that is exactly how a fossil stays reachable from
    // the package barrel without anything ever reading it, and counting
    // those lines would make the guard unable to see the one case it was
    // built for. Composition inside the constants directory still counts —
    // `ALL_LANDMARKS = [...BUSINESS_LANDMARKS]` is a real read.
    const body = stripNonCode(text);
    for (const c of constants) {
      // Word-boundary match: SOME_NAME must not be matched by
      // SOME_NAME_EXTENDED, or a longer sibling would mask a dead one.
      const re = new RegExp(`\\b${c.name}\\b`);
      // In the declaring file, the declaration line is not a use; anything
      // else in it is (MAP_REGIONS feeding a lookup table two lines down is
      // a real read). This is a deliberate false-ALLOW: a constant read
      // only by other dead code in its own file still passes, because
      // proving that needs reachability analysis and this guard is a
      // ten-second regex pass. Erring toward allow is the safe direction —
      // the guard's job is to make a silently-unenforced rule impossible,
      // not to be a linter.
      if (declaredIn.get(c.name) === rel) {
        const decl = new RegExp(`^export\\s+const\\s+${c.name}\\b`);
        const rest = body.split('\n').filter((l) => !decl.test(l)).join('\n');
        if (re.test(rest)) consumers.get(c.name)!.push(rel);
        continue;
      }
      if (re.test(body)) consumers.get(c.name)!.push(rel);
    }
  }

  return { constants, consumers };
}
