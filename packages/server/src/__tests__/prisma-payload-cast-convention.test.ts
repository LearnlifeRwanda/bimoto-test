// HYGIENE W3 G2 — source assertions, in the shape #182 proved.
//
// The five casts this wave removed (auth.ts, aml/flag-store.ts, the two
// conflict-resolver conflicts, admin-aml.routes.ts) were all stale: the
// compiler accepted every payload once the `as any` came off. What they
// cost while they stood was the compiler itself. `data: { … } as any` on
// a Prisma write switches off field checking for that write, which is
// exactly how a `where: { phone }` survived the schema rename #182 spent
// a dispatch undoing — the wrong code compiled because nothing was
// looking.
//
// The rule, read straight off the production source: no object literal
// passed to a Prisma `data:` / `select:` / `where:` key may be cast to
// `any` (or through `unknown`), anywhere in packages/server/src. Casting
// the payload is never the fix; a payload the compiler rejects is a
// finding.
//
// Scope note: this scans every .ts under src, tests included. A test that
// needs to cast a Prisma payload is describing a shape the compiler has
// already rejected, which is the same smell in a cheaper file.

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Blank out comments and string/template bodies, preserving offsets and
 * line breaks. Comments are prose — this very file discusses the banned
 * shape at length, and documenting a rule may never violate it. String
 * contents are blanked for the same reason a fixture may quote the shape.
 */
function stripNonCode(src: string): string {
  let out = '';
  let inBlock = false;
  let inLine = false;
  let inString: string | null = null;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const n = src[i + 1];
    if (inBlock) {
      if (c === '*' && n === '/') {
        inBlock = false;
        i += 1;
        out += '  ';
      } else out += c === '\n' ? '\n' : ' ';
      continue;
    }
    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out += '\n';
      } else out += ' ';
      continue;
    }
    if (inString) {
      if (c === '\\') {
        out += '  ';
        i += 1;
        continue;
      }
      if (c === inString) {
        inString = null;
        out += c;
        continue;
      }
      out += c === '\n' ? '\n' : ' ';
      continue;
    }
    if (c === '/' && n === '*') {
      inBlock = true;
      i += 1;
      out += '  ';
      continue;
    }
    if (c === '/' && n === '/') {
      inLine = true;
      out += ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = c;
      out += c;
      continue;
    }
    out += c;
  }
  return out;
}

const PAYLOAD_KEY = /\b(data|select|where)\s*:\s*\{/g;

/**
 * Every `data:` / `select:` / `where:` object literal whose closing brace
 * is immediately followed by an `as any` / `as unknown` cast. Exported
 * shape is `file:line  key` so a failure names the site.
 */
export function findPrismaPayloadCasts(source: string, label: string): string[] {
  const code = stripNonCode(source);
  const found: string[] = [];
  PAYLOAD_KEY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PAYLOAD_KEY.exec(code)) !== null) {
    let i = match.index + match[0].length - 1;
    let depth = 0;
    for (; i < code.length; i += 1) {
      if (code[i] === '{') depth += 1;
      else if (code[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (i >= code.length) continue;
    const cast = /^\s*as\s+(any|unknown)\b/.exec(code.slice(i + 1));
    if (!cast) continue;
    const line = source.slice(0, match.index).split('\n').length;
    found.push(`${label}:${line}  ${match[1]}: { … } ${cast[0].trim()}`);
  }
  return found;
}

const FILES = walk(SRC);

describe('prisma payload casts', () => {
  test('the tree is scanned at all (the walker itself is not the bug)', () => {
    expect(FILES.length).toBeGreaterThan(200);
  });

  test('no Prisma data/select/where payload is cast to any, anywhere in src', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      offenders.push(
        ...findPrismaPayloadCasts(fs.readFileSync(file, 'utf8'), path.relative(SRC, file)),
      );
    }
    expect(offenders).toEqual([]);
  });

  // Both directions. A guard that cannot fail is not a guard: these are
  // the five shapes this wave removed, plus the multi-line form, planted
  // as source text so the detector is proven to catch them.
  test('planted violations are caught', () => {
    const planted = [
      `await prisma.user.update({ where: { id }, data: { isFlagged: true } as any });`,
      `await prisma.user.findUnique({ where: { id }, select: { frozenAt: true } as any });`,
      `await tx.user.update({ where: { id } as any, data: { ok: true } });`,
      `await prisma.user.update({\n  data: {\n    isFlagged: false,\n    flagReason: null,\n  } as any,\n});`,
      `await prisma.user.update({ data: { x: 1 } as unknown as Prisma.UserUpdateInput });`,
    ];
    for (const src of planted) {
      expect(findPrismaPayloadCasts(src, 'planted.ts')).not.toEqual([]);
    }
  });

  test('the sanctioned shapes are not flagged', () => {
    const clean = [
      `await prisma.user.update({ where: { id }, data: { isFlagged: true } });`,
      `await prisma.user.findUnique({ where: { id }, select: { frozenAt: true } });`,
      // a cast on something that is not a payload literal
      `const row = (await raw()) as any;`,
      // the rule named in prose, which must never trip it
      `// never write data: { x: 1 } as any here`,
      `/* data: { x: 1 } as any */`,
      `const doc = "data: { x: 1 } as any";`,
      // a nested literal inside a payload, with the cast on a leaf value
      `await prisma.user.update({ data: { meta: payload as any } });`,
    ];
    for (const src of clean) {
      expect(findPrismaPayloadCasts(src, 'clean.ts')).toEqual([]);
    }
  });
});
