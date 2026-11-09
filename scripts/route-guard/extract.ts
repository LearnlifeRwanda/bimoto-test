// AUTH-READ G4 — the route-security walker, made permanent.
//
// The AUDIT-BATTERY §G walker was a throwaway audit script. This is its
// first rule kept as CI. It reads every `*.routes.ts` file with the
// TypeScript AST (not a regex, and not a hand-rolled tokenizer) and
// records, for each route, what its HANDLER does about the caller's
// identity.
//
// The oracle's boundary, stated honestly and carried over from §G: it
// sees handler bodies, NOT service internals. It can see that a handler
// passes `req.user.userId` into `messageService.getMessages`; it cannot
// see whether that function then checks anything. That boundary is why
// check.ts is an allowlist rather than a proof — a delegated check is a
// human attestation, recorded with the service function that carries it.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all'] as const;

/** Methods that only read. Rule 1 is about these. */
export const READ_METHODS = new Set(['GET']);

/** Methods that change state — the siblings a read is measured against. */
export const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * How a handler treats the caller's identity.
 *
 *  - `inline`    — the handler itself compares the caller against an
 *                  owner field and denies. Machine-verifiable here.
 *  - `delegated` — the handler passes the caller's id into a call and
 *                  trusts it. NOT verifiable here; needs an allowlist
 *                  entry naming the function that carries the check.
 *  - `none`      — the handler never mentions `req.user` at all. It
 *                  cannot be scoping by caller, whatever its services do,
 *                  because it never tells them who is asking.
 */
export type OwnershipPosture = 'inline' | 'delegated' | 'none';

export interface RouteRecord {
  /** Repo-relative path of the routes file. */
  file: string;
  line: number;
  /** Upper-case HTTP method. */
  method: string;
  /** Router-relative path literal, e.g. `/:id/messages`. */
  path: string;
  /** Named middleware on the route call, in order. */
  middleware: string[];
  /** Middleware applied to the whole router via `router.use(x)`. */
  routerMiddleware: string[];
  posture: OwnershipPosture;
  /** For `delegated`: the callee expressions the caller id was passed to. */
  delegatesTo: string[];
  /** True when the handler mentions `req.user` in any form. */
  usesCaller: boolean;
}

export interface RouteMap {
  routes: RouteRecord[];
  /** Files parsed, repo-relative. */
  files: string[];
  /** Route declarations the walker could not read (path not a literal). */
  skipped: { file: string; line: number; reason: string }[];
}

/** Property names that denote "who owns this row". */
const OWNER_FIELD = /^(id|.*Id)$/;

function isReqUserText(text: string): boolean {
  return /\breq\s*\.\s*user\b/.test(text);
}

/** `router.get` / `router.post` / … → 'GET' | 'POST' | … */
function routerMethodOf(expr: ts.Expression): string | null {
  if (!ts.isPropertyAccessExpression(expr)) return null;
  if (!ts.isIdentifier(expr.expression) || expr.expression.text !== 'router') return null;
  const name = expr.name.text;
  return (HTTP_METHODS as readonly string[]).includes(name) ? name.toUpperCase() : null;
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/**
 * Analyse one handler body: does it enforce ownership itself, hand the
 * caller's identity to something that might, or never ask who is calling?
 */
function analyseHandler(sf: ts.SourceFile, handler: ts.Node): {
  posture: OwnershipPosture;
  delegatesTo: string[];
  usesCaller: boolean;
} {
  // Local names bound to a req.user expression — `const userId = req.user!.userId`
  // — count as the caller from then on.
  const aliases = new Set<string>();
  let usesCaller = false;
  const comparisons: ts.BinaryExpression[] = [];
  const calls: ts.CallExpression[] = [];
  let denies = false;

  const isCallerText = (text: string): boolean => {
    if (isReqUserText(text)) return true;
    for (const a of aliases) {
      if (new RegExp(`\\b${a}\\b`).test(text)) return true;
    }
    return false;
  };

  const collect = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) || ts.isNonNullExpression(node)) {
      if (isReqUserText(node.getText(sf))) usesCaller = true;
    }
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      if (isReqUserText(node.initializer.getText(sf))) aliases.add(node.name.text);
    }
    // Destructuring: `const { userId } = req.user!`
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectBindingPattern(node.name)) {
      if (isReqUserText(node.initializer.getText(sf))) {
        for (const el of node.name.elements) {
          if (ts.isIdentifier(el.name)) aliases.add(el.name.text);
        }
      }
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (
        op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        op === ts.SyntaxKind.EqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsToken
      ) {
        comparisons.push(node);
      }
    }
    if (ts.isCallExpression(node)) {
      calls.push(node);
      const callee = node.expression.getText(sf);
      // `res.status(403)` / `res.status(404)` — a denial the walker can see.
      if (/\bres\s*\.\s*status\b/.test(callee)) {
        const arg = node.arguments[0];
        if (arg && /^(401|403|404)$/.test(arg.getText(sf))) denies = true;
      }
      if (/\bAppError\b/.test(callee) || /\bsendForbidden\b/.test(callee)) denies = true;
    }
    if (ts.isNewExpression(node) && /\bAppError\b/.test(node.expression.getText(sf))) {
      const arg = node.arguments?.[0];
      if (arg && /^(401|403|404)$/.test(arg.getText(sf))) denies = true;
    }
    ts.forEachChild(node, collect);
  };
  collect(handler);

  // Pass 1 above may have seen an alias declared after a use; aliases are
  // small and cheap, so decide the comparisons now that the set is full.
  let inlineOwnership = false;
  for (const cmp of comparisons) {
    const left = cmp.left.getText(sf);
    const right = cmp.right.getText(sf);
    const callerSide = isCallerText(left) ? cmp.right : isCallerText(right) ? cmp.left : null;
    if (!callerSide) continue;
    // The other side must be an owner field on something that is not the
    // request itself (`req.params.id === req.user.userId` compares a URL
    // to a caller, which is a legitimate ownership check too).
    const otherText = callerSide.getText(sf);
    if (ts.isPropertyAccessExpression(callerSide) && OWNER_FIELD.test(callerSide.name.text)) {
      inlineOwnership = true;
    } else if (/\.(id|[A-Za-z]+Id)\b/.test(otherText)) {
      inlineOwnership = true;
    }
  }

  const delegatesTo: string[] = [];
  for (const call of calls) {
    const callee = call.expression.getText(sf);
    if (/\bres\s*\.|\bnext\b|\bconsole\b/.test(callee)) continue;
    if (call.arguments.some((a) => isCallerText(a.getText(sf)))) {
      if (!delegatesTo.includes(callee)) delegatesTo.push(callee);
    }
  }

  let posture: OwnershipPosture;
  if (inlineOwnership && denies) posture = 'inline';
  else if (usesCaller && delegatesTo.length > 0) posture = 'delegated';
  else if (usesCaller) posture = 'delegated';
  else posture = 'none';

  return { posture, delegatesTo, usesCaller };
}

export function extractRoutesFromSource(rel: string, code: string): {
  routes: RouteRecord[];
  skipped: { file: string; line: number; reason: string }[];
} {
  const sf = ts.createSourceFile(rel, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const routes: RouteRecord[] = [];
  const skipped: { file: string; line: number; reason: string }[] = [];
  const routerMiddleware: string[] = [];

  // Router-level middleware: `router.use(authMiddleware)` with no path.
  const collectUse = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const e = node.expression;
      if (ts.isIdentifier(e.expression) && e.expression.text === 'router' && e.name.text === 'use') {
        for (const arg of node.arguments) {
          if (ts.isIdentifier(arg)) routerMiddleware.push(arg.text);
          else if (ts.isCallExpression(arg)) routerMiddleware.push(arg.expression.getText(sf));
        }
      }
    }
    ts.forEachChild(node, collectUse);
  };
  collectUse(sf);

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const method = routerMethodOf(node.expression);
      if (method) {
        const [first, ...rest] = node.arguments;
        if (!first || !ts.isStringLiteral(first)) {
          skipped.push({
            file: rel,
            line: lineOf(sf, node),
            reason: 'route path is not a string literal',
          });
        } else {
          const middleware: string[] = [];
          let handler: ts.Node | null = null;
          for (const arg of rest) {
            if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) handler = arg;
            else if (ts.isIdentifier(arg)) middleware.push(arg.text);
            else if (ts.isCallExpression(arg)) middleware.push(arg.expression.getText(sf));
          }
          if (!handler) {
            skipped.push({
              file: rel,
              line: lineOf(sf, node),
              reason: 'no inline handler function — handler is a reference',
            });
          } else {
            const a = analyseHandler(sf, handler);
            routes.push({
              file: rel,
              line: lineOf(sf, node),
              method,
              path: first.text,
              middleware,
              routerMiddleware: [...routerMiddleware],
              posture: a.posture,
              delegatesTo: a.delegatesTo,
              usesCaller: a.usesCaller,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return { routes, skipped };
}

export interface ExtractConfig {
  /** Repo root. */
  root: string;
  /** Directory holding `*.routes.ts`, relative to root. */
  routesDir: string;
}

export const DEFAULT_CONFIG: Omit<ExtractConfig, 'root'> = {
  routesDir: path.join('packages', 'server', 'src', 'routes'),
};

export function buildRouteMap(cfg: ExtractConfig): RouteMap {
  const dir = path.join(cfg.root, cfg.routesDir);
  const names = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.routes.ts'))
    .sort();

  const routes: RouteRecord[] = [];
  const skipped: RouteMap['skipped'] = [];
  const files: string[] = [];

  for (const name of names) {
    const rel = path.join(cfg.routesDir, name).split(path.sep).join('/');
    files.push(rel);
    const out = extractRoutesFromSource(rel, fs.readFileSync(path.join(dir, name), 'utf8'));
    routes.push(...out.routes);
    skipped.push(...out.skipped);
  }

  routes.sort(
    (a, b) => a.file.localeCompare(b.file) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
  return { routes, files, skipped };
}
