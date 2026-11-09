// PILOT-INSTRUMENT — pickup-identity prompt (the V-4 evidence trigger).
// Shown on the customer's matched screen the moment the server-derived
// approachStatus hits 'arrived': "Is this your driver? (jacket #NNNN)".
// The answer is upserted to POST /api/journeys/:id/pickup-verification
// so the pilot can measure the pickup-mismatch rate and decide whether
// the per-ride dynamic QR/PIN second factor (V-4) is worth building.
//
// Optional and non-gating by design: dismissing or ignoring the card
// never blocks the ride, and a negative answer has no side effect
// beyond the stored row (a human reads it later).
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { useUIStore } from '../../stores/ui.store';
import type {
  ApproachStatus,
  PickupMismatchReason,
  PickupOutcomeValue,
} from '@bimoto/shared';
import { apiFetch } from '../../lib/api';

const answeredStorageKey = (journeyId: string) =>
  `bimoto:pickupVerified:${journeyId}`;

interface Props {
  journeyId: string;
  approachStatus: ApproachStatus | null;
  jacketNumber: string | null;
}

export const PickupVerifyCard: React.FC<Props> = ({
  journeyId,
  approachStatus,
  jacketNumber,
}) => {
  const { t } = useTranslation();
  const { showToast } = useUIStore();

  // Already answered for this journey (survives remounts/reloads so the
  // customer is never re-asked mid-ride).
  const [answered, setAnswered] = useState(() => {
    try {
      return !!localStorage.getItem(answeredStorageKey(journeyId));
    } catch {
      return false;
    }
  });
  const [dismissed, setDismissed] = useState(false);
  const [step, setStep] = useState<'ask' | 'reason'>('ask');
  const [isPosting, setIsPosting] = useState(false);

  const postAnswer = useCallback(
    async (outcome: PickupOutcomeValue, reason?: PickupMismatchReason) => {
      setIsPosting(true);
      try {
        const res = await apiFetch(
          `/api/journeys/${journeyId}/pickup-verification`,
          {
            method: 'POST',
            credentials: 'include',
            body: JSON.stringify(reason ? { outcome, reason } : { outcome }),
          },
        );
        if (!res.ok) throw new Error('post-failed');
        setAnswered(true);
        try {
          localStorage.setItem(answeredStorageKey(journeyId), outcome);
        } catch {
          // Storage unavailable — the card still hides via state.
        }
        showToast(t('matched.pickupVerify.thanks'), 'success');
      } catch {
        // Best-effort capture: the answer didn't land, but the ride is
        // never affected. The card stays so the customer can retry or
        // dismiss it.
        showToast(t('matched.pickupVerify.failed'), 'error');
      } finally {
        setIsPosting(false);
      }
    },
    [journeyId, showToast, t],
  );

  if (approachStatus !== 'arrived' || answered || dismissed) return null;

  return (
    <div
      data-testid="pickup-verify-card"
      className="bg-blue-50 border-b border-blue-200 px-4 py-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-blue-900">
            {t('matched.pickupVerify.title')}
          </p>
          {jacketNumber && (
            <p className="text-sm font-semibold text-[#1B4F72] mt-0.5">
              {t('driver.jacketNumber', { number: jacketNumber })}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label={t('common.dismiss')}
          className="text-blue-400 min-w-[44px] min-h-[24px] text-right"
          onClick={() => setDismissed(true)}
        >
          ✕
        </button>
      </div>

      {step === 'ask' ? (
        <div className="mt-2 space-y-2">
          <Button
            fullWidth
            variant="primary"
            loading={isPosting}
            onClick={() => postAnswer('MATCHED')}
          >
            {t('matched.pickupVerify.yes')}
          </Button>
          <Button
            fullWidth
            variant="secondary"
            disabled={isPosting}
            onClick={() => setStep('reason')}
          >
            {t('matched.pickupVerify.no')}
          </Button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-sm text-blue-900">
            {t('matched.pickupVerify.reasonPrompt')}
          </p>
          <Button
            fullWidth
            variant="secondary"
            loading={isPosting}
            onClick={() => postAnswer('MISMATCH', 'WRONG_NUMBER')}
          >
            {t('matched.pickupVerify.reasonWrongNumber')}
          </Button>
          <Button
            fullWidth
            variant="secondary"
            loading={isPosting}
            onClick={() => postAnswer('MISMATCH', 'NO_VEST')}
          >
            {t('matched.pickupVerify.reasonNoVest')}
          </Button>
          <Button
            fullWidth
            variant="secondary"
            loading={isPosting}
            onClick={() => postAnswer('MISMATCH', 'DIFFERENT_PERSON')}
          >
            {t('matched.pickupVerify.reasonDifferentPerson')}
          </Button>
          <Button
            fullWidth
            variant="ghost"
            loading={isPosting}
            onClick={() => postAnswer('UNSURE')}
          >
            {t('matched.pickupVerify.notSure')}
          </Button>
        </div>
      )}
    </div>
  );
};
