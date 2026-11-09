// WIRE-AUDIT G1 — feature-wiring extractor.
//
// Builds a machine-readable map of what the product actually wires
// together, from the four single registration points the codebase
// guarantees:
//   (a) server endpoints  — packages/server/src/index.ts app.use(...)
//       mounts, walked into their router files;
//   (b) client API calls  — every apiFetch(...)/fetch(...) path
//       expression plus every '/api/...' string literal in client/src;
//   (c) client routes     — <Route path=...> declarations in App.tsx;
//   (d) navigation edges  — BottomNav tab targets plus every
//       <Link>/<Navigate>/navigate(...) target.
//
// Honesty contract: anything the extractor cannot resolve statically
// (a path built from a variable, a navigate() target computed at
// runtime) lands in an UNRESOLVED bucket with its file:line and a
// snippet — it is never guessed into a verdict. The analysis section
// therefore reports *candidates*, and docs/wiring-report.md holds the
// human-confirmed verdicts.
//
// Pure library: no I/O beyond fs reads rooted at the config paths, no
// timestamps, all output arrays sorted — regenerating twice from the
// same tree yields byte-identical output (the determinism test relies
// on this).

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditConfig {
  /** Repo root all other paths are relative to. */
  root: string;
  serverIndex: string;
  clientSrc: string;
  appTsx: string;
  bottomNav: string;
  /** The bundler entry whose import closure defines "live" client code. */
  clientEntry: string;
}

export const DEFAULT_CONFIG: Omit<AuditConfig, 'root'> = {
  serverIndex: 'packages/server/src/index.ts',
  clientSrc: 'packages/client/src',
  appTsx: 'packages/client/src/App.tsx',
  bottomNav: 'packages/client/src/components/layout/BottomNav.tsx',
  clientEntry: 'packages/client/src/main.tsx',
};

export interface Endpoint {
  method: string;
  /** Full path, mount + subpath, dynamic segments as :name. */
  path: string;
  file: string;
  line: number;
}

export interface UnresolvedItem {
  file: string;
  line: number;
  snippet: string;
  reason: string;
}

export interface ApiCall {
  /** Normalized path: template ${...} segments become :param. */
  path: string;
  /** null = statically unknown (init object not a literal). */
  method: string | null;
  file: string;
  line: number;
  via: 'apiFetch' | 'fetch' | 'literal';
  /** True when the containing file is NOT in the client entry's import
   * closure — the call exists in code nothing imports. */
  deadFile?: boolean;
}

export interface RouteDecl {
  path: string;
  screen: string;
  /** Resolved page file relative to root; null if unresolvable. */
  screenFile: string | null;
  guards: string[];
}

export interface NavEdge {
  /** Normalized target: template ${...} segments become :param. */
  target: string;
  file: string;
  line: number;
  kind: 'bottomnav' | 'navigate' | 'link' | 'redirect';
}

export interface NonRouterMount {
  mount: string;
  handler: string;
  line: number;
}

export interface EndpointStatus extends Endpoint {
  callers: Array<{ file: string; line: number; via: string; deadFile: boolean }>;
  status: 'called' | 'called-from-dead-code-only' | 'orphan-candidate';
}

export interface RouteStatus extends RouteDecl {
  reachable: boolean;
  /** Sorted list of 'seed:<kind>:<target>' / 'screen:<route path>'. */
  reachedFrom: string[];
}

export interface WiringMap {
  endpoints: Endpoint[];
  unresolvedEndpoints: UnresolvedItem[];
  nonRouterMounts: NonRouterMount[];
  calls: ApiCall[];
  unresolvedCalls: UnresolvedItem[];
  routes: RouteDecl[];
  navEdges: NavEdge[];
  unresolvedNav: UnresolvedItem[];
  analysis: {
    endpointStatus: EndpointStatus[];
    routeStatus: RouteStatus[];
    /** Client calls whose path matches no server endpoint. */
    unmatchedCalls: ApiCall[];
    /** Client source files outside the entry's import closure — code
     * nothing imports (the LocationPicker/DriverCard failure class). */
    deadClientFiles: string[];
    /** Navigation edges whose target matches no declared route — taps
     * that land on the 404 screen. */
    unmatchedNavTargets: NavEdge[];
  };
}

// ---------------------------------------------------------------------------
// Tokenizer — comments blanked, string/template literal contents blanked
// but delimiters kept, literal values collected with positions. Newlines
// are preserved in the blanked text so line numbers stay computable.
// ---------------------------------------------------------------------------

export interface Literal {
  /** Content with each ${...} replaced by :param (templates only). */
  value: string;
  /** Offset of the opening quote/backtick. */
  start: number;
  end: number;
  line: number;
}

export interface Tokenized {
  /** Source with comments and literal contents blanked (delimiters kept). */
  blanked: string;
  literals: Literal[];
  /** Literal lookup by opening-delimiter offset. */
  byStart: Map<number, Literal>;
}

const REGEX_PRECEDER = /[([{=,:;!&|?+\-*%<>~^]$/;

/** Keywords a regex literal may directly follow (`return /x/`, `case /x/`). */
const REGEX_PRECEDING_KEYWORDS = [
  'return',
  'typeof',
  'case',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'do',
  'else',
];

function lineAt(code: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (code[i] === '\n') line += 1;
  return line;
}

export function tokenize(code: string): Tokenized {
  const out = code.split('');
  const literals: Literal[] = [];
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };

  // LOOSE-ENDS G2 — the ONE regex heuristic, with two call sites.
  //
  // Division vs regex literal: a regex can only appear where an
  // expression is expected, so the decision is made by looking back at
  // the last significant character (plus the keyword forms `return /x/`
  // and friends). Returns the offset just past the literal INCLUDING
  // its flags, or null when the '/' is a division operator.
  //
  // This lives on its own because a second, divergent copy is exactly
  // how the #170 hole stayed open: the main scan below knew how to skip
  // a regex and `skipTemplateExpr` did not, so a regex holding a quote
  // inside a `${...}` expression started a string scan that never came
  // back. One heuristic, called from both places, cannot drift apart.
  //
  // Lookback reads `out` rather than `code` because the main scan has
  // already blanked comments and earlier literal bodies there; for the
  // not-yet-scanned region a template expression sits in, `out` is
  // byte-identical to `code`.
  const regexLiteralEnd = (at: number): number | null => {
    let k = at - 1;
    while (k >= 0 && /\s/.test(out[k])) k -= 1;
    const prev = k >= 0 ? out[k] : '';
    const prevWord = /\w/.test(prev) ? (out.slice(0, k + 1).join('').match(/(\w+)$/)?.[1] ?? '') : '';
    const isRegex = k < 0 || REGEX_PRECEDER.test(prev) || REGEX_PRECEDING_KEYWORDS.includes(prevWord);
    if (!isRegex) return null;
    let j = at + 1;
    let inClass = false;
    while (j < code.length) {
      const rc = code[j];
      if (rc === '\\') j += 2;
      else if (rc === '\n') break; // not a regex after all
      else if (rc === '[') { inClass = true; j += 1; }
      else if (rc === ']') { inClass = false; j += 1; }
      else if (rc === '/' && !inClass) { j += 1; break; }
      else j += 1;
    }
    while (j < code.length && /[a-z]/i.test(code[j])) j += 1;
    return j;
  };

  // Skip a balanced ${...} region starting at the '{' offset; strings,
  // nested templates and regex literals inside the expression are
  // skipped wholesale.
  const skipTemplateExpr = (open: number): number => {
    let depth = 1;
    let i = open + 1;
    while (i < code.length && depth > 0) {
      const c = code[i];
      if (c === '\\') i += 2;
      else if (c === "'" || c === '"') i = skipString(i) ;
      else if (c === '`') i = skipTemplate(i);
      // #170 — without this branch, a `"` or a backtick inside a regex
      // literal here is read as a string/template opener and the whole
      // scan desynchronises.
      else if (c === '/') { const end = regexLiteralEnd(i); i = end === null ? i + 1 : end; }
      else if (c === '{') { depth += 1; i += 1; }
      else if (c === '}') { depth -= 1; i += 1; }
      else i += 1;
    }
    return i;
  };

  // Returns offset just past the closing quote.
  const skipString = (open: number): number => {
    const quote = code[open];
    let i = open + 1;
    while (i < code.length) {
      if (code[i] === '\\') i += 2;
      else if (code[i] === quote) return i + 1;
      else if (code[i] === '\n') return i; // unterminated — bail
      else i += 1;
    }
    return i;
  };

  // Returns offset just past the closing backtick.
  const skipTemplate = (open: number): number => {
    let i = open + 1;
    while (i < code.length) {
      if (code[i] === '\\') i += 2;
      else if (code[i] === '`') return i + 1;
      else if (code[i] === '$' && code[i + 1] === '{') i = skipTemplateExpr(i + 1);
      else i += 1;
    }
    return i;
  };

  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '/' && code[i + 1] === '/') {
      const nl = code.indexOf('\n', i);
      const end = nl === -1 ? code.length : nl;
      blank(i, end);
      i = end;
    } else if (c === '/' && code[i + 1] === '*') {
      const close = code.indexOf('*/', i + 2);
      const end = close === -1 ? code.length : close + 2;
      blank(i, end);
      i = end;
    } else if (c === "'" || c === '"') {
      const end = skipString(i);
      const value = code.slice(i + 1, Math.max(i + 1, end - 1));
      literals.push({ value, start: i, end, line: lineAt(code, i) });
      blank(i + 1, end - 1);
      i = end;
    } else if (c === '`') {
      const end = skipTemplate(i);
      // Build the template value with ${...} → :param.
      let value = '';
      let j = i + 1;
      while (j < end - 1) {
        if (code[j] === '\\') { value += code[j + 1] ?? ''; j += 2; }
        else if (code[j] === '$' && code[j + 1] === '{') {
          value += ':param';
          j = skipTemplateExpr(j + 1);
        } else { value += code[j]; j += 1; }
      }
      literals.push({ value, start: i, end, line: lineAt(code, i) });
      blank(i + 1, end - 1);
      i = end;
    } else if (c === '/') {
      const end = regexLiteralEnd(i);
      if (end !== null) {
        blank(i + 1, end);
        i = end;
      } else {
        i += 1;
      }
    } else {
      i += 1;
    }
  }

  const blanked = out.join('');
  const byStart = new Map(literals.map((l) => [l.start, l]));
  return { blanked, literals, byStart };
}

// ---------------------------------------------------------------------------
// Call-expression helpers
// ---------------------------------------------------------------------------

export interface CallSite {
  /** Offset of the opening paren. */
  open: number;
  /** Offset of the matching close paren (or end of file if unbalanced). */
  close: number;
  line: number;
  /** Captured groups from the callee regex match. */
  groups: string[];
}

/** Find calls matching `calleeRe` (which must end in `\(`) in blanked text. */
export function findCalls(tok: Tokenized, code: string, calleeRe: RegExp): CallSite[] {
  const sites: CallSite[] = [];
  const re = new RegExp(calleeRe.source, calleeRe.flags.includes('g') ? calleeRe.flags : calleeRe.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(tok.blanked)) !== null) {
    // A function *declaration* whose name matches the callee (e.g.
    // `function fetch(...)`, `declare function apiFetch(...)`) is not a
    // call site.
    const before = tok.blanked.slice(Math.max(0, m.index - 20), m.index);
    if (/\bfunction\s*$/.test(before)) continue;
    const open = m.index + m[0].length - 1;
    let depth = 1;
    let j = open + 1;
    while (j < tok.blanked.length && depth > 0) {
      const c = tok.blanked[j];
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      j += 1;
    }
    sites.push({ open, close: j - 1, line: lineAt(code, m.index), groups: m.slice(1) });
  }
  return sites;
}

/** The first argument, iff it is a string/template literal. */
export function firstArgLiteral(tok: Tokenized, site: CallSite): Literal | null {
  let k = site.open + 1;
  while (k < site.close && /\s/.test(tok.blanked[k])) k += 1;
  const lit = tok.byStart.get(k);
  return lit && lit.end <= site.close ? lit : null;
}

/** Snippet of the call's argument list for UNRESOLVED reporting. */
function argSnippet(code: string, site: CallSite): string {
  return code
    .slice(site.open + 1, Math.min(site.close, site.open + 81))
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------

function walkFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        visit(p);
      } else if (exts.some((e) => entry.name.endsWith(e)) && !entry.name.endsWith('.d.ts')) {
        out.push(p);
      }
    }
  };
  visit(dir);
  return out;
}

function isTestFile(rel: string): boolean {
  return /(^|\/)__tests__\//.test(rel) || /\.test\.[jt]sx?$/.test(rel) || /(^|\/)test\//.test(rel);
}

// ---------------------------------------------------------------------------
// (a) Server endpoints
// ---------------------------------------------------------------------------

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all'];

function joinMount(mount: string, sub: string): string {
  const m = mount.endsWith('/') ? mount.slice(0, -1) : mount;
  if (sub === '/' || sub === '') return m || '/';
  return m + (sub.startsWith('/') ? sub : '/' + sub);
}

export function extractServerEndpoints(cfg: AuditConfig): {
  endpoints: Endpoint[];
  unresolved: UnresolvedItem[];
  nonRouterMounts: NonRouterMount[];
} {
  const indexPath = path.join(cfg.root, cfg.serverIndex);
  const code = fs.readFileSync(indexPath, 'utf8');
  const tok = tokenize(code);
  const endpoints: Endpoint[] = [];
  const unresolved: UnresolvedItem[] = [];
  const nonRouterMounts: NonRouterMount[] = [];

  // Default-import map: ident -> resolved file path.
  const imports = new Map<string, string>();
  const importRe = /import\s+(\w+)\s+from\s+(['"])/g;
  let im: RegExpExecArray | null;
  while ((im = importRe.exec(tok.blanked)) !== null) {
    const quoteOffset = im.index + im[0].length - 1;
    const lit = tok.byStart.get(quoteOffset);
    if (!lit || !lit.value.startsWith('.')) continue;
    const base = path.resolve(path.dirname(indexPath), lit.value);
    for (const candidate of [base + '.ts', base + '.tsx', path.join(base, 'index.ts')]) {
      if (fs.existsSync(candidate)) {
        imports.set(im[1], candidate);
        break;
      }
    }
  }

  const relToRoot = (p: string) => path.relative(cfg.root, p).split(path.sep).join('/');

  // Mounts: app.use('<mount>', <ident>)
  for (const site of findCalls(tok, code, /\bapp\.use\s*\(/)) {
    const lit = firstArgLiteral(tok, site);
    if (!lit) continue; // pathless middleware (helmet, cors, ...)
    const mount = lit.value;
    const after = tok.blanked.slice(lit.end, site.close);
    const handlerMatch = after.match(/^\s*,\s*([\w.]+)/);
    const handler = handlerMatch ? handlerMatch[1] : '<expression>';
    const routerFile = imports.get(handler);
    if (!routerFile) {
      nonRouterMounts.push({ mount, handler, line: site.line });
      continue;
    }
    const routerRel = relToRoot(routerFile);
    const rCode = fs.readFileSync(routerFile, 'utf8');
    const rTok = tokenize(rCode);
    const methodRe = new RegExp(`\\brouter\\.(${HTTP_METHODS.join('|')})\\s*\\(`);
    for (const rs of findCalls(rTok, rCode, methodRe)) {
      const pathLit = firstArgLiteral(rTok, rs);
      if (!pathLit) {
        unresolved.push({
          file: routerRel,
          line: rs.line,
          snippet: argSnippet(rCode, rs),
          reason: 'router path is not a string literal',
        });
        continue;
      }
      endpoints.push({
        method: rs.groups[0].toUpperCase(),
        path: joinMount(mount, pathLit.value),
        file: routerRel,
        line: rs.line,
      });
    }
    // router.use('<sub>', ...) with a string path would hide endpoints
    // from this extractor — surface it instead of ignoring it.
    for (const us of findCalls(rTok, rCode, /\brouter\.use\s*\(/)) {
      const subLit = firstArgLiteral(rTok, us);
      if (subLit) {
        unresolved.push({
          file: routerRel,
          line: us.line,
          snippet: argSnippet(rCode, us),
          reason: 'nested router.use with a path — not walked by this extractor',
        });
      }
    }
  }

  // Direct registrations on app: app.get('/api/docs.json', ...)
  const appMethodRe = new RegExp(`\\bapp\\.(${HTTP_METHODS.join('|')})\\s*\\(`);
  const indexRel = relToRoot(indexPath);
  for (const site of findCalls(tok, code, appMethodRe)) {
    const lit = firstArgLiteral(tok, site);
    if (!lit) continue;
    endpoints.push({ method: site.groups[0].toUpperCase(), path: lit.value, file: indexRel, line: site.line });
  }

  endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  unresolved.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  nonRouterMounts.sort((a, b) => a.mount.localeCompare(b.mount));
  return { endpoints, unresolved, nonRouterMounts };
}

// ---------------------------------------------------------------------------
// (b) Client API call sites
// ---------------------------------------------------------------------------

/** Normalize a literal value into an /api path, or null if it isn't one. */
export function apiPathFromValue(raw: string): string | null {
  let v = raw;
  // `${API_URL}/api/...` templates arrive as ':param/api/...'.
  if (v.startsWith(':param/api/') || v === ':param/api') v = v.slice(':param'.length);
  const q = v.search(/[?#]/);
  if (q !== -1) v = v.slice(0, q);
  // A trailing glued `${...}` (e.g. `/api/x${query}`) is almost always a
  // query-string builder — strip it. `${...}` as its own segment stays a
  // :param path segment.
  if (v.endsWith(':param') && !v.endsWith('/:param')) v = v.slice(0, -':param'.length);
  if (v !== '/api' && !v.startsWith('/api/')) return null;
  return v;
}

/** Files excluded from call scanning: the transport layer itself. */
const CALL_SCAN_EXCLUDE = new Set(['lib/api.ts']);

export function extractClientCalls(cfg: AuditConfig): { calls: ApiCall[]; unresolved: UnresolvedItem[] } {
  const srcDir = path.join(cfg.root, cfg.clientSrc);
  const calls: ApiCall[] = [];
  const unresolved: UnresolvedItem[] = [];

  for (const file of walkFiles(srcDir, ['.ts', '.tsx'])) {
    const rel = path.relative(srcDir, file).split(path.sep).join('/');
    if (isTestFile(rel) || CALL_SCAN_EXCLUDE.has(rel)) continue;
    const relRoot = path.relative(cfg.root, file).split(path.sep).join('/');
    const code = fs.readFileSync(file, 'utf8');
    const tok = tokenize(code);
    const claimed = new Set<number>(); // literal starts consumed by a call site

    for (const site of findCalls(tok, code, /\b(apiFetch|fetch)\s*\(/)) {
      const via = site.groups[0] as 'apiFetch' | 'fetch';
      const lit = firstArgLiteral(tok, site);
      if (!lit) {
        unresolved.push({
          file: relRoot,
          line: site.line,
          snippet: `${via}(${argSnippet(code, site)})`,
          reason: 'path argument is not a string/template literal',
        });
        continue;
      }
      claimed.add(lit.start);
      const apiPath = apiPathFromValue(lit.value);
      if (!apiPath) continue; // external URL (tiles, sms:) — not an API call
      // Method: explicit `method: 'X'` wins; a bare call or an inline
      // options object without one is a GET; a non-literal init object
      // leaves the method unknown.
      const slice = tok.blanked.slice(lit.end, site.close);
      let method: string | null = 'GET';
      const mm = slice.match(/\bmethod\s*:\s*['"]/);
      if (mm) {
        const quoteOffset = lit.end + mm.index! + mm[0].length - 1;
        method = tok.byStart.get(quoteOffset)?.value.toUpperCase() ?? null;
      } else {
        const secondArg = slice.match(/^\s*,\s*(\S)/);
        if (secondArg && secondArg[1] !== '{') method = null;
      }
      calls.push({ path: apiPath, method, file: relRoot, line: site.line, via });
    }

    // Fallback literal scan: '/api/...' strings not already claimed by a
    // call site (e.g. const MAP_PATH = '/api/map/...', url builders).
    for (const lit of tok.literals) {
      if (claimed.has(lit.start)) continue;
      const apiPath = apiPathFromValue(lit.value);
      if (!apiPath) continue;
      calls.push({ path: apiPath, method: null, file: relRoot, line: lit.line, via: 'literal' });
    }
  }

  calls.sort((a, b) => a.path.localeCompare(b.path) || a.file.localeCompare(b.file) || a.line - b.line);
  unresolved.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { calls, unresolved };
}

// ---------------------------------------------------------------------------
// (c) Client routes
// ---------------------------------------------------------------------------

export function extractClientRoutes(cfg: AuditConfig): RouteDecl[] {
  const appPath = path.join(cfg.root, cfg.appTsx);
  const code = fs.readFileSync(appPath, 'utf8');

  // Page-import map from App.tsx (default imports and named imports).
  const importFiles = new Map<string, string>();
  const importRe = /import\s+(?:\{\s*([\w\s,]+?)\s*\}|(\w+))\s+from\s+['"](\.[^'"]+)['"]/g;
  let im: RegExpExecArray | null;
  while ((im = importRe.exec(code)) !== null) {
    const names = im[1] ? im[1].split(',').map((s) => s.trim()) : [im[2]];
    const base = path.resolve(path.dirname(appPath), im[3]);
    for (const candidate of [base + '.tsx', base + '.ts', path.join(base, 'index.tsx'), path.join(base, 'index.ts')]) {
      if (fs.existsSync(candidate)) {
        const rel = path.relative(cfg.root, candidate).split(path.sep).join('/');
        for (const n of names) importFiles.set(n, rel);
        break;
      }
    }
  }

  const routes: RouteDecl[] = [];
  const routeRe = /<Route\s+path="([^"]+)"\s+element=\{(.*?)\}\s*\/>/gs;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(code)) !== null) {
    const element = m[2];
    const tags = [...element.matchAll(/<(\w+)/g)].map((t) => t[1]);
    const selfClosing = [...element.matchAll(/<(\w+)\s*\/>/g)].map((t) => t[1]);
    // The screen is the innermost self-closing component; everything
    // else in the element is a guard/wrapper.
    const screen = selfClosing[selfClosing.length - 1] ?? tags[tags.length - 1] ?? '<unknown>';
    routes.push({
      path: m[1],
      screen,
      screenFile: importFiles.get(screen) ?? null,
      guards: tags.filter((t) => t !== screen),
    });
  }
  routes.sort((a, b) => a.path.localeCompare(b.path));
  return routes;
}

// ---------------------------------------------------------------------------
// (d) Navigation edges
// ---------------------------------------------------------------------------

function normalizeNavTarget(raw: string): string {
  const q = raw.search(/[?#]/);
  return q === -1 ? raw : raw.slice(0, q);
}

export function extractNavEdges(cfg: AuditConfig): { edges: NavEdge[]; unresolved: UnresolvedItem[] } {
  const srcDir = path.join(cfg.root, cfg.clientSrc);
  const bottomNavAbs = path.join(cfg.root, cfg.bottomNav);
  const edges: NavEdge[] = [];
  const unresolved: UnresolvedItem[] = [];

  // BottomNav is data-driven (navigate(tab.path)); its targets are the
  // `path:` entries of the tab tables, extracted directly.
  if (fs.existsSync(bottomNavAbs)) {
    const navCode = fs.readFileSync(bottomNavAbs, 'utf8');
    const navRel = path.relative(cfg.root, bottomNavAbs).split(path.sep).join('/');
    const tabRe = /path:\s*'([^']+)'/g;
    let tm: RegExpExecArray | null;
    while ((tm = tabRe.exec(navCode)) !== null) {
      edges.push({ target: tm[1], file: navRel, line: lineAt(navCode, tm.index), kind: 'bottomnav' });
    }
  }

  const appAbs = path.join(cfg.root, cfg.appTsx);
  for (const file of walkFiles(srcDir, ['.ts', '.tsx'])) {
    if (file === bottomNavAbs) continue; // handled above
    const rel = path.relative(srcDir, file).split(path.sep).join('/');
    if (isTestFile(rel)) continue;
    const relRoot = path.relative(cfg.root, file).split(path.sep).join('/');
    const code = fs.readFileSync(file, 'utf8');
    const tok = tokenize(code);

    for (const site of findCalls(tok, code, /\bnavigate\s*\(/)) {
      const lit = firstArgLiteral(tok, site);
      if (lit) {
        edges.push({ target: normalizeNavTarget(lit.value), file: relRoot, line: site.line, kind: 'navigate' });
        continue;
      }
      const snippet = argSnippet(code, site);
      if (/^-?\d+/.test(snippet)) continue; // navigate(-1) — history, not a route target
      unresolved.push({
        file: relRoot,
        line: site.line,
        snippet: `navigate(${snippet})`,
        reason: 'navigate target is not a string/template literal',
      });
    }

    // <Link to=...> and <Navigate to=...>. The attribute may sit on a
    // later line; scan the tag chunk up to the closing '>'.
    const jsxRe = /<(Link|Navigate)\b/g;
    let jm: RegExpExecArray | null;
    while ((jm = jsxRe.exec(tok.blanked)) !== null) {
      const chunkEnd = tok.blanked.indexOf('>', jm.index);
      const chunk = tok.blanked.slice(jm.index, chunkEnd === -1 ? undefined : chunkEnd);
      const line = lineAt(code, jm.index);
      const kind = file === appAbs && jm[1] === 'Navigate' ? 'redirect' : 'link';
      const toMatch = chunk.match(/\bto=\{?\s*(['"`])/);
      if (toMatch) {
        const quoteOffset = jm.index + toMatch.index! + toMatch[0].length - 1;
        const lit = tok.byStart.get(quoteOffset);
        if (lit) {
          edges.push({ target: normalizeNavTarget(lit.value), file: relRoot, line, kind });
          continue;
        }
      }
      if (/\bto=/.test(chunk)) {
        unresolved.push({
          file: relRoot,
          line,
          snippet: code.slice(jm.index, jm.index + 80).replace(/\s+/g, ' ').trim(),
          reason: `${jm[1]} target is not a string/template literal`,
        });
      }
      // A <Link>/<Navigate> whose `to=` fell past the chunk (e.g. after an
      // arrow function's '>') is also surfaced rather than dropped.
      else {
        unresolved.push({
          file: relRoot,
          line,
          snippet: code.slice(jm.index, jm.index + 80).replace(/\s+/g, ' ').trim(),
          reason: `${jm[1]} without a resolvable to= in the scanned tag chunk`,
        });
      }
    }
  }

  edges.sort((a, b) => a.target.localeCompare(b.target) || a.file.localeCompare(b.file) || a.line - b.line);
  unresolved.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { edges, unresolved };
}

// ---------------------------------------------------------------------------
// Import graph (client) — for navigation reachability
// ---------------------------------------------------------------------------

export function buildImportClosure(cfg: AuditConfig): Map<string, Set<string>> {
  const srcDir = path.join(cfg.root, cfg.clientSrc);
  const files = walkFiles(srcDir, ['.ts', '.tsx']).filter((f) => {
    const rel = path.relative(srcDir, f).split(path.sep).join('/');
    return !isTestFile(rel);
  });
  const fileSet = new Set(files);
  const direct = new Map<string, string[]>();

  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    const deps: string[] = [];
    const re = /(?:from|import\()\s*['"](\.[^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const base = path.resolve(path.dirname(file), m[1]);
      for (const candidate of [base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
        if (fileSet.has(candidate)) {
          deps.push(candidate);
          break;
        }
      }
    }
    direct.set(file, deps);
  }

  // Transitive closure per file (memoized DFS with cycle tolerance).
  const closures = new Map<string, Set<string>>();
  const rel = (f: string) => path.relative(cfg.root, f).split(path.sep).join('/');
  for (const file of files) {
    const seen = new Set<string>();
    const stack = [file];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const d of direct.get(cur) ?? []) stack.push(d);
    }
    closures.set(rel(file), new Set([...seen].map(rel)));
  }
  return closures;
}

// ---------------------------------------------------------------------------
// Matching + reachability
// ---------------------------------------------------------------------------

function segMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a === '*' || b === '*') return true;
  if (a.startsWith(':') || b.startsWith(':')) return true;
  // A segment with an embedded dynamic part ('conflicts:param') matches
  // when its literal prefix matches the other side's prefix.
  const dynA = a.indexOf(':param');
  if (dynA !== -1) return b.startsWith(a.slice(0, dynA));
  const dynB = b.indexOf(':param');
  if (dynB !== -1) return a.startsWith(b.slice(0, dynB));
  return false;
}

/** Segment-wise match where a param on either side matches anything. */
export function pathsMatch(a: string, b: string): boolean {
  const as = a.split('/').filter((s) => s !== '');
  const bs = b.split('/').filter((s) => s !== '');
  if (as.length !== bs.length) return false;
  for (let i = 0; i < as.length; i += 1) {
    if (!segMatch(as[i], bs[i])) return false;
  }
  return true;
}

/**
 * The route a navigation target actually lands on.
 *
 * React Router ranks a literal segment above a dynamic one, so a link
 * to `/admin/conflicts/audit` lands on the literal route even when the
 * sibling `/admin/conflicts/:type` was declared first. This used to
 * take the first DECLARED match, which credited the literal screen's
 * only inbound link to its param sibling and then reported the literal
 * screen as unreachable — a screen an admin can in fact tap through to.
 *
 * The score is the number of segments the route matches EXACTLY, which
 * keeps the rule honest in both directions: a literal target prefers
 * the literal route, and a target the extractor could only normalize to
 * `:param` scores the same against both siblings and falls back to
 * declaration order rather than pretending to know which one a runtime
 * value would hit.
 */
export function bestRouteMatch<T extends { path: string }>(
  routes: readonly T[],
  target: string,
): T | undefined {
  const targetSegs = target.split('/').filter((s) => s !== '');
  let best: T | undefined;
  let bestScore = -1;
  for (const r of routes) {
    if (r.path === '*' || !pathsMatch(r.path, target)) continue;
    const segs = r.path.split('/').filter((s) => s !== '');
    const score = segs.filter((s, i) => s === targetSegs[i]).length;
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

function methodCompatible(endpoint: string, call: string | null): boolean {
  if (call === null) return true;
  if (endpoint === 'ALL') return true;
  return endpoint === call;
}

export function analyze(
  endpoints: Endpoint[],
  calls: ApiCall[],
  routes: RouteDecl[],
  navEdges: NavEdge[],
  closures: Map<string, Set<string>>,
  cfg: AuditConfig,
): WiringMap['analysis'] {
  // "Live" client code = the bundler entry's transitive import closure
  // (fall back to App.tsx when the entry isn't in the graph). A call
  // site in a file nothing imports is not wiring — it is dead code that
  // happens to mention a path.
  const liveFiles = closures.get(cfg.clientEntry) ?? closures.get(cfg.appTsx) ?? new Set<string>();
  const annotatedCalls = calls.map((c) => ({ ...c, deadFile: !liveFiles.has(c.file) }));

  const endpointStatus: EndpointStatus[] = endpoints.map((e) => {
    const callers = annotatedCalls
      .filter((c) => pathsMatch(e.path, c.path) && methodCompatible(e.method, c.method))
      .map((c) => ({ file: c.file, line: c.line, via: c.via, deadFile: c.deadFile }));
    const liveCallers = callers.filter((c) => !c.deadFile);
    const status =
      liveCallers.length > 0 ? 'called' : callers.length > 0 ? 'called-from-dead-code-only' : 'orphan-candidate';
    return { ...e, callers, status };
  });

  const unmatchedCalls = annotatedCalls.filter(
    (c) => !endpoints.some((e) => pathsMatch(e.path, c.path) && methodCompatible(e.method, c.method)),
  );

  const deadClientFiles = [...closures.keys()].filter((f) => !liveFiles.has(f)).sort();

  const routeExists = (target: string) => bestRouteMatch(routes, target) !== undefined;
  const unmatchedNavTargets = navEdges.filter(
    (e) => (e.kind === 'navigate' || e.kind === 'link') && !routeExists(e.target),
  );

  // Reachability. Seeds: the boot-time entries ('/', '/login',
  // '/welcome'), every guard redirect declared in App.tsx, and every
  // BottomNav tab (the shell nav is present on every AppShell screen).
  const reached = new Map<string, string[]>();
  const routeFor = (target: string): RouteDecl | undefined => bestRouteMatch(routes, target);

  const seedTargets: Array<{ target: string; label: string }> = [
    { target: '/', label: 'seed:boot:/' },
    { target: '/login', label: 'seed:boot:/login' },
    { target: '/welcome', label: 'seed:boot:/welcome' },
    ...navEdges
      .filter((e) => e.kind === 'redirect' || e.kind === 'bottomnav')
      .map((e) => ({ target: e.target, label: `seed:${e.kind}:${e.target}` })),
  ];
  const queue: RouteDecl[] = [];
  for (const s of seedTargets) {
    const r = routeFor(s.target);
    if (!r) continue;
    if (!reached.has(r.path)) {
      reached.set(r.path, []);
      queue.push(r);
    }
    reached.get(r.path)!.push(s.label);
  }

  // Edges leave from a screen's page file or anything it transitively
  // imports (shared components, hooks).
  const screenEdges = new Map<string, NavEdge[]>();
  for (const r of routes) {
    if (!r.screenFile) continue;
    const closure = closures.get(r.screenFile);
    if (!closure) continue;
    screenEdges.set(
      r.path,
      navEdges.filter((e) => (e.kind === 'navigate' || e.kind === 'link') && closure.has(e.file)),
    );
  }

  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of screenEdges.get(cur.path) ?? []) {
      const r = routeFor(e.target);
      if (!r) continue;
      if (!reached.has(r.path)) {
        reached.set(r.path, []);
        queue.push(r);
      }
      const label = `screen:${cur.path}`;
      const labels = reached.get(r.path)!;
      if (!labels.includes(label)) labels.push(label);
    }
  }

  const routeStatus: RouteStatus[] = routes.map((r) => ({
    ...r,
    reachable: r.path === '*' || reached.has(r.path),
    reachedFrom: (reached.get(r.path) ?? []).slice().sort(),
  }));

  return { endpointStatus, routeStatus, unmatchedCalls, deadClientFiles, unmatchedNavTargets };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export function buildWiringMap(cfg: AuditConfig): WiringMap {
  const server = extractServerEndpoints(cfg);
  const client = extractClientCalls(cfg);
  const routes = extractClientRoutes(cfg);
  const nav = extractNavEdges(cfg);
  const closures = buildImportClosure(cfg);
  return {
    endpoints: server.endpoints,
    unresolvedEndpoints: server.unresolved,
    nonRouterMounts: server.nonRouterMounts,
    calls: client.calls,
    unresolvedCalls: client.unresolved,
    routes,
    navEdges: nav.edges,
    unresolvedNav: nav.unresolved,
    analysis: analyze(server.endpoints, client.calls, routes, nav.edges, closures, cfg),
  };
}

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------

export function buildMarkdown(map: WiringMap): string {
  const lines: string[] = [];
  const orphans = map.analysis.endpointStatus.filter((e) => e.status !== 'called');
  const unreachable = map.analysis.routeStatus.filter((r) => !r.reachable);

  lines.push('# Wiring map (generated)');
  lines.push('');
  lines.push('> Generated by `pnpm wiring:map` (scripts/wiring-audit). Do not edit by');
  lines.push('> hand — regenerate instead. Verdicts with evidence live in');
  lines.push('> `docs/wiring-report.md`; this file is the raw extraction.');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Layer | Count |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Server endpoints | ${map.endpoints.length} |`);
  lines.push(`| Client API call sites | ${map.calls.length} |`);
  lines.push(`| Client routes | ${map.routes.length} |`);
  lines.push(`| Navigation edges | ${map.navEdges.length} |`);
  lines.push(`| Endpoint orphan candidates | ${orphans.length} |`);
  lines.push(`| Unreachable route candidates | ${unreachable.length} |`);
  lines.push(`| UNRESOLVED (endpoints / calls / nav) | ${map.unresolvedEndpoints.length} / ${map.unresolvedCalls.length} / ${map.unresolvedNav.length} |`);
  lines.push('');

  lines.push('## Endpoint orphan candidates (no statically-visible live client caller)');
  lines.push('');
  if (orphans.length === 0) lines.push('None.');
  for (const e of orphans) {
    const note = e.status === 'called-from-dead-code-only' ? ' — called only from dead code' : '';
    lines.push(`- \`${e.method} ${e.path}\` — ${e.file}:${e.line}${note}`);
  }
  lines.push('');

  lines.push('## Unreachable route candidates (no navigation path found)');
  lines.push('');
  if (unreachable.length === 0) lines.push('None.');
  for (const r of unreachable) lines.push(`- \`${r.path}\` → ${r.screen} (${r.screenFile ?? 'unresolved file'})`);
  lines.push('');

  lines.push('## UNRESOLVED — the extractor does not guess');
  lines.push('');
  const bucket = (title: string, items: UnresolvedItem[]) => {
    lines.push(`### ${title}`);
    lines.push('');
    if (items.length === 0) lines.push('None.');
    for (const u of items) lines.push(`- ${u.file}:${u.line} — ${u.reason}: \`${u.snippet}\``);
    lines.push('');
  };
  bucket('Server endpoints', map.unresolvedEndpoints);
  bucket('Client calls', map.unresolvedCalls);
  bucket('Navigation targets', map.unresolvedNav);

  lines.push('## Client calls matching no endpoint (broken wires)');
  lines.push('');
  if (map.analysis.unmatchedCalls.length === 0) lines.push('None.');
  for (const c of map.analysis.unmatchedCalls) {
    const dead = c.deadFile ? ' [in dead code]' : '';
    lines.push(`- \`${c.method ?? '?'} ${c.path}\` — ${c.file}:${c.line} (${c.via})${dead}`);
  }
  lines.push('');

  lines.push('## Navigation targets matching no route (land on 404)');
  lines.push('');
  if (map.analysis.unmatchedNavTargets.length === 0) lines.push('None.');
  for (const e of map.analysis.unmatchedNavTargets) {
    lines.push(`- \`${e.target}\` — ${e.file}:${e.line} (${e.kind})`);
  }
  lines.push('');

  lines.push('## Dead client files (nothing imports them from the entry)');
  lines.push('');
  if (map.analysis.deadClientFiles.length === 0) lines.push('None.');
  for (const f of map.analysis.deadClientFiles) lines.push(`- ${f}`);
  lines.push('');

  lines.push('## All endpoints');
  lines.push('');
  lines.push('| Method | Path | Callers | Status |');
  lines.push('| --- | --- | --- | --- |');
  for (const e of map.analysis.endpointStatus) {
    lines.push(`| ${e.method} | \`${e.path}\` | ${e.callers.length} | ${e.status} |`);
  }
  lines.push('');

  lines.push('## All routes');
  lines.push('');
  lines.push('| Path | Screen | Reachable | Reached from |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of map.analysis.routeStatus) {
    lines.push(`| \`${r.path}\` | ${r.screen} | ${r.reachable ? 'yes' : 'NO'} | ${r.reachedFrom.join(', ') || '—'} |`);
  }
  lines.push('');

  lines.push('## Non-router mounts (informational)');
  lines.push('');
  for (const m of map.nonRouterMounts) lines.push(`- \`${m.mount}\` → ${m.handler}`);
  lines.push('');
  return lines.join('\n');
}
