import { detect } from '../sync-rating-attack';

const makePrisma = (
  ratings: Array<{ raterId: string; ratedId: string; stars: number; createdAt: Date }>,
) =>
  ({
    rating: {
      findMany: jest
        .fn()
        .mockResolvedValue([...ratings].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())),
    },
  }) as any;

const opts = { windowDays: 7, minSampleSize: 1, now: new Date('2026-05-04T00:00:00Z') };

describe('sync-rating-attack detector', () => {
  test('5 first-time raters, all 5-star inside 1 minute -> CRITICAL', async () => {
    const t0 = new Date('2026-05-03T10:00:00Z').getTime();
    const ratings = Array.from({ length: 5 }, (_, i) => ({
      raterId: `first-${i}`,
      ratedId: 'driverA',
      stars: 5,
      createdAt: new Date(t0 + i * 10_000),
    }));
    const result = await detect(makePrisma(ratings), opts);
    expect(result.flagged.length).toBeGreaterThanOrEqual(6);
    const driverFinding = result.flagged.find((f) => f.userId === 'driverA');
    expect(driverFinding?.severity).toBe('CRITICAL');
  });

  test('burst spread across 1 hour (outside SYNC_RATING_WINDOW_MIN) -> 0 findings', async () => {
    const t0 = new Date('2026-05-03T10:00:00Z').getTime();
    const ratings = Array.from({ length: 5 }, (_, i) => ({
      raterId: `first-${i}`,
      ratedId: 'driverA',
      stars: 5,
      createdAt: new Date(t0 + i * 12 * 60 * 1000), // 12 min apart
    }));
    const result = await detect(makePrisma(ratings), opts);
    expect(result.flagged).toHaveLength(0);
  });

  test('below MIN_COUNT -> 0 findings', async () => {
    const t0 = new Date('2026-05-03T10:00:00Z').getTime();
    const ratings = Array.from({ length: 3 }, (_, i) => ({
      raterId: `first-${i}`,
      ratedId: 'driverA',
      stars: 5,
      createdAt: new Date(t0 + i * 30_000),
    }));
    const result = await detect(makePrisma(ratings), opts);
    expect(result.flagged).toHaveLength(0);
  });

  test('5 ratings in window but only 1 first-timer -> 0 findings', async () => {
    const t0 = new Date('2026-05-03T10:00:00Z').getTime();
    const ratings = Array.from({ length: 5 }, (_, i) => ({
      raterId: `repeat-${i}`,
      ratedId: 'driverA',
      stars: 5,
      createdAt: new Date(t0 + i * 30_000),
    }));
    // Make each "repeat" rater look non-first-time by giving them another rating.
    for (const id of ['repeat-0', 'repeat-1', 'repeat-2', 'repeat-3']) {
      ratings.push({ raterId: id, ratedId: 'driverB', stars: 4, createdAt: new Date(t0 - 86400_000) });
    }
    const result = await detect(makePrisma(ratings), opts);
    expect(result.flagged).toHaveLength(0);
  });
});
