// EXPORT-AND-LEDGER G4 — founder decision D10, pinned as a tripwire.
//
// D10 removed POST /api/journeys/:id/customer-complete so that the app has
// exactly ONE way to end a ride: the driver declares and the customer
// confirms, or the auto-confirm does it for her. Interrupt plus
// reconciliation is the rescue for the stuck case, and it is a different
// path with a different name.
//
// A deletion is the easiest thing in a codebase to un-delete by accident —
// a revert, a merge that resurrects a hunk, a future dispatch reading the
// endpoint's name in an old wiring report and helpfully wiring it up. So
// this file asserts the removal two ways: BEHAVIOURALLY (the route is
// gone) and STRUCTURALLY (no source file mentions it), the second in the
// shape NotifyNoInbox.test.ts uses on the client — read the source, not
// the prose, because what is being defended against is a future edit
// rather than a current bug.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findUnique: jest.fn(), update: jest.fn() },
    journeyReconciliationResponse: { upsert: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    user: { update: jest.fn() },
    escrow: { findUnique: jest.fn() },
  },
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import journeyRoutes from '../routes/journey.routes';
import * as journeyService from '../services/journey.service';
import { SOCKET_EVENTS } from '@bimoto/shared';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/journeys', journeyRoutes);
app.use(errorHandler);

const customerCookie = `accessToken=${generateAccessToken({ userId: 'c1', role: 'CUSTOMER' })}`;

describe('D10 — the endpoint is gone', () => {
  test('POST /api/journeys/:id/customer-complete 404s for an authenticated customer', async () => {
    const res = await request(app)
      .post('/api/journeys/j1/customer-complete')
      .set('Cookie', customerCookie);
    expect(res.status).toBe(404);
  });

  test('the router mounts no such path at all — 404 without a cookie either', async () => {
    const res = await request(app).post('/api/journeys/j1/customer-complete');
    expect(res.status).toBe(404);
  });

  test('the service exports no customerCompleteJourney', () => {
    expect((journeyService as Record<string, unknown>).customerCompleteJourney).toBeUndefined();
  });

  test('the socket constant is retired', () => {
    expect(
      (SOCKET_EVENTS as unknown as Record<string, string>).JOURNEY_CUSTOMER_COMPLETED,
    ).toBeUndefined();
    expect(Object.values(SOCKET_EVENTS)).not.toContain('journey-customer-completed');
  });

  test('the two ways a ride ENDS still exist, so this is a removal and not a breakage', () => {
    expect(typeof journeyService.endJourney).toBe('function');
    expect(typeof journeyService.confirmJourney).toBe('function');
    // and the rescue for the stuck case
    expect(typeof journeyService.interruptJourney).toBe('function');
    expect(typeof journeyService.recordReconciliationResponse).toBe('function');
  });
});

// ------------------------------------------------------------- grep-clean

const ROOTS = [
  join(__dirname, '..'), // packages/server/src
  join(__dirname, '..', '..', '..', 'shared', 'src'),
  join(__dirname, '..', '..', '..', 'client', 'src'),
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** This file names all four tokens on purpose; it is the tripwire. */
const SELF = __filename;

/**
 * The one other file allowed to say the words, and why.
 *
 * Deleting a name from the codebase and deleting the RECORD that it was
 * deleted are different acts, and the second one is how a removal gets
 * quietly undone two waves later by somebody who finds the endpoint in an
 * old wiring report and assumes it was an oversight. The socket contract
 * test's orphan registry carries a note saying the event was retired and
 * by which decision; that note has to name the event.
 *
 * So the exemption is not "this file may mention it" — it is "in this
 * file, every mention must be a COMMENT". A line of code reaching for the
 * token fails here exactly as it would anywhere else.
 */
const COMMENT_ONLY_EXEMPTIONS = [
  // The socket contract test's orphan registry: its note has to name the
  // event it retired.
  'packages/shared/src/__tests__/socket-event-contract.test.ts',
  // The swagger endpoint-count pin: its comment ledger records every wave
  // that moved the number, and D10's is the first DECREMENT it has ever
  // carried. This tripwire caught that comment on its first full run,
  // which is the tripwire working — and the answer is to exempt the
  // record, not to delete it.
  'packages/server/src/__tests__/swagger.test.ts',
];

const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

describe('D10 — no source file still reaches for it', () => {
  const files = ROOTS.flatMap((r) => sourceFiles(r)).filter((f) => f !== SELF);
  const rel = (f: string) =>
    relative(join(__dirname, '..', '..', '..', '..'), f).split('\\').join('/');

  test.each([
    ['customer-complete', /customer-complete/],
    ['customerCompleteJourney', /customerCompleteJourney/],
    ['JOURNEY_CUSTOMER_COMPLETED', /JOURNEY_CUSTOMER_COMPLETED/],
    ['CUSTOMER_INITIATED_DUE_HOURS', /CUSTOMER_INITIATED_DUE_HOURS/],
  ])('no file mentions %s outside a retirement note', (_label, pattern) => {
    const hits = files
      .filter((f) => pattern.test(readFileSync(f, 'utf8')))
      .map(rel)
      .filter((f) => !COMMENT_ONLY_EXEMPTIONS.includes(f));
    expect(hits).toEqual([]);
  });

  test.each(COMMENT_ONLY_EXEMPTIONS)('in %s every mention is a comment', (relPath) => {
    const full = files.find((f) => rel(f) === relPath);
    expect(full).toBeDefined();
    const mentions = readFileSync(full!, 'utf8')
      .split('\n')
      .filter((l) =>
        /customer-complete|customerCompleteJourney|JOURNEY_CUSTOMER_COMPLETED/i.test(l),
      );
    expect(mentions.length).toBeGreaterThan(0); // the note is still there
    for (const line of mentions) expect(isComment(line)).toBe(true);
  });

  test('the sweep is actually reading files — a control token IS found', () => {
    // Without this, a broken sourceFiles() would make every assertion
    // above pass over an empty list. INVALID_JOURNEY_STATE is a sibling
    // error code that survives D10 and must still be there.
    const hits = files.filter((f) => /recordReconciliationResponse/.test(readFileSync(f, 'utf8')));
    expect(hits.length).toBeGreaterThan(0);
  });

  test('the state-machine action is callerless but its rows say so', () => {
    // JourneyAction.CUSTOMER_COMPLETE is deliberately NOT removed (shared
    // vocabulary; D10 ruled on an endpoint). What must not happen is it
    // quietly reading as a live second way to end a ride, so both of its
    // rows carry a note. If somebody deletes the action, this test should
    // be deleted with it — it is not defending the action, it is
    // defending the explanation.
    const sm = readFileSync(
      join(__dirname, '..', '..', '..', 'shared', 'src', 'state-machine', 'journey-sm.ts'),
      'utf8',
    );
    expect(sm).toMatch(/CUSTOMER_COMPLETE has NO CALLER/);
    expect(sm).toMatch(/Callerless since D10/);
  });
});

// --------------------------------------------------------- guard entries

describe('D10 — both guard oracles moved with the code', () => {
  const repoRoot = join(__dirname, '..', '..', '..', '..');

  test('the txn-guard parked list is EMPTY', () => {
    const allowlist = JSON.parse(
      readFileSync(join(repoRoot, 'scripts', 'txn-guard', 'allowlist.json'), 'utf8'),
    ) as Array<{ key: string; class: string }>;
    expect(allowlist.filter((e) => e.class === 'a-parked')).toEqual([]);
    expect(allowlist.map((e) => e.key)).not.toContain(
      'customerCompleteJourney in packages/server/src/services/journey.service.ts',
    );
  });

  test('the wiring-audit allowlist no longer parks the endpoint', () => {
    const allowlist = JSON.parse(
      readFileSync(join(repoRoot, 'scripts', 'wiring-audit', 'allowlist.json'), 'utf8'),
    ) as Array<{ key: string }>;
    expect(allowlist.map((e) => e.key)).not.toContain(
      'endpoint POST /api/journeys/:id/customer-complete',
    );
  });
});
