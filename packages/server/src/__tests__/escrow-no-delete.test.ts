// __TESTS__/ESCROW-NO-DELETE.TEST.TS
//
// MAP-TRUTH G6 — no money row is ever deleted.
//
// handlePaymentFailure sat in escrow.service.ts with no callers for long
// enough to be reported twice, deleting an escrow row and taking its
// audit chain with it by cascade. PAY-TRUTH G1 (#153) flagged it and left
// it in place with a hazard comment; this dispatch deleted it. A comment
// is not a guard, so this is:
//
//   * a source-level sweep, because the danger is code EXISTING, not
//     code running — a dead function is exactly how the last one
//     survived two reviews;
//   * plus the invariant it protects, stated where the next person will
//     read it.
//
// A payment failure is a fact about money. markEscrowChargeFailed
// supersedes the row (PENDING → FAILED) and writes an audit entry;
// refunds and releases transition it. None of them erase it.

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const SRC = resolve(__dirname, '..');

function productionSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Tests may mock or assert on deletion; production code may not.
      return entry === '__tests__' ? [] : productionSources(full);
    }
    return /\.ts$/.test(entry) ? [full] : [];
  });
}

describe('no money row is ever deleted (MAP-TRUTH G6)', () => {
  test('no production code deletes an escrow row', () => {
    const offenders = productionSources(SRC)
      .map((file) => ({ file, src: readFileSync(file, 'utf8') }))
      .filter(({ src }) => /\bescrow\s*\.\s*delete(Many)?\s*\(/.test(src))
      .map(({ file }) => file.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });

  test('no production code deletes an escrow audit entry', () => {
    // The chain is only worth as much as its weakest link: erasing the
    // audit rows is the same loss as erasing the escrow.
    const offenders = productionSources(SRC)
      .map((file) => ({ file, src: readFileSync(file, 'utf8') }))
      .filter(({ src }) => /\bescrowAudit\w*\s*\.\s*delete(Many)?\s*\(/.test(src))
      .map(({ file }) => file.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });

  test('handlePaymentFailure is gone, and did not come back', () => {
    const escrowService = require('../services/escrow.service');
    expect(escrowService.handlePaymentFailure).toBeUndefined();
  });

  test('the live failure path is still exported', () => {
    // Deleting the hazard must not have taken the real path with it.
    const escrowService = require('../services/escrow.service');
    expect(typeof escrowService.markEscrowChargeFailed).toBe('function');
  });
});
