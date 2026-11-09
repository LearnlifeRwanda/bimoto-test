jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    driverPayoutBatch: { findFirst: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    // AML hook (assertAmlCheck) queries these. Default: empty 24h window so
    // hard-cap never trips for existing payout-job tests.
    escrow: { findMany: jest.fn().mockResolvedValue([]) },
    amlFlag: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'flag-test' }),
      update: jest.fn(),
    },
  },
}));

jest.mock('../services/payout.service', () => ({
  getPendingDriverPayouts: jest.fn(),
  createPendingBatch: jest.fn(),
  markBatchPaidOut: jest.fn(),
  markBatchFailed: jest.fn(),
}));

jest.mock('../services/payment', () => {
  const actual = jest.requireActual('../services/payment');
  return {
    ...actual,
    transferToWallet: jest.fn(),
  };
});

import prisma from '../prisma';
import { encrypt } from '../utils/crypto';
import {
  getPendingDriverPayouts,
  createPendingBatch,
  markBatchPaidOut,
  markBatchFailed,
} from '../services/payout.service';
import { transferToWallet, FlutterwaveError } from '../services/payment';
import { runPayoutOnce, _resetForTests } from '../jobs/payout.job';

const m = prisma as jest.Mocked<typeof prisma>;
const getPending = getPendingDriverPayouts as jest.Mock;
const createBatch = createPendingBatch as jest.Mock;
const markPaid = markBatchPaidOut as jest.Mock;
const markFailed = markBatchFailed as jest.Mock;
const transfer = transferToWallet as jest.Mock;

// Pick wall-clock instants whose Africa/Kigali (UTC+2) hour we know.
const before22 = new Date('2026-05-04T19:00:00.000Z'); // 21:00 Kigali
const after22 = new Date('2026-05-04T20:30:00.000Z'); // 22:30 Kigali
const after22NextDay = new Date('2026-05-05T20:30:00.000Z');

beforeEach(() => {
  jest.clearAllMocks();
  _resetForTests();
});

describe('runPayoutOnce', () => {
  test("doesn't run before 22:00 Africa/Kigali", async () => {
    await runPayoutOnce(before22);
    expect(getPending).not.toHaveBeenCalled();
  });

  test("doesn't double-run within the same day", async () => {
    (m.driverPayoutBatch.findFirst as jest.Mock).mockResolvedValue(null);
    getPending.mockResolvedValue([]);
    await runPayoutOnce(after22);
    await runPayoutOnce(after22);
    expect(getPending).toHaveBeenCalledTimes(1);
  });

  test('one driver transfer failure does not block other drivers', async () => {
    (m.driverPayoutBatch.findFirst as jest.Mock).mockResolvedValue(null);
    getPending.mockResolvedValue([
      { driverId: 'd1', amount: 5000 },
      { driverId: 'd2', amount: 3000 },
    ]);
    (m.user.findUnique as jest.Mock).mockResolvedValue({ phoneEncrypted: encrypt('+250788000000') });
    createBatch
      .mockResolvedValueOnce({ id: 'b1' })
      .mockResolvedValueOnce({ id: 'b2' });
    transfer
      .mockRejectedValueOnce(new FlutterwaveError('INVALID_WALLET'))
      .mockResolvedValueOnce({ flwTransferId: 'flw-2', status: 'SUCCESS' });

    await runPayoutOnce(after22);

    expect(markFailed).toHaveBeenCalledWith('b1', 'INVALID_WALLET');
    expect(markPaid).toHaveBeenCalledWith('d2', 'b2', 'flw-2');
  });

  test('restart after partial run resumes correctly (existing batch today)', async () => {
    (m.driverPayoutBatch.findFirst as jest.Mock).mockResolvedValue({ id: 'pre-existing' });
    await runPayoutOnce(after22);
    expect(getPending).not.toHaveBeenCalled();
  });

  test('the "already ran today" cutoff is Kigali midnight, not UTC midnight', async () => {
    (m.driverPayoutBatch.findFirst as jest.Mock).mockResolvedValue(null);
    getPending.mockResolvedValue([]);
    await runPayoutOnce(after22); // 22:30 Kigali on 2026-05-04
    expect(m.driverPayoutBatch.findFirst).toHaveBeenCalledWith({
      where: {
        // Kigali (UTC+2) midnight of 2026-05-04 is 22:00 UTC the day before.
        createdAt: { gte: new Date('2026-05-03T22:00:00.000Z') },
        trigger: 'SCHEDULED_22H',
      },
    });
  });

  test('zero-balance drivers are skipped (empty getPendingDriverPayouts)', async () => {
    (m.driverPayoutBatch.findFirst as jest.Mock).mockResolvedValue(null);
    getPending.mockResolvedValue([]);
    await runPayoutOnce(after22);
    expect(transfer).not.toHaveBeenCalled();
    expect(createBatch).not.toHaveBeenCalled();
  });

  test('runs again on a new day after running yesterday', async () => {
    (m.driverPayoutBatch.findFirst as jest.Mock).mockResolvedValue(null);
    getPending.mockResolvedValue([]);
    await runPayoutOnce(after22);
    await runPayoutOnce(after22NextDay);
    expect(getPending).toHaveBeenCalledTimes(2);
  });
});
