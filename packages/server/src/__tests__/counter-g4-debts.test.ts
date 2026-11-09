// __TESTS__/COUNTER-G4-DEBTS.TEST.TS
//
// COUNTER-READY G5 — the two G4 debts that a green suite alone cannot
// prove were paid.
//
// A deletion and a rename are both invisible to behavioural tests: the
// suite is just as green with the dead symbol still sitting there. So
// each is pinned at the SOURCE — the #202 shape (escrow-no-delete.test),
// which pairs the tripwire with a CONTROL assertion so a sweep that
// silently stopped matching anything cannot pass by matching nothing.

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const SRC = resolve(__dirname, '..');

function productionSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : productionSources(full);
    }
    return /\.ts$/.test(entry) ? [full] : [];
  });
}

/** Every .ts in the server package EXCEPT this file, which necessarily
 *  names the retired symbol in order to assert nobody else does. */
function allSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return allSources(full);
    if (full === __filename.replace(/\.js$/, '.ts') || full.endsWith('counter-g4-debts.test.ts')) {
      return [];
    }
    return /\.ts$/.test(entry) ? [full] : [];
  });
}

/** Source hits for a symbol, ignoring the lines that merely name it in
 *  prose (the rename's own explanatory comments). */
function symbolHits(files: string[], symbol: string): string[] {
  const re = new RegExp(`\\b${symbol}\\b`);
  const hits: string[] = [];
  for (const file of files) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
      if (re.test(code)) hits.push(`${file.slice(SRC.length + 1)}:${i + 1}`);
    });
  }
  return hits;
}

describe('G4(b) — assertVelocityOk was renamed, everywhere', () => {
  test('the old symbol appears in no code anywhere in the server package', () => {
    // Census, not spot-check: declaration, barrel export, call site and
    // tests were the four classes, and this asserts the union is empty.
    expect(symbolHits(allSources(SRC), 'assertVelocityOk')).toEqual([]);
  });

  test('CONTROL — the new symbol is found, in the places the old one was', () => {
    // Without this, the sweep above would pass just as happily if the
    // function had been deleted, or if the matcher had quietly stopped
    // matching anything at all.
    const hits = symbolHits(allSources(SRC), 'observeVelocity');
    expect(hits.length).toBeGreaterThanOrEqual(4);
    expect(hits.some((h) => h.startsWith('services/aml/limits.ts'))).toBe(true);
    expect(hits.some((h) => h.startsWith('services/aml/index.ts'))).toBe(true);
    expect(hits.some((h) => h.startsWith('services/journey.service.ts'))).toBe(true);
  });

  test('it is still exported from the aml barrel, and still a function', () => {
    const aml = require('../services/aml');
    expect(typeof aml.observeVelocity).toBe('function');
    expect(aml.assertVelocityOk).toBeUndefined();
  });

  test('and it still does not assert: no throw statement in its body', () => {
    // The whole justification for the rename. If a future edit gives it
    // a throwing branch, the D17 call site's fire-and-forget catch is
    // the only thing between it and the booking path — and the name
    // would be wrong again.
    const src = readFileSync(join(SRC, 'services/aml/limits.ts'), 'utf8');
    const body = src.slice(src.indexOf('export async function observeVelocity'));
    const fnBody = body.slice(0, body.indexOf('\n}\n') + 2);
    expect(fnBody).not.toMatch(/\bthrow\b/);
  });
});

describe('G4(a) — the seven orphaned notify helpers are gone', () => {
  const DELETED = [
    'notifyJourneyStarted',
    'notifyJourneyEnded',
    'notifyJourneyConfirmed',
    'notifyJourneyCancelled',
    'notifyJourneyDisputed',
    'notifyJourneyInterrupted',
    'notifyNewMessage',
  ];

  test.each(DELETED)('%s is no longer exported', (name) => {
    const svc = require('../services/notification.service');
    expect(svc[name]).toBeUndefined();
  });

  test('and no production code references any of them', () => {
    const files = productionSources(SRC);
    const offenders = DELETED.flatMap((name) => symbolHits(files, name));
    expect(offenders).toEqual([]);
  });

  test('CONTROL — the live helpers next to them are untouched', () => {
    // Seven neighbours deleted from one file is exactly the edit that
    // takes an eighth with it.
    const svc = require('../services/notification.service');
    for (const name of [
      'notifyBidReceived',
      'notifyBidAccepted',
      'notifyBidDeclined',
      'notifyEscrowReleased',
      'notifyEscrowRefunded',
      'notifyRatingReceived',
      'notifyDriverNoShowWarning',
      'notifyDriverVerificationApproved',
      'notifyBidCountered',
      'notifyCounterAccepted',
      'notifyCounterDeclined',
    ]) {
      expect(typeof svc[name]).toBe('function');
    }
  });

  test('their push vocabulary is deliberately KEPT', () => {
    // Deleting an uncalled helper decides nothing about the surface it
    // was written for; the string catalogue is not this dispatch's to
    // prune, and asserting so keeps a later cleanup honest about what
    // it is doing.
    const { NOTIFICATION_STRINGS } = require('@bimoto/shared');
    for (const key of ['journeyStarted', 'journeyEnded', 'newMessage']) {
      expect(NOTIFICATION_STRINGS.en[key]).toBeDefined();
    }
  });
});
