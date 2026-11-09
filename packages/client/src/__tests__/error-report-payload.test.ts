// FLIGHT-RECORDER G2 — the serializer both send paths share.
//
// Its job is grouping and bounds, never redaction: redaction already
// happened at write time inside the ledger, and a second pass here would
// imply the first needed backing up. So the assertions below are about
// what the payload SAYS, and one of them is about what it must never
// quietly stop saying — a dropped entry leaves a marker.

import { describe, test, expect } from 'vitest';
import {
  MAX_REPORT_ENTRIES,
  buildErrorReport,
  serializeErrorReport,
} from '../services/error-report-payload';
import { errorFingerprint } from '@bimoto/shared';
import type { ErrorLedgerEntry } from '../services/error-ledger';

function entry(over: Partial<ErrorLedgerEntry> = {}): ErrorLedgerEntry {
  return {
    t: 1_700_000_000_000,
    build: 'abc1234',
    route: '/ride',
    kind: 'window-error',
    message: 'something broke',
    ...over,
  };
}

describe('fingerprints group what is the same', () => {
  test('the same fault twice gets one fingerprint', () => {
    const a = buildErrorReport([entry()]).entries[0].fp;
    const b = buildErrorReport([entry({ t: 1_700_000_009_999, route: '/other' })]).entries[0].fp;
    expect(a).toBe(b);
  });

  test('ids and numbers inside a message do not split a group', () => {
    const one = entry({ message: "no bid for journey 8f2c1a44-1111-4222-8333-444455556666" });
    const two = entry({ message: "no bid for journey 0011dead-9999-4888-8777-666655554444" });
    const built = buildErrorReport([one, two]);
    expect(built.entries).toHaveLength(1);
    expect(built.entries[0].dup).toBe(2);
  });

  test('a different kind is a different group even with the same words', () => {
    const built = buildErrorReport([
      entry({ kind: 'window-error', message: 'same words' }),
      entry({ kind: 'unhandled-rejection', message: 'same words' }),
    ]);
    expect(built.entries).toHaveLength(2);
  });

  test('the client fingerprint is the shared one, not a private copy', () => {
    const e = entry({ stack: 'at doThing (https://app/index-a1b2c3d4.js:10:5)' });
    expect(buildErrorReport([e]).entries[0].fp).toBe(
      errorFingerprint({ kind: e.kind, message: e.message, stack: e.stack }),
    );
  });

  test('a build that shifts line numbers does not shatter a group', () => {
    const before = entry({ stack: 'at doThing (https://app/assets/index-aaaaaaaa.js:10:5)' });
    const after = entry({ stack: 'at doThing (https://app/assets/index-bbbbbbbb.js:42:9)' });
    expect(buildErrorReport([before]).entries[0].fp).toBe(
      buildErrorReport([after]).entries[0].fp,
    );
  });
});

describe('collapse keeps the newest occurrence', () => {
  test('the surviving row carries the newest timestamp and route', () => {
    const built = buildErrorReport([
      entry({ t: 300, route: '/newest' }),
      entry({ t: 200, route: '/middle' }),
      entry({ t: 100, route: '/oldest' }),
    ]);
    expect(built.entries).toHaveLength(1);
    expect(built.entries[0].t).toBe(300);
    expect(built.entries[0].route).toBe('/newest');
    expect(built.entries[0].dup).toBe(3);
  });

  test('a single occurrence carries no dup at all', () => {
    expect(buildErrorReport([entry()]).entries[0].dup).toBeUndefined();
  });
});

describe('bounds are visible, never silent', () => {
  test('a payload over the cap keeps the newest and says what it dropped', () => {
    // Letters, not numbers: the normaliser flattens every digit, so
    // "fault 1" and "fault 2" are deliberately ONE group.
    const many = Array.from({ length: MAX_REPORT_ENTRIES + 10 }, (_, i) =>
      entry({ t: 10_000 - i, message: `fault ${'x'.repeat(i + 1)}` }),
    );
    const built = buildErrorReport(many);

    expect(built.entries).toHaveLength(MAX_REPORT_ENTRIES);
    expect(built.entries[0].message).toBe('fault x');
    const marker = built.entries[built.entries.length - 1];
    expect(marker.kind).toBe('upload-dropped');
    expect(marker.message).toContain('11');
  });

  test('exactly at the cap nothing is dropped and no marker appears', () => {
    const many = Array.from({ length: MAX_REPORT_ENTRIES }, (_, i) =>
      entry({ t: 10_000 - i, message: `fault ${'x'.repeat(i + 1)}` }),
    );
    const built = buildErrorReport(many);
    expect(built.entries).toHaveLength(MAX_REPORT_ENTRIES);
    expect(built.entries.some((e) => e.kind === 'upload-dropped')).toBe(false);
  });
});

describe('the bytes', () => {
  test('serializeErrorReport is buildErrorReport, stringified', () => {
    const entries = [entry(), entry({ message: 'another' })];
    expect(serializeErrorReport(entries)).toBe(JSON.stringify(buildErrorReport(entries)));
  });

  test('an empty ledger serialises to an empty entries array', () => {
    expect(buildErrorReport([]).entries).toEqual([]);
  });
});
