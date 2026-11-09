// CUTGUARD v2 amendment 2 — rule S5: the gate, from the ROUTE's side.
//
//   A route that calls a version-gated service function must say which
//   generation it is answering, or be attested by name.
//
// WHY THIS EXISTS AND S4 IS NOT ENOUGH. S4 is a rule about services: it
// refuses a customer commission attached with no gate around it. It
// cannot see a route that calls a correctly-gated function and simply
// never passes the option — from inside the service that is
// indistinguishable from a caller who meant `false`.
//
// That hole was not hypothetical. `POST /scheduled-rides/:id/
// conflict-acknowledge` is the passenger re-accepting the offer she was
// warned about; it answers her directly and fans out to the journey room,
// exactly like `POST /accept-bid`. It called `acceptBid` without the
// option, so a v14 passenger who came through the conflict dialog lost
// the savings line that the same passenger on the direct path kept.
//
// Note which way that failed: DEGRADED, not crashed. That is the whole
// design working — absent ⇒ 0 ⇒ LEGACY means a forgotten caller withholds
// rather than breaks. S5 is the rule that turns a silent degradation into
// a build failure, because "safe when forgotten" is only half of "right".
//
// THE GATED SET IS DERIVED, NOT LISTED. It is every exported service
// function whose parameter list mentions the option. A sixth gated
// function is therefore covered by S5 the moment it is written, with no
// second place to keep in step — the same reason G5 derives its
// obligation set from the schema instead of hand-listing it.
//
// WHAT COUNTS AS DECLARED. The option name appearing in the ARGUMENTS of
// the call. Expression-scoped rather than function-scoped, unlike S4,
// and for the opposite reason: here there is exactly one shape a caller
// can take — you pass it or you do not — so there is nothing to be
// lenient about.
//
// WHAT AN EXEMPTION MEANS HERE. Not "this is safe for v13" (S4's claim)
// but "this journey object never reaches a client at all". The three
// shipped entries are participation checks: a handler that reads
// `customerId` / `driverId` to decide a 403 and then answers with
// something else entirely.

import * as ts from 'typescript';

/** The option a caller passes to declare the generation it is answering. */
export const GATE_OPTION = 'customerSavingsPreview';

export interface Rule5Finding {
  file: string;
  line: number;
  /** The route handler the call sits in, e.g. `POST /:id/accept-bid`. */
  handler: string;
  /** The gated service function being called. */
  callee: string;
  declared: boolean;
  /** `S5 <file> <handler> <callee>` — the allowlist key. */
  key: string;
}

export interface Rule5AllowlistEntry {
  key: string;
  reason: string;
}

export function rule5Key(file: string, handler: string, callee: string): string {
  return `S5 ${file} ${handler} ${callee}`;
}

/**
 * Every exported function that takes the gate option — derived from the
 * source, so a sixth gated function needs no edit here.
 */
export function findGatedFunctions(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const exported = (n: ts.Node): boolean =>
    !!ts.canHaveModifiers(n) &&
    !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && exported(node)) {
      const params = node.parameters.map((p) => p.getText(sf)).join('\n');
      if (params.includes(GATE_OPTION)) out.push(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * The route handler a node sits in — `router.post('/:id/accept-bid', …)`
 * becomes `POST /:id/accept-bid`. Named by its METHOD and PATH rather
 * than by a line, so the allowlist key survives edits above it. This is
 * the same identity `extract.ts` gives a route function, deliberately:
 * two rules that name the same site the same way can be reasoned about
 * together.
 */
function enclosingHandler(node: ts.Node, sf: ts.SourceFile): string {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (
      ts.isCallExpression(cur) &&
      ts.isPropertyAccessExpression(cur.expression) &&
      ts.isIdentifier(cur.expression.expression) &&
      cur.expression.expression.text === 'router'
    ) {
      const method = cur.expression.name.text.toUpperCase();
      const first = cur.arguments[0];
      const path = first && ts.isStringLiteral(first) ? first.text : '<?>';
      return `${method} ${path}`;
    }
    cur = cur.parent;
  }
  return '<top-level>';
}

export function findRule5(file: string, source: string, gated: Set<string>): Rule5Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: Rule5Finding[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : ts.isIdentifier(node.expression)
          ? node.expression.text
          : null;
      if (callee && gated.has(callee)) {
        const args = node.arguments.map((a) => a.getText(sf)).join('\n');
        const handler = enclosingHandler(node, sf);
        out.push({
          file,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          handler,
          callee,
          declared: args.includes(GATE_OPTION),
          key: rule5Key(file, handler, callee),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function describeRule5(f: Rule5Finding): string {
  return (
    `${f.file}:${f.line} — '${f.handler}' calls the version-gated '${f.callee}' without ` +
    `saying which generation it is answering. Absent means LEGACY, so this does not crash ` +
    `anybody — it silently WITHHOLDS from a current client, which is a feature that works on ` +
    `one route and not its twin. Pass '${GATE_OPTION}: isCurrentApp(req)', or add '${f.key}' to ` +
    `allowlist.json with a reason saying why this call's result never reaches a client.`
  );
}

export function runRule5(
  findings: Rule5Finding[],
  allowlist: Rule5AllowlistEntry[],
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

  const byKey = new Map<string, Rule5AllowlistEntry>();
  for (const e of allowlist) {
    if (!e.key || !e.reason || e.reason.trim() === '') {
      errors.push(`S5 allowlist entry ${JSON.stringify(e)} needs a key AND a reason`);
      continue;
    }
    byKey.set(e.key, e);
  }

  const used = new Set<string>();
  for (const f of findings) {
    if (f.declared) {
      cleared.push(`${f.key} — declares ${GATE_OPTION}`);
      continue;
    }
    const entry = byKey.get(f.key);
    if (entry) {
      used.add(f.key);
      cleared.push(`${f.key} — attested: ${entry.reason}`);
      continue;
    }
    violations.push({ key: f.key, message: describeRule5(f) });
  }

  for (const key of byKey.keys()) {
    if (!used.has(key)) warnings.push(`stale S5 allowlist entry: '${key}'`);
  }

  return { violations, errors, warnings, cleared };
}
