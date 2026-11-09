// SUPPLY-CHAIN G2 — CI must test the Node that production runs.
//
// AUDIT-BATTERY §K-4: `engines.node` was `>=22.9.0` — a floor with no
// ceiling — `packageManager` was unset, all five workflows pinned
// `node-version: 24`, and packages/server/Dockerfile ships
// `node:22-bookworm-slim` in BOTH stages, which render.yaml inherits
// (`runtime: docker`). Every green CI run was therefore evidence about
// Node 24 while production ran Node 22: the thing verified was not the
// thing shipped — structurally the same defect GROUNDSKEEPER G4 fixed
// for `dist/`.
//
// The trap this guard exists to keep shut: `setup-node`'s
// `node-version-file: package.json` resolves `engines.node` as a RANGE,
// so an open `>=22.9.0` resolves to the newest available — Node 24
// again — silently re-creating the defect while looking fixed. The pin
// must therefore be a `.nvmrc` holding ONE exact version, and nothing
// may quietly point at a range instead.
//
// Five assertions, each of which failed at 0cd6efd:
//
//   1. `.nvmrc` holds an exact X.Y.Z — never a range, a major, or `lts/*`.
//   2. Every `FROM node:<tag>` in the Dockerfile has `.nvmrc`'s major.
//      BOTH stages: a builder on one major and a runtime on another is
//      the same defect one layer down.
//   3. Every declared `engines.node` range contains `.nvmrc` AND excludes
//      the next major. A floor with no ceiling is what got us here.
//   4. Every workflow that sets up Node uses `node-version-file: .nvmrc`,
//      and none hardcodes `node-version:` — one pin, in one place.
//   5. `packageManager` is present and matches every `pnpm/action-setup`
//      `version:` in the workflows. (`action-setup` itself only errors
//      when the two DISAGREE, so a drifting pair is silent there.)
//
// Run: pnpm pins:check

import * as fs from 'node:fs';
import * as path from 'node:path';

export const NVMRC = '.nvmrc';

/** Everything the rule reads. Passed in, so tests can plant drift. */
export interface PinInputs {
  /** Raw `.nvmrc` contents. */
  nvmrc: string;
  /** Raw packages/server/Dockerfile contents. */
  dockerfile: string;
  /** Parsed manifests that declare `engines.node`, by repo-relative path. */
  manifests: { file: string; enginesNode?: string; packageManager?: string }[];
  /** Raw workflow files, by repo-relative path. */
  workflows: { file: string; text: string }[];
}

export interface CheckResult {
  ok: boolean;
  errors: string[];
  /** One line per assertion that held, for the CLI's summary. */
  checked: string[];
}

export interface Version {
  major: number;
  minor: number;
  patch: number;
}

/** Parse an EXACT X.Y.Z. Returns null for a range, a partial or junk. */
export function parseExact(raw: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function formatVersion(v: Version): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

function compare(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * A deliberately small range evaluator. It understands exactly the
 * conjunctive comparator form this repo is allowed to use —
 * `>=A.B.C <D`, `>A <=D.E.F`, and so on — and REFUSES anything else
 * (`^`, `~`, `||`, `*`, `x`). That refusal is the feature: a range this
 * guard cannot reason about is a range it cannot prove bounded, and an
 * unbounded `engines.node` is the defect §K-4 recorded. Widening this
 * parser without widening the proof would re-open it.
 */
export function satisfies(range: string, v: Version): boolean | null {
  const parts = range.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  for (const part of parts) {
    const m = /^(>=|<=|>|<|=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(part);
    if (!m) return null; // ^ ~ || * x — not provable here, see above.
    const op = m[1] ?? '=';
    // A partial bound is padded with zeroes: `<23` means `<23.0.0`.
    const bound: Version = {
      major: Number(m[2]),
      minor: Number(m[3] ?? 0),
      patch: Number(m[4] ?? 0),
    };
    const c = compare(v, bound);
    const held =
      op === '>=' ? c >= 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '<' ? c < 0 : c === 0;
    if (!held) return false;
  }
  return true;
}

/** Every `FROM node:<tag>` in a Dockerfile, with its 1-based line. */
export function dockerNodeTags(dockerfile: string): { line: number; tag: string }[] {
  const out: { line: number; tag: string }[] = [];
  dockerfile.split('\n').forEach((text, i) => {
    const m = /^\s*FROM\s+node:(\S+)/i.exec(text);
    if (m) out.push({ line: i + 1, tag: m[1] });
  });
  return out;
}

/** The leading major of a Docker tag like `22-bookworm-slim` or `22.23.2`. */
export function tagMajor(tag: string): number | null {
  const m = /^(\d+)(?:[.-]|$)/.exec(tag);
  return m ? Number(m[1]) : null;
}

export function runCheck(inputs: PinInputs): CheckResult {
  const errors: string[] = [];
  const checked: string[] = [];

  // ---- 1. .nvmrc holds an exact version ----------------------------
  const pinned = parseExact(inputs.nvmrc);
  if (!pinned) {
    errors.push(
      `${NVMRC} must hold ONE exact Node version (X.Y.Z), not ` +
        `'${inputs.nvmrc.trim()}'. A major, a range or 'lts/*' resolves to "newest ` +
        `available", which is exactly how CI drifted onto Node 24 while production ran 22.`,
    );
    // Every remaining assertion is relative to the pin; without it there
    // is nothing to compare against.
    return { ok: false, errors, checked };
  }
  const pin = formatVersion(pinned);
  const nextMajor: Version = { major: pinned.major + 1, minor: 0, patch: 0 };
  checked.push(`${NVMRC} pins Node ${pin} exactly`);

  // ---- 2. Dockerfile majors, in BOTH stages ------------------------
  const tags = dockerNodeTags(inputs.dockerfile);
  if (tags.length === 0) {
    errors.push(
      `packages/server/Dockerfile declares no 'FROM node:...' stage — this guard can no ` +
        `longer prove CI runs production's Node. If the base image moved, teach the guard.`,
    );
  }
  if (tags.length < 2) {
    errors.push(
      `packages/server/Dockerfile has ${tags.length} 'FROM node:...' stage(s); the build and ` +
        `runtime stages are both expected. A stage that stopped declaring its Node is a stage ` +
        `this guard silently stopped watching.`,
    );
  }
  for (const { line, tag } of tags) {
    const major = tagMajor(tag);
    if (major === null) {
      errors.push(
        `packages/server/Dockerfile:${line}: cannot read a major from 'FROM node:${tag}'. ` +
          `Use a numeric tag so the pin stays provable.`,
      );
    } else if (major !== pinned.major) {
      errors.push(
        `NODE PIN DRIFT: packages/server/Dockerfile:${line} ships 'node:${tag}' (major ${major}) ` +
          `but ${NVMRC} pins ${pin} (major ${pinned.major}). CI would again be testing a Node ` +
          `production does not run. Move ${NVMRC} to production's major — never the reverse: ` +
          `render.yaml is 'runtime: docker' and inherits this image.`,
      );
    }
  }
  if (tags.length > 0) {
    checked.push(`Dockerfile ships node:${tags.map((t) => t.tag).join(', node:')} — major ${pinned.major}`);
  }

  // ---- 3. engines.node contains the pin and excludes the next major -
  let sawEngines = false;
  for (const m of inputs.manifests) {
    if (m.enginesNode === undefined) continue;
    sawEngines = true;
    const holds = satisfies(m.enginesNode, pinned);
    const leaks = satisfies(m.enginesNode, nextMajor);
    if (holds === null || leaks === null) {
      errors.push(
        `${m.file}: engines.node '${m.enginesNode}' is not a plain comparator range, so this ` +
          `guard cannot prove it is bounded. Use the '>=X.Y.Z <MAJOR' form.`,
      );
      continue;
    }
    if (!holds) {
      errors.push(
        `${m.file}: engines.node '${m.enginesNode}' excludes the pinned Node ${pin}. ` +
          `The manifest and ${NVMRC} disagree about what this repo runs on.`,
      );
    }
    if (leaks) {
      errors.push(
        `UNBOUNDED ENGINES: ${m.file}: engines.node '${m.enginesNode}' also admits ` +
          `${formatVersion(nextMajor)}. A floor with no ceiling is what let CI run Node 24 ` +
          `against a Node 22 image; bound it to '<${nextMajor.major}'.`,
      );
    }
  }
  if (!sawEngines) {
    errors.push(`no manifest declares engines.node — the bound this guard checks has vanished.`);
  } else {
    checked.push(
      `${inputs.manifests.filter((m) => m.enginesNode !== undefined).length} manifest(s) bound ` +
        `engines.node to [${pin}, ${nextMajor.major})`,
    );
  }

  // ---- 4. workflows read the pin from the file, never inline --------
  let setupNodeCount = 0;
  for (const wf of inputs.workflows) {
    const lines = wf.text.split('\n');
    let usesSetupNode = false;
    lines.forEach((text, i) => {
      if (/^\s*-?\s*uses:\s*actions\/setup-node@/.test(text)) {
        usesSetupNode = true;
        setupNodeCount += 1;
      }
      const inline = /^\s*node-version:\s*(\S+)/.exec(text);
      if (inline) {
        errors.push(
          `INLINE NODE PIN: ${wf.file}:${i + 1} hardcodes 'node-version: ${inline[1]}'. ` +
            `The pin lives in ${NVMRC} and nowhere else — use ` +
            `'node-version-file: ${NVMRC}'. Do NOT point it at package.json: setup-node ` +
            `resolves engines.node as a RANGE and would pick the newest Node again.`,
        );
      }
      const fromFile = /^\s*node-version-file:\s*(\S+)/.exec(text);
      if (fromFile && fromFile[1].replace(/['"]/g, '') !== NVMRC) {
        errors.push(
          `${wf.file}:${i + 1}: 'node-version-file: ${fromFile[1]}' — expected ${NVMRC}. ` +
            `package.json in particular resolves as a range, not a pin.`,
        );
      }
    });
    if (usesSetupNode && !/^\s*node-version-file:/m.test(wf.text)) {
      errors.push(
        `${wf.file} sets up Node but never reads ${NVMRC}. Add ` +
          `'node-version-file: ${NVMRC}' so this job runs production's Node.`,
      );
    }
  }
  if (setupNodeCount === 0) {
    errors.push(`no workflow uses actions/setup-node — this guard is watching nothing.`);
  } else {
    checked.push(`${setupNodeCount} setup-node step(s) across ${inputs.workflows.length} workflow(s) read ${NVMRC}`);
  }

  // ---- 5. packageManager matches the workflows' pnpm pin ------------
  const declared = inputs.manifests
    .map((m) => ({ file: m.file, pm: m.packageManager }))
    .filter((m): m is { file: string; pm: string } => typeof m.pm === 'string' && m.pm !== '');
  if (declared.length === 0) {
    errors.push(
      `no manifest declares 'packageManager'. Without it the pnpm version is whatever the ` +
        `machine happens to have, and the lockfile format is a coincidence. Set it to the ` +
        `version the workflows pin.`,
    );
  }
  const pmVersions = new Set<string>();
  for (const d of declared) {
    const m = /^pnpm@(\d+\.\d+\.\d+)$/.exec(d.pm);
    if (!m) {
      errors.push(
        `${d.file}: packageManager '${d.pm}' is not an exact 'pnpm@X.Y.Z'. ` +
          `A range here is the same defect as a range in ${NVMRC}.`,
      );
      continue;
    }
    pmVersions.add(m[1]);
  }
  if (pmVersions.size > 1) {
    errors.push(`manifests disagree about packageManager: ${[...pmVersions].join(' vs ')}.`);
  }
  const pmPin = [...pmVersions][0];
  let actionPins = 0;
  for (const wf of inputs.workflows) {
    const lines = wf.text.split('\n');
    lines.forEach((text, i) => {
      if (!/^\s*-?\s*uses:\s*pnpm\/action-setup@/.test(text)) return;
      // The `version:` belonging to this step, within its `with:` block.
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const v = /^\s*version:\s*'?"?(\d+\.\d+\.\d+)'?"?\s*$/.exec(lines[j]);
        if (!v) continue;
        actionPins += 1;
        if (pmPin && v[1] !== pmPin) {
          errors.push(
            `PNPM PIN DRIFT: ${wf.file}:${j + 1} pins pnpm ${v[1]} but packageManager says ` +
              `${pmPin}. pnpm/action-setup only errors when these DISAGREE inside one repo ` +
              `checkout — it cannot see the Dockerfile, so drift here is otherwise silent.`,
          );
        }
        break;
      }
    });
  }
  if (pmPin) {
    checked.push(`packageManager pnpm@${pmPin} matches ${actionPins} pnpm/action-setup pin(s)`);
  }

  return { ok: errors.length === 0, errors, checked };
}

/** Read the real repo into PinInputs. */
export function readInputs(root: string): PinInputs {
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
  const manifestFiles = ['package.json', 'packages/server/package.json'];
  const manifests = manifestFiles.map((file) => {
    const pkg = JSON.parse(read(file)) as {
      engines?: { node?: string };
      packageManager?: string;
    };
    return {
      file,
      enginesNode: pkg.engines?.node,
      packageManager: pkg.packageManager,
    };
  });
  const wfDir = path.join(root, '.github', 'workflows');
  const workflows = fs
    .readdirSync(wfDir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .map((f) => ({ file: `.github/workflows/${f}`, text: read(`.github/workflows/${f}`) }));
  return {
    nvmrc: read(NVMRC),
    dockerfile: read('packages/server/Dockerfile'),
    manifests,
    workflows,
  };
}

/* istanbul ignore next — CLI entry */
if (require.main === module) {
  const root = path.resolve(__dirname, '..', '..');
  const result = runCheck(readInputs(root));
  for (const e of result.errors) console.error(`FAIL: ${e}`);
  if (!result.ok) {
    console.error(`\npins:check: ${result.errors.length} pin drift(s). CI must run what production runs.`);
    process.exit(1);
  }
  for (const c of result.checked) console.log(`  ok  ${c}`);
  console.log(`pins:check: OK (${result.checked.length} assertions)`);
}
