// AUTH-READ G4 / CUTGUARD v2 G4 — rule 3: the ownership tautology.
//
//   AN OWNERSHIP ID PASSED INTO A CALL MUST COME FROM THE SESSION,
//   NEVER FROM A ROW THE HANDLER JUST FETCHED.
//
// THE DEFECT, and it was live on the pilot:
//
//   router.post('/:id/conflict-acknowledge', authMiddleware, driverOnly, …)
//     const journey = await prisma.journey.findUnique({ where: { id: req.params.id } });
//     await bidService.acceptBid(req.params.id, journey.customerId, bidId, …);
//
// and `acceptBid` checks `journey.customerId !== customerId` — the row
// against itself. The check is present, reads correctly, and cannot fire.
// A stranger motari matched a passenger at a price she never accepted,
// with her money HELD.
//
// WHY A RULE AND NOT JUST THE TYPE. G4's `SessionUserId` brand
// (services/session-actor.ts) makes this a compile error wherever the
// callee has been threaded — and that is the stronger layer, because it
// is exhaustive over the functions it covers. But it covers only the
// functions somebody threaded, and it cannot see through `any`: a handler
// with `const result: any = ...` or an untyped service will accept a
// record-sourced id without complaint. This rule is the layer that does
// not care about types, only about where the value came from — so a
// service nobody has threaded yet is still watched.
//
// The two layers fail differently on purpose. The type catches it in the
// callee's signature; the rule catches it at the handler. Neither is
// sufficient, which is why there are two.
//
// WHAT COUNTS AS RECORD-SOURCED. A property access `X.ownerId` where `X`
// is bound in the same handler to a Prisma model read, and the property
// name looks like an owner field (`id`, `*Id`). That is deliberately
// narrow: `journey.customerId` is condemned, `journey.status` is not,
// and a value the handler received from its own caller is not seen at
// all.
//
// ORACLE BOUNDARY, stated because the alternative is claiming coverage:
// the walker sees ONE handler body. A row fetched in a service and passed
// back is not seen here (the TYPE is the layer for that). A record id
// assigned to a local first (`const owner = journey.customerId`) and then
// passed IS seen, because the binding is tracked.
//
// ALLOWLIST KEY TRADE-OFF, also stated rather than discovered later. The
// key is `rule3 <file> <callee>(<expression>)` — deliberately NOT
// line-numbered, the same choice rule 1 makes (`METHOD path in file`),
// because a line-numbered key goes stale every time somebody adds a
// comment above the site, and a guard that cries stale on every edit is a
// guard somebody turns off. The cost: a SECOND call with the identical
// callee and identical expression, in a file whose first one is already
// attested, is covered by that attestation silently. Reviewing a diff
// that adds a call to an attested file is what covers that gap; the guard
// does not.

import * as fs from 'node:fs';
import * as ts from 'typescript';

/** Property names that denote "who owns this row" — mirrors extract.ts. */
const OWNER_FIELD = /^(id|.*Id)$/;

/** Prisma methods that yield a row. */
const PRISMA_READS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'create',
  'update',
  'upsert',
]);

const PRISMA_ROOTS = new Set(['prisma', 'tx', 'db']);

export interface Rule3Finding {
  file: string;
  line: number;
  /** e.g. `journey.customerId` */
  expression: string;
  /** The callee the value was handed to, as written. */
  callee: string;
  /** `<file>:<callee>:<expression>` — the allowlist key. */
  key: string;
}

export interface Rule3AllowlistEntry {
  key: string;
  reason: string;
}

export function rule3Key(file: string, callee: string, expression: string): string {
  return `rule3 ${file} ${callee}(${expression})`;
}

function calleeText(call: ts.CallExpression, sf: ts.SourceFile): string {
  return call.expression.getText(sf);
}

export function findRule3(file: string, source: string): Rule3Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings: Rule3Finding[] = [];

  function isPrismaRead(node: ts.Node): boolean {
    let call: ts.CallExpression | null = null;
    if (ts.isCallExpression(node)) call = node;
    else if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression)) {
      call = node.expression;
    }
    if (!call || !ts.isPropertyAccessExpression(call.expression)) return false;
    if (!PRISMA_READS.has(call.expression.name.text)) return false;
    const model = call.expression.expression;
    return (
      ts.isPropertyAccessExpression(model) &&
      ts.isIdentifier(model.expression) &&
      PRISMA_ROOTS.has(model.expression.text)
    );
  }

  function analyse(fn: ts.FunctionLikeDeclaration): void {
    /** Locals bound to a Prisma row. */
    const rows = new Set<string>();
    /** Locals bound to a record-sourced owner id, e.g. `const owner = j.customerId`. */
    const laundered = new Map<string, string>();

    // Pass 1 — collect bindings.
    function collect(node: ts.Node): void {
      if (node !== fn && isFunctionLike(node)) return;
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
        if (isPrismaRead(node.initializer)) {
          rows.add(node.name.text);
        } else {
          const init = node.initializer;
          if (
            ts.isPropertyAccessExpression(init) &&
            ts.isIdentifier(init.expression) &&
            rows.has(init.expression.text) &&
            OWNER_FIELD.test(init.name.text)
          ) {
            laundered.set(node.name.text, `${init.expression.text}.${init.name.text}`);
          }
        }
      }
      ts.forEachChild(node, collect);
    }
    collect(fn);

    // Pass 2 — find them being handed to a call.
    function inspect(node: ts.Node): void {
      if (node !== fn && isFunctionLike(node)) return;
      if (ts.isCallExpression(node)) {
        for (const arg of node.arguments) {
          let expression: string | null = null;
          if (
            ts.isPropertyAccessExpression(arg) &&
            ts.isIdentifier(arg.expression) &&
            rows.has(arg.expression.text) &&
            OWNER_FIELD.test(arg.name.text)
          ) {
            expression = `${arg.expression.text}.${arg.name.text}`;
          } else if (ts.isIdentifier(arg) && laundered.has(arg.text)) {
            expression = laundered.get(arg.text)!;
          }
          if (expression) {
            const callee = calleeText(node, sf);
            // A Prisma call taking `where: { id: row.id }` is a lookup,
            // not an authorisation — it is how you fetch the next row.
            if (/^(prisma|tx|db)\./.test(callee)) continue;
            findings.push({
              file,
              line: sf.getLineAndCharacterOfPosition(arg.getStart(sf)).line + 1,
              expression,
              callee,
              key: rule3Key(file, callee, expression),
            });
          }
        }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(fn);
  }

  function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
    return (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
    );
  }

  function walk(node: ts.Node): void {
    if (isFunctionLike(node)) analyse(node);
    ts.forEachChild(node, walk);
  }
  walk(sf);

  // One handler can be visited via its parent too; de-duplicate by key+line.
  const seen = new Set<string>();
  return findings.filter((f) => {
    const id = `${f.key}@${f.line}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function describeRule3(f: Rule3Finding): string {
  return (
    `${f.file}:${f.line} — '${f.expression}' is handed to ${f.callee}(). ` +
    `An ownership id must come from the SESSION (req.user), not from a row the handler ` +
    `just fetched: comparing a record against itself is a check that cannot fail. ` +
    `Use req.user (via sessionUserId(req)), or add '${f.key}' to rule3-allowlist.json ` +
    `with a reason naming what DOES authorise the call.`
  );
}

/**
 * Rule 3 keeps its own file rather than joining include-allowlist.json,
 * which is a bare JSON array belonging to rule 2. Two rules, two lists,
 * neither able to disturb the other.
 */
export function loadRule3Allowlist(file: string): Rule3AllowlistEntry[] {
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${file}: expected a JSON array of {key, reason} entries`);
  }
  return parsed as Rule3AllowlistEntry[];
}

export function runRule3(
  findings: Rule3Finding[],
  allowlist: Rule3AllowlistEntry[],
): { errors: string[]; warnings: string[]; cleared: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cleared: string[] = [];

  const byKey = new Map<string, Rule3AllowlistEntry>();
  for (const entry of allowlist) {
    // `__…__` keys are prose for the reader of the file, not attestations.
    // They are skipped rather than reported stale.
    if (entry.key?.startsWith('__')) continue;
    if (!entry.key || !entry.reason || entry.reason.trim() === '') {
      errors.push(
        `rule3 allowlist entry ${JSON.stringify(entry)} needs a key AND a reason naming what authorises the call`,
      );
      continue;
    }
    byKey.set(entry.key, entry);
  }

  const used = new Set<string>();
  for (const f of findings) {
    const entry = byKey.get(f.key);
    if (entry) {
      used.add(f.key);
      cleared.push(`${f.key} — ${entry.reason}`);
      continue;
    }
    errors.push(describeRule3(f));
  }

  for (const key of byKey.keys()) {
    if (!used.has(key)) warnings.push(`stale rule3 allowlist entry: '${key}'`);
  }

  return { errors, warnings, cleared };
}
