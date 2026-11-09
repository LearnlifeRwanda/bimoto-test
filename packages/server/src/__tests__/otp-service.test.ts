jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    otpCode: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock('../services/sms.service', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
}));

import prisma from '../prisma';
import { sendSms } from '../services/sms.service';
import { sendOtp, verifyOtp, sendLoginOtp, verifyLoginOtp, LOGIN_PURPOSE } from '../services/otp.service';
import { hmacOtp } from '../utils/crypto';

const m = prisma as jest.Mocked<typeof prisma>;
const findFirst = m.otpCode.findFirst as jest.Mock;
const findUnique = m.otpCode.findUnique as jest.Mock;
const create = m.otpCode.create as jest.Mock;
const update = m.otpCode.update as jest.Mock;
const updateMany = m.otpCode.updateMany as jest.Mock;
const sms = sendSms as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  updateMany.mockResolvedValue({ count: 0 });
});

describe('sendOtp', () => {
  test('persists only the HMAC of the code — never the plaintext (G1 at-rest invariant)', async () => {
    create.mockResolvedValue({
      id: 'otp-1',
      expiresAt: new Date(Date.now() + 600_000),
    });
    const out = await sendOtp({
      userId: 'u1',
      phone: '+250788111222',
      purpose: 'PAYOUT_PREFERENCE_CHANGE',
    });
    expect(out.otpId).toBe('otp-1');
    expect(create).toHaveBeenCalledTimes(1);
    expect(sms).toHaveBeenCalledTimes(1);
    expect(sms.mock.calls[0][0]).toBe('+250788111222');
    const smsBody: string = sms.mock.calls[0][1];
    const plaintext = smsBody.match(/Bimoto code: (\d{6})/)?.[1];
    expect(plaintext).toBeDefined();
    const storedCode = create.mock.calls[0][0].data.code;
    // The stored column is the keyed hash of the SMS code, not the code.
    expect(storedCode).not.toBe(plaintext);
    expect(storedCode).toBe(hmacOtp(plaintext!));
  });

  test('kills any live code for (userId, purpose) before issuing a fresh one', async () => {
    create.mockResolvedValue({
      id: 'otp-2',
      expiresAt: new Date(Date.now() + 600_000),
    });
    await sendOtp({
      userId: 'u1',
      phone: '+250788111222',
      purpose: 'PAYOUT_PREFERENCE_CHANGE',
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'u1',
        purpose: 'PAYOUT_PREFERENCE_CHANGE',
        used: false,
      }),
      data: { used: true },
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(sms).toHaveBeenCalledTimes(1);
  });
});

describe('verifyOtp', () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'otp-1',
    code: hmacOtp('123456'),
    attemptCount: 0,
    purpose: 'PAYOUT_PREFERENCE_CHANGE',
    used: false,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });

  test('accepts correct code + purpose, marks used', async () => {
    findUnique.mockResolvedValue(row());
    const result = await verifyOtp({
      otpId: 'otp-1',
      code: '123456',
      purpose: 'PAYOUT_PREFERENCE_CHANGE',
    });
    expect(result.verified).toBe(true);
    expect(update).toHaveBeenCalledWith({ where: { id: 'otp-1' }, data: { used: true } });
  });

  test('rejects expired', async () => {
    findUnique.mockResolvedValue(row({ expiresAt: new Date(Date.now() - 1000) }));
    const result = await verifyOtp({
      otpId: 'otp-1',
      code: '123456',
      purpose: 'PAYOUT_PREFERENCE_CHANGE',
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('expired');
    expect(update).not.toHaveBeenCalled();
  });

  test('rejects wrong purpose', async () => {
    findUnique.mockResolvedValue(row({ purpose: 'OTHER_PURPOSE' }));
    const result = await verifyOtp({
      otpId: 'otp-1',
      code: '123456',
      purpose: 'PAYOUT_PREFERENCE_CHANGE',
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('wrong_purpose');
  });

  test('rejects already-used', async () => {
    findUnique.mockResolvedValue(row({ used: true }));
    const result = await verifyOtp({
      otpId: 'otp-1',
      code: '123456',
      purpose: 'PAYOUT_PREFERENCE_CHANGE',
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('already_used');
  });

  test('rejects wrong code (non-leaking reason)', async () => {
    findUnique.mockResolvedValue(row());
    const result = await verifyOtp({
      otpId: 'otp-1',
      code: '999999',
      purpose: 'PAYOUT_PREFERENCE_CHANGE',
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('invalid');
  });

  test('rejects unknown otpId', async () => {
    findUnique.mockResolvedValue(null);
    const result = await verifyOtp({
      otpId: 'no-such-id',
      code: '123456',
      purpose: 'PAYOUT_PREFERENCE_CHANGE',
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('invalid');
  });
});

describe('sendLoginOtp / verifyLoginOtp (login path)', () => {
  test('round-trip: the code from the SMS verifies against the stored HMAC', async () => {
    create.mockImplementation(async ({ data }: any) => ({ id: 'otp-l1', ...data }));
    await sendLoginOtp('+250788111222');

    const smsBody: string = sms.mock.calls[0][1];
    const plaintext = smsBody.match(/code is: (\d{6})/)?.[1];
    expect(plaintext).toBeDefined();
    const storedRow = { id: 'otp-l1', ...create.mock.calls[0][0].data, used: false, attemptCount: 0 };
    // At-rest invariant: the column holds the HMAC, not the SMS code.
    expect(storedRow.code).not.toBe(plaintext);
    expect(storedRow.purpose).toBe(LOGIN_PURPOSE);

    findFirst.mockResolvedValue(storedRow);
    const result = await verifyLoginOtp('+250788111222', plaintext!);
    expect(result.verified).toBe(true);
    expect(update).toHaveBeenCalledWith({ where: { id: 'otp-l1' }, data: { used: true } });
  });

  test('kills prior live login codes on re-request (single valid code per phone)', async () => {
    create.mockImplementation(async ({ data }: any) => ({ id: 'otp-l2', ...data }));
    await sendLoginOtp('+250788111222');
    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ purpose: LOGIN_PURPOSE, used: false }),
      data: { used: true },
    });
  });

  test('rejects a wrong code', async () => {
    findFirst.mockResolvedValue({
      id: 'otp-l3',
      code: hmacOtp('123456'),
      attemptCount: 0,
      purpose: LOGIN_PURPOSE,
      used: false,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const result = await verifyLoginOtp('+250788111222', '999999');
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('invalid');
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { used: true } }),
    );
  });

  test('rejects when no live code exists', async () => {
    findFirst.mockResolvedValue(null);
    const result = await verifyLoginOtp('+250788111222', '123456');
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('invalid');
  });
});
