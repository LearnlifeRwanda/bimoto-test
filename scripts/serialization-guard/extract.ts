// CUTGUARD v2 G1 — the serialization walker.
//
// Sibling of scripts/route-guard/extract.ts, and built the same way: the
// TypeScript AST, not a regex, and an oracle whose boundary is stated
// rather than implied.
//
// WHAT IT LOOKS FOR. A "raw row" is a value bound in a function to a
// Prisma model call — `prisma.user.findUnique(...)`,
// `tx.escrow.create(...)`, and so on. The two rules in check.ts ask where
// such a value goes:
//
//   S1 — does it reach a response body (`res.json` / `res.send`) in a
//        routes file, directly or through a spread or a property?
//   S2 — is it RETURNED from an exported function in a services file?
//        (Scoped to the `user` model — see check.ts for why.)
//
// WHAT MAKES A VALUE SAFE. Two things, both of them positive acts:
//
//   - a `select:` on the Prisma call. A select IS an explicit positive
//     projection: the columns are written down at the call site, so a
//     column added to the model tomorrow does not join the payload.
//     `include:` is NOT this — it widens.
//   - passing through a serializer named in allowlist.json.
//
// THE ORACLE'S BOUNDARY, stated plainly because the alternative is
// claiming coverage this does not have:
//
//   1. Data flow is tracked WITHIN one function body. A row handed to a
//      local helper, or assigned into an object that is then passed
//      somewhere else and spread there, is not followed.
//   2. A row that crosses a module boundary is seen only where S2 sees
//      it — an exported service function returning a `user` row. A row
//      returned from a NON-exported helper, or from a service on a model
//      other than `user`, is invisible to this walker.
//   3. `res.json(await someService.thing())` is not resolved: the walker
//      does not know what `thing` returns. S2 is the answer to that for
//      the model it covers, and nothing else covers the rest.
//
// Those three are why check.ts is an allowlist, not a proof — the same
// reason route-guard's is. The residual is written up in
// docs/serialization-boundary.md and pinned with response-shape tests.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

/** Prisma client methods that yield model rows. */
export const PRISMA_READ_WRITE = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
]);

/** Identifiers that stand for a Prisma client (the module default, or a `$transaction` handle). */
export const PRISMA_ROOTS = new Set(['prisma', 'tx', 'db', 'client']);

export interface RawRowBinding {
  /** The local name the row is bound to. */
  name: string;
  /** Prisma model, e.g. `user`. */
  model: string;
  /** Prisma method, e.g. `findUnique`. */
  method: string;
  /** True when the call carried a `select:` — an explicit positive projection. */
  hasSelect: boolean;
  line: number;
}

export interface Emission {
  /** `res.json` | `res.send` | `return` */
  kind: 'res.json' | 'res.send' | 'return';
  /** Names of raw-row bindings this emission carries. */
  carries: string[];
  /** How each name is carried: direct | spread | property. */
  how: Record<string, 'direct' | 'spread' | 'property'>;
  line: number;
}

export interface FunctionRecord {
  /** Repo-relative file. */
  file: string;
  line: number;
  /** Best-effort name: the exported function, the route path, or `<anonymous>`. */
  name: string;
  /** True when this is an exported top-level function declaration. */
  exported: boolean;
  /** True when the enclosing file is a `*.routes.ts`. */
  isRoute: boolean;
  bindings: RawRowBinding[];
  emissions: Emission[];
  /** Local names that were produced by a call to an allowlisted serializer. */
  serialized: string[];
}

export interface SerializationMap {
  functions: FunctionRecord[];
  files: string[];
}

export interface ExtractConfig {
  /** Repo root. */
  root: string;
  /** Directories to walk, repo-relative. */
  dirs: string[];
  /** Serializer function names that launder a raw row. */
  serializers: string[];
}

export const DEFAULT_CONFIG: Omit<ExtractConfig, 'root'> = {
  dirs: ['packages/server/src/routes', 'packages/server/src/services'],
  serializers: [],
};

function isPrismaRoot(expr: ts.Expression): boolean {
  return ts.isIdentifier(expr) && PRISMA_ROOTS.has(expr.text);
}

/**
 * `prisma.user.findUnique(...)` → `{ model: 'user', method: 'findUnique' }`.
 * Anything else → null.
 */
export function prismaCallOf(
  node: ts.Node,
): { model: string; method: string; hasSelect: boolean } | null {
  let call: ts.CallExpression | null = null;
  if (ts.isCallExpression(node)) call = node;
  else if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression)) {
    call = node.expression;
  }
  if (!call) return null;

  const method = call.expression;
  if (!ts.isPropertyAccessExpression(method)) return null;
  const methodName = method.name.text;
  if (!PRISMA_READ_WRITE.has(methodName)) return null;

  const modelAccess = method.expression;
  if (!ts.isPropertyAccessExpression(modelAccess)) return null;
  if (!isPrismaRoot(modelAccess.expression)) return null;

  const model = modelAccess.name.text;

  // A `select:` anywhere in the top-level argument object counts. Nested
  // selects inside an `include:` do not launder the parent row, so only
  // the top level is read.
  let hasSelect = false;
  const arg = call.arguments[0];
  if (arg && ts.isObjectLiteralExpression(arg)) {
    hasSelect = arg.properties.some(
      (prop) =>
        (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) &&
        prop.name !== undefined &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === 'select',
    );
  }
  return { model, method: methodName, hasSelect };
}

/** The identifier names referenced at the top level of an emitted expression. */
function carriersOf(
  expr: ts.Expression,
): Array<{ name: string; how: 'direct' | 'spread' | 'property' }> {
  const out: Array<{ name: string; how: 'direct' | 'spread' | 'property' }> = [];

  const unwrap = (e: ts.Expression): ts.Expression =>
    ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e)
      ? unwrap(e.expression as ts.Expression)
      : e;

  const target = unwrap(expr);

  if (ts.isIdentifier(target)) {
    out.push({ name: target.text, how: 'direct' });
    return out;
  }

  if (ts.isObjectLiteralExpression(target)) {
    for (const prop of target.properties) {
      if (ts.isSpreadAssignment(prop)) {
        const inner = unwrap(prop.expression);
        if (ts.isIdentifier(inner)) out.push({ name: inner.text, how: 'spread' });
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        out.push({ name: prop.name.text, how: 'property' });
      } else if (ts.isPropertyAssignment(prop)) {
        const inner = unwrap(prop.initializer as ts.Expression);
        if (ts.isIdentifier(inner)) out.push({ name: inner.text, how: 'property' });
      }
    }
    return out;
  }

  // `res.json(rows.map(...))` and friends: read the receiver, so a raw
  // array that is merely reshaped inline is still seen.
  if (ts.isCallExpression(target) && ts.isPropertyAccessExpression(target.expression)) {
    const recv = unwrap(target.expression.expression);
    if (ts.isIdentifier(recv)) out.push({ name: recv.text, how: 'direct' });
  }

  return out;
}

/** Name of the call's callee, for serializer detection: `toClientUser(x)` → `toClientUser`. */
function calleeName(node: ts.Node): string | null {
  const unwrap = (e: ts.Node): ts.Node =>
    ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e) ? unwrap(e.expression) : e;
  const target = unwrap(node);
  if (!ts.isCallExpression(target)) return null;
  if (ts.isIdentifier(target.expression)) return target.expression.text;
  if (ts.isPropertyAccessExpression(target.expression)) return target.expression.name.text;
  return null;
}

function isExportedFunction(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return (mods ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * A function-ish node's display name. For a route handler the enclosing
 * `router.post('/x', …)` path is far more useful than `<anonymous>`.
 */
function displayName(node: ts.Node, sf: ts.SourceFile): string {
  if (
    (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
    node.name &&
    ts.isIdentifier(node.name)
  ) {
    return node.name.text;
  }
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  // Route handler: walk up to the router call and read its path literal.
  let cur: ts.Node | undefined = node;
  while (cur) {
    if (
      ts.isCallExpression(cur) &&
      ts.isPropertyAccessExpression(cur.expression) &&
      ts.isIdentifier(cur.expression.expression) &&
      cur.expression.expression.text === 'router'
    ) {
      const method = cur.expression.name.text.toUpperCase();
      const first = cur.arguments[0];
      const p = first && ts.isStringLiteralLike(first) ? first.text : '?';
      return `${method} ${p}`;
    }
    cur = cur.parent;
  }
  void sf;
  return '<anonymous>';
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

export function extractFile(
  absPath: string,
  repoRelative: string,
  serializers: Set<string>,
): FunctionRecord[] {
  const text = fs.readFileSync(absPath, 'utf8');
  const sf = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const isRoute = /\.routes\.ts$/.test(repoRelative);
  const records: FunctionRecord[] = [];

  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  function analyseFunction(fn: ts.FunctionLikeDeclaration, exported: boolean): FunctionRecord {
    const bindings: RawRowBinding[] = [];
    const emissions: Emission[] = [];
    const serialized: string[] = [];

    function walkBody(node: ts.Node): void {
      // Do not descend into nested functions — each gets its own record,
      // so a callback's bindings are not attributed to its parent.
      if (node !== fn && isFunctionLike(node)) return;

      if (ts.isVariableDeclaration(node) && node.initializer) {
        const prismaCall = prismaCallOf(node.initializer);
        if (prismaCall && ts.isIdentifier(node.name)) {
          bindings.push({
            name: node.name.text,
            model: prismaCall.model,
            method: prismaCall.method,
            hasSelect: prismaCall.hasSelect,
            line: lineOf(node),
          });
        } else if (prismaCall && ts.isObjectBindingPattern(node.name)) {
          // `const { a, b } = await prisma.x.findFirst()` — each name is
          // a piece of the row, and a piece is not a projection.
          for (const el of node.name.elements) {
            if (ts.isIdentifier(el.name)) {
              bindings.push({
                name: el.name.text,
                model: prismaCall.model,
                method: prismaCall.method,
                hasSelect: prismaCall.hasSelect,
                line: lineOf(node),
              });
            }
          }
        }
        const callee = calleeName(node.initializer);
        if (callee && serializers.has(callee) && ts.isIdentifier(node.name)) {
          serialized.push(node.name.text);
        }
      }

      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const recv = node.expression.expression;
        const name = node.expression.name.text;
        if (ts.isIdentifier(recv) && recv.text === 'res' && (name === 'json' || name === 'send')) {
          const arg = node.arguments[0];
          if (arg) {
            const carried = carriersOf(arg);
            const how: Emission['how'] = {};
            for (const c of carried) how[c.name] = c.how;
            emissions.push({
              kind: name === 'json' ? 'res.json' : 'res.send',
              carries: carried.map((c) => c.name),
              how,
              line: lineOf(node),
            });
          }
        }
      }

      if (ts.isReturnStatement(node) && node.expression) {
        const carried = carriersOf(node.expression);
        const how: Emission['how'] = {};
        for (const c of carried) how[c.name] = c.how;
        emissions.push({
          kind: 'return',
          carries: carried.map((c) => c.name),
          how,
          line: lineOf(node),
        });
      }

      ts.forEachChild(node, walkBody);
    }

    walkBody(fn);

    return {
      file: repoRelative,
      line: lineOf(fn),
      name: displayName(fn, sf),
      exported,
      isRoute,
      bindings,
      emissions,
      serialized,
    };
  }

  function walkTop(node: ts.Node): void {
    if (isFunctionLike(node)) {
      let exported = isExportedFunction(node);
      // `export const f = async () => {}` — the modifier is on the statement.
      if (!exported && node.parent && ts.isVariableDeclaration(node.parent)) {
        const stmt = node.parent.parent?.parent;
        if (stmt && ts.isVariableStatement(stmt)) exported = isExportedFunction(stmt);
      }
      records.push(analyseFunction(node, exported));
    }
    ts.forEachChild(node, walkTop);
  }

  walkTop(sf);
  return records;
}

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...listTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out.sort();
}

export function buildSerializationMap(config: ExtractConfig): SerializationMap {
  const serializers = new Set(config.serializers);
  const functions: FunctionRecord[] = [];
  const files: string[] = [];

  for (const dir of config.dirs) {
    for (const abs of listTsFiles(path.join(config.root, dir))) {
      const rel = path.relative(config.root, abs).split(path.sep).join('/');
      files.push(rel);
      functions.push(...extractFile(abs, rel, serializers));
    }
  }

  return { functions, files };
}
