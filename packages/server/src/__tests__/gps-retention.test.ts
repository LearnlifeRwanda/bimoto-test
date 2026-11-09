// Drives the PAYOUT-F GPS retention sweep against in-memory emulations of
// its two SQL surfaces: the batched raw DELETE (timestamp < cutoff AND the
// journey's status is terminal, LIMITed per batch) and otpCode.deleteMany.
// The emulation mirrors the semantics the real statements declare so the
// job's cutoff math, batching loop, guards and completion line are what's
// under test.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    $executeRaw: jest.fn(),
    otpCode: {
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock('@sentry/node', () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

jest.mock('node-cron', () => ({
  __esModule: true,
  default: {
    schedule: jest.fn(() => ({ stop: jest.fn() })),
  },
}));

jest.mock('../services/job-lock', () => ({
  withJobLease: jest.fn(),
}));

import cron from 'node-cron';
import * as Sentry from '@sentry/node';
import prisma from '../prisma';
import { withJobLease } from '../services/job-lock';
import {
  GPS_RETENTION_BATCH_SIZE,
  GPS_RETENTION_LEASE_TTL_MS,
  _resetForTests,
  runGpsRetentionOnce,
  startGpsRetentionJob,
} from '../jobs/gps-retention.job';

const TERMINAL = ['COMPLETED', 'CANCELLED', 'EXPIRED'];

interface Pt {
  id: string;
  timestamp: Date;
  status: string;
}

interface Otp {
  id: string;
  expiresAt: Date;
}

let points: Pt[] = [];
let otps: Otp[] = [];

const NOW = new Date('2026-07-03T05:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600 * 1000);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000);

let logSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  _resetForTests();
  points = [];
  otps = [];
  logSpy = jest.spyOn(console, 'log').mockImplementation();
  errorSpy = jest.spyOn(console, 'error').mockImplementation();

  (prisma.$executeRaw as jest.Mock).mockImplementation(
    async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      // Parameter order in the sweep's DELETE: cutoff, batch limit.
      const cutoff = values[0] as Date;
      const limit = values[1] as number;
      const doomed = new Set(
        points
          .filter((p) => p.timestamp < cutoff && TERMINAL.includes(p.status))
          .slice(0, limit)
          .map((p) => p.id),
      );
      points = points.filter((p) => !doomed.has(p.id));
      return doomed.size;
    },
  );

  (prisma.otpCode.deleteMany as jest.Mock).mockImplementation(
    async ({ where }: any) => {
      const cutoff = where.expiresAt.lt as Date;
      const before = otps.length;
      otps = otps.filter((o) => !(o.expiresAt < cutoff));
      return { count: before - otps.length };
    },
  );
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('runGpsRetentionOnce', () => {
  it('deletes old points on terminal journeys, keeps young points', async () => {
    points.push(
      { id: 'old-completed', timestamp: daysAgo(15), status: 'COMPLETED' },
      { id: 'old-cancelled', timestamp: daysAgo(45), status: 'CANCELLED' },
      { id: 'old-expired', timestamp: daysAgo(60), status: 'EXPIRED' },
      { id: 'young-completed', timestamp: daysAgo(13), status: 'COMPLETED' },
      { id: 'fresh', timestamp: hoursAgo(1), status: 'COMPLETED' },
    );

    const result = await runGpsRetentionOnce(NOW);
    expect(result).not.toBeNull();
    expect(result!.deleted).toBe(3);
    expect(points.map((p) => p.id).sort()).toEqual([
      'fresh',
      'young-completed',
    ]);
  });

  it('keeps old points whose journey is DISPUTED or otherwise non-terminal', async () => {
    points.push(
      { id: 'old-disputed', timestamp: daysAgo(90), status: 'DISPUTED' },
      { id: 'old-interrupted', timestamp: daysAgo(90), status: 'INTERRUPTED' },
      { id: 'old-in-progress', timestamp: daysAgo(90), status: 'IN_PROGRESS' },
      { id: 'old-awaiting', timestamp: daysAgo(90), status: 'AWAITING_CONFIRMATION' },
      { id: 'old-completed', timestamp: daysAgo(90), status: 'COMPLETED' },
    );

    const result = await runGpsRetentionOnce(NOW);
    expect(result!.deleted).toBe(1);
    expect(points.map((p) => p.id).sort()).toEqual([
      'old-awaiting',
      'old-disputed',
      'old-in-progress',
      'old-interrupted',
    ]);
  });

  it('loops batches until a batch comes back short', async () => {
    const total = GPS_RETENTION_BATCH_SIZE * 2 + 1;
    for (let i = 0; i < total; i++) {
      points.push({ id: `p${i}`, timestamp: daysAgo(40), status: 'COMPLETED' });
    }

    const result = await runGpsRetentionOnce(NOW);
    expect(result!.deleted).toBe(total);
    expect(result!.batches).toBe(3);
    expect(points).toHaveLength(0);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
  }, 20_000);

  it('purges OTP rows expired more than 24h ago, keeps recent and live ones', async () => {
    otps.push(
      { id: 'long-dead', expiresAt: hoursAgo(25) },
      { id: 'recently-expired', expiresAt: hoursAgo(23) },
      { id: 'live', expiresAt: new Date(NOW.getTime() + 5 * 60 * 1000) },
    );

    const result = await runGpsRetentionOnce(NOW);
    expect(result!.otpDeleted).toBe(1);
    expect(otps.map((o) => o.id).sort()).toEqual(['live', 'recently-expired']);
  });

  it('emits the run-metrics completion line', async () => {
    points.push({ id: 'old', timestamp: daysAgo(40), status: 'COMPLETED' });
    otps.push({ id: 'dead', expiresAt: hoursAgo(48) });

    const result = await runGpsRetentionOnce(NOW);
    const line = logSpy.mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.startsWith('[GPS-RETENTION] run complete:'));
    expect(line).toBe(
      `[GPS-RETENTION] run complete: deleted=1 batches=1 otpDeleted=1 durationMs=${result!.durationMs}`,
    );
  });

  it('margin guard: refuses to run when retention would undercut the aggregation window', async () => {
    process.env.SENTRY_DSN = 'https://fake@sentry.example/1';
    try {
      points.push({ id: 'old', timestamp: daysAgo(10), status: 'COMPLETED' });

      // Retention patched to 2 days: cutoff (now-2d) lands INSIDE the
      // 24h-lookback + 3d margin (now-4d) — the sweep must refuse.
      const result = await runGpsRetentionOnce(NOW, 2);
      expect(result).toBeNull();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(prisma.otpCode.deleteMany).not.toHaveBeenCalled();
      expect(points).toHaveLength(1);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        'gps-retention.job margin guard tripped',
        expect.objectContaining({ level: 'error' }),
      );
    } finally {
      delete process.env.SENTRY_DSN;
    }
  });

  it("margin guard is dormant at today's values (14d retention, 1d window)", async () => {
    points.push({ id: 'old', timestamp: daysAgo(40), status: 'COMPLETED' });
    const result = await runGpsRetentionOnce(NOW);
    expect(result).not.toBeNull();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});

describe('gps-retention cron wiring', () => {
  it('runs the sweep through withJobLease; a lost claim means no deletes', async () => {
    startGpsRetentionJob();
    const tick = (cron.schedule as jest.Mock).mock.calls[0][1] as () => Promise<void>;

    // Contention: another process holds the lease — claim returns null
    // without invoking the sweep.
    (withJobLease as jest.Mock).mockResolvedValue(null);
    points.push({ id: 'old', timestamp: daysAgo(40), status: 'COMPLETED' });
    await tick();

    expect(withJobLease).toHaveBeenCalledWith(
      'gps-retention.job',
      GPS_RETENTION_LEASE_TTL_MS,
      expect.any(Function),
    );
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(points).toHaveLength(1);

    // Claim won: the same wiring runs the sweep for real.
    (withJobLease as jest.Mock).mockImplementation(
      async (_name: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
    );
    await tick();
    expect(points).toHaveLength(0);
  });
});
