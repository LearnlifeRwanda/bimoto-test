import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useAuthStore } from '../../stores/auth.store';
import { CURRENT_DRIVER_TERMS_VERSION, getVehicleCompliance } from '@bimoto/shared';
import { apiFetch } from '../../lib/api';

export const DriverVerificationPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [licenseNumber, setLicenseNumber] = useState('');
  const [ruraNumber, setRuraNumber] = useState('');
  const [cooperativeName, setCooperativeName] = useState('');
  const [insuranceConfirmed, setInsuranceConfirmed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const vehicleType = (user?.driverProfile as any)?.vehicleType || 'MOTO';
  const compliance = getVehicleCompliance(vehicleType);
  const verificationStatus = user?.driverProfile?.verificationStatus ?? 'PENDING';

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      // Accept driver terms
      if (!termsAccepted) {
        setIsSubmitting(false);
        return;
      }

      await apiFetch(`/api/users/me/accept-driver-terms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ version: CURRENT_DRIVER_TERMS_VERSION }),
      });

      await apiFetch(`/api/users/me/driver-verification`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          drivingLicenseNumber: licenseNumber || undefined,
          ruraAuthorizationNumber: ruraNumber || undefined,
          cooperativeName: cooperativeName || undefined,
          insuranceConfirmed,
        }),
      });

      navigate('/driver', { replace: true });
    } catch {
      // Silent fail
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpload = async (docType: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,application/pdf';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('document', file);
      await apiFetch(`/api/users/me/driver-verification/upload/${docType}`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
    };
    input.click();
  };

  // DRIVER-ID v3 — REVOKED shows the calm terminal notice; the form
  // below stays visible because re-submitting through this page is the
  // only way back into the verification pipeline (re-application resets
  // REVOKED -> PENDING server-side).
  const statusMessage = {
    PENDING: t('verification.statusPending'),
    UNDER_REVIEW: t('verification.statusReview'),
    VERIFIED: t('verification.statusVerified'),
    REJECTED: t('verification.statusRejected', { reason: '' }),
    REVOKED: t('driver.revokedNotice'),
  }[verificationStatus] || '';

  const statusColor = {
    PENDING: 'text-yellow-600 bg-yellow-50',
    UNDER_REVIEW: 'text-blue-600 bg-blue-50',
    VERIFIED: 'text-green-700 bg-green-50',
    REJECTED: 'text-red-600 bg-red-50',
    REVOKED: 'text-gray-700 bg-gray-100',
  }[verificationStatus] || 'text-gray-600 bg-gray-50';

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="max-w-md mx-auto space-y-5">
        <h1 className="text-xl font-bold text-[#1B4F72]">{t('verification.title')}</h1>

        <div className={`rounded-lg p-3 text-sm ${statusColor}`}>
          {statusMessage}
        </div>

        {verificationStatus !== 'VERIFIED' && (
          <>
            {compliance.registrationHintKey && (
              <p className="text-sm text-gray-600 bg-blue-50 rounded-lg p-3">
                {t(compliance.registrationHintKey)}
              </p>
            )}

            {compliance.licenseRequired && (
              <Input
                label={t('verification.licenseNumber', { category: compliance.licenseCategory })}
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
              />
            )}

            {/* BIKE-GATE — the person identifier (jacket number) is
                required for every driver; the field doubles as the RURA
                authorization number for vehicle types that need one, so
                only the label changes with the compliance matrix. */}
            <Input
              label={
                compliance.ruraRequired
                  ? t('verification.ruraNumber')
                  : t('verification.driverNumber')
              }
              value={ruraNumber}
              onChange={(e) => setRuraNumber(e.target.value)}
              placeholder={
                compliance.ruraRequired ? undefined : t('verification.driverNumberHint')
              }
            />

            {compliance.cooperativeRequired && (
              <Input
                label={t('verification.cooperative')}
                value={cooperativeName}
                onChange={(e) => setCooperativeName(e.target.value)}
                placeholder={t('verification.cooperativeHint')}
              />
            )}

            {compliance.insuranceRequired && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={insuranceConfirmed}
                  onChange={(e) => setInsuranceConfirmed(e.target.checked)}
                  className="rounded border-gray-300"
                />
                {t('verification.insurance')}
              </label>
            )}

            <div className="space-y-2">
              {compliance.licenseRequired && (
                <Button fullWidth variant="secondary" size="sm" onClick={() => handleUpload('driving-license')}>
                  {t('verification.uploadLicense')}
                </Button>
              )}
              {compliance.ruraRequired && (
                <Button fullWidth variant="secondary" size="sm" onClick={() => handleUpload('rura-authorization')}>
                  {t('verification.uploadRura')}
                </Button>
              )}
              {compliance.insuranceRequired && (
                <Button fullWidth variant="secondary" size="sm" onClick={() => handleUpload('insurance')}>
                  {t('verification.uploadInsurance')}
                </Button>
              )}
            </div>

            {(compliance.licenseRequired || compliance.ruraRequired) && (
              <p className="text-xs text-gray-500">{t('verification.iremboHint')}</p>
            )}

            <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700">
              {t('legal.driverTermsText')}
            </div>

            {/* RIDE-TRACE G4 — said out loud, before he accepts, in the
                same box style as the terms above it. The line above
                already says he allows "GPS tracking during rides"; this
                says what that actually means for him: what is kept, for
                how long, what happens under a dispute, and — the part a
                motari asks about first — that nobody is watching, and
                the single bounded case in which somebody does. That
                exception used to be its own box. A promise in one box
                and its exception in the next is a driver who accepts
                after reading the first one, so both are now one
                sentence he cannot finish without reaching the end. */}
            <div
              className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 leading-relaxed"
              data-testid="driver-ride-trace-notice"
            >
              {t('legal.rideTraceNotice')}
            </div>

            {/* COMPLIANCE-ACK (founder, 24 Aug) — the same three rules
                the ConsentPage step states, restated here where a
                motari accepts the driver agreement, plus the sentence
                that is his alone: he refuses such a ride even when the
                passenger insists. No number appears — the legal
                minimum age is counsel's to fix (card 2ZazTeyo).

                This step is NOT the enforcement mechanism for existing
                drivers. Nothing reads driverTermsVersion for
                staleness, so bumping it re-prompts nobody; it only
                makes a NEW driver stamp the version that carries this
                text. Every existing motari meets the acknowledgment
                through the general-terms bump on ConsentPage, which
                renders the refuse line for DRIVER and BOTH. */}
            <div
              className="border-2 border-[#1B4F72] rounded-lg p-4 space-y-3"
              data-testid="driver-safety-acknowledgment"
            >
              <h3 className="text-base font-semibold text-[#1B4F72]">
                {t('legal.safetyAckTitle')}
              </h3>
              <ul className="list-disc pl-5 space-y-2 text-sm text-gray-800 leading-relaxed">
                <li>{t('legal.safetyAckNoInfants')}</li>
                <li>{t('legal.safetyAckOnePassenger')}</li>
                <li>{t('legal.safetyAckMinimumAge')}</li>
              </ul>
              <p
                className="text-sm text-gray-800 leading-relaxed"
                data-testid="driver-safety-ack-refuse"
              >
                {t('legal.safetyAckDriverRefuse')}
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="rounded border-gray-300"
              />
              {t('legal.driverTermsAgree')}
            </label>

            <Button
              fullWidth
              size="lg"
              variant="success"
              loading={isSubmitting}
              onClick={handleSubmit}
              disabled={!termsAccepted}
            >
              {t('common.save')}
            </Button>
          </>
        )}

        <Button
          fullWidth
          variant="secondary"
          size="sm"
          onClick={() => navigate('/driver', { replace: true })}
        >
          {t('common.back')}
        </Button>
      </div>
    </div>
  );
};

export default DriverVerificationPage;
