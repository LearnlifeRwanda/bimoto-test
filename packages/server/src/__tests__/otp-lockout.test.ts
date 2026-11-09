// PREPROTO-AUTH G2 — brute-force lockout tests: a code dies after
// OTP_MAX_ATTEMPTS wrong guesses (even the correct code is then
// rejected), and the verify-otp / refresh routes are rate-limited.

jest.mock('../prisma', () => {
  const otpRows: any[] = [];
  return {
    __esModule: true,
    default: {
      otpCode: {
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `otp-${otpRows.length + 1}`,
            used: false,
            attemptCount: 0,
            createdAt: new Date(),
            ...data,
          };
          otpRows.push(row);
          return row;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          const now = new Date();
          const matches = otpRows
            .filter(
              (r) =>
                r.phoneHash === where.phoneHash &&
                r.purpose === where.purpose &&
                r.used === where.used &&
                r.expiresAt >= now,
            )
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return matches[0] ?? null;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = otpRows.find((r) => r.id === where.id);
          Object.assign(row, data);
          return row;
        }),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    },
  };
});

jest.mock('../services/sms.service', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
}));

import { sendSms } from '../services/sms.service';
import { sendLoginOtp, verifyLoginOtp } from '../services/otp.service';
import { rateLimit, _resetRateLimitForTests } from '../middleware/rate-limit';
import { config } from '../config';

const sms = sendSms as jest.Mock;

function lastSmsCode(): string {
  const body: string = sms.mock.calls[sms.mock.calls.length - 1][1];
  return body.match(/(\d{6})/)![1];
}

function wrongCode(code: string): string {
  return code === '000000' ? '000001' : '000000';
}

describe('OTP attempt cap (G2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test(`code is killed after ${5} wrong guesses — the 6th is rejected even if correct`, async () => {
    expect(config.OTP_MAX_ATTEMPTS).toBe(5);
    await sendLoginOtp('+250788111222');
    const code = lastSmsCode();

    for (let i = 1; i <= 5; i++) {
      const result = await verifyLoginOtp('+250788111222', wrongCode(code));
      expect(result.verified).toBe(false);
      expect(result.reason).toBe(i < 5 ? 'invalid' : 'too_many_attempts');
    }

    // The code is dead: the CORRECT code no longer works.
    const afterLockout = await verifyLoginOtp('+250788111222', code);
    expect(afterLockout.verified).toBe(false);
  });

  test('wrong guesses below the cap do not kill the code', async () => {
    await sendLoginOtp('+250788111222');
    const code = lastSmsCode();

    for (let i = 0; i < 4; i++) {
      await verifyLoginOtp('+250788111222', wrongCode(code));
    }
    const result = await verifyLoginOtp('+250788111222', code);
    expect(result.verified).toBe(true);
  });
});

describe('rate limiter identity keying (G2/G5)', () => {
  const realNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    _resetRateLimitForTests();
    // The limiter no-ops under NODE_ENV=test; exercise the real path.
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = realNodeEnv;
  });

  function run(middleware: any, req: any): number | 'passed' {
    let status: number | 'passed' = 'passed';
    const res = {
      status: (s: number) => {
        status = s;
        return { json: () => undefined };
      },
    };
    let called = false;
    middleware(req, res, () => {
      called = true;
    });
    return called ? 'passed' : status;
  }

  test('keys on the extracted identity: same phone from different IPs shares one bucket', () => {
    const mw = rateLimit(3, 60_000, 'test-scope', (req: any) => req.body?.phone);
    for (let i = 0; i < 3; i++) {
      expect(run(mw, { ip: `10.0.0.${i}`, body: { phone: '+250788111222' } })).toBe('passed');
    }
    // 4th attempt for the same phone — from yet another IP — is throttled.
    expect(run(mw, { ip: '10.0.0.99', body: { phone: '+250788111222' } })).toBe(429);
    // A different phone still passes.
    expect(run(mw, { ip: '10.0.0.99', body: { phone: '+250788999888' } })).toBe('passed');
  });

  test('falls back to IP keying when the extractor returns nothing', () => {
    const mw = rateLimit(2, 60_000, 'test-scope-2', (req: any) => req.body?.phone);
    expect(run(mw, { ip: '10.0.0.1', body: {} })).toBe('passed');
    expect(run(mw, { ip: '10.0.0.1', body: {} })).toBe('passed');
    expect(run(mw, { ip: '10.0.0.1', body: {} })).toBe(429);
    expect(run(mw, { ip: '10.0.0.2', body: {} })).toBe('passed');
  });
});
