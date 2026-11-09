// PREPROTO-AUTH G1 — the single OTP implementation. Both the login flow
// (auth.service) and step-up flows (payout preference change) generate and
// verify codes through this module:
//
//   - codes come from crypto.randomInt (CSPRNG), never a predictable PRNG;
//   - only hmacOtp(code) is persisted — the plaintext exists in the SMS
//     and nowhere else;
//   - comparisons are constant-time over the HMAC.

import crypto from 'crypto';
import prisma from '../prisma';
import { sendSms } from './sms.service';
import { hashPhone, hmacOtp } from '../utils/crypto';
import { config } from '../config';
import { OTP_EXPIRY_MINUTES, OTP_LENGTH } from '@bimoto/shared';

const STEP_UP_TTL_MS = 10 * 60 * 1000;
const LOGIN_TTL_MS = OTP_EXPIRY_MINUTES * 60 * 1000;

export const LOGIN_PURPOSE = 'LOGIN';

function generateCode(): string {
  // CSPRNG, leading-zero safe.
  const n = crypto.randomInt(0, 10 ** OTP_LENGTH);
  return n.toString().padStart(OTP_LENGTH, '0');
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Constant-time check of a presented code against the stored HMAC. */
function codeMatches(storedHmac: string, presented: string): boolean {
  return constantTimeEquals(storedHmac, hmacOtp(presented));
}

export interface SendOtpInput {
  userId: string;
  phone: string;
  purpose: string;
}

export interface SendOtpResult {
  otpId: string;
  expiresAt: Date;
}

export async function sendOtp(input: SendOtpInput): Promise<SendOtpResult> {
  const { userId, phone, purpose } = input;
  const phoneHash = hashPhone(phone);
  const now = new Date();

  // Only the HMAC is at rest, so an unexpired existing code cannot be
  // re-sent (its plaintext is gone). Kill any live code for (userId,
  // purpose) and issue a fresh one — the latest SMS is the one that
  // counts, and exactly one code is ever valid per (userId, purpose).
  await prisma.otpCode.updateMany({
    where: { userId, purpose, used: false, expiresAt: { gt: now } },
    data: { used: true },
  });

  const code = generateCode();
  const expiresAt = new Date(now.getTime() + STEP_UP_TTL_MS);
  const row = await prisma.otpCode.create({
    data: { phoneHash, userId, purpose, code: hmacOtp(code), expiresAt },
  });

  await sendSms(phone, `Bimoto code: ${code}. Expires in 10 min.`);
  return { otpId: row.id, expiresAt };
}

export interface VerifyOtpInput {
  otpId: string;
  code: string;
  purpose: string;
}

export interface VerifyOtpResult {
  verified: boolean;
  reason?: 'invalid' | 'expired' | 'already_used' | 'wrong_purpose' | 'too_many_attempts';
}

export async function verifyOtp(input: VerifyOtpInput): Promise<VerifyOtpResult> {
  const { otpId, code, purpose } = input;
  const row = await prisma.otpCode.findUnique({ where: { id: otpId } });
  if (!row) return { verified: false, reason: 'invalid' };
  if (row.used) return { verified: false, reason: 'already_used' };
  if (row.purpose !== purpose) return { verified: false, reason: 'wrong_purpose' };
  if (row.expiresAt.getTime() <= Date.now()) return { verified: false, reason: 'expired' };
  if (!codeMatches(row.code, code)) {
    return registerFailedAttempt(row.id, row.attemptCount);
  }

  await prisma.otpCode.update({ where: { id: otpId }, data: { used: true } });
  return { verified: true };
}

/**
 * PREPROTO-AUTH — login-path OTP (used by auth.service). Same hardening
 * as the step-up path; keyed by phoneHash because the user may not exist
 * yet (login auto-provisions).
 */
export interface SendLoginOtpResult {
  expiresAt: Date;
  /**
   * TEST-ONLY SEAM. Since G1 only hmacOtp(code) is at rest, so the e2e
   * suite can no longer read the code from the DB; under NODE_ENV=test
   * the plaintext is returned so tests can complete a real login. The
   * gate lives HERE (not at the route) so no caller can leak the code
   * in any other environment — outside test the field does not exist.
   */
  testOnlyCode?: string;
}

export async function sendLoginOtp(phone: string): Promise<SendLoginOtpResult> {
  const phoneHash = hashPhone(phone);
  const now = new Date();

  // One valid code per phone: kill any live login codes before issuing.
  await prisma.otpCode.updateMany({
    where: { phoneHash, purpose: LOGIN_PURPOSE, used: false, expiresAt: { gt: now } },
    data: { used: true },
  });

  const code = generateCode();
  const expiresAt = new Date(now.getTime() + LOGIN_TTL_MS);
  await prisma.otpCode.create({
    data: { phoneHash, purpose: LOGIN_PURPOSE, code: hmacOtp(code), expiresAt },
  });

  await sendSms(phone, `Your Bimoto verification code is: ${code}. Valid for ${OTP_EXPIRY_MINUTES} minutes.`);
  return { expiresAt, ...(config.NODE_ENV === 'test' ? { testOnlyCode: code } : {}) };
}

export async function verifyLoginOtp(phone: string, code: string): Promise<VerifyOtpResult> {
  const phoneHash = hashPhone(phone);
  const row = await prisma.otpCode.findFirst({
    where: {
      phoneHash,
      purpose: LOGIN_PURPOSE,
      used: false,
      expiresAt: { gte: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return { verified: false, reason: 'invalid' };
  if (!codeMatches(row.code, code)) {
    return registerFailedAttempt(row.id, row.attemptCount);
  }

  await prisma.otpCode.update({ where: { id: row.id }, data: { used: true } });
  return { verified: true };
}

/**
 * PREPROTO-AUTH G2 — brute-force lockout. Every wrong guess increments
 * attemptCount; once the budget (OTP_MAX_ATTEMPTS) is exhausted the code
 * is killed (marked used), so even the correct code is rejected
 * afterwards. Bounds the guessing budget per code regardless of request
 * rate — the route-level rate limit only throttles, this terminates.
 */
async function registerFailedAttempt(
  otpId: string,
  currentAttempts: number,
): Promise<VerifyOtpResult> {
  const attempts = currentAttempts + 1;
  const exhausted = attempts >= config.OTP_MAX_ATTEMPTS;
  await prisma.otpCode.update({
    where: { id: otpId },
    data: { attemptCount: attempts, ...(exhausted ? { used: true } : {}) },
  });
  return { verified: false, reason: exhausted ? 'too_many_attempts' : 'invalid' };
}
