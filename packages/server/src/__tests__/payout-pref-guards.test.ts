jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    payoutPreferenceChangeLog: { findFirst: jest.fn() },
  },
}));

jest.mock('../services/otp.service', () => ({
  verifyOtp: jest.fn(),
}));

import prisma from '../prisma';
import { verifyOtp } from '../services/otp.service';
import {
  assertNotRateLimited,
  assertOtpVerified,
} from '../services/payout/preferences/guards';

const findFirst = (prisma as any).payoutPreferenceChangeLog.findFirst as jest.Mock;
const verify = verifyOtp as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('assertNotRateLimited', () => {
  test('passes when no log row in last 24h', async () => {
    findFirst.mockResolvedValue(null);
    await expect(assertNotRateLimited('u1')).resolves.toBeUndefined();
  });

  test('throws PREFERENCE_CHANGE_RATE_LIMITED when log row exists', async () => {
    findFirst.mockResolvedValue({ id: 'log-1', createdAt: new Date() });
    await expect(assertNotRateLimited('u1')).rejects.toMatchObject({
      statusCode: 429,
      code: 'PREFERENCE_CHANGE_RATE_LIMITED',
    });
  });
});

describe('assertOtpVerified', () => {
  test('passes when verifyOtp returns {verified: true}', async () => {
    verify.mockResolvedValue({ verified: true });
    await expect(
      assertOtpVerified({ userId: 'u1', otpId: 'o1', code: '123456' }),
    ).resolves.toBeUndefined();
  });

  test('throws on verified=false', async () => {
    verify.mockResolvedValue({ verified: false, reason: 'invalid' });
    await expect(
      assertOtpVerified({ userId: 'u1', otpId: 'o1', code: '999999' }),
    ).rejects.toMatchObject({ statusCode: 401, code: 'OTP_INVALID' });
  });

  test('treats verified=undefined as failure (defense-in-depth)', async () => {
    verify.mockResolvedValue({});
    await expect(
      assertOtpVerified({ userId: 'u1', otpId: 'o1', code: '123456' }),
    ).rejects.toMatchObject({ statusCode: 401, code: 'OTP_INVALID' });
  });

  test('treats null result as failure', async () => {
    verify.mockResolvedValue(null as any);
    await expect(
      assertOtpVerified({ userId: 'u1', otpId: 'o1', code: '123456' }),
    ).rejects.toMatchObject({ statusCode: 401, code: 'OTP_INVALID' });
  });

  test('threads PAYOUT_PREFERENCE_CHANGE purpose', async () => {
    verify.mockResolvedValue({ verified: true });
    await assertOtpVerified({ userId: 'u1', otpId: 'o1', code: '123456' });
    expect(verify).toHaveBeenCalledWith({
      otpId: 'o1',
      code: '123456',
      purpose: 'PAYOUT_PREFERENCE_CHANGE',
    });
  });
});
