import { detect } from '../reputation-ring';

const makePrisma = (
  ratings: Array<{ raterId: string; ratedId: string; stars: number }>,
  users: Array<{ id: string; role: 'CUSTOMER' | 'DRIVER' }>,
) =>
  ({
    rating: { findMany: jest.fn().mockResolvedValue(ratings) },
    user: {
      findMany: jest.fn(({ where }: any) => {
        const ids: string[] = where.id.in;
        return Promise.resolve(users.filter((u) => ids.includes(u.id)));
      }),
    },
  }) as any;

const opts = { windowDays: 7, minSampleSize: 1, now: new Date('2026-05-04T00:00:00Z') };

describe('reputation-ring detector', () => {
  test('clique of 3 customers rating only 3 drivers, all 5-star -> HIGH severity', async () => {
    const customers = ['cX', 'cY', 'cZ'];
    const drivers = ['dA', 'dB', 'dC'];
    const ratings: Array<{ raterId: string; ratedId: string; stars: number }> = [];
    // Each customer rates each driver exactly twice → 5 ratings per customer per driver to satisfy MIN_RATINGS=5.
    for (const c of customers) {
      for (const d of drivers) {
        for (let i = 0; i < 2; i++) ratings.push({ raterId: c, ratedId: d, stars: 5 });
      }
    }
    // Ensure each customer has >= 5 ratings.
    const users = [
      ...customers.map((id) => ({ id, role: 'CUSTOMER' as const })),
      ...drivers.map((id) => ({ id, role: 'DRIVER' as const })),
    ];
    // Add 2 extra customers to push clique size to 5 (HIGH severity threshold).
    customers.push('cW', 'cV');
    users.push(
      { id: 'cW', role: 'CUSTOMER' },
      { id: 'cV', role: 'CUSTOMER' },
    );
    for (const d of drivers) {
      for (let i = 0; i < 2; i++) {
        ratings.push({ raterId: 'cW', ratedId: d, stars: 5 });
        ratings.push({ raterId: 'cV', ratedId: d, stars: 5 });
      }
    }
    const result = await detect(makePrisma(ratings, users), opts);
    expect(result.flagged.length).toBeGreaterThan(0);
    expect(result.flagged.some((f) => f.severity === 'HIGH')).toBe(true);
    const flaggedIds = new Set(result.flagged.map((f) => f.userId));
    for (const id of [...customers, ...drivers]) expect(flaggedIds.has(id)).toBe(true);
  });

  test('driver has many outside ratings -> not flagged', async () => {
    const ratings: Array<{ raterId: string; ratedId: string; stars: number }> = [];
    for (let i = 0; i < 5; i++) ratings.push({ raterId: 'cX', ratedId: 'dA', stars: 5 });
    // dA has 50 ratings from a wide pool of unrelated customers.
    const outsiders: Array<{ id: string; role: 'CUSTOMER' }> = [];
    for (let i = 0; i < 50; i++) {
      const id = `outsider-${i}`;
      outsiders.push({ id, role: 'CUSTOMER' });
      ratings.push({ raterId: id, ratedId: 'dA', stars: 4 });
    }
    const users = [
      { id: 'cX', role: 'CUSTOMER' as const },
      { id: 'dA', role: 'DRIVER' as const },
      ...outsiders,
    ];
    const result = await detect(makePrisma(ratings, users), opts);
    expect(result.flagged).toHaveLength(0);
  });

  test('customer below MIN_RATINGS -> 0 findings', async () => {
    const ratings = [
      { raterId: 'cX', ratedId: 'dA', stars: 5 },
      { raterId: 'cX', ratedId: 'dA', stars: 5 },
    ];
    const users = [
      { id: 'cX', role: 'CUSTOMER' as const },
      { id: 'dA', role: 'DRIVER' as const },
    ];
    const result = await detect(makePrisma(ratings, users), opts);
    expect(result.flagged).toHaveLength(0);
  });
});
