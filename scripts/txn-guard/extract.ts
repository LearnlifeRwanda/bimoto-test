// MONEY-ATOMIC G5 — the transaction-boundary walker, made permanent.
//
// The AUDIT-BATTERY §D transaction-boundary census was a throwaway audit
// script: an AST oracle over every non-test file in packages/server/src,
// looking for functions that write to more than one model without a
// transaction around them. It found six genuine atomicity defects — the
// six this dispatch fixes. This is that walker kept as CI, so the seventh
// is caught when it is written rather than when a driver goes unpaid.
//
// The rule, in one line: a function that writes to TWO OR MORE DISTINCT
// models through the shared prisma client, outside any $transaction, is a
// finding.
//
// Three things it does NOT flag, because they are not the defect:
//
//  - writes through a `tx` (or `db`, or `client`) the function received as
//    a PARAMETER. Those are the *Tx variants — releaseEscrowTx and its
//    siblings — whose transaction belongs to their caller. §D's census
//    called the `db`-named tx parameter its most common lexical false
//    positive; here it is handled by the walker rather than by a human.
//  - writes lexically inside a `$transaction(...)` callback, at any depth.
//  - a single model written repeatedly. One model is one row lock away
//    from safe, and §D scoped itself to cross-model boundaries.
//
// The oracle's boundary, stated honestly: it reads syntax, not runtime.
// It cannot tell whether two writes it sees in one function body are
// reachable together (the if/else arms, the try/catch arms), whether a
// second write is idempotent, or whether a failure between them is
// harmless. That is exactly why check.ts is an allowlist and not a proof:
// every finding is either fixed or attested by a human with the class
// letter §D used and a reason.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

/** Prisma delegate methods that write. */
export const WRITE_METHODS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

export interface WriteRecord {
  /** Prisma model the write targets, e.g. `journey`. */
  model: string;
  /** Delegate method, e.g. `update`. */
  method: string;
  line: number;
}

export interface FunctionRecord {
  /** Repo-relative path of the file. */
  file: string;
  /** Declared name, or `<anonymous>@line` for an unnamed callback. */
  name: string;
  line: number;
  /** Unbatched writes, in source order. */
  writes: WriteRecord[];
  /** Distinct models among `writes`, sorted. */
  models: string[];
  /**
   * Writes this function makes INSIDE a transaction. Not a finding — kept
   * so check.ts can tell a function that was batched from one that was
   * deleted when it reports a stale allowlist entry.
   */
  batched: number;
}

export interface TxnMap {
  /** Every function that writes through prisma at all. */
  functions: FunctionRecord[];
  /** Files parsed, repo-relative. */
  files: string[];
}

export interface ExtractConfig {
  root: string;
  /** Repo-relative directory to walk. */
  srcDir: string;
}

export const DEFAULT_CONFIG: Omit<ExtractConfig, 'root'> = {
  srcDir: path.join('packages', 'server', 'src'),
};

export function functionKey(f: FunctionRecord): string {
  return `${f.name} in ${f.file}`;
}

/** Root identifier of `a.b.c()` → `a`. */
function rootIdentifier(expr: ts.Expression): ts.Identifier | null {
  let cur: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(cur) || ts.isNonNullExpression(cur)) {
    cur = cur.expression;
  }
  return ts.isIdentifier(cur) ? cur : null;
}

/** The name a `import prisma from '...'` binds, if the file has one. */
function prismaBindings(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const spec = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(spec) || !/(^|\/)prisma$/.test(spec.text)) continue;
    const clause = stmt.importClause;
    if (clause.name) names.add(clause.name.text);
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) names.add(el.name.text);
    }
  }
  return names;
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** `$transaction(...)`, on any receiver. */
function isTransactionCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return ts.isPropertyAccessExpression(callee) && callee.name.text === '$transaction';
}

/**
 * The name a function-like is known by: its own name, the variable it is
 * assigned to, or the property it is defined under.
 */
function nameOf(sf: ts.SourceFile, fn: ts.FunctionLikeDeclaration): string | null {
  if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name) return fn.name.text;
  if (ts.isMethodDeclaration(fn) && ts.isIdentifier(fn.name)) return fn.name.text;
  const parent = fn.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  // A route handler: `router.post('/:id/emergency', …, async (req, res) => …)`.
  // Named by its route rather than by its line, so an allowlist entry
  // survives edits above it — and so a reader knows what it is.
  if (parent && ts.isCallExpression(parent)) {
    const callee = parent.expression;
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === 'router'
    ) {
      const first = parent.arguments[0];
      if (first && ts.isStringLiteral(first)) {
        return `${callee.name.text.toUpperCase()} ${first.text}`;
      }
    }
  }
  return null;
}

export function extractFromSource(rel: string, code: string): FunctionRecord[] {
  const sf = ts.createSourceFile(rel, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const prismaNames = prismaBindings(sf);
  if (prismaNames.size === 0) return [];

  const lineOf = (node: ts.Node) =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const records: FunctionRecord[] = [];

  /**
   * @param owner    the named function writes are attributed to; null at
   *                 module top level.
   * @param inTx     true inside a $transaction callback.
   * @param params   parameter names of every enclosing function — a write
   *                 through one of them is the caller's transaction.
   */
  const walk = (
    node: ts.Node,
    owner: FunctionRecord | null,
    inTx: boolean,
    params: Set<string>,
  ): void => {
    if (isTransactionCall(node)) {
      // The callee expression itself is still ordinary code; only the
      // arguments (the callback) are inside the transaction.
      const call = node as ts.CallExpression;
      walk(call.expression, owner, inTx, params);
      for (const arg of call.arguments) walk(arg, owner, true, params);
      return;
    }

    if (isFunctionLike(node)) {
      const nextParams = new Set(params);
      for (const p of node.parameters) {
        if (ts.isIdentifier(p.name)) nextParams.add(p.name.text);
      }
      const declared = nameOf(sf, node);
      // An inline callback (`.map(x => …)`, a route handler) is not its
      // own unit of work: its writes belong to the function that contains
      // it. Only a declared function opens a new attribution scope.
      let nextOwner = owner;
      if (declared !== null || owner === null) {
        nextOwner = {
          file: rel,
          name: declared ?? `<anonymous>@${lineOf(node)}`,
          line: lineOf(node),
          writes: [],
          models: [],
          batched: 0,
        };
        records.push(nextOwner);
      }
      for (const child of node.getChildren(sf)) walk(child, nextOwner, inTx, nextParams);
      return;
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const access = node.expression;
      const method = access.name.text;
      if (
        WRITE_METHODS.has(method) &&
        ts.isPropertyAccessExpression(access.expression) &&
        owner !== null
      ) {
        const model = access.expression.name.text;
        const root = rootIdentifier(access.expression);
        if (root && params.has(root.text)) {
          // Through a `tx` / `db` / `client` the function received as a
          // parameter: the transaction is the caller's. §D's most common
          // lexical false positive, handled here rather than by a human.
          owner.batched += 1;
        } else if (root && prismaNames.has(root.text)) {
          // Through the shared client. Inside a $transaction callback it
          // is batched; outside one it is what this guard is looking for.
          if (inTx) owner.batched += 1;
          else owner.writes.push({ model, method, line: lineOf(node) });
        }
      }
    }

    for (const child of node.getChildren(sf)) walk(child, owner, inTx, params);
  };

  for (const stmt of sf.statements) walk(stmt, null, false, new Set());

  for (const r of records) {
    r.models = [...new Set(r.writes.map((w) => w.model))].sort();
  }
  return records.filter((r) => r.writes.length > 0 || r.batched > 0);
}

function listTsFiles(dir: string, rootLen: number, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      listTsFiles(full, rootLen, out);
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
    if (entry.name.endsWith('.d.ts')) continue;
    out.push(full.slice(rootLen + 1).split(path.sep).join('/'));
  }
}

export function buildTxnMap(cfg: ExtractConfig): TxnMap {
  const files: string[] = [];
  listTsFiles(path.join(cfg.root, cfg.srcDir), cfg.root.length, files);

  const functions: FunctionRecord[] = [];
  for (const rel of files) {
    functions.push(...extractFromSource(rel, fs.readFileSync(path.join(cfg.root, rel), 'utf8')));
  }
  return { functions, files };
}
