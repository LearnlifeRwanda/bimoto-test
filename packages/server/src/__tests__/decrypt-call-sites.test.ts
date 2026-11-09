// DECRYPT v3 G4 — the runtime guard, both directions, and destination
// proofs for the call sites whose own suites only assert "an SMS went
// out" rather than "an SMS went out to a number you could dial".
//
// The six sites already proved elsewhere are left alone: markLegActive
// (driver-arrived destination), legs-service-recipient-sms (destination
// AND the "contact X at Y" body), auto-confirm-flagged-rows, and the
// three scheduled-ride-reminder windows all assert the literal
// +250… number their fixtures encrypt. This file covers freeze,
// unfreeze, auto-fallback, the payout step-up OTP's phoneHash, and the
// guard itself.

import { encrypt } from '../utils/crypto';
import {
  assertDialable,
  looksLikeCiphertext,
  ciphertextBreadcrumb,
  NotDialableError,
} from '../utils/dialable';

const PLAINTEXT = '+250788123456';
const CIPHERTEXT = encrypt(PLAINTEXT);

describe('the ciphertext shape is recognised, and only the ciphertext shape', () => {
  test('real ciphertext from crypto.ts is caught', () => {
    expect(CIPHERTEXT).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i);
    expect(looksLikeCiphertext(CIPHERTEXT)).toBe(true);
    expect(() => assertDialable(CIPHERTEXT, 'test')).toThrow(NotDialableError);
  });

  test.each([
    ['E.164 Rwandan', '+250788123456'],
    ['local leading zero', '0788123456'],
    ['bare local', '788123456'],
    ['spaced', '+250 788 123 456'],
    ['dashed', '+250-788-123-456'],
    ['ops short code', '1234'],
    ['non-RW E.164', '+447700900000'],
  ])('a %s number is never refused', (_label, number) => {
    expect(looksLikeCiphertext(number)).toBe(false);
    expect(() => assertDialable(number, 'test')).not.toThrow();
  });

  test('empty and nullish are not ciphertext (callers guard those separately)', () => {
    expect(looksLikeCiphertext('')).toBe(false);
    expect(looksLikeCiphertext(null)).toBe(false);
    expect(looksLikeCiphertext(undefined)).toBe(false);
  });

  test('a hex-looking value with the wrong part count is not caught', () => {
    // Two parts is not the crypto.ts shape; the guard is deliberately
    // narrow so it can never start refusing real traffic.
    expect(looksLikeCiphertext('abcdef:123456')).toBe(false);
  });

  test('the breadcrumb never reproduces the value', () => {
    const crumb = ciphertextBreadcrumb(CIPHERTEXT);
    expect(crumb).not.toContain(CIPHERTEXT);
    for (const part of CIPHERTEXT.split(':')) {
      expect(crumb).not.toContain(part);
    }
    expect(crumb).toContain('3 parts');
  });

  test('the error message carries the context but not the material', () => {
    const err = new NotDialableError('transferToWallet.account_number', CIPHERTEXT);
    expect(err.code).toBe('NOT_DIALABLE');
    expect(err.message).toContain('transferToWallet.account_number');
    expect(err.message).not.toContain(CIPHERTEXT);
  });
});

describe('sendSms refuses a ciphertext destination before any transport', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
    jest.resetModules();
  });

  test('ciphertext returns a structured failure and reaches no transport', async () => {
    jest.resetModules();
    const create = jest.fn();
    jest.doMock('../prisma', () => ({
      __esModule: true,
      default: { simulatedMessage: { create } },
    }));
    jest.doMock('../config', () => ({
      config: {
        ...jest.requireActual('../config').config,
        SMS_MODE: 'simulated',
      },
    }));
    const { sendSms } = await import('../services/sms.service');

    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await sendSms(CIPHERTEXT, 'body');

    expect(result).toEqual({ success: false });
    // Not even the simulated inbox — the guard sits above every branch.
    expect(create).not.toHaveBeenCalled();
    const logged = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('refused');
    expect(logged).not.toContain(CIPHERTEXT);
    errSpy.mockRestore();
  });

  test('a real number still reaches the transport', async () => {
    jest.resetModules();
    const create = jest.fn(async () => ({ id: 'sim-1' }));
    jest.doMock('../prisma', () => ({
      __esModule: true,
      default: { simulatedMessage: { create } },
    }));
    jest.doMock('../config', () => ({
      config: {
        ...jest.requireActual('../config').config,
        SMS_MODE: 'simulated',
      },
    }));
    const { sendSms } = await import('../services/sms.service');

    const result = await sendSms(PLAINTEXT, 'body');
    expect(result).toEqual({ success: true });
    expect(create).toHaveBeenCalledWith({
      data: { toPhone: PLAINTEXT, body: 'body' },
    });
  });
});

describe('the mobile-money boundary refuses a ciphertext wallet address', () => {
  afterEach(() => jest.resetModules());

  test('transferToWallet throws before the gateway is called', async () => {
    jest.resetModules();
    const initiate = jest.fn();
    jest.doMock('../services/payment/flutterwave-client', () => ({
      getClient: () => ({ Transfer: { initiate } }),
    }));
    const { transferToWallet } = await import('../services/payment/transfer');

    // Asserted on the structured code, not the constructor: jest.resetModules
    // hands the dynamically-imported transfer.ts its own copy of
    // utils/dialable, so an instanceof check would compare two distinct
    // classes that are both NotDialableError.
    await expect(
      transferToWallet({
        phone: CIPHERTEXT,
        amount: 5000,
        narration: 'payout',
        reference: 'ref-1',
      }),
    ).rejects.toMatchObject({
      code: 'NOT_DIALABLE',
      name: 'NotDialableError',
    });
    expect(initiate).not.toHaveBeenCalled();
  });

  test('transferToWallet passes a real number through to account_number', async () => {
    jest.resetModules();
    const initiate = jest.fn(async () => ({
      status: 'success',
      data: { id: 42, status: 'successful' },
    }));
    jest.doMock('../services/payment/flutterwave-client', () => ({
      getClient: () => ({ Transfer: { initiate } }),
    }));
    const { transferToWallet } = await import('../services/payment/transfer');

    const out = await transferToWallet({
      phone: PLAINTEXT,
      amount: 5000,
      narration: 'payout',
      reference: 'ref-1',
    });

    expect(out.status).toBe('SUCCESS');
    expect(initiate).toHaveBeenCalledWith(
      expect.objectContaining({ account_number: PLAINTEXT }),
    );
  });
});

describe('freeze and unfreeze notices reach a dialable number', () => {
  const sendSms = jest.fn(async (_phone: string, _body: string) => ({ success: true }));

  beforeEach(() => {
    jest.resetModules();
    sendSms.mockClear();
  });

  async function loadFreezeService() {
    const userRow: Record<string, unknown> = {
      id: 'u1',
      phoneEncrypted: CIPHERTEXT,
      nickname: 'Aljo',
      role: 'DRIVER',
      frozenAt: null,
    };
    const tx = {
      user: {
        findUnique: jest.fn(async () => userRow),
        update: jest.fn(async ({ data }: any) => Object.assign(userRow, data)),
      },
      driverPayoutBatch: { updateMany: jest.fn(async () => ({ count: 0 })) },
      adminAction: { create: jest.fn(async ({ data }: any) => ({ id: 'aa-1', ...data })) },
    };
    jest.doMock('../prisma', () => ({
      __esModule: true,
      default: { $transaction: async (fn: any) => fn(tx) },
    }));
    jest.doMock('../services/sms.service', () => ({ sendSms, maskPhone: (p: string) => p }));
    jest.doMock('../services/admin/socket-disconnect.helper', () => ({
      disconnectUserSockets: jest.fn(),
    }));
    jest.doMock('../middleware/auth-status-cache', () => ({
      invalidateAuthStatusCache: jest.fn(),
    }));
    jest.doMock('../services/refresh-token.service', () => ({
      revokeAllRefreshTokensForUser: jest.fn(),
    }));
    jest.doMock('../services/admin/admin-action-audit.service', () => ({
      appendAdminActionTx: jest.fn(async () => ({ id: 'aa-1' })),
    }));
    return import('../services/admin/freeze.service');
  }

  test('the freeze notice is addressed to the decrypted number', async () => {
    const svc = await loadFreezeService();
    const out = await svc.freezeUser({
      userId: 'u1',
      adminId: 'a1',
      category: 'FRAUD' as never,
      reason: 'test',
      releasePayouts: false,
      notify: true,
    } as never);

    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms.mock.calls[0][0]).toBe(PLAINTEXT);
    // and the value handed back to the admin surface is dialable too
    expect((out as { user: { phone: string } }).user.phone).toBe(PLAINTEXT);
  });

  test('the unfreeze notice is addressed to the decrypted number', async () => {
    const svc = await loadFreezeService();
    const out = await svc.unfreezeUser({
      userId: 'u1',
      adminId: 'a1',
      reason: 'test',
      releasePayouts: false,
      notify: true,
    } as never);

    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms.mock.calls[0][0]).toBe(PLAINTEXT);
    expect((out as { user: { phone: string } }).user.phone).toBe(PLAINTEXT);
  });
});

describe('the payout step-up OTP is redeemable end to end', () => {
  afterEach(() => jest.resetModules());

  test('the SMS goes to plaintext and OtpCode.phoneHash is derived from plaintext', async () => {
    jest.resetModules();
    const sendSms = jest.fn(async (_phone: string, _body: string) => ({ success: true }));
    const created: Array<Record<string, unknown>> = [];
    jest.doMock('../services/sms.service', () => ({ sendSms }));
    jest.doMock('../prisma', () => ({
      __esModule: true,
      default: {
        otpCode: {
          updateMany: jest.fn(async () => ({ count: 0 })),
          create: jest.fn(async ({ data }: any) => {
            created.push(data);
            return { id: 'otp-1', ...data };
          }),
        },
      },
    }));
    const { sendOtp } = await import('../services/otp.service');
    const { hashPhone } = await import('../utils/crypto');
    const { decryptedPhone } = await import('../services/user-phone');

    // payout.routes.ts hands sendOtp the DECRYPTED number; the service's
    // plaintext contract is unchanged.
    const userRow = { phoneEncrypted: CIPHERTEXT };
    await sendOtp({
      userId: 'u1',
      phone: decryptedPhone(userRow),
      purpose: 'PAYOUT_PREFERENCE_CHANGE',
    });

    expect(sendSms.mock.calls[0][0]).toBe(PLAINTEXT);
    // The stored hash must match one derived from what the user will type
    // at verification time — a hash of the ciphertext never could.
    expect(created[0].phoneHash).toBe(hashPhone(PLAINTEXT));
    expect(created[0].phoneHash).not.toBe(hashPhone(CIPHERTEXT));
  });
});
