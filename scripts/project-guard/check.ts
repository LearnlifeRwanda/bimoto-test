// HYGIENE W3 G3 — the guard #182 needed and did not get.
//
// #182 closed the orphan-typecheck-root class for packages/server/scripts
// and prisma: two roots holding .ts that no tsconfig project resolved, so
// no compiler was looking at them. That is how a `prisma.user.createMany`
// still naming the pre-rename field reached CI with a green typecheck
// above it. The class recurred one directory over — AUDIT-BATTERY §A-1
// found real orphans in packages/client (the two root-level tests, the
// Capacitor config, the Vite config) and packages/shared (three
// __tests__ files its build project excludes).
//
// Nothing structural stopped either recurrence, because "is this file in
// a project?" was a question only a human census ever asked. This guard
// asks it on every run.
//
// The rule:
//
//   Every .ts / .tsx file in the repo either resolves into at least one
//   of the tsconfig projects the root `typecheck` script compiles, or
//   carries an allowlist entry with a REASON. A new orphan FAILS. An
//   allowlist entry that no longer matches any orphan also FAILS, as
//   stale — the route-guard precedent (#183): an entry that no longer
//   describes anything real is an unexamined claim the next reader would
//   trust.
//
// Two design choices worth stating, because they are what makes the
// answer true rather than merely computed:
//
//   1. The project list is PARSED OUT OF the root `typecheck` script, not
//      restated here. A guard with its own copy of the list would go
//      green while CI compiled a different set — the exact drift it
//      exists to catch. If typecheck stops compiling a project, this
//      guard's coverage shrinks with it and the orphans surface.
//   2. Coverage is `tsc --listFiles`, not `--showConfig`. `--showConfig`
//      reports the files an `include` pattern matched; `--listFiles`
//      reports every file the compiler actually loaded, transitive
//      imports included. A file pulled in by an import IS typechecked,
//      and calling it an orphan would be a false finding.
//
// Run: pnpm projects:check

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Project {
  /** Directory the compiler runs in, relative to the repo root. */
  cwd: string;
  /** `-p` argument, or null for the directory's default tsconfig.json. */
  project: string | null;
  /** How the segment read in the typecheck script, for error messages. */
  label: string;
}

export interface AllowEntry {
  /**
   * Repo-relative file or directory prefix. A directory entry covers
   * every orphan beneath it — the fixture trees are dozens of files
   * held out for one reason, and one entry says that once.
   */
  path: string;
  /** Why no compiler may look at this. Never "generated" or "legacy". */
  reason: string;
}

export interface CheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Every .ts/.tsx file no project resolved. */
  orphans: string[];
  /** Orphans an entry accounted for. */
  allowed: string[];
  /** Files at least one project loaded. */
  coveredCount: number;
}

const WORKSPACE_FILTER = /^pnpm --filter (\S+) exec tsc --noEmit(?: -p (\S+))?$/;
const ROOT_PROJECT = /^pnpm exec tsc --noEmit -p (\S+)$/;

/**
 * The tsconfig projects the root `typecheck` script compiles.
 *
 * `pnpm --filter @bimoto/client exec tsc --noEmit -p tsconfig.root.json`
 * becomes { cwd: 'packages/client', project: 'tsconfig.root.json' };
 * `pnpm exec tsc --noEmit -p scripts/dep-guard` becomes
 * { cwd: '.', project: 'scripts/dep-guard' }.
 *
 * A segment this cannot read is an ERROR, never a silent skip: an
 * unparsed segment is a project whose files would all look orphaned.
 */
export function parseTypecheckScript(
  script: string,
  filterToDir: (filter: string) => string | null,
): { projects: Project[]; errors: string[] } {
  const projects: Project[] = [];
  const errors: string[] = [];
  for (const raw of script.split('&&')) {
    const seg = raw.trim();
    if (seg === '') continue;
    const w = WORKSPACE_FILTER.exec(seg);
    if (w) {
      const dir = filterToDir(w[1]);
      if (dir === null) {
        errors.push(`typecheck script names workspace '${w[1]}', which is not a package in the tree`);
        continue;
      }
      projects.push({ cwd: dir, project: w[2] ?? null, label: seg });
      continue;
    }
    const r = ROOT_PROJECT.exec(seg);
    if (r) {
      projects.push({ cwd: '.', project: r[1], label: seg });
      continue;
    }
    errors.push(
      `cannot read this segment of the root 'typecheck' script: "${seg}". This guard derives its ` +
        `project list from that script so the two can never drift; a segment it cannot parse is a ` +
        `project whose files would every one look orphaned. Teach the parser, or keep the ` +
        `established segment shape.`,
    );
  }
  return { projects, errors };
}

const normalise = (p: string) => p.split(path.sep).join('/');

/** True when `file` is `entry` or sits beneath it. */
export function covers(entryPath: string, file: string): boolean {
  const e = normalise(entryPath).replace(/\/+$/, '');
  return file === e || file.startsWith(`${e}/`);
}

export function runCheck(
  allFiles: string[],
  coveredFiles: string[],
  allow: AllowEntry[],
  parseErrors: string[] = [],
): CheckResult {
  const errors: string[] = [...parseErrors];
  const warnings: string[] = [];

  const seenPaths = new Set<string>();
  for (const entry of allow) {
    if (typeof entry.path !== 'string' || entry.path.trim() === '') {
      errors.push(`allowlist entry with no path: ${JSON.stringify(entry)}`);
      continue;
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      errors.push(
        `allowlist entry '${entry.path}' has no reason. Every entry must say WHY no compiler may ` +
          `look at this file. An entry that cannot answer that is an orphan nobody has examined.`,
      );
    }
    if (seenPaths.has(entry.path)) warnings.push(`duplicate allowlist entry for ${entry.path}`);
    seenPaths.add(entry.path);
  }

  const covered = new Set(coveredFiles.map(normalise));
  const orphans = allFiles.map(normalise).filter((f) => !covered.has(f)).sort();

  const allowed: string[] = [];
  const matchedBy = new Map<string, number>();
  for (const orphan of orphans) {
    const entry = allow.find((a) => typeof a.path === 'string' && covers(a.path, orphan));
    if (!entry) {
      errors.push(
        `ORPHAN: ${orphan} resolves into no tsconfig project — no compiler is looking at it. ` +
          `Bring it under a project (extend an 'include', or add a small project and a line to ` +
          `the root 'typecheck' script), or add an entry to ` +
          `scripts/project-guard/allowlist.json with a reason.`,
      );
      continue;
    }
    allowed.push(orphan);
    matchedBy.set(entry.path, (matchedBy.get(entry.path) ?? 0) + 1);
  }

  // The #183 rule: a claim that no longer describes anything must go.
  for (const entry of allow) {
    if (typeof entry.path !== 'string' || entry.path.trim() === '') continue;
    if (matchedBy.has(entry.path)) continue;
    errors.push(
      `STALE allowlist entry '${entry.path}': it matches no orphan. Either the file came under a ` +
        `project (delete the entry — that is the good outcome) or it no longer exists. Reason was: ` +
        `${entry.reason}`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    orphans,
    allowed,
    coveredCount: covered.size,
  };
}

/* ---------------------------------------------------------------- IO ---- */

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'android', 'ios']);

/**
 * The extensions this guard asks its question about.
 *
 * VALIDATE-MEND G5 / FT B6 — `.mjs` was a blind surface. The guard's
 * question is "is any compiler looking at this file", and a .mjs tool
 * answers no just as loudly as an orphaned .ts did — it is simply
 * written in a language where nothing was ever going to look. Sixteen
 * of them had accumulated with no census and no owner, which is the
 * same shape as the orphan-root class this guard was built for.
 *
 * Extending the glob does not make them compile. It makes each one
 * carry a REASON, and — by the #183 stale rule — makes a reason that no
 * longer describes anything fail. From here, a NEW .mjs must justify
 * itself in the allowlist or come in as TypeScript.
 */
const WATCHED_EXTENSIONS = /\.(tsx?|mjs)$/;

/** Every watched source file in the tree, repo-relative, excluding .d.ts and build output. */
export function listRepoFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (WATCHED_EXTENSIONS.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        out.push(normalise(path.relative(root, full)));
      }
    }
  };
  walk(root);
  return out.sort();
}

export function resolveWorkspaceDir(root: string, filter: string): string | null {
  for (const dir of fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const pkg = path.join(root, 'packages', dir.name, 'package.json');
    if (!fs.existsSync(pkg)) continue;
    const name = (JSON.parse(fs.readFileSync(pkg, 'utf8')) as { name?: string }).name;
    if (name === filter) return `packages/${dir.name}`;
  }
  return null;
}

/**
 * Files a project's compiler actually loaded. `--listFiles` emits them
 * even on a failing compile, which matters: this guard answers "is
 * anything looking at this file", not "does it compile".
 */
export function listProjectFiles(root: string, project: Project): string[] {
  const args = ['exec', 'tsc', '--noEmit', '--listFiles'];
  if (project.project) args.push('-p', project.project);
  let stdout: string;
  try {
    stdout = execFileSync('pnpm', args, {
      cwd: path.join(root, project.cwd),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    const e = err as { stdout?: string; message?: string };
    if (!e.stdout) {
      throw new Error(
        `tsc produced no file list for "${project.label}" (${e.message ?? 'unknown error'}). This ` +
          `guard fails rather than reporting coverage it never actually saw.`,
      );
    }
    stdout = e.stdout;
  }
  const out: string[] = [];
  for (const line of stdout.split('\n')) {
    const abs = line.trim();
    if (abs === '' || abs.includes('/node_modules/')) continue;
    const rel = normalise(path.relative(root, abs));
    if (rel.startsWith('..')) continue;
    // Same extension set as listRepoFiles: a project that genuinely
    // loads a .mjs (allowJs) must count it as covered, or the guard
    // would report a file its own compiler is reading as an orphan.
    if (!WATCHED_EXTENSIONS.test(rel) || rel.endsWith('.d.ts')) continue;
    out.push(rel);
  }
  return out;
}

export function loadAllowlist(file: string): AllowEntry[] {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${file}: expected a JSON array of allowlist entries`);
  return parsed as AllowEntry[];
}

/* istanbul ignore next — CLI entry */
if (require.main === module) {
  const root = path.resolve(__dirname, '..', '..');
  const script = (
    JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    }
  ).scripts?.typecheck;
  if (!script) {
    console.error('FAIL: the root package.json has no "typecheck" script to derive projects from.');
    process.exit(1);
  }
  const { projects, errors: parseErrors } = parseTypecheckScript(script, (f) =>
    resolveWorkspaceDir(root, f),
  );
  const covered: string[] = [];
  for (const project of projects) covered.push(...listProjectFiles(root, project));
  const result = runCheck(listRepoFiles(root), covered, loadAllowlist(path.join(__dirname, 'allowlist.json')), parseErrors);

  for (const w of result.warnings) console.warn(`WARN: ${w}`);
  for (const e of result.errors) console.error(`FAIL: ${e}`);

  if (!result.ok) {
    console.error(`\nprojects:check: ${result.errors.length} finding(s).`);
    process.exit(1);
  }
  const allowlistSize = loadAllowlist(path.join(__dirname, 'allowlist.json')).length;
  console.log(
    `projects:check: OK\n` +
      `  ${projects.length} tsconfig project(s), derived from the root typecheck script\n` +
      `  ${result.coveredCount} file(s) under at least one compiler\n` +
      `  ${result.orphans.length} orphan(s), every one accounted for by ${allowlistSize} ` +
      `allowlisted path(s) with a reason`,
  );
}
