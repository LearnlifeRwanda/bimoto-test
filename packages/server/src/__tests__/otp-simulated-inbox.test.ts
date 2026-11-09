// PREPROTO-SIM G3 — end-to-end over the OTP seam: requesting a code with
// SMS_MODE=simulated lands a readable row in the simulated inbox (this IS
// the pilot's OTP delivery channel). The OTP service itself is untouched
// (#112 code, out of scope) — only the transport underneath it changed.

jest.mock('../config', () => ({
  config: {
    DATABASE_URL: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16-chars',
    ENCRYPTION_KEY: 'a'.repeat(64),
    OTP_HMAC_KEY: undefined,
    OTP_MAX_ATTEMPTS: 5,
    PORT: 3000,
    CLIENT_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
    PAYMENTS_MODE: 'live',
    SMS_MODE: 'simulated',
    SIM_INBOX_TOKEN: '',
    ALLOW_SIMULATED_IN_PROD: false,
  },
}));

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    otpCode: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({ id: 'otp-1' }),
    },
    simulatedMessage: {
      create: jest.fn().mockResolvedValue({ id: 'sm-1' }),
    },
  },
}));

import prisma from '../prisma';
import { sendOtp } from '../services/otp.service';

const smsCreate = (prisma as any).simulatedMessage.create as jest.Mock;
const otpCreate = (prisma as any).otpCode.create as jest.Mock;

describe('OTP request path with SMS_MODE=simulated', () => {
  beforeEach(() => jest.clearAllMocks());

  test('captures the plaintext code as a readable inbox row', async () => {
    const r = await sendOtp({ userId: 'u1', phone: '+250781234567', purpose: 'LOGIN' });
    expect(r.otpId).toBe('otp-1');

    expect(smsCreate).toHaveBeenCalledTimes(1);
    const { toPhone, body } = smsCreate.mock.calls[0][0].data;
    expect(toPhone).toBe('+250781234567');
    const codeMatch = body.match(/Bimoto code: (\d{6})\./);
    expect(codeMatch).not.toBeNull();

    // The plaintext code lives ONLY in the inbox row; at rest the OtpCode
    // row holds the HMAC, which must not equal the plaintext.
    const storedCode = otpCreate.mock.calls[0][0].data.code;
    expect(storedCode).not.toBe(codeMatch![1]);
  });
});
