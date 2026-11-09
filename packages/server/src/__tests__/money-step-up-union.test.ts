// MONEY-PIN G6 — the step-up union on the payout-preference change.
//
// Two things are being pinned here, and they are different in kind:
//
//   1. The PIN arm works and takes NOTHING from the caller. If this arm
//      could be satisfied by a client-supplied value, the whole feature
//      would be theatre.
//   2. The audit row records the method TRUTHFULLY. That is the one named
//      semantic change in the swap, and the reason "byte-identical audit
//      rows" was never achievable.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    payoutPreferenceChangeLog: { findFirst: jest.fn(), create: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn() },
    driverBalance: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('../services/otp.service', () => ({ verifyOtp: jest.fn() }));
jest.mock('../services/payout/preferences/anomaly-check', () => ({
  getPreferenceChangeAnomalyVerdict: jest.fn(),
}));

import prisma from '../prisma';
import { verifyOtp } from '../services/otp.service';
import { getPreferenceChangeAnomalyVerdict } from '../services/payout/preferences/anomaly-check';
import { applyPreferenceChange } from '../services/payout/preferences/change-flow';
import { assertStepUpVerified } from '../services/payout/preferences/guards';
import {
  openMoneyStepUp,
  closeMoneyStepUp,
  _resetMoneyStepUpForTests,
} from '../middleware/money-step-up';

const p = prisma as any;
const createLog = p.payoutPreferenceChangeLog.create as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  _resetMoneyStepUpForTests();
  p.payoutPreferenceChangeLog.findFirst.mockResolvedValue(null);
  p.user.findUnique.mockResolvedValue({ id: 'u1', payoutPreference: 'AT_SHIFT_END' });
  p.driverBalance.findUnique.mockResolvedValue({ pendingAmount: 0 });
  (getPreferenceChangeAnomalyVerdict as jest.Mock).mockResolvedValue({
    allowAuto: true,
    thresholdRwf: 50_000,
  });
  createLog.mockResolvedValue({ id: 'log-1' });
  p.$transaction.mockImplementation(async (cb: any) =>
    cb({
      user: { update: p.user.update },
      payoutPreferenceChangeLog: { create: createLog },
    }),
  );
});

describe('assertStepUpVerified — the union', () => {
  test('the PIN arm reads the session SERVER-SIDE and takes no caller input', async () => {
    openMoneyStepUp('u1');
    const verdict = await assertStepUpVerified('u1', { kind: 'pin' });
    expect(verdict.method).toBe('PIN');
    // The stamp comes from the session, not from anything passed in.
    expect(verdict.verifiedAt).toBeInstanceOf(Date);
  });

  test('the PIN arm refuses without a live session', async () => {
    await expect(assertStepUpVerified('u1', { kind: 'pin' })).rejects.toMatchObject({
      statusCode: 401,
      code: 'MONEY_STEP_UP_REQUIRED',
    });
  });

  test('a session for a DIFFERENT user does not satisfy the PIN arm', async () => {
    openMoneyStepUp('someone-else');
    await expect(assertStepUpVerified('u1', { kind: 'pin' })).rejects.toMatchObject({
      code: 'MONEY_STEP_UP_REQUIRED',
    });
  });

  test('the OTP arm still works and is unchanged', async () => {
    (verifyOtp as jest.Mock).mockResolvedValue({ verified: true });
    const verdict = await assertStepUpVerified('u1', {
      kind: 'otp',
      otpId: 'o1',
      code: '123456',
    });
    expect(verdict.method).toBe('OTP');
    expect((verifyOtp as jest.Mock).mock.calls[0][0].purpose).toBe('PAYOUT_PREFERENCE_CHANGE');
  });

  test('the OTP arm rejects anything that is not an explicit verified===true', async () => {
    for (const bad of [undefined, null, {}, { verified: 'yes' }, { verified: 1 }]) {
      (verifyOtp as jest.Mock).mockResolvedValue(bad);
      await expect(
        assertStepUpVerified('u1', { kind: 'otp', otpId: 'o1', code: '1' }),
      ).rejects.toMatchObject({ code: 'OTP_INVALID' });
    }
  });
});

describe('applyPreferenceChange — gated by PIN, recorded truthfully', () => {
  test('a PIN-proven change succeeds and the row says PIN', async () => {
    openMoneyStepUp('u1');
    await applyPreferenceChange({
      userId: 'u1',
      newPreference: 'TWICE_DAILY',
      stepUp: { kind: 'pin' },
    });

    const data = createLog.mock.calls[0][0].data;
    expect(data.stepUpMethod).toBe('PIN');
    // otpVerified stays bound to the OTP arm. A PIN row that claimed an
    // OTP would be a false record on the one flow whose purpose IS the
    // record.
    expect(data.otpVerified).toBe(false);
    // No SMS was needed to change where a driver's money goes.
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  test('an OTP-proven change still writes otpVerified:true, so old rows stay interpretable', async () => {
    (verifyOtp as jest.Mock).mockResolvedValue({ verified: true });
    await applyPreferenceChange({
      userId: 'u1',
      newPreference: 'TWICE_DAILY',
      stepUp: { kind: 'otp', otpId: 'o1', code: '123456' },
    });
    const data = createLog.mock.calls[0][0].data;
    expect(data.stepUpMethod).toBe('OTP');
    expect(data.otpVerified).toBe(true);
  });

  test('without a session the change never happens', async () => {
    await expect(
      applyPreferenceChange({
        userId: 'u1',
        newPreference: 'TWICE_DAILY',
        stepUp: { kind: 'pin' },
      }),
    ).rejects.toMatchObject({ code: 'MONEY_STEP_UP_REQUIRED' });
    expect(p.user.update).not.toHaveBeenCalled();
    expect(createLog).not.toHaveBeenCalled();
  });

  test('a closed session stops working immediately', async () => {
    openMoneyStepUp('u1');
    closeMoneyStepUp('u1');
    await expect(
      applyPreferenceChange({
        userId: 'u1',
        newPreference: 'TWICE_DAILY',
        stepUp: { kind: 'pin' },
      }),
    ).rejects.toMatchObject({ code: 'MONEY_STEP_UP_REQUIRED' });
  });

  test('THE INVARIANT: a failing audit-row write still rolls the change back', async () => {
    // MONEY-ATOMIC G4's guarantee, re-asserted on the PIN arm. This is
    // the thing that had to stay byte-identical through the swap — not
    // the row's field list.
    openMoneyStepUp('u1');
    const committed: string[] = [];
    const staged: string[] = [];
    p.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        user: {
          update: async (args: any) => {
            staged.push(args.data.payoutPreference);
            return {};
          },
        },
        payoutPreferenceChangeLog: {
          create: async () => {
            throw new Error('audit log write failed');
          },
        },
      };
      try {
        const out = await cb(tx);
        committed.push(...staged);
        return out;
      } catch (err) {
        throw err; // ROLLBACK: staged writes are discarded
      }
    });

    await expect(
      applyPreferenceChange({
        userId: 'u1',
        newPreference: 'TWICE_DAILY',
        stepUp: { kind: 'pin' },
      }),
    ).rejects.toThrow('audit log write failed');

    expect(committed).toHaveLength(0);
  });
});
