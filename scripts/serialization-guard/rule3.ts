// CUTGUARD v2 G3 — rule S3: the commission projection boundary.
//
//   A `commissionBreakdown` is PRODUCED BY A PROJECTOR, never written as
//   an object literal at the site that emits it.
//
// WHY THIS RULE AND NOT "DON'T SHIP driverPayout". Because "don't ship
// driverPayout" is what #202 and #207 already said, twice, in prose, and
// the accept path shipped it anyway. It shipped it because the accept
// path did not KNOW it was projecting — it was simply building an object,
// the way every endpoint builds an object, and nothing distinguished the
// customer's exit from the driver's.
//
// The type (services/commission-view.ts) closes the assignment: a
// customer-scoped payload declares `CustomerSafeCommission` and an inline
// literal cannot be assigned to it. This rule closes the step BEFORE the
// assignment — writing a hand-rolled projection at all. Together they
// mean the next money exit has exactly one way to answer a passenger, and
// it is the way that is already correct.
//
// THE RULE, precisely. In `packages/server/src`, a property assignment or
// shorthand whose name is in PROJECTED_KEYS and whose value is an object
// literal is a violation, unless the site is allowlisted with a reason. A
// value that is a CALL — `toCustomerSafeCommission(...)`,
// `toDriverSettlementCommission(...)`, or an identifier holding one — is
// fine: the projector decided the shape, which is the whole point.
//
// ORACLE BOUNDARY. This is a syntactic rule about where a shape is
// WRITTEN, not a data-flow proof about where it goes. A literal built
// into a local variable two lines up and then assigned by name is not
// seen (the type catches that one instead). Stated here and in
// docs/serialization-boundary.md rather than implied.

import * as ts from 'typescript';

/**
 * Property names whose value is a money projection. `commissionBreakdown`
 * is the key every customer-facing money payload uses — the journey read,
 * the bid list, the accept result, the rides list.
 */
export const PROJECTED_KEYS = new Set(['commissionBreakdown']);

/**
 * The driver-money field names. A literal carrying any of these under a
 * PROJECTED_KEYS property is the specific defect U-4 was, so the message
 * names which one it found.
 */
export const DRIVER_MONEY_KEYS = new Set([
  'driverPayout',
  'driverTier',
  'driverCommissionRate',
  'driverSavings',
  'totalCommissionAmount',
  'totalCommissionRate',
  'chargedCommissionAmount',
  'waivedCommissionAmount',
]);

export interface Rule3Finding {
  file: string;
  line: number;
  key: string;
  /** Driver-money keys present in the literal, if any. */
  driverKeys: string[];
  /** `<file>:<line> <key>` — the allowlist key. */
  siteKey: string;
}

export function rule3SiteKey(file: string, line: number, key: string): string {
  return `S3 ${file}:${line} ${key}`;
}

/**
 * Walk one source file for hand-written projections.
 */
export function findRule3(file: string, source: string): Rule3Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings: Rule3Finding[] = [];

  const unwrap = (e: ts.Expression): ts.Expression =>
    ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e)
      ? unwrap(e.expression as ts.Expression)
      : e;

  function record(nameNode: ts.Identifier | ts.StringLiteral, value: ts.Expression): void {
    const driverKeys: string[] = [];
    for (const prop of (value as ts.ObjectLiteralExpression).properties) {
      const n = prop.name;
      if (n && (ts.isIdentifier(n) || ts.isStringLiteral(n)) && DRIVER_MONEY_KEYS.has(n.text)) {
        driverKeys.push(n.text);
      }
    }
    const line = sf.getLineAndCharacterOfPosition(nameNode.getStart(sf)).line + 1;
    findings.push({
      file,
      line,
      key: nameNode.text,
      driverKeys,
      siteKey: rule3SiteKey(file, line, nameNode.text),
    });
  }

  function visit(node: ts.Node): void {
    // `const commissionBreakdown = { … }` — the shape the accept path
    // built. A named local is still a hand-rolled projection; it simply
    // takes one more line to become a payload.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      PROJECTED_KEYS.has(node.name.text) &&
      node.initializer !== undefined
    ) {
      const value = unwrap(node.initializer as ts.Expression);
      if (ts.isObjectLiteralExpression(value)) {
        record(node.name, value);
        ts.forEachChild(node, visit);
        return;
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      node.name !== undefined &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      PROJECTED_KEYS.has(node.name.text)
    ) {
      const value = unwrap(node.initializer as ts.Expression);
      if (ts.isObjectLiteralExpression(value)) {
        record(node.name as ts.Identifier | ts.StringLiteral, value);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return findings;
}

export function describeRule3(f: Rule3Finding): string {
  const driver =
    f.driverKeys.length > 0
      ? ` It carries driver money: ${f.driverKeys.join(', ')}.`
      : '';
  return (
    `${f.file}:${f.line} — '${f.key}' is written as an object literal.${driver} ` +
    `A commission payload must be produced by a projector ` +
    `(toCustomerSafeCommission / toCustomerListCommission / toDriverSettlementCommission), ` +
    `so one function decides what each audience sees. Route it through one, or add ` +
    `'${f.siteKey}' to allowlist.json with a reason.`
  );
}
