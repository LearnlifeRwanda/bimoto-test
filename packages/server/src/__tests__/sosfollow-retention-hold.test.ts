// SOS-FOLLOW G3 — a journey with an open emergency is not swept.
//
// The existing retention suite (gps-retention.test.ts) emulates the
// sweep's SQL in JavaScript and is deliberately UNTOUCHED by this work:
// its emulation models the terminal-status predicate only, so it keeps
// asserting exactly what it always asserted, including the margin guard.
// That is the point — the alert hold must be additive.
//
// This file proves the addition in the two ways it can be proven without
// a database:
//
//   1. STATICALLY, against the job's real SQL. The clause either is in
//      the DELETE or it is not, and no in-memory emulation can tell you
//      which, so this reads the source. It is the only assertion here
//      that would survive somebody rewriting the emulation below.
//   2. SEMANTICALLY, by emulating the FULL predicate — terminal status
//      AND no ACTIVE alert — and driving the same journey through hold
//      and release.
//
// HOLD THEN RELEASE is the test that matters. A hold that never lets go
// is not a retention policy, it is an accidental forever, and the promise
// made to drivers is fourteen days.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    $executeRaw: jest.fn(),
    otpCode: { deleteMany: jest.fn() },
  },
}));

jest.mock('@sentry/node', () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

jest.mock('node-cron', () => ({
  __esModule: true,
  default: { schedule: jest.fn(() => ({ stop: jest.fn() })) },
}));

jest.mock('../services/job-lock', () => ({
  withJobLease: jest.fn(),
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import prisma from '../prisma';
import { _resetForTests, runGpsRetentionOnce } from '../jobs/gps-retention.job';

const JOB_SOURCE = readFileSync(
  join(__dirname, '../jobs/gps-retention.job.ts'),
  'utf8',
);

const TERMINAL = ['COMPLETED', 'CANCELLED', 'EXPIRED'];

interface Pt {
  id: string;
  timestamp: Date;
  journeyId: string;
  status: string;
}

const NOW = new Date();
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600 * 1000);

let points: Pt[] = [];
/** journeyIds currently holding an ACTIVE EmergencyAlert. */
let alerted: Set<string>;
let logSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  _resetForTests();
  points = [];
  alerted = new Set();
  logSpy = jest.spyOn(console, 'log').mockImplementation();

  (prisma.$executeRaw as jest.Mock).mockImplementation(
    async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const cutoff = values[0] as Date;
      const limit = values[1] as number;
      // The FULL predicate the real DELETE declares: old enough, on a
      // terminal journey, and NOT EXISTS an ACTIVE alert for it.
      const doomed = new Set(
        points
          .filter(
            (p) =>
              p.timestamp < cutoff &&
              TERMINAL.includes(p.status) &&
              !alerted.has(p.journeyId),
          )
          .slice(0, limit)
          .map((p) => p.id),
      );
      points = points.filter((p) => !doomed.has(p.id));
      return doomed.size;
    },
  );

  (prisma.otpCode.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
});

afterEach(() => logSpy.mockRestore());

describe('the clause is in the real SQL, not only in this file', () => {
  test('the sweep excludes journeys holding an ACTIVE EmergencyAlert', () => {
    const delete_ = JOB_SOURCE.slice(JOB_SOURCE.indexOf('DELETE FROM "GpsPoint"'));
    expect(delete_).toContain('NOT EXISTS');
    expect(delete_).toContain('FROM "EmergencyAlert" ea');
    expect(delete_).toContain('ea."journeyId" = j."id"');
    expect(delete_).toContain(`ea."status" = 'ACTIVE'`);
  });

  test('it holds on ACTIVE alone — a closed alert is not a hold', () => {
    // If this ever matched RESOLVED or EXPIRED too, the hold would never
    // release and every journey that ever had an emergency would be kept
    // forever. The status literal is the whole release mechanism.
    const clause = JOB_SOURCE.slice(
      JOB_SOURCE.indexOf('FROM "EmergencyAlert" ea'),
      JOB_SOURCE.indexOf('LIMIT ${GPS_RETENTION_BATCH_SIZE}'),
    );
    expect(clause).not.toContain('RESOLVED');
    expect(clause).not.toContain('EXPIRED');
  });

  test('the terminal-status hold is still there, unchanged', () => {
    expect(JOB_SOURCE).toContain(
      `ARRAY['COMPLETED', 'CANCELLED', 'EXPIRED']::"JourneyStatus"[]`,
    );
  });
});

describe('hold, then release', () => {
  const OLD_COMPLETED = {
    id: 'p1',
    timestamp: daysAgo(30),
    journeyId: 'j-emergency',
    status: 'COMPLETED',
  };
  const CONTROL = {
    id: 'p2',
    timestamp: daysAgo(30),
    journeyId: 'j-ordinary',
    status: 'COMPLETED',
  };

  test('HELD: a completed journey with an open emergency keeps its trace', async () => {
    points = [{ ...OLD_COMPLETED }, { ...CONTROL }];
    alerted.add('j-emergency');

    const result = await runGpsRetentionOnce();

    expect(result!.deleted).toBe(1);
    expect(points.map((p) => p.id)).toEqual(['p1']);
  });

  test('RELEASED: the same journey is swept once the alert is closed', async () => {
    points = [{ ...OLD_COMPLETED }];
    alerted.add('j-emergency');

    await runGpsRetentionOnce();
    expect(points).toHaveLength(1);

    // Ops resolved it, or the valve expired it. Either way it stops
    // being ACTIVE, which is all the hold ever looked at.
    alerted.delete('j-emergency');
    _resetForTests();

    const second = await runGpsRetentionOnce();
    expect(second!.deleted).toBe(1);
    expect(points).toHaveLength(0);
  });

  test('the emergency hold outranks age, exactly as the dispute hold does', async () => {
    points = [
      { id: 'ancient', timestamp: daysAgo(365), journeyId: 'j-emergency', status: 'COMPLETED' },
    ];
    alerted.add('j-emergency');

    const result = await runGpsRetentionOnce();

    expect(result!.deleted).toBe(0);
    expect(points).toHaveLength(1);
  });

  test('an ordinary completed journey is unaffected by any of this', async () => {
    points = [{ ...CONTROL }];

    const result = await runGpsRetentionOnce();

    expect(result!.deleted).toBe(1);
    expect(points).toHaveLength(0);
  });
});
