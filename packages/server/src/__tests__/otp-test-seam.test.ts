// PREPROTO-AUTH — the test-only OTP seam. Since G1 only hmacOtp(code) is
// at rest, so the e2e suite reads the plaintext from the request-otp
// response under NODE_ENV=test. This suite proves the seam works in test
// mode AND that it does not exist outside it (the gate lives inside
// otp.service, so no caller can leak the code in production).

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    otpCode: {
      create: jest.fn(async ({ data }: any) => ({ id: 'otp-1', ...data })),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
  },
}));

jest.mock('../services/sms.service', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
}));

import { sendSms } from '../services/sms.service';

const sms = sendSms as jest.Mock;

function smsCode(): string {
  const body: string = sms.mock.calls[sms.mock.calls.length - 1][1];
  return body.match(/(\d{6})/)![1];
}

afterEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

describe('sendLoginOtp test-only seam', () => {
  test('NODE_ENV=test: returns the plaintext code (matches the SMS)', async () => {
    jest.doMock('../config', () => ({
      config: {
        NODE_ENV: 'test',
        ENCRYPTION_KEY: 'a'.repeat(64),
        OTP_HMAC_KEY: undefined,
        OTP_MAX_ATTEMPTS: 5,
      },
    }));
    const { sendLoginOtp } = require('../services/otp.service');
    const out = await sendLoginOtp('+250788111222');
    expect(out.testOnlyCode).toBeDefined();
    expect(out.testOnlyCode).toBe(smsCode());
  });

  test('NODE_ENV=production: the field does not exist', async () => {
    jest.doMock('../config', () => ({
      config: {
        NODE_ENV: 'production',
        ENCRYPTION_KEY: 'a'.repeat(64),
        OTP_HMAC_KEY: undefined,
        OTP_MAX_ATTEMPTS: 5,
      },
    }));
    const { sendLoginOtp } = require('../services/otp.service');
    const out = await sendLoginOtp('+250788111222');
    expect('testOnlyCode' in out).toBe(false);
  });

  test('NODE_ENV=development: the field does not exist either', async () => {
    jest.doMock('../config', () => ({
      config: {
        NODE_ENV: 'development',
        ENCRYPTION_KEY: 'a'.repeat(64),
        OTP_HMAC_KEY: undefined,
        OTP_MAX_ATTEMPTS: 5,
      },
    }));
    const { sendLoginOtp } = require('../services/otp.service');
    const out = await sendLoginOtp('+250788111222');
    expect('testOnlyCode' in out).toBe(false);
  });

  test('requestOtp exposes testOtp only when the service returned the code', async () => {
    jest.doMock('../config', () => ({
      config: {
        NODE_ENV: 'production',
        ENCRYPTION_KEY: 'a'.repeat(64),
        OTP_HMAC_KEY: undefined,
        OTP_MAX_ATTEMPTS: 5,
        JWT_SECRET: 'x'.repeat(32),
        JWT_REFRESH_SECRET: 'y'.repeat(32),
      },
    }));
    const { requestOtp } = require('../services/auth.service');
    const out = await requestOtp('+250788111222');
    expect(out.success).toBe(true);
    expect('testOtp' in out).toBe(false);
  });
});
