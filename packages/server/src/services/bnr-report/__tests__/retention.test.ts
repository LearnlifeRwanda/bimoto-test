jest.mock('../../../prisma', () => ({
  __esModule: true,
  default: {
    bnrReport: {
      deleteMany: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

import prisma from '../../../prisma';
import { deleteOlderThan } from '../store/db';
import { RETENTION_YEARS } from '../config';

const repo = (prisma as any).bnrReport as { deleteMany: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
});

function subYears(date: Date, years: number): Date {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() - years);
  return next;
}

describe('bnr-report retention sweep', () => {
  test('deleteOlderThan deletes only rows older than the cutoff', async () => {
    repo.deleteMany.mockResolvedValueOnce({ count: 1 });

    const now = new Date('2026-05-01T00:00:00Z');
    const cutoff = subYears(now, RETENTION_YEARS);

    const deleted = await deleteOlderThan(cutoff);
    expect(deleted).toBe(1);
    expect(repo.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: cutoff } },
    });
  });

  test('cutoff for 7-year retention is exactly 7 calendar years before now', () => {
    const now = new Date('2026-05-01T00:00:00Z');
    const cutoff = subYears(now, RETENTION_YEARS);
    expect(cutoff.toISOString()).toBe('2019-05-01T00:00:00.000Z');
    expect(RETENTION_YEARS).toBe(7);
  });

  test('returns the count from the underlying deleteMany call', async () => {
    repo.deleteMany.mockResolvedValueOnce({ count: 0 });
    const cutoff = subYears(new Date(), RETENTION_YEARS);
    expect(await deleteOlderThan(cutoff)).toBe(0);
  });
});
