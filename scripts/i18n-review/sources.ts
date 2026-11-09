// I18N-TRUTH G1 — every phrase the app shows, read straight off disk.
//
// The review workbook used to be written by hand. It said it audited 232
// keys while the locale files held 1088, which is how a translator came to
// be pointed at a file covering a fifth of the app. Nothing here is typed
// by a human: the three locale files, the canned chat phrases and the
// Kigali landmark names are parsed from source on every run, so the
// workbook can only ever describe what actually ships.
//
// Reading strategy mirrors scripts/wiring-audit/extract.ts: source files
// are read as TEXT, never imported. The generator must run from a bare
// checkout with no build step and no workspace resolution.

import * as fs from 'node:fs';
import * as path from 'node:path';

export const LOCALES = ['en', 'fr', 'rw'] as const;
export type Locale = (typeof LOCALES)[number];

export interface QuickMessageEntry {
  id: string;
  forRole: string;
  en: string;
  fr: string;
  rw: string;
}

export interface LandmarkEntry {
  name: string;
  category: string;
  nameRw: string;
  nameFr: string;
}

export interface Sources {
  /** Flattened dotted key -> value, per locale, in locale-file order. */
  locales: Record<Locale, Record<string, string>>;
  /** Raw bytes of every file that feeds the workbook, for the digest. */
  rawBytes: Record<string, string>;
  quickMessages: QuickMessageEntry[];
  landmarks: LandmarkEntry[];
}

export function localePath(root: string, locale: Locale): string {
  return path.join(root, 'packages', 'client', 'public', 'locales', locale, 'translation.json');
}

export function quickMessagesPath(root: string): string {
  return path.join(root, 'packages', 'shared', 'src', 'constants', 'quick-messages.ts');
}

/**
 * Every file the landmark catalog lives in. LANDMARKS G2 split it one file
 * per category under constants/landmarks/, so this is a list rather than a
 * path: locations.ts is still the door everything imports through, but the
 * names themselves are next door. New category files are picked up by being
 * there, so the workbook cannot fall behind the catalog.
 */
export function catalogPaths(root: string): string[] {
  const dir = path.join(root, 'packages', 'shared', 'src', 'constants');
  const files = [path.join(dir, 'locations.ts')];
  const split = path.join(dir, 'landmarks');
  if (fs.existsSync(split)) {
    for (const f of fs.readdirSync(split).sort()) {
      if (f.endsWith('.ts')) files.push(path.join(split, f));
    }
  }
  return files.filter((f) => fs.existsSync(f));
}

/** Dotted-key flatten. Object values recurse; everything else is a leaf. */
export function flatten(obj: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
}

// ---------------------------------------------------------------- TS parsing
//
// Both constants files are hand-written literal arrays. A quote-aware
// scanner is enough and keeps the generator dependency-free; a parser that
// silently returned nothing would be worse than one that throws, so the
// callers below assert the shapes they expect.

/** Reads the single- or double-quoted string literal starting at `from`. */
function readStringLiteral(src: string, from: number): { value: string; end: number } | null {
  const quote = src[from];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let out = '';
  for (let i = from + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      const next = src[i + 1];
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      i++;
      continue;
    }
    if (ch === quote) return { value: out, end: i + 1 };
    out += ch;
  }
  return null;
}

/** `field: 'value'` (or `[Language.EN]: 'value'`) anywhere in `chunk`. */
function field(chunk: string, name: string): string | null {
  const re = new RegExp(`(?:^|[^\\w.])${name.replace(/[.[\]]/g, '\\$&')}\\s*:\\s*`);
  const m = re.exec(chunk);
  if (!m) return null;
  const lit = readStringLiteral(chunk, m.index + m[0].length);
  return lit ? lit.value : null;
}

/**
 * Walks `src` from `from`, calling `onBracket` for every bracket that is
 * real code — not inside a string, a line comment or a block comment.
 * Comments matter: an apostrophe in `// the driver's phone` would open a
 * phantom string literal and silently swallow the entries that follow.
 * Returns when `onBracket` returns a number (the index to stop at).
 */
function scanBrackets(src: string, from: number, onBracket: (ch: string, i: number) => number | void): number {
  let quote: string | null = null;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i === -1) break;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{' || ch === '}' || ch === '[' || ch === ']') {
      const stop = onBracket(ch, i);
      if (typeof stop === 'number') return stop;
    }
  }
  return -1;
}

/** Splits the top-level `{...}` object literals out of an array body. */
function objectChunks(body: string): string[] {
  const chunks: string[] = [];
  let depth = 0;
  let start = -1;
  scanBrackets(body, 0, (ch, i) => {
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        chunks.push(body.slice(start, i + 1));
        start = -1;
      }
    }
  });
  return chunks;
}

/** Body of `export const <name> ... = [ ... ];`, brace/bracket aware. */
function arrayBody(src: string, name: string): string {
  const anchor = new RegExp(`export const ${name}\\b[^=]*=\\s*\\[`).exec(src);
  if (!anchor) throw new Error(`i18n-review: could not find "export const ${name} = [" — parser needs updating`);
  const open = anchor.index + anchor[0].length;
  let depth = 1;
  const close = scanBrackets(src, open, (ch, i) => {
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
    return undefined;
  });
  if (close === -1) throw new Error(`i18n-review: unterminated ${name} array literal`);
  return src.slice(open, close);
}

export function parseQuickMessages(src: string): QuickMessageEntry[] {
  const entries = objectChunks(arrayBody(src, 'QUICK_MESSAGES'))
    .map((chunk) => ({
      id: field(chunk, 'id') ?? '',
      forRole: field(chunk, 'forRole') ?? '',
      en: field(chunk, '[Language.EN]') ?? '',
      fr: field(chunk, '[Language.FR]') ?? '',
      rw: field(chunk, '[Language.RW]') ?? '',
    }))
    .filter((e) => e.id !== '');
  if (entries.length === 0) throw new Error('i18n-review: parsed 0 quick messages — parser needs updating');
  const blank = entries.filter((e) => e.en === '' || e.rw === '');
  if (blank.length > 0) {
    throw new Error(
      `i18n-review: ${blank.length} quick message(s) parsed with no text (${blank
        .map((e) => e.id)
        .join(', ')}) — parser needs updating`,
    );
  }
  return entries;
}

/**
 * Every landmark name in one catalog file, from every `*_LANDMARKS` export
 * it declares — verified and unverified alike, because a passenger reads
 * both. The anchor is the export name pattern rather than one literal
 * constant: locations.ts declares KIGALI_LANDMARKS, each category file
 * declares its own pair, and a file whose arrays are all spreads (as
 * locations.ts now is) contributes nothing rather than failing.
 */
export function parseLandmarks(src: string): LandmarkEntry[] {
  const entries: LandmarkEntry[] = [];
  for (const match of src.matchAll(/export const ([A-Z0-9_]*LANDMARKS)\b[^=]*=\s*\[/g)) {
    for (const chunk of objectChunks(arrayBody(src, match[1]))) {
      const name = field(chunk, 'name') ?? '';
      if (name === '') continue;
      entries.push({
        name,
        category: field(chunk, 'category') ?? '',
        nameRw: field(chunk, 'nameRw') ?? '',
        nameFr: field(chunk, 'nameFr') ?? '',
      });
    }
  }
  return entries;
}

export function loadSources(root: string): Sources {
  const rawBytes: Record<string, string> = {};
  const locales = {} as Record<Locale, Record<string, string>>;
  for (const locale of LOCALES) {
    const file = localePath(root, locale);
    const raw = fs.readFileSync(file, 'utf8');
    rawBytes[path.relative(root, file)] = raw;
    locales[locale] = flatten(JSON.parse(raw));
  }

  const qmFile = quickMessagesPath(root);
  const qmRaw = fs.readFileSync(qmFile, 'utf8');
  rawBytes[path.relative(root, qmFile)] = qmRaw;

  // Every catalog file joins the digest, not just locations.ts — otherwise
  // the freshness guard would stop noticing landmark names the moment they
  // moved next door.
  const landmarks: LandmarkEntry[] = [];
  for (const file of catalogPaths(root)) {
    const raw = fs.readFileSync(file, 'utf8');
    rawBytes[path.relative(root, file)] = raw;
    landmarks.push(...parseLandmarks(raw));
  }
  if (landmarks.length === 0) throw new Error('i18n-review: parsed 0 landmarks — parser needs updating');

  return {
    locales,
    rawBytes,
    quickMessages: parseQuickMessages(qmRaw),
    landmarks,
  };
}
