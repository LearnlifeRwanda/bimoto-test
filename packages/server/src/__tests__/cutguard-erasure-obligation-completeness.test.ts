// CUTGUARD v2 G5 — the completeness ratchet.
//
//   EVERY WAY A USER ROW IS REFERENCED HAS BEEN ADJUDICATED, AND EVERY
//   ADJUDICATION THAT SAYS "BLOCKS" HAS A FACT BEHIND IT.
//
// THE FAILURE THIS EXISTS FOR. `collectBlockingFacts` read five facts.
// The list was hand-maintained, so it could only ever contain what
// somebody had thought of — and nobody thought of bids. A driver with a
// PENDING offer was erased; a passenger then accepted from "Deleted
// User"; her money was HELD against an anonymised account she could not
// text. Adding a sixth fact by hand would leave the mechanism exactly as
// it was, and the seventh omission would be found the same way: in
// production, by somebody's money.
//
// So this test does not check that bids are handled. It derives the
// CANDIDATE SET from schema.prisma — every relation on `model User`, plus
// every model that references a user by id with no declared
// back-relation — and asserts that OBLIGATION_AUDIT covers it exactly, in
// both directions. Add a relation and the build tells you to adjudicate
// it. Delete one and the build tells you the audit has rotted.
//
// The undeclared-FK half is not a flourish. Five models reference a user
// with no back-relation on `model User`, and one of them is
// DriverBalance — the source of a fact that ALREADY EXISTED. A
// relation-only audit would have declared itself complete while missing
// the model behind one of its own five facts.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFERRAL_REASONS } from '@bimoto/shared';
import {
  OBLIGATION_AUDIT,
  firstBlockingReason,
  LIVE_BID_STATUSES,
  TERMINAL_BID_STATUSES,
  LIVE_PAYOUT_BATCH_STATUSES,
  TERMINAL_PAYOUT_BATCH_STATUSES,
  type BlockingFacts,
} from '../jobs/deletion-execution.job';

const SCHEMA = fs.readFileSync(
  path.join(__dirname, '..', '..', 'prisma', 'schema.prisma'),
  'utf8',
);

/** Every `model X { … }` in the schema. */
function models(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of SCHEMA.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    out.set(m[1], m[2]);
  }
  return out;
}

/** Relation fields declared on `model User`, derived — never listed. */
function userRelationFields(): Array<{ field: string; model: string }> {
  const all = models();
  const body = all.get('User');
  if (!body) throw new Error('model User not found in schema.prisma');
  const out: Array<{ field: string; model: string }> = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
    const m = /^(\w+)\s+(\w+)/.exec(line);
    if (!m) continue;
    const [, field, type] = m;
    if (all.has(type)) out.push({ field, model: type });
  }
  return out;
}

/**
 * Models that reference a user by id but declare NO back-relation on
 * `model User` — invisible to a relation-only walk, and the half that
 * matters most because nothing in the schema points at them from here.
 */
function undeclaredUserReferences(): Array<{ field: string; model: string }> {
  const all = models();
  const declared = new Set(userRelationFields().map((r) => r.model));
  const out: Array<{ field: string; model: string }> = [];
  for (const [name, body] of all) {
    if (name === 'User' || declared.has(name)) continue;
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      const m = /^(\w*(?:[Uu]serId|driverId|customerId|raisedById|reporterId))\s/.exec(line);
      if (m) {
        out.push({ field: `${name}.${m[1]}`, model: name });
        break;
      }
    }
  }
  return out;
}

/**
 * Facts that are COLUMNS on User rather than relations — `frozenAt`. The
 * audit carries them so it describes the whole fact set, not only its
 * relational half; they are named here so the coverage check knows they
 * are expected extras rather than rot.
 */
const COLUMN_FACTS = ['User.frozenAt'];

describe('the obligation audit covers the schema, exactly', () => {
  test('the candidate set is derived, and it is not small', () => {
    // A sanity floor: if the parser silently stopped matching, every
    // assertion below would pass vacuously.
    expect(userRelationFields().length).toBeGreaterThanOrEqual(25);
    expect(undeclaredUserReferences().length).toBeGreaterThanOrEqual(1);
  });

  test('EVERY relation on model User is adjudicated', () => {
    const audited = new Set(OBLIGATION_AUDIT.map((a) => a.relation));
    const missing = userRelationFields()
      .map((r) => r.field)
      .filter((f) => !audited.has(f));
    expect(missing).toEqual([]);
  });

  test('EVERY undeclared user reference is adjudicated', () => {
    // DriverBalance lives here, and it is the source of a fact that
    // already existed — proof that a relation-only audit is not enough.
    const audited = new Set(OBLIGATION_AUDIT.map((a) => a.relation));
    const missing = undeclaredUserReferences()
      .map((r) => r.field)
      .filter((f) => !audited.has(f));
    expect(missing).toEqual([]);
  });

  test('the audit contains nothing the schema does not — no rot', () => {
    const known = new Set([
      ...userRelationFields().map((r) => r.field),
      ...undeclaredUserReferences().map((r) => r.field),
      ...COLUMN_FACTS,
    ]);
    const stale = OBLIGATION_AUDIT.map((a) => a.relation).filter((r) => !known.has(r));
    expect(stale).toEqual([]);
  });

  test('every adjudication states a real reason', () => {
    for (const entry of OBLIGATION_AUDIT) {
      expect(entry.reason.trim().length).toBeGreaterThan(40);
      expect(entry.model.length).toBeGreaterThan(0);
    }
  });
});

describe('every blocking adjudication has a fact behind it', () => {
  test('a blocking entry names a BlockingFacts key', () => {
    for (const entry of OBLIGATION_AUDIT.filter((a) => a.blocks)) {
      expect(entry.fact).toBeDefined();
    }
  });

  test('a non-blocking entry names none — a fact with no rule is a lie', () => {
    for (const entry of OBLIGATION_AUDIT.filter((a) => !a.blocks)) {
      expect(entry.fact).toBeUndefined();
    }
  });

  test('every named fact actually defers, on its own', () => {
    // The load-bearing direction. It is not enough that a fact EXISTS;
    // setting it alone must produce a deferral. A fact wired into
    // BlockingFacts but forgotten in firstBlockingReason would pass every
    // check above and erase the account anyway.
    const clear: BlockingFacts = {
      hasNonTerminalJourney: false,
      hasLiveEscrow: false,
      hasOpenBid: false,
      hasUnresolvedEmergency: false,
      isFrozen: false,
      driverBalance: null,
      hasInFlightPayout: false,
      hasScheduledPayout: false,
    };
    expect(firstBlockingReason(clear)).toBeNull();

    for (const entry of OBLIGATION_AUDIT.filter((a) => a.blocks)) {
      const fact = entry.fact!;
      const facts: BlockingFacts = { ...clear };
      // `driverBalance` is a number, not a boolean; everything else is
      // the boolean it looks like.
      if (fact === 'driverBalance') facts.driverBalance = 1;
      else (facts as unknown as Record<string, boolean>)[fact] = true;

      const reason = firstBlockingReason(facts);
      expect(reason).not.toBeNull();
      expect(DEFERRAL_REASONS).toContain(reason);
    }
  });

  test('every fact on BlockingFacts is claimed by at least one adjudication', () => {
    // The reverse direction: a fact nobody's adjudication points at is a
    // fact whose justification has been lost.
    const claimed = new Set(OBLIGATION_AUDIT.filter((a) => a.blocks).map((a) => a.fact));
    const allFacts: Array<keyof BlockingFacts> = [
      'hasNonTerminalJourney',
      'hasLiveEscrow',
      'hasOpenBid',
      'hasUnresolvedEmergency',
      'isFrozen',
      'driverBalance',
      'hasInFlightPayout',
      'hasScheduledPayout',
    ];
    for (const fact of allFacts) {
      expect(claimed.has(fact)).toBe(true);
    }
  });
});

describe('the live-status sets are derived, not listed', () => {
  test('bid statuses partition the enum exactly', () => {
    const { BidStatus } = jest.requireActual('@prisma/client');
    const all = Object.values(BidStatus) as string[];
    expect([...LIVE_BID_STATUSES, ...TERMINAL_BID_STATUSES].sort()).toEqual([...all].sort());
    expect(LIVE_BID_STATUSES.filter((s) => TERMINAL_BID_STATUSES.includes(s))).toEqual([]);
  });

  test('a new bid status would BLOCK by default, not slip through', () => {
    // The whole reason LIVE_BID_STATUSES is a complement: an added
    // status is live until somebody deliberately declares it terminal.
    expect(LIVE_BID_STATUSES).toContain('PENDING');
    expect(TERMINAL_BID_STATUSES).not.toContain('PENDING');
  });

  test('payout batch statuses partition the enum exactly', () => {
    const { DriverPayoutStatus } = jest.requireActual('@prisma/client');
    const all = Object.values(DriverPayoutStatus) as string[];
    expect([...LIVE_PAYOUT_BATCH_STATUSES, ...TERMINAL_PAYOUT_BATCH_STATUSES].sort()).toEqual(
      [...all].sort(),
    );
  });
});

describe('B-4, as the audit records it', () => {
  test('bids block, and the entry says what went wrong', () => {
    const bids = OBLIGATION_AUDIT.find((a) => a.relation === 'bids');
    expect(bids?.blocks).toBe(true);
    expect(bids?.fact).toBe('hasOpenBid');
    expect(bids?.reason).toMatch(/Deleted User/);
  });

  test('an open bid alone defers with OPEN_BID', () => {
    expect(
      firstBlockingReason({
        hasNonTerminalJourney: false,
        hasLiveEscrow: false,
        hasOpenBid: true,
        hasUnresolvedEmergency: false,
        isFrozen: false,
        driverBalance: null,
        hasInFlightPayout: false,
        hasScheduledPayout: false,
      }),
    ).toBe('OPEN_BID');
  });
});
