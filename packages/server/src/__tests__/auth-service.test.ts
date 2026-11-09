// PREPROTO-AUTH — login-flow tests over auth.service. Uses an in-memory
// OtpCode table so the full request→verify→token round-trip runs against
// the real otp.service (CSPRNG + HMAC-at-rest + constant-time compare).

jest.mock('../prisma', () => {
  const otpRows: any[] = [];
  const userRows = new Map<string, any>();
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
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const r of otpRows) {
            if (r.phoneHash === where.phoneHash && r.purpose === where.purpose && r.used === where.used) {
              Object.assign(r, data);
              count++;
            }
          }
          return { count };
        }),
      },
      // ACCOUNT-RIGHTS-CORE G3 — registration reads the tombstone to
      // apply the D19 returner policy. No tombstone in these fixtures, so
      // every account below is an ordinary first-time signup and the
      // login flow they assert is unchanged.
      accountTombstone: {
        findUnique: jest.fn(async () => null),
      },
      refreshToken: {
        create: jest.fn(async ({ data }: any) => ({ id: `rt-${Date.now()}`, ...data })),
        findUnique: jest.fn(async () => null),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      user: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.phoneHash) {
            return (
              Array.from(userRows.values()).find((u) => u.phoneHash === where.phoneHash) ?? null
            );
          }
          return userRows.get(where.id) ?? null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `user-${userRows.size + 1}`, ...data };
          userRows.set(row.id, row);
          return row;
        }),
      },
      __rows: { otpRows, userRows },
    },
  };
});

jest.mock('../services/sms.service', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
}));

import prisma from '../prisma';
import { sendSms } from '../services/sms.service';
import { requestOtp, verifyOtp } from '../services/auth.service';
import { verifyAccessToken, verifyRefreshToken } from '../utils/jwt';

const sms = sendSms as jest.Mock;
const rows = (prisma as any).__rows as { otpRows: any[]; userRows: Map<string, any> };

beforeEach(() => {
  jest.clearAllMocks();
  rows.otpRows.length = 0;
  rows.userRows.clear();
});

function lastSmsCode(): string {
  const body: string = sms.mock.calls[sms.mock.calls.length - 1][1];
  const code = body.match(/(\d{6})/)?.[1];
  if (!code) throw new Error(`no code in SMS body: ${body}`);
  return code;
}

describe('login flow (requestOtp → verifyOtp)', () => {
  test('full round-trip succeeds and issues valid tokens', async () => {
    await requestOtp('+250788111222');
    const code = lastSmsCode();

    const out = await verifyOtp('+250788111222', code);
    expect(out.isNewUser).toBe(true);
    expect(out.user.role).toBe('CUSTOMER');
    expect(verifyAccessToken(out.accessToken).userId).toBe(out.user.id);
    expect(verifyRefreshToken(out.refreshToken).userId).toBe(out.user.id);
  });

  test('stored OtpCode.code column is not the SMS plaintext (no plaintext at rest)', async () => {
    await requestOtp('+250788111222');
    const code = lastSmsCode();
    expect(rows.otpRows).toHaveLength(1);
    expect(rows.otpRows[0].code).not.toBe(code);
    expect(rows.otpRows[0].code).toMatch(/^[0-9a-f]{64}$/); // HMAC-SHA256 hex
  });

  test('wrong code is rejected with INVALID_OTP', async () => {
    await requestOtp('+250788111222');
    const code = lastSmsCode();
    const wrong = code === '000000' ? '000001' : '000000';
    await expect(verifyOtp('+250788111222', wrong)).rejects.toMatchObject({
      code: 'INVALID_OTP',
    });
  });

  test('a used code cannot be replayed', async () => {
    await requestOtp('+250788111222');
    const code = lastSmsCode();
    await verifyOtp('+250788111222', code);
    await expect(verifyOtp('+250788111222', code)).rejects.toMatchObject({
      code: 'INVALID_OTP',
    });
  });

  test('existing user logs in without re-provisioning', async () => {
    await requestOtp('+250788111222');
    await verifyOtp('+250788111222', lastSmsCode());
    await requestOtp('+250788111222');
    const out = await verifyOtp('+250788111222', lastSmsCode());
    expect(out.isNewUser).toBe(false);
    expect(rows.userRows.size).toBe(1);
  });

  test('re-requesting an OTP invalidates the previous code', async () => {
    await requestOtp('+250788111222');
    const first = lastSmsCode();
    await requestOtp('+250788111222');
    const second = lastSmsCode();
    if (first !== second) {
      await expect(verifyOtp('+250788111222', first)).rejects.toMatchObject({
        code: 'INVALID_OTP',
      });
    }
    const out = await verifyOtp('+250788111222', second);
    expect(out.user).toBeDefined();
  });
});
