// SERVICES/MONEY-PIN.SERVICE.TS
//
// MONEY-PIN G1 — the number that stands between a borrowed phone and a
// motari's money. Founder ruling D25 (24 August).
//
// THE THREAT THIS ANSWERS is not a thief and not a hacker. It is the
// ordinary, constant fact of the pilot: a motari hands his phone to a
// cousin to make a call, to a passenger to type an address, to a friend
// who wants to see the app. Everything else in Bimoto is fine to hand
// over. His balance and where his money goes are not.
//
// SO THE FRICTION IS PLACED EXACTLY THERE AND NOWHERE ELSE. The PIN is
// asked at the money surfaces (services/../middleware/money-step-up.ts
// holds the list) and at no other screen. Riding, bidding, chatting,
// the whole day's work — untouched.
//
// STORAGE IS OtpCode's, NOT A NEW IDEA (PREPROTO-AUTH G1). Only
// hmacOtp(pin) is persisted; the plaintext exists in the user's head and
// in one TLS request body. Comparison is constant-time over the HMAC.
// Wrong guesses are COUNTED, not merely rate-limited: a 4-digit PIN has
// 10^4 states, so a budget that terminates is the only thing that
// actually bounds a guesser. The crypto is imported from the OTP module's
// own primitives — this file forks nothing.
//
// THE RESET IS THE INTERESTING PART. A driver who forgets his PIN proves
// himself by SMS OTP. But whoever is holding the phone is also holding
// the SMS, so if an SMS-proven reset took effect immediately the PIN
// would protect nothing at all against the exact person it is meant to
// stop. Hence D25's ruling: a reset proven by SMS becomes live 24 HOURS
// LATER, and an SMS goes out the moment it is requested saying so. The
// borrower gets a PIN that works tomorrow; the owner gets a day, and a
// text message, in which to stop it. And because the owner still knows
// the LIVE pin, using it inside the window CANCELS the pending reset:
// the person who can prove knowledge beats the person who can only
// prove possession. The owner wins.
//
// NO JOB RUNS ANY OF THIS. The pending pair is a hash plus an instant;
// it is read at verify time, which is the only moment it can matter. A
// server that was switched off for the whole window behaves identically
// to one that was up.

import prisma from '../prisma';
import type { Language } from '@prisma/client';
import { AppError } from '../middleware/error-handler';
import { hmacOtp } from '../utils/crypto';
import { sendOtp, verifyOtp } from './otp.service';
import { sendSms } from './sms.service';
import { getUserLanguage } from './push';
import { decryptedPhone } from './user-phone';
import {
  MONEY_PIN_LENGTH,
  MONEY_PIN_MAX_ATTEMPTS,
  MONEY_PIN_LOCKOUT_MINUTES,
  MONEY_PIN_RESET_DELAY_HOURS,
} from '@bimoto/shared';
import crypto from 'crypto';

/**
 * The OTP purpose reserved for a money-PIN reset.
 *
 * Dedicated rather than reused: otp.service keeps exactly one live code
 * per (userId, purpose), and verifyOtp REFUSES a code presented under a
 * different purpose than it was issued for. A shared purpose would let a
 * code issued for a payout-preference change be spent on a PIN reset,
 * which is precisely the substitution the step-up exists to prevent.
 */
export const MONEY_PIN_RESET_PURPOSE = 'MONEY_PIN_RESET';

const LOCKOUT_MS = MONEY_PIN_LOCKOUT_MINUTES * 60 * 1000;
const RESET_DELAY_MS = MONEY_PIN_RESET_DELAY_HOURS * 60 * 60 * 1000;

/** The digits-only, exact-length shape a money PIN must have. */
const PIN_SHAPE = new RegExp(`^\\d{${MONEY_PIN_LENGTH}}$`);

export function isValidPinFormat(pin: unknown): pin is string {
  return typeof pin === 'string' && PIN_SHAPE.test(pin);
}

/**
 * Constant-time compare of two hex HMACs.
 *
 * Same primitive as otp.service's: length is checked first because
 * timingSafeEqual throws on a length mismatch, and two hex digests of
 * the same algorithm are always the same length anyway — an unequal
 * length here means a malformed column, not a near-miss guess.
 */
function hashMatches(storedHash: string, presented: string): boolean {
  const a = Buffer.from(storedHash);
  const b = Buffer.from(hmacOtp(presented));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export type MoneyPinState =
  /** No PIN yet — the lazy-enrollment block applies. */
  | 'NOT_SET'
  /** A PIN is live. */
  | 'SET'
  /** A PIN is live AND an SMS-proven reset is waiting out its 24 hours. */
  | 'PENDING_RESET';

export interface MoneyPinStatus {
  state: MoneyPinState;
  /** When the pending reset goes live, if one is waiting. */
  pendingActivatesAt?: Date;
  /** When the lockout expires, if the PIN is currently locked. */
  lockedUntil?: Date;
}

export async function getMoneyPinStatus(userId: string): Promise<MoneyPinStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      moneyPinHash: true,
      moneyPinPendingHash: true,
      moneyPinPendingActivatesAt: true,
      moneyPinLockedUntil: true,
    },
  });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'errors.userNotFound');

  const now = new Date();
  const locked =
    user.moneyPinLockedUntil && user.moneyPinLockedUntil > now
      ? user.moneyPinLockedUntil
      : undefined;

  if (!user.moneyPinHash) {
    return { state: 'NOT_SET', ...(locked ? { lockedUntil: locked } : {}) };
  }
  if (user.moneyPinPendingHash && user.moneyPinPendingActivatesAt) {
    return {
      state: 'PENDING_RESET',
      pendingActivatesAt: user.moneyPinPendingActivatesAt,
      ...(locked ? { lockedUntil: locked } : {}),
    };
  }
  return { state: 'SET', ...(locked ? { lockedUntil: locked } : {}) };
}

// ── SET (first time) ───────────────────────────────────────────────────

/**
 * First-time enrollment. Requires NO existing credential, by ruling: a
 * driver who has never had a PIN has nothing to prove, and demanding
 * something of him would make the lazy-enrollment block unpassable.
 *
 * It refuses when a PIN already exists — changing one goes through
 * `changeMoneyPin`, which asks for the old one. Without that refusal,
 * this endpoint would BE the bypass: anyone holding an unlocked phone
 * could simply set a new PIN over the top of the driver's.
 */
export async function setMoneyPin(userId: string, pin: string): Promise<void> {
  if (!isValidPinFormat(pin)) {
    throw new AppError(400, 'MONEY_PIN_INVALID_FORMAT', 'errors.moneyPinInvalidFormat');
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { moneyPinHash: true },
  });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'errors.userNotFound');
  if (user.moneyPinHash) {
    throw new AppError(409, 'MONEY_PIN_ALREADY_SET', 'errors.moneyPinAlreadySet');
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      moneyPinHash: hmacOtp(pin),
      moneyPinAttempts: 0,
      moneyPinLockedUntil: null,
      moneyPinPendingHash: null,
      moneyPinPendingActivatesAt: null,
    },
  });
}

/**
 * Deliberate change by someone who knows the current PIN. Immediate — no
 * 24-hour delay, because the delay exists solely to cover a reset that
 * proved only POSSESSION of the phone. Knowledge of the live PIN is the
 * stronger proof, and making the owner wait a day for his own deliberate
 * change would be friction that buys nothing.
 */
export async function changeMoneyPin(
  userId: string,
  currentPin: string,
  newPin: string,
): Promise<void> {
  if (!isValidPinFormat(newPin)) {
    throw new AppError(400, 'MONEY_PIN_INVALID_FORMAT', 'errors.moneyPinInvalidFormat');
  }
  // Goes through the full verify path so a change attempt is bounded by
  // the same attempt budget and lockout as any other guess. Also means a
  // pending reset that has matured is applied first, and one that has not
  // is cancelled by the old PIN — both by verifyMoneyPin's own rules.
  await verifyMoneyPin(userId, currentPin);

  await prisma.user.update({
    where: { id: userId },
    data: {
      moneyPinHash: hmacOtp(newPin),
      moneyPinAttempts: 0,
      moneyPinLockedUntil: null,
      moneyPinPendingHash: null,
      moneyPinPendingActivatesAt: null,
    },
  });
}

// ── VERIFY (and the reset state machine, which lives here) ─────────────

export interface VerifyMoneyPinResult {
  verified: true;
  /** True when this verify matured a pending reset into the live PIN. */
  activatedPendingReset: boolean;
  /** True when this verify cancelled a pending reset (old PIN won). */
  cancelledPendingReset: boolean;
}

/**
 * The single place the reset state machine is evaluated.
 *
 * Order matters and is deliberate:
 *
 *   1. A lockout in force refuses everything, including a correct PIN.
 *   2. A MATURED pending reset (activatesAt in the past) becomes the live
 *      PIN before any comparison — so the new PIN starts working on its
 *      own, with no job, at the first attempt after the window closes.
 *   3. The presented PIN is compared against the (possibly just-promoted)
 *      live hash.
 *   4. If it matches AND an UNMATURED pending reset is waiting, that
 *      reset is cancelled: the owner has just proved he knows the live
 *      PIN, which beats whoever proved only that they held the handset.
 *      He is told by SMS, because a cancellation he did not intend is
 *      exactly as newsworthy as the reset itself.
 */
export async function verifyMoneyPin(
  userId: string,
  pin: string,
): Promise<VerifyMoneyPinResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      moneyPinHash: true,
      moneyPinPendingHash: true,
      moneyPinPendingActivatesAt: true,
      moneyPinAttempts: true,
      moneyPinLockedUntil: true,
    },
  });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'errors.userNotFound');

  const now = new Date();

  // (1) A live lockout refuses even the correct PIN. That is the point:
  // the budget bounds a guesser regardless of how fast they can ask.
  if (user.moneyPinLockedUntil && user.moneyPinLockedUntil > now) {
    throw new AppError(423, 'MONEY_PIN_LOCKED', 'errors.moneyPinLocked');
  }

  // (2) A matured pending reset becomes live BEFORE the comparison.
  let liveHash = user.moneyPinHash;
  let activatedPendingReset = false;
  const pendingMatured =
    user.moneyPinPendingHash != null &&
    user.moneyPinPendingActivatesAt != null &&
    user.moneyPinPendingActivatesAt <= now;

  if (pendingMatured) {
    liveHash = user.moneyPinPendingHash;
    activatedPendingReset = true;
    await prisma.user.update({
      where: { id: userId },
      data: {
        moneyPinHash: user.moneyPinPendingHash,
        moneyPinPendingHash: null,
        moneyPinPendingActivatesAt: null,
      },
    });
  }

  if (!liveHash) {
    throw new AppError(428, 'MONEY_PIN_NOT_SET', 'errors.moneyPinNotSet');
  }

  // (3) Compare. Format is checked here only to reject obvious noise
  // cheaply; a well-formed wrong PIN and a malformed one both spend a
  // guess, so the budget cannot be dodged by sending junk.
  if (!isValidPinFormat(pin) || !hashMatches(liveHash, pin)) {
    await registerFailedPinAttempt(userId, user.moneyPinAttempts);
  }

  // (4) A correct live PIN inside an unmatured window cancels the reset.
  let cancelledPendingReset = false;
  const pendingUnmatured =
    !activatedPendingReset &&
    user.moneyPinPendingHash != null &&
    user.moneyPinPendingActivatesAt != null &&
    user.moneyPinPendingActivatesAt > now;

  await prisma.user.update({
    where: { id: userId },
    data: {
      moneyPinAttempts: 0,
      moneyPinLockedUntil: null,
      ...(pendingUnmatured
        ? { moneyPinPendingHash: null, moneyPinPendingActivatesAt: null }
        : {}),
    },
  });

  if (pendingUnmatured) {
    cancelledPendingReset = true;
    await sendMoneyPinSms(userId, 'cancelled');
  }

  return { verified: true, activatedPendingReset, cancelledPendingReset };
}

/**
 * Spends one guess and throws. Never returns — every call site treats a
 * wrong PIN as terminal for that request, so returning a value would
 * only invite a caller to ignore it.
 */
async function registerFailedPinAttempt(
  userId: string,
  currentAttempts: number,
): Promise<never> {
  const attempts = currentAttempts + 1;
  const exhausted = attempts >= MONEY_PIN_MAX_ATTEMPTS;
  await prisma.user.update({
    where: { id: userId },
    data: {
      moneyPinAttempts: attempts,
      ...(exhausted ? { moneyPinLockedUntil: new Date(Date.now() + LOCKOUT_MS) } : {}),
    },
  });
  if (exhausted) {
    throw new AppError(423, 'MONEY_PIN_LOCKED', 'errors.moneyPinLocked');
  }
  throw new AppError(401, 'MONEY_PIN_INVALID', 'errors.moneyPinInvalid');
}

// ── RESET (SMS-proven, 24-hour delayed activation) ─────────────────────

export interface RequestResetResult {
  otpId: string;
  expiresAt: Date;
}

/**
 * Step one of a reset: send the SMS code. Nothing about the PIN changes
 * here — this only proves the phone. Deliberately does NOT reveal
 * whether a PIN is set: the response shape is identical either way, so
 * the endpoint cannot be used to probe.
 */
export async function requestMoneyPinReset(userId: string): Promise<RequestResetResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'errors.userNotFound');

  const result = await sendOtp({
    userId,
    // otp.service's plaintext contract: it SENDS to this value and
    // derives OtpCode.phoneHash from it (see payout.routes' same note).
    phone: decryptedPhone(user),
    purpose: MONEY_PIN_RESET_PURPOSE,
  });
  return { otpId: result.otpId, expiresAt: result.expiresAt };
}

export interface ConfirmResetResult {
  /** When the new PIN starts working. */
  activatesAt: Date;
}

/**
 * Step two: the SMS code is spent, and the new PIN is written to the
 * PENDING pair with an activation instant 24 hours out. The live PIN is
 * untouched and keeps working for the whole window — that is what lets
 * the owner cancel with it.
 *
 * The notice SMS is sent here, at REQUEST time rather than at activation
 * time, and that is the entire security value of the delay: a warning
 * that arrives when the new PIN goes live arrives too late to be acted
 * on. It names the deadline so the reader knows how long they have.
 *
 * TRANSACTIONAL: the pending write and the attempt reset are one row, so
 * one update covers them. The SMS is deliberately OUTSIDE and after — a
 * failed SMS must not roll back a reset the user has already proven, and
 * an SMS sent for a write that then failed would be a lie.
 */
export async function confirmMoneyPinReset(
  userId: string,
  otpId: string,
  code: string,
  newPin: string,
): Promise<ConfirmResetResult> {
  if (!isValidPinFormat(newPin)) {
    throw new AppError(400, 'MONEY_PIN_INVALID_FORMAT', 'errors.moneyPinInvalidFormat');
  }

  const result = await verifyOtp({ otpId, code, purpose: MONEY_PIN_RESET_PURPOSE });
  // Defence-in-depth, matching payout/preferences/guards.ts: anything
  // other than an explicit `verified === true` is a failure.
  if (result?.verified !== true) {
    throw new AppError(401, 'OTP_INVALID', 'errors.otpInvalid');
  }

  const activatesAt = new Date(Date.now() + RESET_DELAY_MS);
  await prisma.user.update({
    where: { id: userId },
    data: {
      moneyPinPendingHash: hmacOtp(newPin),
      moneyPinPendingActivatesAt: activatesAt,
      // A reset also clears a lockout: a driver who was locked out is the
      // likeliest person to be resetting, and leaving him locked would
      // make the reset useless to the one user who needs it most.
      moneyPinAttempts: 0,
      moneyPinLockedUntil: null,
    },
  });

  await sendMoneyPinSms(userId, 'reset', activatesAt);
  return { activatesAt };
}

// ── The notice SMS ─────────────────────────────────────────────────────

type NoticeKind = 'reset' | 'cancelled';

/**
 * Plain words in the user's own language, following the locale-aware SMS
 * precedent in recipient-sms-notification.service.ts (a switch per
 * language, `rw` as the default arm).
 *
 * Deliberately contains NO code, NO link and NO PIN — an SMS is the one
 * channel we assume the adversary is already reading. It carries only
 * the fact that something happened, the deadline, and where to complain.
 */
export function composeMoneyPinNotice(
  language: Language,
  kind: NoticeKind,
  activatesAt?: Date,
): string {
  const when = activatesAt ? formatNoticeTime(activatesAt) : '';
  if (kind === 'cancelled') {
    switch (language) {
      case 'fr':
        return 'Bimoto: la demande de changement de votre code argent a ete annulee, car votre code actuel a ete utilise.';
      case 'en':
        return 'Bimoto: the request to change your money PIN was cancelled, because your current PIN was used.';
      case 'rw':
      default:
        return 'Bimoto: icyifuzo cyo guhindura kode y’amafaranga cyahagaritswe, kuko kode yawe isanzwe yakoreshejwe.';
    }
  }
  switch (language) {
    case 'fr':
      return `Bimoto: votre code argent a ete change. Si ce n'etait pas vous, contactez le support avant ${when}.`;
    case 'en':
      return `Bimoto: your money PIN was changed. If this wasn't you, contact support before ${when}.`;
    case 'rw':
    default:
      return `Bimoto: kode y’amafaranga yawe yahinduwe. Niba atari wowe, hamagara ubufasha mbere ya ${when}.`;
  }
}

/**
 * The deadline in Kigali wall-clock, which is the only clock the reader
 * has. Date-and-time, not a bare time: the window is 24 hours, so "14:30"
 * alone would be ambiguous about which day.
 */
function formatNoticeTime(at: Date): string {
  return at.toLocaleString('en-GB', {
    timeZone: 'Africa/Kigali',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Fire-and-forget in the same sense as the recipient SMS pipeline: a
 * failure is logged and swallowed, never thrown into the caller. A reset
 * that succeeded must not report failure because an SMS gateway blinked
 * — but it IS awaited, so tests can assert on the message and so the
 * common case orders correctly.
 */
async function sendMoneyPinSms(
  userId: string,
  kind: NoticeKind,
  activatesAt?: Date,
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    // DELIBERATELY IGNORES User.smsOptOut. That flag is set by texting
    // STOP to the Bimoto number (sms-inbound/handlers/help-stop.ts), which
    // means anyone holding the handset can set it — and if this notice
    // honoured it, the attack would simply be: text STOP, then reset the
    // PIN, and the owner is never told. The whole security value of this
    // message is that it arrives; an opt-out an adversary can trigger
    // must not be able to suppress it. STOP silences marketing and
    // service chatter, not the one SMS that says someone is moving on
    // your money.
    const language = await getUserLanguage(userId);
    const body = composeMoneyPinNotice(language, kind, activatesAt);
    await sendSms(decryptedPhone(user), body);
  } catch (err) {
    console.error('[money-pin] notice SMS failed', err);
  }
}
