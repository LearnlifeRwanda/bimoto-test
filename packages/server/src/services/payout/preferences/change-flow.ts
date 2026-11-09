import * as Sentry from '@sentry/node';
import prisma from '../../../prisma';
import { assertNotRateLimited, assertStepUpVerified, StepUpProof } from './guards';
import { getPreferenceChangeAnomalyVerdict } from './anomaly-check';

const COOLDOWN_MS = 30 * 60 * 1000;

// Alias of the schema enum's type so this flow can't drift from the
// PayoutPreference values Prisma actually accepts.
type PayoutPref = import('@prisma/client').PayoutPreference;

export interface ApplyPreferenceChangeInput {
  userId: string;
  newPreference: PayoutPref;
  ipAddress?: string;
  /**
   * MONEY-PIN G2 — how the caller proved itself. Was a bare `otpId` +
   * `code` pair; is now the union, because ruling D25 made the money PIN
   * the proof this flow actually asks for and the OTP the legacy arm.
   */
  stepUp: StepUpProof;
}

export interface ApplyPreferenceChangeResult {
  logId: string;
  immediatePayoutQueued: boolean;
  payoutDueAt?: Date;
}

export async function applyPreferenceChange(
  input: ApplyPreferenceChangeInput,
): Promise<ApplyPreferenceChangeResult> {
  await assertNotRateLimited(input.userId);
  const stepUp = await assertStepUpVerified(input.userId, input.stepUp);

  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }
  const oldPreference = user.payoutPreference;

  // MONEY-ATOMIC G4 — the two reads below stay OUTSIDE the transaction.
  // They are reads: they inform what the log row says, but nothing about
  // them needs to be atomic with the change, and the anomaly verdict can
  // reach Sentry and other services. Only the preference write and its
  // audit row need to be one unit, so the transaction is opened around
  // exactly those two.
  const balance = await prisma.driverBalance.findUnique({
    where: { driverId: input.userId },
  });
  const pendingBalance = balance?.pendingAmount ?? 0;

  const verdict = await getPreferenceChangeAnomalyVerdict({
    userId: input.userId,
    pendingBalance,
  });

  const shouldQueuePayout = pendingBalance > 0 && verdict.allowAuto;
  const payoutDueAt = shouldQueuePayout ? new Date(Date.now() + COOLDOWN_MS) : null;

  // MONEY-ATOMIC G4 — a driver's money destination changes and the audit
  // row recording it lands, together or not at all.
  //
  // Before this, the preference write committed on its own and the log
  // row was created eighteen lines and two awaits later. A failure in
  // that window changed where a driver's payouts go with NO record that
  // anything had changed, or of what it changed from — on the one flow
  // this codebase gates behind a step-up precisely because the audit
  // row is the point of it.
  //
  // MONEY-PIN G2 CHANGED THE GATE, NOT THIS. The proof in front of the
  // flow moved from an SMS OTP to the money PIN; the atomicity below is
  // untouched, and the invariant it exists for — a failing audit-row
  // write rolls the preference change back — is byte-identical.
  const log = await prisma.$transaction(async (tx: any) => {
    await tx.user.update({
      where: { id: input.userId },
      data: { payoutPreference: input.newPreference },
    });

    return tx.payoutPreferenceChangeLog.create({
      data: {
        userId: input.userId,
        oldPreference,
        newPreference: input.newPreference,
        ipAddress: input.ipAddress ?? null,
        // MONEY-PIN G2 — the row records the method TRUTHFULLY. This is
        // the one named semantic change in the swap, and it is why
        // "audit rows byte-identical" was never achievable: a PIN-gated
        // change that wrote `otpVerified: true` would be a false record
        // of how it was proven, on the one flow whose entire purpose is
        // the record. `otpVerified` therefore stays bound to the OTP arm
        // — true when an OTP was given, false when it was not — so every
        // row written before this dispatch keeps meaning exactly what it
        // meant, and stepUpMethod carries the new fact alongside it.
        otpVerified: stepUp.method === 'OTP',
        stepUpMethod: stepUp.method,
        payoutFired: false,
        payoutDueAt: payoutDueAt ?? undefined,
      },
    });
  });

  if (!verdict.allowAuto && pendingBalance > 0) {
    Sentry.captureMessage(
      `Preference-change anomaly: ${input.userId} pending=${pendingBalance} threshold=${verdict.thresholdRwf}`,
      'warning',
    );
  }

  // No in-process timer: the log row (payoutFired:false + payoutDueAt) IS
  // the schedule. jobs/preference-change-payout.job.ts scans and fires due
  // rows, so a restart inside the cooldown window no longer loses the payout.

  return {
    logId: log.id,
    immediatePayoutQueued: shouldQueuePayout,
    payoutDueAt: payoutDueAt ?? undefined,
  };
}
