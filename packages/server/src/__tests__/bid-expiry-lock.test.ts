// PAYOUT-E — representative check that a non-payout job wrapped in
// withJobLock (E2) skips its tick on contention. The generic lock
// semantics live in job-lock.test.ts; this asserts the wiring inside a
// wrapped job: the boot tick goes through the advisory lock, so a
// process that loses the election must not touch the DB.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    bid: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
  },
}));

jest.mock('../socket', () => ({ emitToJourney: jest.fn() }));

import prisma from '../prisma';
import { startBidExpiryJob, stopBidExpiryJob } from '../jobs/bid-expiry.job';

const transaction = prisma.$transaction as jest.Mock;
const findBids = (prisma as any).bid.findMany as jest.Mock;

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  findBids.mockResolvedValue([]);
});

afterEach(() => {
  stopBidExpiryJob();
});

describe('bid-expiry.job under withJobLock', () => {
  test('boot tick runs when the advisory lock is free', async () => {
    transaction.mockImplementation(async (cb: any) =>
      cb({ $queryRaw: async () => [{ acquired: true }] }),
    );
    startBidExpiryJob();
    await flush();
    expect(findBids).toHaveBeenCalled();
  });

  test('skips the tick when another process holds the lock', async () => {
    transaction.mockImplementation(async (cb: any) =>
      cb({ $queryRaw: async () => [{ acquired: false }] }),
    );
    startBidExpiryJob();
    await flush();
    expect(transaction).toHaveBeenCalled();
    expect(findBids).not.toHaveBeenCalled();
  });
});
