// MONEY-PIN G6 — the reset state machine, the attempt budget, and the
// notice SMS.
//
// The state machine is the part worth testing hardest: it is the whole
// security of the borrowed-phone story, it is evaluated at exactly one
// moment (verify), and every one of its branches is a decision the
// founder ruled on rather than an implementation detail.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: { user: { findUnique: jest.fn(), update: jest.fn() } },
}));

jest.mock('../services/otp.service', () => ({
  sendOtp: jest.fn(),
  verifyOtp: jest.fn(),
}));

jest.mock('../services/sms.service', () => ({ sendSms: jest.fn() }));
jest.mock('../services/push', () => ({ getUserLanguage: jest.fn() }));
jest.mock('../services/user-phone', () => ({ decryptedPhone: () => '+250780000000' }));

import prisma from '../prisma';
import { sendOtp, verifyOtp } from '../services/otp.service';
import { sendSms } from '../services/sms.service';
import { getUserLanguage } from '../services/push';
import { hmacOtp } from '../utils/crypto';
import {
  setMoneyPin,
  changeMoneyPin,
  verifyMoneyPin,
  requestMoneyPinReset,
  confirmMoneyPinReset,
  getMoneyPinStatus,
  composeMoneyPinNotice,
  MONEY_PIN_RESET_PURPOSE,
} from '../services/money-pin.service';
import { MONEY_PIN_MAX_ATTEMPTS } from '@bimoto/shared';

const findUnique = (prisma as any).user.findUnique as jest.Mock;
const update = (prisma as any).user.update as jest.Mock;
const smsMock = sendSms as jest.Mock;
const langMock = getUserLanguage as jest.Mock;

const HOUR = 60 * 60 * 1000;

/** A user row with sane defaults; each test overrides only what it means. */
function userRow(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    moneyPinHash: hmacOtp('1234'),
    moneyPinPendingHash: null,
    moneyPinPendingActivatesAt: null,
    moneyPinAttempts: 0,
    moneyPinLockedUntil: null,
    smsOptOut: false,
    language: 'rw',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  update.mockResolvedValue({});
  langMock.mockResolvedValue('rw');
  smsMock.mockResolvedValue({ success: true });
});

describe('setMoneyPin', () => {
  test('sets the first PIN and stores only the HMAC, never the plaintext', async () => {
    findUnique.mockResolvedValue(userRow({ moneyPinHash: null }));
    await setMoneyPin('u1', '4321');

    const data = update.mock.calls[0][0].data;
    expect(data.moneyPinHash).toBe(hmacOtp('4321'));
    // The invariant, asserted rather than assumed: the digits must not
    // appear anywhere in what is written.
    expect(JSON.stringify(data)).not.toContain('4321');
  });

  test('refuses when a PIN already exists — this endpoint is not the bypass', async () => {
    findUnique.mockResolvedValue(userRow());
    await expect(setMoneyPin('u1', '4321')).rejects.toMatchObject({
      code: 'MONEY_PIN_ALREADY_SET',
    });
    expect(update).not.toHaveBeenCalled();
  });

  test.each([['123'], ['12345'], ['abcd'], ['']])(
    'rejects malformed PIN %p',
    async (bad) => {
      findUnique.mockResolvedValue(userRow({ moneyPinHash: null }));
      await expect(setMoneyPin('u1', bad)).rejects.toMatchObject({
        code: 'MONEY_PIN_INVALID_FORMAT',
      });
    },
  );
});

describe('verifyMoneyPin — attempts and lockout', () => {
  test('correct PIN verifies and resets the attempt counter', async () => {
    findUnique.mockResolvedValue(userRow({ moneyPinAttempts: 3 }));
    const result = await verifyMoneyPin('u1', '1234');
    expect(result.verified).toBe(true);
    expect(update.mock.calls[0][0].data).toMatchObject({
      moneyPinAttempts: 0,
      moneyPinLockedUntil: null,
    });
  });

  test('wrong PIN spends one guess and throws', async () => {
    findUnique.mockResolvedValue(userRow({ moneyPinAttempts: 1 }));
    await expect(verifyMoneyPin('u1', '9999')).rejects.toMatchObject({
      code: 'MONEY_PIN_INVALID',
    });
    expect(update.mock.calls[0][0].data.moneyPinAttempts).toBe(2);
    expect(update.mock.calls[0][0].data.moneyPinLockedUntil).toBeUndefined();
  });

  test('the last wrong guess locks the PIN', async () => {
    findUnique.mockResolvedValue(userRow({ moneyPinAttempts: MONEY_PIN_MAX_ATTEMPTS - 1 }));
    await expect(verifyMoneyPin('u1', '9999')).rejects.toMatchObject({
      code: 'MONEY_PIN_LOCKED',
    });
    expect(update.mock.calls[0][0].data.moneyPinLockedUntil).toBeInstanceOf(Date);
  });

  test('a live lockout refuses even the CORRECT PIN', async () => {
    // The point of a terminating budget: it bounds a guesser regardless
    // of how fast they can ask, so it cannot make an exception for a
    // guess that happens to be right.
    findUnique.mockResolvedValue(
      userRow({ moneyPinLockedUntil: new Date(Date.now() + 10 * 60_000) }),
    );
    await expect(verifyMoneyPin('u1', '1234')).rejects.toMatchObject({
      code: 'MONEY_PIN_LOCKED',
    });
  });

  test('an EXPIRED lockout lets the correct PIN through, with no job having run', async () => {
    findUnique.mockResolvedValue(
      userRow({ moneyPinLockedUntil: new Date(Date.now() - 1000) }),
    );
    await expect(verifyMoneyPin('u1', '1234')).resolves.toMatchObject({ verified: true });
  });

  test('a malformed PIN still spends a guess — junk cannot dodge the budget', async () => {
    findUnique.mockResolvedValue(userRow({ moneyPinAttempts: 0 }));
    await expect(verifyMoneyPin('u1', 'zzzz')).rejects.toMatchObject({
      code: 'MONEY_PIN_INVALID',
    });
    expect(update.mock.calls[0][0].data.moneyPinAttempts).toBe(1);
  });
});

describe('verifyMoneyPin — the reset state machine', () => {
  test('a pending reset that has NOT matured does not work yet', async () => {
    findUnique.mockResolvedValue(
      userRow({
        moneyPinPendingHash: hmacOtp('7777'),
        moneyPinPendingActivatesAt: new Date(Date.now() + 23 * HOUR),
      }),
    );
    // The borrower's new PIN. It is stored, and it is refused.
    await expect(verifyMoneyPin('u1', '7777')).rejects.toMatchObject({
      code: 'MONEY_PIN_INVALID',
    });
  });

  test('a pending reset PAST its activatesAt becomes live on the next verify', async () => {
    findUnique.mockResolvedValue(
      userRow({
        moneyPinPendingHash: hmacOtp('7777'),
        moneyPinPendingActivatesAt: new Date(Date.now() - 1000),
      }),
    );
    const result = await verifyMoneyPin('u1', '7777');
    expect(result.verified).toBe(true);
    expect(result.activatedPendingReset).toBe(true);
    // Promoted, and the pending pair cleared — no job involved.
    expect(update.mock.calls[0][0].data).toMatchObject({
      moneyPinHash: hmacOtp('7777'),
      moneyPinPendingHash: null,
      moneyPinPendingActivatesAt: null,
    });
  });

  test('the OLD pin used inside the window CANCELS the pending reset — the owner wins', async () => {
    findUnique.mockResolvedValue(
      userRow({
        moneyPinPendingHash: hmacOtp('7777'),
        moneyPinPendingActivatesAt: new Date(Date.now() + 20 * HOUR),
      }),
    );
    const result = await verifyMoneyPin('u1', '1234');
    expect(result.verified).toBe(true);
    expect(result.cancelledPendingReset).toBe(true);
    expect(update.mock.calls[0][0].data).toMatchObject({
      moneyPinPendingHash: null,
      moneyPinPendingActivatesAt: null,
    });
  });

  test('cancelling notifies — an unintended cancellation is as newsworthy as the reset', async () => {
    findUnique.mockResolvedValue(
      userRow({
        moneyPinPendingHash: hmacOtp('7777'),
        moneyPinPendingActivatesAt: new Date(Date.now() + 20 * HOUR),
      }),
    );
    await verifyMoneyPin('u1', '1234');
    expect(smsMock).toHaveBeenCalledTimes(1);
    expect(smsMock.mock.calls[0][1]).toContain('yahagaritswe');
  });

  test('a matured reset is NOT also treated as cancellable', async () => {
    findUnique.mockResolvedValue(
      userRow({
        moneyPinPendingHash: hmacOtp('7777'),
        moneyPinPendingActivatesAt: new Date(Date.now() - 1000),
      }),
    );
    const result = await verifyMoneyPin('u1', '7777');
    expect(result.activatedPendingReset).toBe(true);
    expect(result.cancelledPendingReset).toBe(false);
    expect(smsMock).not.toHaveBeenCalled();
  });
});

describe('the reset flow', () => {
  test('request sends an OTP under the DEDICATED purpose', async () => {
    findUnique.mockResolvedValue(userRow());
    (sendOtp as jest.Mock).mockResolvedValue({ otpId: 'o1', expiresAt: new Date() });
    await requestMoneyPinReset('u1');
    // A shared purpose would let a code issued for a preference change be
    // spent on a PIN reset — the exact substitution the step-up prevents.
    expect((sendOtp as jest.Mock).mock.calls[0][0].purpose).toBe(MONEY_PIN_RESET_PURPOSE);
  });

  test('confirm writes the PENDING pair 24h out and leaves the LIVE pin alone', async () => {
    findUnique.mockResolvedValue(userRow());
    (verifyOtp as jest.Mock).mockResolvedValue({ verified: true });

    const before = Date.now();
    const result = await confirmMoneyPinReset('u1', 'o1', '123456', '7777');

    const data = update.mock.calls[0][0].data;
    expect(data.moneyPinPendingHash).toBe(hmacOtp('7777'));
    // The live PIN is NOT written — that is what lets the owner cancel.
    expect(data.moneyPinHash).toBeUndefined();

    const delayMs = result.activatesAt.getTime() - before;
    expect(delayMs).toBeGreaterThan(23.9 * HOUR);
    expect(delayMs).toBeLessThanOrEqual(24 * HOUR + 1000);
  });

  test('confirm clears a lockout — the locked-out driver is the one who needs the reset', async () => {
    findUnique.mockResolvedValue(
      userRow({ moneyPinLockedUntil: new Date(Date.now() + HOUR) }),
    );
    (verifyOtp as jest.Mock).mockResolvedValue({ verified: true });
    await confirmMoneyPinReset('u1', 'o1', '123456', '7777');
    expect(update.mock.calls[0][0].data).toMatchObject({
      moneyPinAttempts: 0,
      moneyPinLockedUntil: null,
    });
  });

  test('a failed OTP writes nothing at all', async () => {
    findUnique.mockResolvedValue(userRow());
    (verifyOtp as jest.Mock).mockResolvedValue({ verified: false, reason: 'invalid' });
    await expect(confirmMoneyPinReset('u1', 'o1', '000000', '7777')).rejects.toMatchObject({
      code: 'OTP_INVALID',
    });
    expect(update).not.toHaveBeenCalled();
  });

  test('the notice SMS goes out at REQUEST time and names the deadline', async () => {
    findUnique.mockResolvedValue(userRow());
    (verifyOtp as jest.Mock).mockResolvedValue({ verified: true });
    langMock.mockResolvedValue('en');

    const result = await confirmMoneyPinReset('u1', 'o1', '123456', '7777');

    // Sent NOW, not at activation: a warning that arrives when the new
    // PIN starts working arrives too late to be acted on.
    expect(smsMock).toHaveBeenCalledTimes(1);
    const body = smsMock.mock.calls[0][1] as string;
    expect(body).toContain('money PIN was changed');
    expect(body).toContain('contact support before');
    // The deadline is in the message, in Kigali wall-clock.
    const day = result.activatesAt.toLocaleString('en-GB', {
      timeZone: 'Africa/Kigali',
      day: '2-digit',
    });
    expect(body).toContain(day);
  });

  test('the notice carries NO code, NO link and NO PIN', async () => {
    findUnique.mockResolvedValue(userRow());
    (verifyOtp as jest.Mock).mockResolvedValue({ verified: true });
    await confirmMoneyPinReset('u1', 'o1', '123456', '7777');
    const body = smsMock.mock.calls[0][1] as string;
    // SMS is the one channel we assume the adversary is already reading.
    expect(body).not.toContain('7777');
    expect(body).not.toContain('123456');
    expect(body).not.toMatch(/https?:\/\//);
  });

  test('the notice ignores smsOptOut — STOP must not be able to silence it', async () => {
    // The attack it closes: text STOP to the Bimoto number (which anyone
    // holding the handset can do), then reset the PIN, and the owner is
    // never told.
    findUnique.mockResolvedValue(userRow({ smsOptOut: true }));
    (verifyOtp as jest.Mock).mockResolvedValue({ verified: true });
    await confirmMoneyPinReset('u1', 'o1', '123456', '7777');
    expect(smsMock).toHaveBeenCalledTimes(1);
  });

  test('a failing SMS does not roll back a reset the user already proved', async () => {
    findUnique.mockResolvedValue(userRow());
    (verifyOtp as jest.Mock).mockResolvedValue({ verified: true });
    smsMock.mockRejectedValue(new Error('gateway down'));
    await expect(confirmMoneyPinReset('u1', 'o1', '123456', '7777')).resolves.toMatchObject({
      activatesAt: expect.any(Date),
    });
  });
});

describe('composeMoneyPinNotice — one message per language', () => {
  test.each([
    ['en', 'money PIN was changed'],
    ['fr', 'code argent a ete change'],
    ['rw', 'kode y’amafaranga yawe yahinduwe'],
  ])('%s reset notice', (lang, fragment) => {
    const body = composeMoneyPinNotice(lang as any, 'reset', new Date());
    expect(body).toContain(fragment);
  });

  test('an unknown language falls back to Kinyarwanda, not to a blank', () => {
    const body = composeMoneyPinNotice('xx' as any, 'reset', new Date());
    expect(body).toContain('Bimoto');
    expect(body.length).toBeGreaterThan(20);
  });
});

describe('changeMoneyPin', () => {
  test('needs the current PIN and applies the new one immediately — no delay', async () => {
    findUnique.mockResolvedValue(userRow());
    await changeMoneyPin('u1', '1234', '5678');
    // Last write is the change itself; no pending pair is created.
    const data = update.mock.calls[update.mock.calls.length - 1][0].data;
    expect(data.moneyPinHash).toBe(hmacOtp('5678'));
    expect(data.moneyPinPendingHash).toBeNull();
    expect(data.moneyPinPendingActivatesAt).toBeNull();
  });

  test('a wrong current PIN changes nothing', async () => {
    findUnique.mockResolvedValue(userRow());
    await expect(changeMoneyPin('u1', '9999', '5678')).rejects.toMatchObject({
      code: 'MONEY_PIN_INVALID',
    });
    const wrote = update.mock.calls.some(
      (c: any) => c[0].data.moneyPinHash === hmacOtp('5678'),
    );
    expect(wrote).toBe(false);
  });
});

describe('getMoneyPinStatus', () => {
  test('NOT_SET drives the lazy-enrolment block', async () => {
    findUnique.mockResolvedValue(userRow({ moneyPinHash: null }));
    await expect(getMoneyPinStatus('u1')).resolves.toMatchObject({ state: 'NOT_SET' });
  });

  test('PENDING_RESET reports when the pending PIN goes live', async () => {
    const at = new Date(Date.now() + 20 * HOUR);
    findUnique.mockResolvedValue(
      userRow({ moneyPinPendingHash: 'x', moneyPinPendingActivatesAt: at }),
    );
    await expect(getMoneyPinStatus('u1')).resolves.toMatchObject({
      state: 'PENDING_RESET',
      pendingActivatesAt: at,
    });
  });

  test('never returns the hash', async () => {
    findUnique.mockResolvedValue(userRow());
    const status = await getMoneyPinStatus('u1');
    expect(JSON.stringify(status)).not.toContain(hmacOtp('1234'));
  });
});
