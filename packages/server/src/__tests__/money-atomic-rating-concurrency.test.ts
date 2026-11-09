// MONEY-ATOMIC G4 — two ratings for the SAME driver, genuinely
// interleaved, not in sequence.
//
// createRating stores the rating, then aggregates every rating for that
// driver and publishes the average onto DriverProfile.avgRating. That is
// a read-modify-write across a boundary no row lock spans: the read is an
// aggregate over the Rating table, the write lands on DriverProfile. Two
// ratings arriving together could both aggregate before either wrote, and
// the later write would publish an average that ignores the other rating
// — permanently, since nothing ever recomputes it.
//
// Unlike the dispute counter (see money-atomic-dispute-concurrency.test.ts),
// a transaction alone does NOT close this: READ COMMITTED is happy to let
// both aggregates run against the same snapshot of committed rows, and
// the two DriverProfile writes then race. The advisory lock keyed on the
// driver is what serializes them — the fee-waiver/index.ts and
// aml/limits.ts idiom, over the same shape of problem.
//
// Both directions are tested: with the lock the published average counts
// both ratings; with the lock statement skipped, the same interleaving
// publishes an average that counts only one. If the lock is ever dropped,
// case 1 fails and case 2 says why.

jest.mock('../prisma', () => {
  // Replaced per-test by installDb(); the service module captures this
  // object once at import time, so the harness mutates it in place.
  const db: any = {};
  return { __esModule: true, default: db };
});

import prisma from '../prisma';
import * as ratingService from '../services/rating.service';

const db = prisma as any;

const tick = () => new Promise((r) => setImmediate(r));

interface Harness {
  /** Committed state. Nothing lands here until a transaction resolves. */
  profiles: Map<string, any>;
  ratings: any[];
  parked: () => boolean;
  release: () => void;
}

function installDb(opts: { withLock: boolean }): Harness {
  const committedRatings: any[] = [];
  const committedProfiles = new Map<string, any>([['d1', { userId: 'd1', avgRating: 0 }]]);
  const journeys = new Map<string, any>([
    ['j1', { id: 'j1', customerId: 'c1', driverId: 'd1', status: 'COMPLETED' }],
    ['j2', { id: 'j2', customerId: 'c2', driverId: 'd1', status: 'COMPLETED' }],
  ]);

  const lockTails = new Map<string, Promise<void>>();
  let parkResolve: (() => void) | null = null;
  let alreadyParked = false;

  const makeTx = (holds: Array<() => void>) => {
    const stagedRatings: any[] = [];
    const stagedProfiles = new Map<string, any>();

    const tx: any = {
      rating: {
        create: async ({ data }: any) => {
          stagedRatings.push({ ...data });
          return { id: `r-${data.journeyId}`, ...data };
        },
        aggregate: async ({ where }: any) => {
          // A transaction sees committed rows plus its own.
          const rows = [...committedRatings, ...stagedRatings].filter(
            (r) => r.ratedId === where.ratedId,
          );
          const avg = rows.length
            ? rows.reduce((sum, r) => sum + r.stars, 0) / rows.length
            : null;
          // Park the FIRST caller here — after it has aggregated, before
          // it publishes. This is the window the defect lives in.
          if (!alreadyParked) {
            alreadyParked = true;
            await new Promise<void>((r) => {
              parkResolve = r;
            });
          }
          return { _avg: { stars: avg } };
        },
      },
      driverProfile: {
        findUnique: async ({ where }: any) =>
          stagedProfiles.get(where.userId) ?? committedProfiles.get(where.userId) ?? null,
        update: async ({ where, data }: any) => {
          const next = { ...committedProfiles.get(where.userId), ...data };
          stagedProfiles.set(where.userId, next);
          return next;
        },
      },
      __commit: () => {
        committedRatings.push(...stagedRatings);
        for (const [id, row] of stagedProfiles) committedProfiles.set(id, row);
      },
    };

    if (opts.withLock) {
      // pg_advisory_xact_lock: one mutex per key, held to end of transaction.
      tx.$queryRaw = async (_strings: TemplateStringsArray, ...values: any[]) => {
        const key = String(values[0]);
        const prev = lockTails.get(key) ?? Promise.resolve();
        let release!: () => void;
        const mine = new Promise<void>((r) => {
          release = r;
        });
        lockTails.set(
          key,
          prev.then(() => mine),
        );
        await prev;
        holds.push(release);
        return [{ locked: 'true' }];
      };
    }
    return tx;
  };

  db.journey = {
    findUnique: async ({ where }: any) => {
      const row = journeys.get(where.id);
      return row ? { ...row } : null;
    },
  };
  db.rating = { findUnique: async () => null };
  db.$transaction = async (cb: any) => {
    const holds: Array<() => void> = [];
    const tx = makeTx(holds);
    try {
      const out = await cb(tx);
      tx.__commit();
      return out;
    } finally {
      // *_xact_ locks release at commit OR rollback.
      for (const release of holds) release();
    }
  };

  return {
    profiles: committedProfiles,
    ratings: committedRatings,
    parked: () => parkResolve !== null,
    release: () => {
      const r = parkResolve;
      parkResolve = null;
      if (r) r();
    },
  };
}

/** First rater parks after aggregating; the second gets every chance to
 *  get ahead; then the first resumes and publishes. */
async function raceTwoRatings(h: Harness) {
  const a = ratingService.createRating('j1', 'c1', 'd1', 5);
  while (!h.parked()) await tick();

  const b = ratingService.createRating('j2', 'c2', 'd1', 1);
  for (let i = 0; i < 20; i += 1) await tick();

  h.release();
  await Promise.all([a, b]);
}

describe('MONEY-ATOMIC D-4 — concurrent ratings for one driver', () => {
  test('the advisory lock serializes them: the published average counts both ratings', async () => {
    const h = installDb({ withLock: true });

    await raceTwoRatings(h);

    expect(h.ratings).toHaveLength(2);
    // (5 + 1) / 2. A lost update leaves 5 (or 1) — an average that counts
    // one of the two ratings the driver actually received.
    expect(h.profiles.get('d1').avgRating).toBeCloseTo(3, 10);
  });

  test('without the lock the same interleaving publishes an average that counts one rating (the defect)', async () => {
    const h = installDb({ withLock: false });

    await raceTwoRatings(h);

    // Both ratings stored…
    expect(h.ratings).toHaveLength(2);
    // …but the driver's public number describes only the first: it
    // aggregated before the second rating existed and published last.
    expect(h.profiles.get('d1').avgRating).toBeCloseTo(5, 10);
  });
});
