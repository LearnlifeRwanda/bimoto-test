import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { useAuthStore } from '../../stores/auth.store';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '@bimoto/shared';
import { apiFetch } from '../../lib/api';

export const ConsentPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, setUser } = useAuthStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  // COMPLIANCE-ACK — the safety acknowledgment is its own affirmative
  // act, deliberately NOT folded into the agree button. An
  // acknowledgment buried in scroll-text is decorative; counsel was
  // asked (card 2ZazTeyo) for wording that is effective, and effective
  // starts with a tick the user has to make on purpose.
  const [safetyAcknowledged, setSafetyAcknowledged] = useState(false);

  const role = (user as any)?.role;
  const isDriverRole = role === 'DRIVER' || role === 'BOTH';

  const handleAccept = async () => {
    // Both acts are required: the tick above, and this button. Neither
    // POST fires without the acknowledgment — the button is disabled
    // too, and this guard is the half that survives a programmatic
    // click or a future layout change.
    if (!safetyAcknowledged) return;
    setIsSubmitting(true);
    try {
      await apiFetch(`/api/users/me/accept-privacy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ version: CURRENT_PRIVACY_VERSION }),
      });

      await apiFetch(`/api/users/me/accept-terms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ version: CURRENT_TERMS_VERSION }),
      });

      if (user) {
        setUser({
          ...user,
          privacyConsentAt: new Date().toISOString(),
          privacyConsentVersion: CURRENT_PRIVACY_VERSION,
          termsAcceptedAt: new Date().toISOString(),
          termsAcceptedVersion: CURRENT_TERMS_VERSION,
        });
      }

      // R3-DRIVER-SCREENER — drivers next reach the eligibility screener.
      // Customers go straight to the customer home as before.
      if (isDriverRole) {
        navigate('/driver/screener', { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    } catch {
      // Silent fail — user can retry
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-10">
      <div className="max-w-md w-full space-y-6">
        <h1 className="text-2xl font-bold text-[#1B4F72] text-center">
          {t('legal.privacyTitle')}
        </h1>

        <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 leading-relaxed">
          {t('legal.privacyText')}
        </div>

        <h2 className="text-lg font-semibold text-gray-900">
          {t('legal.termsTitle')}
        </h2>

        {/* TEAM-SAID G1 — the terms heading has stood here since the
            consent screen shipped with nothing underneath it. The
            child policy is the first line to go under it: the team
            asked (Faustin, Lievin, Sophonie) that the rule stay in
            writing even though the booking flow stopped asking. */}
        <div
          className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 leading-relaxed"
          data-testid="terms-child-policy"
        >
          {t('legal.termsChildPolicy')}
        </div>

        {/* FLIGHT-RECORDER G2 — the diagnostics line. This is where the
            background upload is consented to, in plain language, before
            anything is ever sent: what is collected, what is not, where
            it goes, and that Settings can turn it off. The Diagnostics
            screen shows the exact bytes at any time. */}
        <div
          className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 leading-relaxed"
          data-testid="consent-diagnostics"
        >
          {t('legal.diagnosticsConsent')}
        </div>

        {/* COMPLIANCE-ACK (founder, 24 Aug) — three rules both sides of
            a ride acknowledge once, in plain words, at consent. They
            carry NO number: the legal minimum age is counsel's to fix
            (card 2ZazTeyo), and a number invented here would be quoted
            back at us as policy. The child-gate in
            services/child-safety/legal-thresholds.ts stays dormant and
            untouched — this is copy the user affirms, not a gate.

            Styled apart from the grey information boxes above on
            purpose: those are things we tell the user, this is a thing
            the user tells us. */}
        <div
          className="border-2 border-[#1B4F72] rounded-lg p-4 space-y-3"
          data-testid="safety-acknowledgment"
        >
          <h2 className="text-base font-semibold text-[#1B4F72]">
            {t('legal.safetyAckTitle')}
          </h2>

          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-800 leading-relaxed">
            <li data-testid="safety-ack-no-infants">{t('legal.safetyAckNoInfants')}</li>
            <li data-testid="safety-ack-one-passenger">{t('legal.safetyAckOnePassenger')}</li>
            <li data-testid="safety-ack-minimum-age">{t('legal.safetyAckMinimumAge')}</li>
          </ul>

          {/* The driver's extra sentence rides HERE rather than only on
              the driver-terms step, and that is the whole mechanism:
              nothing reads driverTermsVersion for staleness, so a
              driver-terms bump alone never re-prompts an existing
              motari. This step is the one every user passes. */}
          {isDriverRole && (
            <p
              className="text-sm text-gray-800 leading-relaxed"
              data-testid="safety-ack-driver-refuse"
            >
              {t('legal.safetyAckDriverRefuse')}
            </p>
          )}

          <label className="flex items-start gap-2 text-sm font-medium text-gray-900">
            <input
              type="checkbox"
              checked={safetyAcknowledged}
              onChange={(e) => setSafetyAcknowledged(e.target.checked)}
              className="mt-1 rounded border-gray-300"
              data-testid="safety-ack-checkbox"
            />
            {t('legal.safetyAckAgree')}
          </label>
        </div>

        <Button
          fullWidth
          size="lg"
          variant="success"
          loading={isSubmitting}
          onClick={handleAccept}
          disabled={!safetyAcknowledged}
        >
          {t('legal.privacyAgree')}
        </Button>
      </div>
    </div>
  );
};

export default ConsentPage;
