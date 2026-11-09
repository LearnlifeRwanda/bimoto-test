jest.mock('../prisma', () => {
  const db: any = {
    payoutPreferenceChangeLog: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    driverBalance: {
      findUnique: jest.fn(),
    },
    // MONEY-ATOMIC G4 — the preference write and its audit row now share
    // one transaction. The tx handed to the callback is this same object,
    // so every assertion below still reads the same jest.fn call lists.
    $transaction: jest.fn(async (cb: any) => cb(db)),
  };
  return { __esModule: true, default: db };
});

jest.mock('../services/otp.service', () => ({
  verifyOtp: jest.fn(),
}));

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import prisma from '../prisma';
import { verifyOtp } from '../services/otp.service';
import { applyPreferenceChange } from '../services/payout/preferences/change-flow';

const findFirstLog = (prisma as any).payoutPreferenceChangeLog.findFirst as jest.Mock;
const createLog = (prisma as any).payoutPreferenceChangeLog.create as jest.Mock;
const updateLog = (prisma as any).payoutPreferenceChangeLog.update as jest.Mock;
const findUser = (prisma as any).user.findUnique as jest.Mock;
const updateUser = (prisma as any).user.update as jest.Mock;
const findBalance = (prisma as any).driverBalance.findUnique as jest.Mock;
const verify = verifyOtp as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('applyPreferenceChange', () => {
  function setHappyPath(opts: { balance?: number } = {}): void {
    findFirstLog.mockResolvedValue(null);
    verify.mockResolvedValue({ verified: true });
    findUser.mockResolvedValue({ id: 'u1', payoutPreference: 'AT_SHIFT_END' });
    updateUser.mockResolvedValue({});
    findBalance.mockResolvedValue(
      opts.balance != null ? { driverId: 'u1', pendingAmount: opts.balance } : null,
    );
    createLog.mockResolvedValue({ id: 'log-1' });
    updateLog.mockResolvedValue({});
  }

  // MONEY-ATOMIC G4 — D-3. The preference write used to commit on its own,
  // eighteen lines before the audit row was created. A failure in that
  // window moved a driver's money destination with no record of the move
  // or of what it moved from — on the one flow gated behind an OTP
  // step-up precisely because that record is the point.
  test('a failing audit-row write rolls the preference change back', async () => {
    setHappyPath({ balance: 0 });
    const committed: any[] = [];
    createLog.mockRejectedValueOnce(new Error('audit log write failed'));
    ((prisma as any).$transaction as jest.Mock).mockImplementationOnce(async (cb: any) => {
      const staged: any[] = [];
      const tx: any = {
        user: {
          update: async (args: any) => {
            staged.push({ model: 'user', args });
            return {};
          },
        },
        payoutPreferenceChangeLog: { create: (args: any) => createLog(args) },
      };
      try {
        const out = await cb(tx);
        committed.push(...staged); // COMMIT
        return out;
      } catch (err) {
        throw err; // ROLLBACK: staged writes are discarded
      }
    });

    await expect(
      applyPreferenceChange({
        userId: 'u1',
        newPreference: 'TWICE_DAILY',
        stepUp: { kind: 'otp', otpId: 'o1', code: '123456' } as const,
      }),
    ).rejects.toThrow('audit log write failed');

    // The payoutPreference write never lands without its audit row.
    expect(committed).toHaveLength(0);
  });

  test('happy path with 0 balance — no payout queued', async () => {
    setHappyPath({ balance: 0 });
    const result = await applyPreferenceChange({
      userId: 'u1',
      newPreference: 'TWICE_DAILY',
      stepUp: { kind: 'otp', otpId: 'o1', code: '123456' } as const,
    });
    expect(result.immediatePayoutQueued).toBe(false);
    expect(result.payoutDueAt).toBeUndefined();
    expect(updateUser).toHaveBeenCalled();
  });

  test('happy path with small balance — payout queued for +30 min', async () => {
    setHappyPath({ balance: 5000 });
    const result = await applyPreferenceChange({
      userId: 'u1',
      newPreference: 'TWICE_DAILY',
      stepUp: { kind: 'otp', otpId: 'o1', code: '123456' } as const,
    });
    expect(result.immediatePayoutQueued).toBe(true);
    expect(result.payoutDueAt).toBeInstanceOf(Date);
    const deltaMs = result.payoutDueAt!.getTime() - Date.now();
    expect(deltaMs).toBeGreaterThan(29 * 60 * 1000);
    expect(deltaMs).toBeLessThanOrEqual(30 * 60 * 1000 + 1000);
  });

  test('scheduling is row-based, not timer-based (restart-safe)', async () => {
    jest.useFakeTimers();
    try {
      setHappyPath({ balance: 5000 });
      const result = await applyPreferenceChange({
        userId: 'u1',
        newPreference: 'TWICE_DAILY',
        stepUp: { kind: 'otp', otpId: 'o1', code: '123456' } as const,
      });

      // The schedule lives in the log row (payoutFired:false + payoutDueAt),
      // consumed by preference-change-payout.job — no in-process timer.
      expect(jest.getTimerCount()).toBe(0);
      expect(createLog).toHaveBeenCalledWith({
        data: expect.objectContaining({
          payoutFired: false,
          payoutDueAt: result.payoutDueAt,
        }),
      });
      // And nothing fires later in-process: the row is untouched here.
      jest.advanceTimersByTime(31 * 60 * 1000);
      expect(updateLog).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  test('rate-limit blocks before any state change', async () => {
    findFirstLog.mockResolvedValue({ id: 'old-log' });
    await expect(
      applyPreferenceChange({
        userId: 'u1',
        newPreference: 'TWICE_DAILY',
        stepUp: { kind: 'otp', otpId: 'o1', code: '123456' } as const,
      }),
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(updateUser).not.toHaveBeenCalled();
  });

  test('OTP failure blocks before any state change', async () => {
    findFirstLog.mockResolvedValue(null);
    verify.mockResolvedValue({ verified: false, reason: 'invalid' });
    await expect(
      applyPreferenceChange({
        userId: 'u1',
        newPreference: 'TWICE_DAILY',
        stepUp: { kind: 'otp', otpId: 'o1', code: '999999' } as const,
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(updateUser).not.toHaveBeenCalled();
  });

  test('anomaly-flagged balance: log created, no auto-payout queued', async () => {
    setHappyPath({ balance: 60_000 });
    const result = await applyPreferenceChange({
      userId: 'u1',
      newPreference: 'TWICE_DAILY',
      stepUp: { kind: 'otp', otpId: 'o1', code: '123456' } as const,
    });
    expect(result.immediatePayoutQueued).toBe(false);
    expect(createLog).toHaveBeenCalled();
  });
});

