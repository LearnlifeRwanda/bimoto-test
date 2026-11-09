jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  },
}));

import prisma from '../prisma';
import { withJobLease, withJobLock } from '../services/job-lock';

// Emulates pg_try_advisory_xact_lock semantics: a lock keyed by the job
// name is held for the lifetime of the $transaction callback and released
// when it settles (resolve or throw) — exactly the property the real xact
// lock gives us at commit/rollback.
const held = new Set<string>();

beforeEach(() => {
  held.clear();
  (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
    let acquiredName: string | null = null;
    const tx = {
      $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        const name = String(values[0]);
        if (held.has(name)) return [{ acquired: false }];
        held.add(name);
        acquiredName = name;
        return [{ acquired: true }];
      },
    };
    try {
      return await cb(tx);
    } finally {
      if (acquiredName) held.delete(acquiredName);
    }
  });
});

describe('withJobLock', () => {
  it('runs fn and returns its result when the lock is free', async () => {
    const fn = jest.fn().mockResolvedValue('paid');
    await expect(withJobLock('payout.job', fn)).resolves.toBe('paid');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns null (and never calls fn) for a second concurrent caller', async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const firstFn = jest.fn().mockImplementation(async () => {
      await gate;
      return 'first';
    });
    const secondFn = jest.fn();

    const first = withJobLock('payout.job', firstFn);
    // First caller is parked inside fn, still holding the lock.
    await expect(withJobLock('payout.job', secondFn)).resolves.toBeNull();
    expect(secondFn).not.toHaveBeenCalled();

    releaseFirst();
    await expect(first).resolves.toBe('first');
  });

  it('releases the lock after fn resolves', async () => {
    await withJobLock('payout.job', async () => 'done');
    await expect(withJobLock('payout.job', async () => 'again')).resolves.toBe(
      'again',
    );
  });

  it('releases the lock after fn throws, and propagates the error', async () => {
    await expect(
      withJobLock('payout.job', async () => {
        throw new Error('gateway down');
      }),
    ).rejects.toThrow('gateway down');

    await expect(
      withJobLock('payout.job', async () => 'recovered'),
    ).resolves.toBe('recovered');
  });

  it('locks are per job name — different jobs do not block each other', async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withJobLock('payout.job', async () => {
      await gate;
      return 'first';
    });
    await expect(
      withJobLock('payout-fallback.job', async () => 'other'),
    ).resolves.toBe('other');

    releaseFirst();
    await expect(first).resolves.toBe('first');
  });
});

// Emulates the lease claim/release SQL semantics against an in-memory table
// keyed by job name: INSERT … ON CONFLICT DO UPDATE … WHERE expired
// RETURNING (claim wins iff no row or the row's expiresAt has passed), and
// a holder-scoped DELETE (release only removes the caller's own lease).
describe('withJobLease', () => {
  const leases = new Map<string, { holder: string; expiresAt: Date }>();

  beforeEach(() => {
    leases.clear();
    (prisma.$queryRaw as jest.Mock).mockImplementation(
      async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        // Parameter order in withJobLease's claim statement:
        // name, holder, acquiredAt(now), expiresAt, now (expiry check).
        const name = String(values[0]);
        const holder = String(values[1]);
        const expiresAt = values[3] as Date;
        const now = values[4] as Date;
        const existing = leases.get(name);
        if (existing && existing.expiresAt >= now) return [];
        leases.set(name, { holder, expiresAt });
        return [{ name }];
      },
    );
    (prisma.$executeRaw as jest.Mock).mockImplementation(
      async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        // Parameter order in the release statement: name, holder.
        const name = String(values[0]);
        const holder = String(values[1]);
        const existing = leases.get(name);
        if (existing && existing.holder === holder) {
          leases.delete(name);
          return 1;
        }
        return 0;
      },
    );
  });

  it('runs fn and returns its result when no lease exists', async () => {
    const fn = jest.fn().mockResolvedValue('aggregated');
    await expect(withJobLease('mobility.job', 60_000, fn)).resolves.toBe(
      'aggregated',
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns null (and never calls fn) while another holder has a live lease', async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const secondFn = jest.fn();
    const first = withJobLease('mobility.job', 60_000, async () => {
      await gate;
      return 'first';
    });
    // Let the first claim land before contending.
    await new Promise((resolve) => setImmediate(resolve));

    await expect(withJobLease('mobility.job', 60_000, secondFn)).resolves.toBeNull();
    expect(secondFn).not.toHaveBeenCalled();

    releaseFirst();
    await expect(first).resolves.toBe('first');
  });

  it('releases the lease after fn resolves', async () => {
    await withJobLease('mobility.job', 60_000, async () => 'done');
    expect(leases.size).toBe(0);
    await expect(
      withJobLease('mobility.job', 60_000, async () => 'again'),
    ).resolves.toBe('again');
  });

  it('releases the lease after fn throws, and propagates the error', async () => {
    await expect(
      withJobLease('mobility.job', 60_000, async () => {
        throw new Error('aggregator down');
      }),
    ).rejects.toThrow('aggregator down');
    expect(leases.size).toBe(0);

    await expect(
      withJobLease('mobility.job', 60_000, async () => 'recovered'),
    ).resolves.toBe('recovered');
  });

  it('an expired lease from a crashed holder is claimable', async () => {
    // A holder that died without releasing: row present, expiry passed.
    leases.set('mobility.job', {
      holder: 'crashed-process',
      expiresAt: new Date(Date.now() - 1),
    });

    const fn = jest.fn().mockResolvedValue('healed');
    await expect(withJobLease('mobility.job', 60_000, fn)).resolves.toBe(
      'healed',
    );
    expect(fn).toHaveBeenCalledTimes(1);
    // Our own release removed the re-claimed row.
    expect(leases.size).toBe(0);
  });

  it('a live lease from another holder is NOT claimable', async () => {
    leases.set('mobility.job', {
      holder: 'other-process',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const fn = jest.fn();
    await expect(withJobLease('mobility.job', 60_000, fn)).resolves.toBeNull();
    expect(fn).not.toHaveBeenCalled();
    // The other holder's lease is untouched.
    expect(leases.get('mobility.job')?.holder).toBe('other-process');
  });

  it('leases are per job name — different jobs do not block each other', async () => {
    leases.set('bnr-monthly.job', {
      holder: 'other-process',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      withJobLease('gps-retention.job', 60_000, async () => 'runs'),
    ).resolves.toBe('runs');
  });
});
