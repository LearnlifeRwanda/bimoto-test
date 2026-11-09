import prisma from '../../../prisma';
import { AppError } from '../../../middleware/error-handler';
import { verifyOtp } from '../../otp.service';
import { getMoneyStepUp } from '../../../middleware/money-step-up';

const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function assertNotRateLimited(userId: string): Promise<void> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recent = await prisma.payoutPreferenceChangeLog.findFirst({
    where: { userId, createdAt: { gt: since } },
  });
  if (recent) {
    throw new AppError(429, 'PREFERENCE_CHANGE_RATE_LIMITED', 'errors.preferenceChangeRateLimited');
  }
}

// MONEY-PIN G2 — the step-up on this flow becomes a UNION of two proofs.
//
// Ruling D25: the money PIN REPLACES the SMS OTP on the payout-preference
// change. Two reasons, and the first is the security one. This flow's
// whole job is to stop someone else moving where a driver's money goes —
// and an SMS step-up is proven by the phone that receives the SMS, which
// is the SAME phone the attacker is holding. A PIN is proven by something
// he does not have. The second reason is that every one of those SMS
// messages costs money, on a flow a driver uses perhaps twice a year.
//
// THE OTP ARM IS NOT DELETED. It stays a live, tested arm of the union:
// the enum is `{kind:'otp'} | {kind:'pin'}` rather than a swap, so a
// caller that still has an otpId keeps working, and the historical audit
// rows keep a code path that explains them.
//
// This guard has exactly ONE production consumer (applyPreferenceChange —
// censused before the reshape, whole-repo, including the barrel
// re-export in ./index). Generalising it therefore cannot reshape a gate
// under some other flow's feet. If a second consumer ever arrives, it
// arrives at a union that already has both arms.

export interface AssertOtpInput {
  userId: string;
  otpId: string;
  code: string;
}

/** The two ways this codebase will accept a sensitive change as proven. */
export type StepUpProof =
  | { kind: 'otp'; otpId: string; code: string }
  | { kind: 'pin' };

export interface StepUpVerdict {
  /** What the audit row must record. */
  method: 'OTP' | 'PIN';
  /** When the proof was given — for the PIN arm, the session's own stamp. */
  verifiedAt: Date;
}

/**
 * PREPROTO-AUTH's OTP arm, unchanged in behaviour: verifyOtp under the
 * PAYOUT_PREFERENCE_CHANGE purpose, and anything other than an explicit
 * `verified === true` is a failure. Guards must never accept
 * undefined/null/'' as truthy.
 */
export async function assertOtpVerified(input: AssertOtpInput): Promise<void> {
  const result = await verifyOtp({
    otpId: input.otpId,
    code: input.code,
    purpose: 'PAYOUT_PREFERENCE_CHANGE',
  });
  if (result?.verified !== true) {
    throw new AppError(401, 'OTP_INVALID', 'errors.otpInvalid');
  }
}

/**
 * The union gate.
 *
 * The PIN arm reads the step-up session SERVER-SIDE and takes no input
 * from the caller beyond the user id. That is deliberate and it is the
 * whole security of the arm: if this accepted a `stepUpVerifiedAt` the
 * client supplied, the client could simply supply one. The only thing
 * that can say a PIN was entered is the process that checked it.
 */
export async function assertStepUpVerified(
  userId: string,
  proof: StepUpProof,
): Promise<StepUpVerdict> {
  if (proof.kind === 'otp') {
    await assertOtpVerified({ userId, otpId: proof.otpId, code: proof.code });
    return { method: 'OTP', verifiedAt: new Date() };
  }

  const session = getMoneyStepUp(userId);
  if (!session) {
    throw new AppError(401, 'MONEY_STEP_UP_REQUIRED', 'errors.moneyStepUpRequired');
  }
  return { method: 'PIN', verifiedAt: session.verifiedAt };
}
