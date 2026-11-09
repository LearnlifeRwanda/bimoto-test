jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    driverPayoutBatch: { findFirst: jest.fn() },
  },
}));

jest.mock('../services/payout.service', () => ({
  getPendingForCohort: jest.fn(),
  firePreferenceChangeBatch: jest.fn(),
}));

import prisma from '../prisma';
import {
  getPendingForCohort,
  firePreferenceChangeBatch,
} from '../services/payout.service';
import {
  runTwiceDailyPayoutOnce,
  _resetForTests,
} from '../jobs/twice-daily-payout.job';

const findFirst = (prisma as any).driverPayoutBatch.findFirst as jest.Mock;
const getCohort = getPendingForCohort as jest.Mock;
const fire = firePreferenceChangeBatch as jest.Mock;

// Africa/Kigali is UTC+2 (no DST).
const at_05_59 = new Date('2026-05-04T03:59:00.000Z'); // 05:59 Kigali
const at_06 = new Date('2026-05-04T04:00:00.000Z'); // 06:00 Kigali
const at_17_59 = new Date('2026-05-04T15:59:00.000Z'); // 17:59 Kigali
const at_18 = new Date('2026-05-04T16:00:00.000Z'); // 18:00 Kigali

beforeEach(() => {
  jest.clearAllMocks();
  _resetForTests();
});

describe('runTwiceDailyPayoutOnce', () => {
  test('does NOT fire at 05:59 Kigali', async () => {
    findFirst.mockResolvedValue(null);
    getCohort.mockResolvedValue([]);
    await runTwiceDailyPayoutOnce(at_05_59);
    expect(getCohort).not.toHaveBeenCalled();
  });

  test('fires at 06:00 Kigali for TWICE_DAILY cohort', async () => {
    findFirst.mockResolvedValue(null);
    getCohort.mockResolvedValue([{ driverId: 'd1', amount: 5000 }]);
    fire.mockResolvedValue({ batchId: 'b1', amount: 5000 });
    await runTwiceDailyPayoutOnce(at_06);
    expect(getCohort).toHaveBeenCalledWith('TWICE_DAILY');
    expect(fire).toHaveBeenCalledWith('d1', 'SCHEDULED_06');
  });

  test('does NOT fire at 17:59 Kigali', async () => {
    findFirst.mockResolvedValue(null);
    await runTwiceDailyPayoutOnce(at_17_59);
    expect(getCohort).not.toHaveBeenCalled();
  });

  test('fires at 18:00 Kigali (SCHEDULED_18 trigger)', async () => {
    findFirst.mockResolvedValue(null);
    getCohort.mockResolvedValue([{ driverId: 'd1', amount: 4000 }]);
    fire.mockResolvedValue({ batchId: 'b2', amount: 4000 });
    await runTwiceDailyPayoutOnce(at_18);
    expect(fire).toHaveBeenCalledWith('d1', 'SCHEDULED_18');
  });

  test("doesn't double-fire within the same window", async () => {
    findFirst.mockResolvedValue(null);
    getCohort.mockResolvedValue([{ driverId: 'd1', amount: 5000 }]);
    fire.mockResolvedValue({ batchId: 'b1', amount: 5000 });
    await runTwiceDailyPayoutOnce(at_06);
    await runTwiceDailyPayoutOnce(at_06);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  test('idempotent on restart — DB-side guard skips when batch already exists', async () => {
    findFirst.mockResolvedValue({ id: 'pre-existing' });
    await runTwiceDailyPayoutOnce(at_06);
    expect(getCohort).not.toHaveBeenCalled();
    expect(fire).not.toHaveBeenCalled();
  });

  test('the "already ran today" cutoff is Kigali midnight, not UTC midnight', async () => {
    findFirst.mockResolvedValue(null);
    getCohort.mockResolvedValue([]);
    await runTwiceDailyPayoutOnce(at_06); // 06:00 Kigali on 2026-05-04
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        // Kigali (UTC+2) midnight of 2026-05-04 is 22:00 UTC the day before.
        createdAt: { gte: new Date('2026-05-03T22:00:00.000Z') },
        trigger: 'SCHEDULED_06',
      },
    });
  });

  test('skips drivers with empty cohort', async () => {
    findFirst.mockResolvedValue(null);
    getCohort.mockResolvedValue([]);
    await runTwiceDailyPayoutOnce(at_06);
    expect(fire).not.toHaveBeenCalled();
  });
});
