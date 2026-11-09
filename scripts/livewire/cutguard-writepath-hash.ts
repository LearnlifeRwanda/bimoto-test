/**
 * CUTGUARD v2 §3 — the write-path hash assertion.
 *
 * THE INVARIANT this dispatch committed to: no money or matching WRITE
 * path changes semantics. Every change was a read-projection, an
 * authorization-correctness fix, a payload allowlist, a type, a guard, or
 * additive plumbing.
 *
 * That is an easy thing to say and a hard thing to prove by reading a
 * diff, because the diff for this dispatch touches the same FILES the
 * money writers live in — G3 retyped a breakdown in bid.service, G4
 * changed acceptBidCore's signature. So this proves it the other way: it
 * extracts each money-writing function's body from the baseline commit
 * and from the working tree, normalises nothing, and compares SHA-256.
 *
 * `acceptBidCore` is deliberately NOT in this set and could not be: G4
 * changed its parameter type, which is the whole point of G4. Its
 * transaction body is verified separately, by the git diff, and the
 * report says so rather than hiding it behind a hash that would have to
 * be excused.
 *
 * Run:
 *   npx tsx scripts/livewire/cutguard-writepath-hash.ts [baseline-ref]
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

const BASELINE = process.argv[2] ?? 'abb6a26';
const ROOT = path.resolve(__dirname, '..', '..');

/**
 * The money and matching WRITERS. Each one either moves money, records
 * that money moved, or decides what a settlement is worth.
 *
 * Chosen by walking the three modules that own money at rest — the escrow
 * ledger, the payout ledger, and the fee-waiver resolver — and taking
 * every exported function that WRITES. A reader that changes only what is
 * shown is not here, because this set is about semantics, not surface.
 */
const WRITE_PATHS: Array<{ file: string; fn: string }> = [
  // The escrow ledger — money in, money out, money held.
  { file: 'packages/server/src/services/escrow.service.ts', fn: 'createEscrowTx' },
  { file: 'packages/server/src/services/escrow.service.ts', fn: 'adoptEscrowTx' },
  { file: 'packages/server/src/services/escrow.service.ts', fn: 'markEscrowChargeSucceeded' },
  { file: 'packages/server/src/services/escrow.service.ts', fn: 'markEscrowChargeFailed' },
  { file: 'packages/server/src/services/escrow.service.ts', fn: 'releaseEscrowTx' },
  { file: 'packages/server/src/services/escrow.service.ts', fn: 'refundEscrowTx' },
  { file: 'packages/server/src/services/escrow.service.ts', fn: 'freezeEscrowTx' },
  // The payout ledger — what a driver is owed and when it is sent.
  { file: 'packages/server/src/services/payout.service.ts', fn: 'creditDriverBalance' },
  { file: 'packages/server/src/services/payout.service.ts', fn: 'createPendingBatch' },
  { file: 'packages/server/src/services/payout.service.ts', fn: 'markBatchPaidOut' },
  // What the settlement is worth.
  { file: 'packages/server/src/services/fee-waiver/apply.ts', fn: 'applyWaiver' },
];

function fileAt(ref: string, file: string): string | null {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], {
      cwd: ROOT,
      maxBuffer: 32 * 1024 * 1024,
    }).toString();
  } catch {
    return null;
  }
}

/** The exact source text of one top-level function, or null. */
function functionText(source: string, file: string, name: string): string | null {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found: string | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = node.getText(sf);
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      found = node.getText(sf);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);

/**
 * `acceptBidCore`'s `$transaction` body, extracted by brace-matching from
 * the `prisma.$transaction(async (tx: any) => {` that opens it.
 *
 * G4 changed that function's SIGNATURE — `customerId: string` became
 * `actor: BidAcceptActor` — so the function as a whole cannot be hashed
 * against the baseline and must not be: the change is the point. What
 * must be unchanged is the write LOGIC, and this is how that is proved
 * rather than asserted. `customerId` inside the transaction is now
 * derived once from `journey.customerId` above it, so every statement in
 * here reads the same name and the same value it always did.
 */
function transactionBody(source: string): string | null {
  const marker = 'await prisma.$transaction(async (tx: any) => {';
  const at = source.indexOf(marker);
  if (at === -1) return null;
  const open = source.indexOf('{', source.indexOf('=> {', at));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

function checkAcceptBidCoreTransaction(): boolean {
  const file = 'packages/server/src/services/bid.service.ts';
  const beforeSrc = fileAt(BASELINE, file);
  const afterSrc = fs.readFileSync(path.join(ROOT, file), 'utf8');
  if (!beforeSrc) return false;

  const before = transactionBody(beforeSrc);
  const after = transactionBody(afterSrc);
  if (!before || !after) {
    console.log('  MISSING    acceptBidCore $transaction body');
    return false;
  }

  const b = sha(before);
  const a = sha(after);
  console.log(
    `\nacceptBidCore — the SIGNATURE changed (G4), so the function is not hashed.\n` +
      `Its write LOGIC is, and that is the claim that matters:`,
  );
  if (b === a) {
    console.log(`  IDENTICAL  $transaction body            ${a}  (${after.length} chars)`);
    return true;
  }
  console.log(`  CHANGED    $transaction body            ${b} -> ${a}`);
  return false;
}

function main(): void {
  console.log(`\nCUTGUARD v2 — money/matching write-path hashes vs ${BASELINE}\n`);

  let identical = 0;
  const changed: string[] = [];
  const missing: string[] = [];

  for (const { file, fn } of WRITE_PATHS) {
    const beforeSrc = fileAt(BASELINE, file);
    const afterSrc = fs.existsSync(path.join(ROOT, file))
      ? fs.readFileSync(path.join(ROOT, file), 'utf8')
      : null;

    if (!beforeSrc || !afterSrc) {
      missing.push(`${file} :: ${fn} — file absent in ${!beforeSrc ? BASELINE : 'working tree'}`);
      continue;
    }

    const before = functionText(beforeSrc, file, fn);
    const after = functionText(afterSrc, file, fn);

    if (!before || !after) {
      missing.push(`${file} :: ${fn} — function not found in ${!before ? BASELINE : 'working tree'}`);
      continue;
    }

    const b = sha(before);
    const a = sha(after);
    if (b === a) {
      identical++;
      console.log(`  IDENTICAL  ${fn.padEnd(28)} ${a}  (${file})`);
    } else {
      changed.push(`${fn} — ${b} -> ${a} (${file})`);
      console.log(`  CHANGED    ${fn.padEnd(28)} ${b} -> ${a}  (${file})`);
    }
  }

  console.log(
    `\n${identical}/${WRITE_PATHS.length} money/matching write paths byte-identical to ${BASELINE}.`,
  );
  for (const m of missing) console.log(`  MISSING  ${m}`);
  for (const c of changed) console.log(`  CHANGED  ${c}`);

  const txOk = checkAcceptBidCoreTransaction();

  if (changed.length || missing.length || !txOk) process.exitCode = 1;
}

main();
