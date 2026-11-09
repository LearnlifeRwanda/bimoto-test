import { z } from 'zod';

// PILOT-INSTRUMENT — pickup-identity verification (the V-4 evidence
// trigger). The customer's answer to "Is this your driver?" when the
// driver arrives at pickup. Evidence only: a MISMATCH/UNSURE row is
// read by a human via the admin summary and must never freeze, flag,
// cancel, or notify anyone.
export const PICKUP_OUTCOMES = ['MATCHED', 'MISMATCH', 'UNSURE'] as const;
export type PickupOutcomeValue = (typeof PICKUP_OUTCOMES)[number];

// One-tap reasons offered on the negative path. Constrained to a fixed
// vocabulary (no free text) so the ledger stays countable and collects
// no incidental PII.
export const PICKUP_MISMATCH_REASONS = [
  'WRONG_NUMBER',
  'NO_VEST',
  'DIFFERENT_PERSON',
] as const;
export type PickupMismatchReason = (typeof PICKUP_MISMATCH_REASONS)[number];

export const createPickupVerificationSchema = z.object({
  outcome: z.enum(PICKUP_OUTCOMES),
  reason: z.enum(PICKUP_MISMATCH_REASONS).optional(),
});

export type CreatePickupVerificationInput = z.infer<
  typeof createPickupVerificationSchema
>;
