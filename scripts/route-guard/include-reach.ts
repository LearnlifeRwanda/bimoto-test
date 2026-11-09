// INCLUDE-REACH G2 — the over-reaching-read walker (rule 2).
//
// Rule 1 (check.ts) asks whether a read route MENTIONS the caller. Rule 2
// asks a different question, one file layer down: when a read runs, HOW FAR
// does it reach, and did anybody check who was asking?
//
// The rule, in one line: a Prisma read reachable from a GET route, whose
// `include`/`select` traverses into a PROTECTED model, inside a function
// that does not restrict by caller, is a finding.
//
// This is the shape of the defect AUTH-READ (#183) closed at the chat route
// and then found a SECOND time in `GET /api/journeys/:id`, whose `include`
// block reached the same chat, the escrow row, and the legs' third-party
// contact details — on a route that never restricted by caller at all. Two
// hand-built lists in a row undercounted the class. This walker replaces
// the hand.
//
// WHY IT RUNS AT THE DATA-ACCESS LAYER, NOT THE ROUTE LAYER (blind spot c).
// extract.ts says at length that it sees handler bodies, not service
// internals — and the include block that leaks is never in a handler body.
// It is in a service. So rule 2 walks EVERY non-test server source file,
// records the reads where they physically are, and then maps each function
// back to the GET routes that reach it through a name-based call graph
// (which also carries re-export barrels: `journeyService.getJourneyById`
// and `getJourneyById` resolve to the same last segment).
//
// THE FOUR BLIND SPOTS IT WAS BUILT AGAINST, each of which has bitten this
// codebase once already:
//
//  (a) HOISTED SELECTORS. DECRYPT v3 addendum 2: TypeScript applies
//      excess-property checking only to FRESH object literals, so a select
//      hoisted into a named const escaped both the compiler and review.
//      This walker resolves module-level const selectors; one it cannot
//      resolve is reported UNKNOWN, never counted clean.
//  (b) `any` REGIONS. MONEY-ATOMIC: a `(tx: any)` parameter blinded the §D
//      walker to two defects; CASTAWAY: five casts hid live sites. A read
//      whose client or selector is `any`-typed is UNKNOWN by construction.
//  (c) SERVICE DELEGATION — handled by the call graph described above.
//  (d) SPREAD AND DYNAMIC SELECTORS. `...base` is resolved when the spread
//      target is resolvable; a computed key, a call-built selector or an
//      unresolvable spread is UNKNOWN.
//
// UNKNOWN is a first-class result. It is neither a finding nor a clean
// row: it is the walker saying "I could not see". check.ts fails on an
// unattested UNKNOWN exactly as it fails on a finding, because a census
// with an unexplained hole in it is not a census.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

/** Prisma delegate methods that read. */
export const READ_METHODS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
]);

/**
 * Models whose rows are not the caller's to see merely because the caller
 * knows a parent row's id. Seeded from the RECON §B PII census and the
 * AUDIT-BATTERY protected-data list.
 */
export const PROTECTED_MODELS = new Set([
  'Message',
  'Escrow',
  'EscrowAuditLog',
  'GpsPoint',
  'EmergencyAlert',
  'Rating',
  'RideReport',
  'AmlFlag',
  'PayoutPreferenceChangeLog',
  'NameMismatchLog',
  'SmsInbound',
  'SimulatedMessage',
  'OtpCode',
  'RefreshToken',
  'DriverBalance',
  'DriverPayoutBatch',
]);

/**
 * Models protected at FIELD level rather than whole-model level. A driver's
 * profile is legitimately read all over the app (rating, plate, vehicle);
 * his identity-document URLs are not. Reaching the model with `true` (the
 * whole row) counts, as does naming one of these fields in a select.
 */
export const PROTECTED_FIELDS = new Map<string, Set<string>>([
  [
    // A leg's WHERE and WHAT are the open-request card a motari bids on. Its
    // WHO — the sender or recipient standing at that address — belongs to
    // somebody who is not party to the request at all, and is the reason
    // `Leg` is on this list rather than the whole-model one above. Reaching
    // the model without a `select` returns these fields, so that counts.
    'Leg',
    new Set(['contactName', 'contactPhone', 'recipientDisputeReason']),
  ],
  [
    'DriverProfile',
    new Set([
      'idPhotoUrl',
      'drivingLicensePhotoUrl',
      'ruraAuthorizationPhotoUrl',
      'insurancePhotoUrl',
      'selfieUrl',
      'vehiclePhotoUrl',
    ]),
  ],
]);

/** Parameter names that mean "who is asking". */
const CALLER_PARAM = /^(requesting|requester|caller|current|viewer|actor|acting|auth)?_?[Uu]ser_?[Ii]d$|^(callerId|viewerId|actorId|requesterId|requestingUserId|currentUserId|userId|adminId)$/;

export interface SchemaModel {
  /** relation field name → target model */
  relations: Map<string, string>;
  /** scalar field names */
  scalars: Set<string>;
}

export interface PrismaSchema {
  models: Map<string, SchemaModel>;
  /** `message` → `Message`: the delegate name Prisma exposes on the client. */
  delegates: Map<string, string>;
}

/**
 * A deliberately small schema reader: enough to answer "is `messages` on
 * Journey a relation, and to what model". Not a Prisma parser — it reads
 * `model X { … }` blocks and calls a field a relation when its type names
 * another model.
 */
export function parsePrismaSchema(text: string): PrismaSchema {
  const blocks: { name: string; body: string }[] = [];
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) blocks.push({ name: m[1], body: m[2] });

  const names = new Set(blocks.map((b) => b.name));
  const models = new Map<string, SchemaModel>();
  const delegates = new Map<string, string>();

  for (const block of blocks) {
    const relations = new Map<string, string>();
    const scalars = new Set<string>();
    for (const rawLine of block.body.split('\n')) {
      const line = rawLine.trim();
      if (line === '' || line.startsWith('//') || line.startsWith('@@')) continue;
      const field = /^(\w+)\s+(\w+)/.exec(line);
      if (!field) continue;
      const [, fieldName, typeName] = field;
      if (names.has(typeName)) relations.set(fieldName, typeName);
      else scalars.add(fieldName);
    }
    models.set(block.name, { relations, scalars });
    delegates.set(block.name.charAt(0).toLowerCase() + block.name.slice(1), block.name);
  }

  return { models, delegates };
}

export interface ReadRecord {
  /** Prisma model the read targets, e.g. `Journey`. */
  model: string;
  /** Delegate method, e.g. `findUnique`. */
  method: string;
  line: number;
  /** Protected models the selector traverses INTO via a relation hop, sorted. */
  protectedReach: string[];
  /** Protected models the read targets directly (its own model), sorted. */
  directReach: string[];
  /** Why the walker could not finish resolving this selector, if it could not. */
  unknowns: string[];
  /** Restrictions carried by THIS read (its own where / its own selector). */
  restrictions: Restriction[];
}

export type Restriction =
  /** the function denies (401/403/404) after comparing the caller to an owner field */
  | 'inline-denial'
  /** the read's own `where` is narrowed by a caller-derived value */
  | 'scoped-where'
  /** the selector itself is chosen from a caller-derived value — the projection IS the check */
  | 'scoped-projection'
  /** the caller is handed to an assert-shaped guard or a *ViewerScope resolver */
  | 'caller-scope';

export interface ReachFunctionRecord {
  file: string;
  name: string;
  line: number;
  reads: ReadRecord[];
  /** Every callee name invoked in this body — the call-graph edges. */
  calls: string[];
  /**
   * Lines carrying a denial (401/403/404) reached through a CALLER test.
   *
   * Lines, not a boolean, because a denial gates only the reads BELOW it. A
   * 150-line service that denies an outsider in its customer branch has not
   * thereby gated the driver-feed query eighty lines further down — and
   * `getJourneys` is exactly that function, so a boolean here would have
   * silently certified the open-request feed it never checked.
   */
  denialLines: number[];
  /** Lines where the caller is handed to an assert-shaped guard. Same rule. */
  assertLines: number[];
  /** Restrictions that belong to the function as a whole (currently none). */
  restrictions: Restriction[];
  /** True when the body names a caller-ish parameter at all. */
  usesCaller: boolean;
}

export interface ReachMap {
  functions: ReachFunctionRecord[];
  files: string[];
  roots: string[];
}

export function reachKey(f: { name: string; file: string }): string {
  return `${f.name} in ${f.file}`;
}

/** Root identifier of `a.b.c` → `a`. */
function rootIdentifier(expr: ts.Expression): ts.Identifier | null {
  let cur: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(cur) || ts.isNonNullExpression(cur)) cur = cur.expression;
  return ts.isIdentifier(cur) ? cur : null;
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** Same naming convention as txn-guard: a function is known by its declared name. */
function nameOf(sf: ts.SourceFile, fn: ts.FunctionLikeDeclaration): string | null {
  if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name) return fn.name.text;
  if (ts.isMethodDeclaration(fn) && ts.isIdentifier(fn.name)) return fn.name.text;
  const parent = fn.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (parent && ts.isCallExpression(parent)) {
    const callee = parent.expression;
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === 'router'
    ) {
      const first = parent.arguments[0];
      if (first && ts.isStringLiteral(first)) return `${callee.name.text.toUpperCase()} ${first.text}`;
    }
  }
  return null;
}

/** The last identifier of `a.b.c` — what a barrel re-export preserves. */
export function lastSegment(callee: string): string {
  const parts = callee.split('.');
  return parts[parts.length - 1];
}

interface TraverseCtx {
  schema: PrismaSchema;
  /** module-level `const NAME = { … }` selectors, for blind spot (a). */
  consts: Map<string, ts.Expression>;
  /**
   * Repo-wide exported selectors, consulted ONLY after `consts` misses.
   *
   * Needed because a shared selector nests: `CURATED_BIDDER_SELECT` resolves
   * in the importing file, and the identifier INSIDE it —
   * `CURATED_BIDDER_PROFILE_SELECT` — belongs to the DEFINING file's scope,
   * which the importer never sees. Names here are unique repo-wide by
   * construction: `collectExportedSelectors` drops any exported twice.
   */
  exported?: ExportedSelectors;
  sf: ts.SourceFile;
  /** identifiers whose value is `any` — blind spot (b). */
  anyNames: Set<string>;
  reached: Set<string>;
  /** protected models the read targets DIRECTLY (not via a relation hop). */
  direct: Set<string>;
  unknowns: string[];
  /** guards against a const that spreads itself. */
  seen: Set<ts.Expression>;
}

/** Selector keys that are query mechanics, not fields. */
const NON_FIELD_KEYS = new Set([
  'where',
  'orderBy',
  'take',
  'skip',
  'cursor',
  'distinct',
  'by',
  '_count',
  '_sum',
  '_avg',
  '_min',
  '_max',
  'having',
  'relationLoadStrategy',
  'omit',
]);

/**
 * Record that the selector reached `model`, with `whole` = `true`-valued.
 *
 * `into` separates the two shapes the census reports apart: a model reached
 * by a RELATION HOP from the read's own model (rule 2's subject — the
 * `include` that over-reaches), and a model the read TARGETS DIRECTLY
 * (`prisma.message.findMany({ where: { journeyId } })` — the shape of the
 * #183 chat IDOR itself). Both matter; only the first is rule 2.
 */
function recordReach(
  ctx: TraverseCtx,
  model: string,
  whole: boolean,
  named: Set<string>,
  into: Set<string>,
): void {
  if (PROTECTED_MODELS.has(model)) {
    into.add(model);
    return;
  }
  const fields = PROTECTED_FIELDS.get(model);
  if (!fields) return;
  if (whole) {
    into.add(model);
    return;
  }
  for (const f of named) {
    if (fields.has(f)) {
      into.add(model);
      return;
    }
  }
}

/**
 * Walk a resolved selector expression against `model`, recording every
 * protected model it traverses into. Anything it cannot resolve becomes an
 * UNKNOWN rather than silence.
 */
function traverseSelector(
  expr: ts.Expression,
  model: string,
  ctx: TraverseCtx,
  where: string,
  depth = 0,
): void {
  if (ctx.seen.has(expr)) return;
  ctx.seen.add(expr);

  // `x as any` hides everything below it (blind spot b); any other cast is
  // transparent and we keep walking through it.
  if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr)) {
    if (expr.type.kind === ts.SyntaxKind.AnyKeyword) {
      ctx.unknowns.push(`${where}: selector is cast to \`any\` — contents unreadable`);
      return;
    }
    traverseSelector(expr.expression, model, ctx, where, depth);
    return;
  }

  if (ts.isParenthesizedExpression(expr)) {
    traverseSelector(expr.expression, model, ctx, where, depth);
    return;
  }

  // A selector chosen by a condition: BOTH arms are reachable, so both are
  // walked. (The condition being caller-derived is what makes the enclosing
  // function `scoped-projection`; that is decided by the caller of this fn.)
  if (ts.isConditionalExpression(expr)) {
    traverseSelector(expr.whenTrue, model, ctx, where, depth);
    traverseSelector(expr.whenFalse, model, ctx, where, depth);
    return;
  }

  // `a ?? b`, `a || b`
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (
      op === ts.SyntaxKind.QuestionQuestionToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      traverseSelector(expr.left, model, ctx, where, depth);
      traverseSelector(expr.right, model, ctx, where, depth);
      return;
    }
  }

  // A hoisted selector (blind spot a) — the whole reason this branch exists.
  if (ts.isIdentifier(expr)) {
    if (ctx.anyNames.has(expr.text)) {
      ctx.unknowns.push(`${where}: selector \`${expr.text}\` is \`any\`-typed`);
      return;
    }
    const resolved = ctx.consts.get(expr.text) ?? ctx.exported?.get(expr.text);
    if (!resolved) {
      ctx.unknowns.push(
        `${where}: selector \`${expr.text}\` is not a module-level const in this file — unresolved`,
      );
      return;
    }
    traverseSelector(resolved, model, ctx, where, depth);
    return;
  }

  if (!ts.isObjectLiteralExpression(expr)) {
    ctx.unknowns.push(
      `${where}: selector is a ${ts.SyntaxKind[expr.kind]}, not an object literal — unresolved`,
    );
    return;
  }

  const schemaModel = ctx.schema.models.get(model);
  const namedScalars = new Set<string>();

  for (const prop of expr.properties) {
    if (ts.isSpreadAssignment(prop)) {
      // blind spot (d)
      traverseSelector(prop.expression, model, ctx, `${where} (spread)`, depth);
      continue;
    }
    if (ts.isShorthandPropertyAssignment(prop)) {
      const key = prop.name.text;
      applyKey(key, null, model, ctx, where, schemaModel, namedScalars, depth);
      continue;
    }
    if (!ts.isPropertyAssignment(prop)) {
      ctx.unknowns.push(`${where}: selector member \`${prop.getText(ctx.sf)}\` is not a plain key`);
      continue;
    }
    if (ts.isComputedPropertyName(prop.name)) {
      ctx.unknowns.push(`${where}: selector has a computed key — unresolved`);
      continue;
    }
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
    if (key === null) {
      ctx.unknowns.push(`${where}: selector has an unreadable key`);
      continue;
    }
    applyKey(key, prop.initializer, model, ctx, where, schemaModel, namedScalars, depth);
  }

  recordReach(ctx, model, false, namedScalars, depth === 0 ? ctx.direct : ctx.reached);
}

function applyKey(
  key: string,
  value: ts.Expression | null,
  model: string,
  ctx: TraverseCtx,
  where: string,
  schemaModel: SchemaModel | undefined,
  namedScalars: Set<string>,
  depth: number,
): void {
  // A nested `include`/`select` stays on the SAME model.
  if (key === 'include' || key === 'select') {
    if (value) traverseSelector(value, model, ctx, where, depth);
    return;
  }
  if (NON_FIELD_KEYS.has(key)) return;

  const target = schemaModel?.relations.get(key);
  if (target) {
    // Prisma semantics, and the trap the original defect sat in: `include:
    // { legs: { orderBy: … } }` returns every column of every leg. ONLY a
    // `select` narrows a relation. Anything else — `true`, a bare `orderBy`,
    // a `where` — is the whole row.
    const whole =
      value === null ||
      value.kind === ts.SyntaxKind.TrueKeyword ||
      (ts.isObjectLiteralExpression(value) && !hasSelect(value));
    recordReach(ctx, target, whole, new Set(), ctx.reached);
    // Recurse even when the row comes back whole. `whole` decides whether
    // the PARENT is fully read; it says nothing about what a nested
    // `include` underneath it drags in — and
    // `bids: { include: { driver: { include: { driverProfile: true } } } }`
    // is exactly that shape, three hops from the read.
    if (value && ts.isObjectLiteralExpression(value)) {
      traverseSelector(value, target, ctx, `${where} → ${key}`, depth + 1);
    }
    return;
  }

  if (!schemaModel) {
    ctx.unknowns.push(`${where}: model \`${model}\` is not in the Prisma schema — key \`${key}\` unresolved`);
    return;
  }
  namedScalars.add(key);
}

/** Does this relation argument narrow its columns with a `select`? */
function hasSelect(obj: ts.ObjectLiteralExpression): boolean {
  return obj.properties.some(
    (p) =>
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
      (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
      p.name.text === 'select',
  );
}

/** `{ requestingUserId }` and friends — the parameter that says who is asking. */
export function isCallerName(name: string): boolean {
  return CALLER_PARAM.test(name);
}

/** Does this source text name the caller — `req.user`, or a local bound to it? */
export function mentionsCaller(text: string, callers: Set<string>): boolean {
  if (/\breq\s*\.\s*user\b/.test(text)) return true;
  for (const c of callers) {
    if (new RegExp(`\\b${c}\\b`).test(text)) return true;
  }
  return false;
}

/** A denial the walker can see, in the same shapes rule 1 recognises. */
function isDenial(node: ts.Node, sf: ts.SourceFile): boolean {
  if (ts.isCallExpression(node)) {
    const callee = node.expression.getText(sf);
    if (/\bres\s*\.\s*status\b/.test(callee)) {
      const arg = node.arguments[0];
      if (arg && /^(401|403|404)$/.test(arg.getText(sf))) return true;
    }
    if (/\bsendForbidden\b/.test(callee)) return true;
  }
  if (ts.isNewExpression(node) && /\bAppError\b/.test(node.expression.getText(sf))) {
    const arg = node.arguments?.[0];
    if (arg && /^(401|403|404)$/.test(arg.getText(sf))) return true;
  }
  return false;
}

/**
 * Callees that decide, from the caller's identity, what may come back.
 *
 * Two shapes. The DENYING one — `assertJourneyParticipant`, `requireOwner` —
 * throws at an outsider. The PROJECTING one — `bidViewerScope`,
 * `journeyViewerScope` — never throws; it returns which projection this
 * viewer gets, and on a marketplace route that is the only fix available,
 * because a driver must be able to inspect a journey he is not yet part of.
 * A rule that only recognised the denying shape would report every correctly
 * scoped read on the platform as a finding.
 */
const GUARD_CALLEE = /^(assert|require|ensure|verify|check|guard)[A-Z]|ViewerScope$/;

/**
 * Blind spot (a), CONTINUED — a selector shared ACROSS modules.
 *
 * The resolver below has always resolved a hoisted selector declared in the
 * SAME file, and reported one it could not resolve as an unknown, on the
 * principle that an unresolved read is not a clean read. That was right and
 * it stayed right until a projection was deliberately given ONE definition
 * for several exits to share.
 *
 * MONEY-VIEW v2 (#207) is that case: `CURATED_BIDDER_SELECT` is the single
 * answer to "what does a passenger see of a motari who has bid?", applied at
 * three reads across two services precisely so a second copy cannot drift
 * from the first. Under the old resolver those three reads became three
 * UNKNOWNs, and the only way past was `include-allowlist.json` — which would
 * have blinded this guard to the exact field set that dispatch existed to
 * narrow. The oracle would have gone quiet about the room it was pointed at.
 *
 * So the fix is resolution, not attestation: one pre-pass collects every
 * `export const NAME = …` across the walked files, and each file is seeded
 * with the ones it actually IMPORTS by name. A local const of the same name
 * still wins; only a gap is filled.
 *
 * AMBIGUITY IS AN UNKNOWN, not a guess. If two files export the same name
 * with different initializers, the entry is DROPPED rather than resolved to
 * whichever was walked first — the read then reports as unresolved, which is
 * the honest answer and the behaviour that existed before.
 */
export type ExportedSelectors = Map<string, ts.Expression>;

export function collectExportedSelectors(
  readFile: (rel: string) => string,
  files: string[],
): ExportedSelectors {
  const byName = new Map<string, { expr: ts.Expression; file: string }>();
  const ambiguous = new Set<string>();
  for (const rel of files) {
    const sf = ts.createSourceFile(rel, readFile(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const stmt of sf.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      const isExported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!isExported) continue;
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        const prior = byName.get(d.name.text);
        if (prior && prior.file !== rel) {
          ambiguous.add(d.name.text);
          continue;
        }
        byName.set(d.name.text, { expr: d.initializer, file: rel });
      }
    }
  }
  const out: ExportedSelectors = new Map();
  for (const [name, { expr }] of byName) {
    if (!ambiguous.has(name)) out.set(name, expr);
  }
  return out;
}

export function extractFromSource(
  rel: string,
  code: string,
  schema: PrismaSchema,
  exported?: ExportedSelectors,
): ReachFunctionRecord[] {
  const sf = ts.createSourceFile(rel, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  // Blind spot (a): every module-level const selector, resolvable by name.
  const consts = new Map<string, ts.Expression>();
  const anyNames = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(d.name)) continue;
      if (d.type && d.type.kind === ts.SyntaxKind.AnyKeyword) anyNames.add(d.name.text);
      if (d.initializer) consts.set(d.name.text, d.initializer);
    }
  }

  // …and the ones this file IMPORTS. Named bindings only, and only where
  // the file has no local const of that name — a local declaration is the
  // more specific answer and keeps precedence.
  if (exported) {
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt)) continue;
      const bindings = stmt.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const el of bindings.elements) {
        const localName = el.name.text;
        if (consts.has(localName)) continue;
        const sourceName = (el.propertyName ?? el.name).text;
        const resolved = exported.get(sourceName);
        if (resolved) consts.set(localName, resolved);
      }
    }
  }

  const records: ReachFunctionRecord[] = [];

  const walk = (
    node: ts.Node,
    owner: ReachFunctionRecord | null,
    callers: Set<string>,
    localAny: Set<string>,
    scoped: Map<string, ts.Expression>,
    inCallerBranch: boolean,
  ): void => {
    // A denial only restricts if it is REACHED BY a caller test. The 404 at
    // the top of a `findUnique` — "no such row" — is not an authorisation
    // decision, and counting it as one is precisely how `getJourneyById`
    // would have hidden from its own oracle.
    if (ts.isIfStatement(node) && owner !== null) {
      const condIsCaller = mentionsCaller(node.expression.getText(sf), callers);
      walk(node.expression, owner, callers, localAny, scoped, inCallerBranch);
      walk(node.thenStatement, owner, callers, localAny, scoped, inCallerBranch || condIsCaller);
      if (node.elseStatement) {
        walk(node.elseStatement, owner, callers, localAny, scoped, inCallerBranch || condIsCaller);
      }
      return;
    }
    if (ts.isConditionalExpression(node) && owner !== null) {
      const condIsCaller = mentionsCaller(node.condition.getText(sf), callers);
      walk(node.condition, owner, callers, localAny, scoped, inCallerBranch);
      walk(node.whenTrue, owner, callers, localAny, scoped, inCallerBranch || condIsCaller);
      walk(node.whenFalse, owner, callers, localAny, scoped, inCallerBranch || condIsCaller);
      return;
    }

    if (isFunctionLike(node)) {
      const nextCallers = new Set(callers);
      const nextAny = new Set(localAny);
      for (const p of node.parameters) {
        if (!ts.isIdentifier(p.name)) continue;
        if (isCallerName(p.name.text)) nextCallers.add(p.name.text);
        // blind spot (b): `(tx: any)` — MONEY-ATOMIC's two hidden defects.
        if (!p.type || p.type.kind === ts.SyntaxKind.AnyKeyword) nextAny.add(p.name.text);
      }
      const nextScoped = new Map(scoped);
      const declared = nameOf(sf, node);
      let nextOwner = owner;
      if (declared !== null || owner === null) {
        nextOwner = {
          file: rel,
          name: declared ?? `<anonymous>@${lineOf(node)}`,
          line: lineOf(node),
          reads: [],
          calls: [],
          denialLines: [],
          assertLines: [],
          restrictions: [],
          usesCaller: false,
        };
        records.push(nextOwner);
      }
      for (const child of node.getChildren(sf)) {
        walk(child, nextOwner, nextCallers, nextAny, nextScoped, false);
      }
      return;
    }

    if (owner !== null) {
      // A local bound to a caller-derived value is itself caller-derived —
      // `const scope = journeyViewerScope(requestingUserId, base)`.
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const text = node.initializer.getText(sf);
        // Blind spot (a), the local half: a selector hoisted into a const
        // one line above the read is exactly as invisible as a module-level
        // one if the walker only looks at module scope.
        scoped.set(node.name.text, node.initializer);
        if (mentionsCaller(text, callers)) callers.add(node.name.text);
        if (
          (node.type && node.type.kind === ts.SyntaxKind.AnyKeyword) ||
          /\bas\s+any\b/.test(text)
        ) {
          localAny.add(node.name.text);
        }
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer &&
        mentionsCaller(node.initializer.getText(sf), callers)
      ) {
        for (const el of node.name.elements) {
          if (ts.isIdentifier(el.name)) callers.add(el.name.text);
        }
      }

      if (inCallerBranch && isDenial(node, sf)) owner.denialLines.push(lineOf(node));

      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(sf);
        if (!/\bres\s*\.|\bnext\b|\bconsole\b/.test(callee)) {
          const seg = lastSegment(callee);
          if (!owner.calls.includes(seg)) owner.calls.push(seg);
          const passesCaller = node.arguments.some((a) => mentionsCaller(a.getText(sf), callers));
          if (passesCaller && GUARD_CALLEE.test(seg)) owner.assertLines.push(lineOf(node));
        }
      }

      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const access = node.expression;
        const method = access.name.text;
        if (READ_METHODS.has(method) && ts.isPropertyAccessExpression(access.expression)) {
          const delegate = access.expression.name.text;
          const model = schema.delegates.get(delegate);
          const root = rootIdentifier(access.expression);
          const arg = node.arguments[0] ?? null;
          if (model) {
            const read = analyseRead(
              arg,
              model,
              method,
              lineOf(node),
              {
                schema,
                consts: new Map([...consts, ...scoped]),
                exported,
                sf,
                anyNames: new Set([...anyNames, ...localAny]),
                reached: new Set(),
                direct: new Set(),
                unknowns: [],
                seen: new Set(),
              },
              callers,
              root && localAny.has(root.text) ? root.text : null,
            );
            if (read) owner.reads.push(read);
          }
        }
      }

      if (ts.isPropertyAccessExpression(node) || ts.isIdentifier(node)) {
        if (mentionsCaller(node.getText(sf), callers)) owner.usesCaller = true;
      }
    }

    for (const child of node.getChildren(sf)) {
      walk(child, owner, callers, localAny, scoped, inCallerBranch);
    }
  };

  for (const stmt of sf.statements) walk(stmt, null, new Set(), new Set(), new Map(), false);

  for (const r of records) {
    r.restrictions = [...new Set(r.restrictions)];
  }
  return records.filter((r) => r.reads.length > 0 || r.calls.length > 0);
}

/**
 * Flatten a Prisma query argument into its top-level key/value pairs,
 * resolving what can be resolved: spreads (blind spot d — a pagination
 * `...(cursor ? {…} : {})` is not a selector and must not be surrendered to
 * as one), conditionals, and named consts. What genuinely cannot be resolved
 * becomes an UNKNOWN rather than an assumed-empty query.
 */
function collectQueryProps(
  expr: ts.Expression,
  ctx: TraverseCtx,
  out: Array<{ key: string; value: ts.Expression }>,
  where: string,
  depth = 0,
): void {
  if (depth > 6) return;
  if (ts.isParenthesizedExpression(expr)) {
    collectQueryProps(expr.expression, ctx, out, where, depth + 1);
    return;
  }
  if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr)) {
    if (expr.type.kind === ts.SyntaxKind.AnyKeyword) {
      ctx.unknowns.push(`${where}: query argument is cast to \`any\``);
      return;
    }
    collectQueryProps(expr.expression, ctx, out, where, depth + 1);
    return;
  }
  if (ts.isConditionalExpression(expr)) {
    collectQueryProps(expr.whenTrue, ctx, out, where, depth + 1);
    collectQueryProps(expr.whenFalse, ctx, out, where, depth + 1);
    return;
  }
  if (ts.isIdentifier(expr)) {
    if (ctx.anyNames.has(expr.text)) {
      ctx.unknowns.push(`${where}: query argument \`${expr.text}\` is \`any\`-typed`);
      return;
    }
    const resolved = ctx.consts.get(expr.text) ?? ctx.exported?.get(expr.text);
    if (!resolved) {
      ctx.unknowns.push(`${where}: query argument \`${expr.text}\` is unresolved`);
      return;
    }
    collectQueryProps(resolved, ctx, out, where, depth + 1);
    return;
  }
  if (!ts.isObjectLiteralExpression(expr)) {
    ctx.unknowns.push(
      `${where}: query argument is a ${ts.SyntaxKind[expr.kind]}, not an object literal`,
    );
    return;
  }
  for (const prop of expr.properties) {
    if (ts.isSpreadAssignment(prop)) {
      collectQueryProps(prop.expression, ctx, out, where, depth + 1);
      continue;
    }
    if (ts.isShorthandPropertyAssignment(prop)) {
      // `{ where, include }` — the value is the identifier itself. Skipping
      // these (as this walker first did) reads the query as having no
      // selector at all: the quietest possible false clean.
      out.push({ key: prop.name.text, value: prop.name });
      continue;
    }
    if (!ts.isPropertyAssignment(prop)) continue;
    if (ts.isComputedPropertyName(prop.name)) {
      ctx.unknowns.push(`${where}: query argument has a computed key`);
      continue;
    }
    if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) continue;
    out.push({ key: prop.name.text, value: prop.initializer });
  }
}

function analyseRead(
  arg: ts.Expression | null,
  model: string,
  method: string,
  line: number,
  ctx: TraverseCtx,
  callers: Set<string>,
  anyClient: string | null,
): ReadRecord | null {
  const restrictions: Restriction[] = [];
  const where = `${model}.${method}`;

  const direct = PROTECTED_MODELS.has(model) ? [model] : [];

  if (anyClient) {
    // blind spot (b): a read through an `any`-typed client is unreadable.
    return {
      model,
      method,
      line,
      protectedReach: [],
      directReach: direct,
      unknowns: [`${where}: read runs through \`${anyClient}\`, which is \`any\`-typed`],
      restrictions,
    };
  }

  if (arg === null) {
    // `findMany()` — no filter, no selector. Reaches its own model whole.
    if (direct.length === 0) return null;
    return { model, method, line, protectedReach: [], directReach: direct, unknowns: [], restrictions };
  }

  const props: Array<{ key: string; value: ts.Expression }> = [];
  collectQueryProps(arg, ctx, props, where);

  let hasSelector = false;
  for (const { key, value } of props) {
    if (key === 'where') {
      if (mentionsCaller(value.getText(ctx.sf), callers)) restrictions.push('scoped-where');
      continue;
    }
    if (key !== 'include' && key !== 'select') continue;
    hasSelector = true;
    // The selector IS the check when the value is chosen from a
    // caller-derived expression — the `bidViewerScope` idiom.
    const selText = value.getText(ctx.sf);
    const chosen =
      ts.isConditionalExpression(value) ||
      (ts.isIdentifier(value) && callers.has(value.text)) ||
      ts.isCallExpression(value);
    if (chosen && mentionsCaller(selText, callers)) restrictions.push('scoped-projection');
    traverseSelector(value, model, ctx, where);
  }

  for (const m of direct) ctx.direct.add(m);

  // Nothing protected anywhere near this read, and nothing unreadable:
  // it is not census material at all.
  if (ctx.reached.size === 0 && ctx.direct.size === 0 && ctx.unknowns.length === 0) return null;

  return {
    model,
    method,
    line,
    protectedReach: [...ctx.reached].sort(),
    directReach: [...ctx.direct].sort(),
    unknowns: ctx.unknowns,
    restrictions: [...new Set(restrictions)],
  };
}

export interface ReachConfig {
  root: string;
  /** Repo-relative directories to walk — every server `.ts` root under `pnpm typecheck`. */
  srcDirs: string[];
  /** Repo-relative path of schema.prisma. */
  schemaFile: string;
}

export const DEFAULT_REACH_CONFIG: Omit<ReachConfig, 'root'> = {
  srcDirs: [
    path.join('packages', 'server', 'src'),
    path.join('packages', 'server', 'scripts'),
    path.join('packages', 'server', 'prisma'),
  ],
  schemaFile: path.join('packages', 'server', 'prisma', 'schema.prisma'),
};

function listTsFiles(dir: string, rootLen: number, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'migrations') continue;
      listTsFiles(full, rootLen, out);
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts') || entry.name.endsWith('.d.ts')) continue;
    out.push(full.slice(rootLen + 1).split(path.sep).join('/'));
  }
}

export function buildReachMap(cfg: ReachConfig): ReachMap {
  const schema = parsePrismaSchema(fs.readFileSync(path.join(cfg.root, cfg.schemaFile), 'utf8'));
  const files: string[] = [];
  for (const dir of cfg.srcDirs) listTsFiles(path.join(cfg.root, dir), cfg.root.length, files);

  const readFile = (rel: string) => fs.readFileSync(path.join(cfg.root, rel), 'utf8');
  // One pre-pass, so a selector shared by several exits resolves at all of
  // them instead of becoming an unknown at each.
  const exported = collectExportedSelectors(readFile, files);

  const functions: ReachFunctionRecord[] = [];
  for (const rel of files) {
    functions.push(...extractFromSource(rel, readFile(rel), schema, exported));
  }
  functions.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { functions, files, roots: cfg.srcDirs.map((d) => d.split(path.sep).join('/')) };
}
