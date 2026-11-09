// DECRYPT v3 L3 — source assertions, in the spirit of #180's structural
// guards. The point of the schema rename is that the wrong code becomes
// unwritable; the point of these tests is that it STAYS unwritable once
// the compiler errors have all been cleared and the next contributor
// arrives with no memory of why the field is called `phoneEncrypted`.
//
// Three rules, each read straight off the production source:
//
//   1. Only services/user-phone.ts (and utils/crypto.ts itself) may call
//      decrypt() on a phone-shaped expression.
//   2. Nothing outside services/user-phone.ts may READ .phoneEncrypted as
//      a value. Naming it as a Prisma select/where key is fine — that is
//      a column declaration, not a plaintext read — and passing a whole
//      user object to the accessor is the sanctioned idiom.
//   3. No template literal anywhere interpolates a *phoneEncrypted
//      expression. That is the exact shape of the parcel-delivered SMS
//      defect: "contact Aljo at 4f3a…:9c2b…:11de…".

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..');
const ACCESSOR = path.join(SRC, 'services', 'user-phone.ts');
const CRYPTO = path.join(SRC, 'utils', 'crypto.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const PRODUCTION_FILES = walk(SRC);
const rel = (f: string) => path.relative(SRC, f);

/**
 * Comments are prose, not code — and these rules are deliberately
 * discussed in comments (this file's own header names `.phoneEncrypted`
 * repeatedly; services/user-phone.ts explains at length what the column
 * is and is not). Strip line and block comments before applying any rule,
 * so documenting the convention can never violate it.
 *
 * SENDER-MATCH — this pointer used to name sms-inbound/sender-lookup.ts,
 * whose comment explained why its query deliberately named the encrypted
 * column. That query is gone: the lookup now goes through `phoneHash`, so
 * the reference described a file that no longer says what was claimed.
 * Retired here rather than left to rot (#183).
 */
function codeLines(src: string): Array<{ line: string; n: number }> {
  const out: Array<{ line: string; n: number }> = [];
  let inBlock = false;
  src.split('\n').forEach((raw, i) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) return;
      line = line.slice(end + 2);
      inBlock = false;
    }
    for (;;) {
      const start = line.indexOf('/*');
      if (start === -1) break;
      const end = line.indexOf('*/', start + 2);
      if (end === -1) {
        line = line.slice(0, start);
        inBlock = true;
        break;
      }
      line = line.slice(0, start) + line.slice(end + 2);
    }
    const lineComment = line.indexOf('//');
    if (lineComment !== -1) line = line.slice(0, lineComment);
    if (line.trim()) out.push({ line, n: i + 1 });
  });
  return out;
}

describe('DECRYPT v3 — phone access convention (source assertions)', () => {
  test('the census actually found files to check', () => {
    expect(PRODUCTION_FILES.length).toBeGreaterThan(100);
    expect(PRODUCTION_FILES).toContain(ACCESSOR);
  });

  test('only user-phone.ts and crypto.ts decrypt a phone', () => {
    const offenders: string[] = [];
    for (const file of PRODUCTION_FILES) {
      if (file === ACCESSOR || file === CRYPTO) continue;
      for (const { line, n } of codeLines(fs.readFileSync(file, 'utf8'))) {
        if (/\bdecrypt\s*\(/.test(line) && /phone|contact|msisdn/i.test(line)) {
          offenders.push(`${rel(file)}:${n}  ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('nothing outside user-phone.ts reads .phoneEncrypted as a value', () => {
    const offenders: string[] = [];
    for (const file of PRODUCTION_FILES) {
      if (file === ACCESSOR) continue;
      // A member read: `something.phoneEncrypted`. Prisma select/where
      // keys (`phoneEncrypted: true`) carry no leading dot and are the
      // sanctioned way to name the column.
      for (const { line, n } of codeLines(fs.readFileSync(file, 'utf8'))) {
        if (/[.?]\s*phoneEncrypted\b/.test(line)) {
          offenders.push(`${rel(file)}:${n}  ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no template literal interpolates encrypted phone material', () => {
    const offenders: string[] = [];
    for (const file of PRODUCTION_FILES) {
      for (const { line, n } of codeLines(fs.readFileSync(file, 'utf8'))) {
        if (/\$\{[^}]*phoneEncrypted[^}]*\}/.test(line)) {
          offenders.push(`${rel(file)}:${n}  ${line.trim()}`);
        }
        if (/\$\{[^}]*emergencyContactsEncrypted[^}]*\}/.test(line)) {
          offenders.push(`${rel(file)}:${n}  ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // DECRYPT v3 addendum — the roots `pnpm typecheck` cannot reach.
  //
  // Everything else that holds .ts is now under a tsc project (see the
  // typecheck script and the CI job): server src, server prisma+scripts,
  // client, shared, e2e, and the three guard scripts. scripts/livewire is
  // the one exception: its imports (@prisma/client, socket.io-client,
  // jsonwebtoken) live in packages/server/node_modules and pnpm's isolated
  // layout gives a root-level project no way to resolve them, and the file
  // additionally carries pre-existing strict-mode errors unrelated to
  // phones. Rather than leave it unguarded, it is scanned here instead.
  //
  // This is the rule that would have caught the defect that reached CI:
  // prisma.user.createMany({ data: [{ phone: … }] }) in a file no compiler
  // was looking at.
  const UNTYPECHECKED_ROOTS = [
    path.join(SRC, '..', '..', '..', 'scripts', 'livewire'),
  ];

  test('no untypechecked root writes the pre-rename User field names', () => {
    const offenders: string[] = [];
    for (const root of UNTYPECHECKED_ROOTS) {
      if (!fs.existsSync(root)) continue;
      for (const file of walk(root)) {
        const src = fs.readFileSync(file, 'utf8');
        if (!/prisma\.user|tx\.user/.test(src)) continue;
        for (const { line, n } of codeLines(src)) {
          if (/^\s*phone:/.test(line) || /^\s*emergencyContacts:/.test(line)) {
            offenders.push(`${path.basename(root)}/${path.basename(file)}:${n}  ${line.trim()}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the untypechecked-root list is real and non-empty', () => {
    // If this ever empties, every root is under a compiler and the scan
    // above can go. If a new root appears, add it here or to the typecheck
    // script — those are the only two options.
    expect(UNTYPECHECKED_ROOTS.length).toBeGreaterThan(0);
    for (const root of UNTYPECHECKED_ROOTS) {
      expect(fs.existsSync(root)).toBe(true);
    }
  });

  // DECRYPT v3 addendum — the class the compiler structurally cannot see.
  //
  // TypeScript applies excess-property checking only to FRESH object
  // literals. A Prisma select hoisted into a named const —
  //   const DRIVER_SELECT = { id: true, phone: true } as const
  // — is never checked against UserSelect, no cast required. tsc was green
  // on exactly that while Prisma rejected `phone` at runtime, 500'ing
  // GET /api/admin/payouts. No compiler configuration fixes this; the only
  // durable guard is reading the source.
  test('no pre-rename User field survives as a Prisma select key', () => {
    const offenders: string[] = [];
    for (const file of PRODUCTION_FILES) {
      for (const { line, n } of codeLines(fs.readFileSync(file, 'utf8'))) {
        if (/\bphone:\s*true\b/.test(line) || /\bemergencyContacts:\s*true\b/.test(line)) {
          offenders.push(`${rel(file)}:${n}  ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the accessor is the only importer of decrypt outside crypto.ts', () => {
    const importers: string[] = [];
    for (const file of PRODUCTION_FILES) {
      if (file === CRYPTO) continue;
      const src = fs.readFileSync(file, 'utf8');
      if (/import\s*\{[^}]*\bdecrypt\b[^}]*\}\s*from\s*['"][^'"]*utils\/crypto['"]/.test(src)) {
        importers.push(rel(file));
      }
    }
    // document-crypto.ts decrypts FILES, not phones, and legitimately
    // reaches for the same key material via getEncryptionKey.
    expect(importers).toEqual(['services/user-phone.ts']);
  });
});
