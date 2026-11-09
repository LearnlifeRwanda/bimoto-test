// CUTGUARD v2 amendment 2 — rule S4: the version gate, as a CLASS.
//
//   A CUSTOMER-projected commission attached to a payload must be
//   lexically gated on `customerSavingsPreview`, or attested by name.
//
// WHY THIS RULE EXISTS, and it is the whole lesson of this dispatch
// applied to the dispatch itself.
//
// G6 gated the bid-list savings preview — the instance B-2 named — and
// reported the class closed. It was not. The journey read and the
// rides-list customer arm attached the same shape with no gate, and v13's
// MatchedPage and HistoryPage guard on PRESENCE only: they then read
// `totalCommissionAmount`, `totalCommissionRate` and `driverPayout` off
// an object that carries none of them and must carry none of them (#202 —
// those fields reconstruct the motari's net). The discriminator that
// makes v14 safe, `hasCustomerSafeCommission`, landed in #206, AFTER the
// da9eca0 APK, so it is not in v13. Result: a white screen on the ride
// screen and on the receipt.
//
// Amendment 2 gated those two. Gating three instances while the guard
// still knows about one would be the same mistake one level up — so the
// guard now knows about the class.
//
// HOW IT CLASSIFIES, and why that is trustworthy. Rule S3 already forces
// every `commissionBreakdown` through a projector, so there is no
// hand-rolled shape left to guess about. The projector NAMES the
// audience:
//
//   customer  toCustomerSafeCommission, toCustomerListCommission,
//             projectCustomerSafeCommission
//   driver    toFullCommissionBreakdown
//
// S4 therefore reads the value's projector, and asks for a gate only on
// the customer ones. The driver ladder is never gated — his build has
// always rendered it, and the gate narrows by CLIENT, not by viewer.
// S3 is what makes S4 possible; neither is much use alone.
//
// WHAT COUNTS AS GATED. `customerSavingsPreview` appearing within the
// ENCLOSING FUNCTION of the attach. Deliberately function-scoped rather
// than expression-scoped, because the real shapes differ — the rides list
// gates at the variable's assignment and attaches by shorthand two lines
// later, the journey read gates in the spread itself — and a rule that
// only understood one of them would have to be argued with at every site.
//
// THE RESIDUAL, stated rather than discovered: a NEW attach added inside
// a function that ALREADY mentions the option passes without its own
// gate. What this catches is the realistic case and the one that actually
// happened — a new surface, in a new function, with nobody thinking about
// v13. A second attach inside an already-gated function is a diff a
// reviewer is looking straight at.

import * as ts from 'typescript';

/** Payload keys that carry a commission projection. */
export const PROJECTED_KEYS = new Set(['commissionBreakdown']);

/** Projectors whose output a CUSTOMER receives. */
export const CUSTOMER_PROJECTORS = new Set([
  'toCustomerSafeCommission',
  'toCustomerListCommission',
  'projectCustomerSafeCommission',
]);

/** Projectors whose output a DRIVER receives. Never gated. */
export const DRIVER_PROJECTORS = new Set(['toFullCommissionBreakdown']);

/** The option that proves a caller said which generation it is. */
export const GATE_OPTION = 'customerSavingsPreview';

export interface Rule4Finding {
  file: string;
  line: number;
  /** The function the attach sits in. */
  fn: string;
  /** The projector that produced the value. */
  projector: string;
  gated: boolean;
  /** `S4 <file> <fn> <projector>` — the allowlist key. */
  key: string;
}

export interface Rule4AllowlistEntry {
  key: string;
  reason: string;
}

export function rule4Key(file: string, fn: string, projector: string): string {
  return `S4 ${file} ${fn} ${projector}`;
}

function enclosingFunction(node: ts.Node): ts.Node | null {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur)
    ) {
      return cur;
    }
    cur = cur.parent;
  }
  return null;
}

function ownName(fn: ts.Node): string | null {
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text;
  if (ts.isMethodDeclaration(fn) && ts.isIdentifier(fn.name)) return fn.name.text;
  const parent = fn.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return null;
}

/**
 * A name for the allowlist key that does not move when a line above it
 * moves. Both surfaces amendment 2 gated attach inside a `.map()`
 * callback, and `<anonymous@617>` would be a key that goes stale on the
 * next unrelated edit — the exact brittleness route-guard's rule 3 was
 * re-cut to avoid.
 *
 * So an anonymous function borrows its nearest NAMED ancestor:
 * `getJourneys/λ`. Two sibling callbacks under one named function, both
 * attaching via the same projector, would share a key — the same
 * line-independence trade-off rule 3 makes, and the same answer: an
 * exemption is meant to be rare enough that a reviewer reads it.
 */
function functionName(fn: ts.Node, _sf: ts.SourceFile): string {
  const own = ownName(fn);
  if (own) return own;
  let cur: ts.Node | undefined = fn.parent;
  while (cur) {
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur)
    ) {
      const named = ownName(cur);
      if (named) return `${named}/λ`;
    }
    cur = cur.parent;
  }
  return '<anonymous>';
}

/**
 * The projector behind a value, following one level of local aliasing —
 * `const x = toCustomerListCommission(...)` then `{ ...{ x } }`, which is
 * exactly the rides list's shape.
 */
function projectorOf(
  value: ts.Expression,
  sf: ts.SourceFile,
  fnNode: ts.Node | null,
): string | null {
  const unwrap = (e: ts.Expression): ts.Expression =>
    ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e)
      ? unwrap(e.expression as ts.Expression)
      : e;
  const v = unwrap(value);

  const nameOf = (call: ts.CallExpression): string | null => {
    if (ts.isIdentifier(call.expression)) return call.expression.text;
    if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
    return null;
  };

  if (ts.isCallExpression(v)) return nameOf(v);

  // A ternary: take whichever branch names a projector.
  if (ts.isConditionalExpression(v)) {
    return (
      projectorOf(v.whenTrue, sf, fnNode) ?? projectorOf(v.whenFalse, sf, fnNode)
    );
  }

  // An identifier: find its declaration inside this function.
  if (ts.isIdentifier(v) && fnNode) {
    let found: string | null = null;
    const walk = (n: ts.Node): void => {
      if (found) return;
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === v.text &&
        n.initializer
      ) {
        found = projectorOf(n.initializer as ts.Expression, sf, fnNode);
        return;
      }
      ts.forEachChild(n, walk);
    };
    walk(fnNode);
    return found;
  }
  return null;
}

export function findRule4(file: string, source: string): Rule4Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: Rule4Finding[] = [];

  const record = (
    nameNode: ts.Node,
    value: ts.Expression | null,
    shorthandName?: string,
  ): void => {
    const fnNode = enclosingFunction(nameNode);
    const projector = value
      ? projectorOf(value, sf, fnNode)
      : shorthandName && fnNode
        ? projectorOf(
            ts.factory.createIdentifier(shorthandName) as ts.Expression,
            sf,
            fnNode,
          )
        : null;
    if (!projector || !CUSTOMER_PROJECTORS.has(projector)) return;

    const fnText = fnNode ? fnNode.getText(sf) : '';
    out.push({
      file,
      line: sf.getLineAndCharacterOfPosition(nameNode.getStart(sf)).line + 1,
      fn: fnNode ? functionName(fnNode, sf) : '<top-level>',
      projector,
      gated: fnText.includes(GATE_OPTION),
      key: rule4Key(file, fnNode ? functionName(fnNode, sf) : '<top-level>', projector),
    });
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      PROJECTED_KEYS.has(node.name.text)
    ) {
      record(node, node.initializer as ts.Expression);
    }
    // `{ commissionBreakdown }` — the rides list's shape.
    if (ts.isShorthandPropertyAssignment(node) && PROJECTED_KEYS.has(node.name.text)) {
      const fnNode = enclosingFunction(node);
      const projector = fnNode
        ? projectorOf(ts.factory.createIdentifier(node.name.text), sf, fnNode)
        : null;
      if (projector && CUSTOMER_PROJECTORS.has(projector)) {
        const fnText = fnNode ? fnNode.getText(sf) : '';
        out.push({
          file,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          fn: fnNode ? functionName(fnNode, sf) : '<top-level>',
          projector,
          gated: fnText.includes(GATE_OPTION),
          key: rule4Key(file, fnNode ? functionName(fnNode, sf) : '<top-level>', projector),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const seen = new Set<string>();
  return out.filter((f) => {
    const id = `${f.key}@${f.line}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function describeRule4(f: Rule4Finding): string {
  return (
    `${f.file}:${f.line} — '${f.fn}' attaches a CUSTOMER commission ` +
    `(${f.projector}) with no version gate. A v13 client guards on PRESENCE only and then ` +
    `dereferences totalCommissionAmount / driverPayout, which this shape does not and must ` +
    `not carry — that is B-2, and it crashes the screen. Gate the attach on ` +
    `'${GATE_OPTION}' (threaded from req.appVersion, as journey.routes and bid.routes do), ` +
    `or add '${f.key}' to allowlist.json with a reason naming why no v13 client reads it.`
  );
}

export function runRule4(
  findings: Rule4Finding[],
  allowlist: Rule4AllowlistEntry[],
): {
  violations: Array<{ key: string; message: string }>;
  errors: string[];
  warnings: string[];
  cleared: string[];
} {
  const violations: Array<{ key: string; message: string }> = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const cleared: string[] = [];

  const byKey = new Map<string, Rule4AllowlistEntry>();
  for (const e of allowlist) {
    if (e.key?.startsWith('__')) continue;
    if (!e.key || !e.reason || e.reason.trim() === '') {
      errors.push(`S4 allowlist entry ${JSON.stringify(e)} needs a key AND a reason`);
      continue;
    }
    byKey.set(e.key, e);
  }

  const used = new Set<string>();
  for (const f of findings) {
    if (f.gated) {
      cleared.push(`${f.key} — gated on ${GATE_OPTION}`);
      continue;
    }
    const entry = byKey.get(f.key);
    if (entry) {
      used.add(f.key);
      cleared.push(`${f.key} — attested: ${entry.reason}`);
      continue;
    }
    violations.push({ key: f.key, message: describeRule4(f) });
  }

  for (const key of byKey.keys()) {
    if (!used.has(key)) warnings.push(`stale S4 allowlist entry: '${key}'`);
  }

  return { violations, errors, warnings, cleared };
}
