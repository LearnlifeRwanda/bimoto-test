// COMPONENTS/RATING/RATE-RIDE-CARD.TSX
//
// COCKPIT G4 — the first caller POST /api/journeys/:id/rate has ever had
// that a passenger can actually reach.
//
// The endpoint has been in the server since R3. Its one client caller
// was ConfirmPage, whose route no navigation ever reached; DEADWOOD #163
// deleted that screen and the endpoint went to the orphan list with the
// note "nobody can rate a driver from the app, and nobody could before
// either". The receipt is where a finished ride already lives, so the
// stars go here.
//
// SERVER SEMANTICS, reflected not re-invented (rating.service.ts):
//   • one rating per (journey, rater) — a second POST is 409 ALREADY_RATED,
//     so this collects once and then shows what was sent, disabled;
//   • the journey must be COMPLETED — 400 JOURNEY_NOT_COMPLETED;
//   • the caller must be a participant — 403 NOT_JOURNEY_PARTICIPANT;
//   • stars must be 1–5 — 400 INVALID_RATING, which the UI makes
//     unreachable by only ever offering five stars and never submitting
//     zero.
// Every one of those comes back through the existing toast with the
// server's own localized message key. The UI never guesses.
//
// BODY SHAPE: `{ journeyId, stars }`. Enforcement is
// `validate(createRatingSchema)` on the body, and createRatingSchema
// (packages/shared/src/schemas/rating.schema.ts) requires `journeyId` as
// a uuid — posting `{ stars }` alone is a 400 VALIDATION_ERROR. The
// route's OpenAPI block used to claim otherwise; TRUE-WORDS G5.2 corrected
// it to the validator's truth, so the two now agree.
//
// READ MODEL (TRUE-WORDS G5.1): GET /api/journeys/:id now carries
// `myRating` — the VIEWER's own stars for this ride, or null. That closed
// the seam COCKPIT left open: a reopened receipt used to offer the stars
// again on a ride you had already rated, and the only way to find out was
// to submit and read the 409. The card now takes `initialRating` from that
// field and opens in the shown state, disabled. Nothing new was added to
// the API surface — the read rides the GET the receipt already made, so
// there is no second round trip and no endpoint to keep in step.
//
// The counterpart's stars are deliberately not in that payload. What the
// other side thought of you is not yours to read from a receipt.
//
// TEAM-ANSWERS G2 (OPEN DECISIONS item 15, Kigali team, 18 August) — a
// low rating may carry a REASON.
//
// The team asked for "no dispute button; instead, when a passenger gives
// 1-2 stars, offer a reason dropdown and an optional details box". That
// is exactly what this is. At or below RATING_REASON_THRESHOLD stars the
// card reveals a select and a textarea; BOTH are optional and neither
// gates the submit — a passenger who taps one star and sends is sending
// one star, and always was. Raising the stars back above the threshold
// hides the fields and drops what was typed, because a reason for a bad
// ride is not a reason for a good one.
//
// This card is also the ONLY caller of POST /:id/rate, in the passenger
// direction, which is what made TEAM-ANSWERS' narrowing of that route to
// customerOnly safe (see rating.routes.ts).

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RATING_REASONS, RATING_REASON_THRESHOLD } from '@bimoto/shared';
import type { RatingReason } from '@bimoto/shared';
import { StarRating } from './StarRating';
import { Button } from '../ui/Button';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';

export interface RateRideCardProps {
  journeyId: string;
  /**
   * The viewer's already-stored stars for this ride (journey.myRating.stars),
   * or null/undefined when they have not rated it. Present means the card
   * opens in the shown state rather than offering the stars again.
   */
  initialRating?: number | null;
  /**
   * The reason key stored with those stars, when there is one
   * (journey.myRating.reason). Read-back only — never used to prefill an
   * unsent rating.
   */
  initialReason?: RatingReason | string | null;
  /** The details the passenger typed with those stars (journey.myRating.comment). */
  initialComment?: string | null;
}

export const RateRideCard: React.FC<RateRideCardProps> = ({
  journeyId,
  initialRating,
  initialReason,
  initialComment,
}) => {
  const { t } = useTranslation();
  const [stars, setStars] = useState(0);
  const [reason, setReason] = useState<string>('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<number | null>(initialRating ?? null);
  const [submittedReason, setSubmittedReason] = useState<string | null>(
    (initialReason as string | null) ?? null,
  );
  const [submittedDetails, setSubmittedDetails] = useState<string | null>(
    initialComment ?? null,
  );

  const showReasons = stars > 0 && stars <= RATING_REASON_THRESHOLD;

  // Going back up above the threshold clears what the low-star branch
  // collected: the fields are about to disappear, and sending a hidden
  // value the passenger can no longer see would be dishonest.
  const changeStars = useCallback((next: number) => {
    setStars(next);
    if (next > RATING_REASON_THRESHOLD) {
      setReason('');
      setDetails('');
    }
  }, []);

  const submit = useCallback(async () => {
    if (stars < 1) return;
    setSubmitting(true);
    const sentReason = showReasons && reason ? reason : undefined;
    const sentDetails = showReasons && details.trim() ? details.trim() : undefined;
    try {
      const res = await apiFetch(`/api/journeys/${journeyId}/rate`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          journeyId,
          stars,
          // Both omitted unless the passenger actually chose/typed them —
          // the server's schema marks each optional, so an absent field
          // is the honest "they did not say".
          ...(sentReason ? { reason: sentReason } : {}),
          ...(sentDetails ? { comment: sentDetails } : {}),
        }),
      });
      if (!res.ok) throw await apiErrorFromResponse(res);
      setSubmitted(stars);
      setSubmittedReason(sentReason ?? null);
      setSubmittedDetails(sentDetails ?? null);
    } catch (err) {
      presentApiError(err);
    } finally {
      setSubmitting(false);
    }
  }, [journeyId, stars, reason, details, showReasons]);

  if (submitted !== null) {
    return (
      <div
        className="bg-white rounded-xl shadow-sm p-4 mt-4"
        data-testid="rate-ride-done"
      >
        <p className="text-secondary text-gray-600 mb-2">
          {t('rating.yourRating')}
        </p>
        <StarRating value={submitted} readonly />
        {submittedReason && (
          <p className="text-caption text-gray-600 mt-2" data-testid="rate-ride-reason-readback">
            {t('rating.reasonGiven')}{' '}
            {t(`rating.reason.${submittedReason}`, { defaultValue: submittedReason })}
          </p>
        )}
        {submittedDetails && (
          <p className="text-caption text-gray-600 mt-1 whitespace-pre-wrap" data-testid="rate-ride-details-readback">
            {submittedDetails}
          </p>
        )}
        <p className="text-caption text-green-700 mt-2" data-testid="rate-ride-thanks">
          {t('rating.thankYou')}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 mt-4" data-testid="rate-ride">
      <p className="text-secondary text-gray-700 mb-2">{t('rating.rateYourRide')}</p>
      <StarRating value={stars} onChange={changeStars} />

      {/* TEAM-ANSWERS G2 — the 1-2 star branch. Optional, always. */}
      {showReasons && (
        <div className="mt-3 space-y-2" data-testid="rate-ride-reasons">
          <label className="block">
            <span className="text-caption text-gray-600">{t('rating.reasonLabel')}</span>
            <select
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-secondary"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              data-testid="rate-ride-reason"
            >
              <option value="">{t('rating.reasonNone')}</option>
              {RATING_REASONS.map((key) => (
                <option key={key} value={key}>
                  {t(`rating.reason.${key}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-caption text-gray-600">{t('rating.detailsLabel')}</span>
            <textarea
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-secondary"
              rows={3}
              maxLength={500}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={t('rating.detailsPlaceholder')}
              data-testid="rate-ride-details"
            />
          </label>
          <p className="text-caption text-gray-500">{t('rating.reasonOptional')}</p>
        </div>
      )}

      <Button
        fullWidth
        className="mt-3"
        disabled={stars < 1}
        loading={submitting}
        onClick={submit}
        data-testid="rate-ride-submit"
      >
        {t('rating.submit')}
      </Button>
    </div>
  );
};

export default RateRideCard;
