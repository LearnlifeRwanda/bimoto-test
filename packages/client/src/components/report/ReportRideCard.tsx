// COMPONENTS/REPORT/REPORT-RIDE-CARD.TSX
//
// TEAM-ANSWERS G3 — the driver's way to say a ride went wrong.
//
// The Kigali team asked (item 15) for driver-rates-passenger so that
// issues could be identified and managed from both sides. The goal
// ships here; the mechanism is an incident report, not a grade — see
// packages/shared/src/types/ride-report.ts for the decision and the
// reasoning behind it.
//
// SHAPE, deliberately understated: a plain link, not a button competing
// with "back to dashboard". Most rides are fine, and a screen that
// leads with "was there a problem?" invites problems. Tapping it opens
// a reason select and an optional details box; filing is entirely
// optional and nothing about the ride, the money or the next request
// depends on it.
//
// SERVER SEMANTICS, reflected not re-invented (ride-report.service.ts):
//   • one report per (journey, driver) — a second POST is 409
//     ALREADY_REPORTED, so this collects once and then says so;
//   • only the driver who drove it — 403 NOT_JOURNEY_DRIVER;
//   • the ride must have ended — 400 JOURNEY_NOT_ENDED. The driver's
//     natural moment is the receipt the instant he taps End, which is
//     AWAITING_CONFIRMATION, and the service allows exactly that.
// Everything else comes back through the existing toast with the
// server's own localized message key.

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RIDE_REPORT_REASONS } from '@bimoto/shared';
import { Button } from '../ui/Button';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';
import { useUIStore } from '../../stores/ui.store';

export interface ReportRideCardProps {
  journeyId: string;
}

export const ReportRideCard: React.FC<ReportRideCardProps> = ({ journeyId }) => {
  const { t } = useTranslation();
  const { showToast } = useUIStore();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [filed, setFiled] = useState(false);

  const submit = useCallback(async () => {
    if (!reason) return;
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/journeys/${journeyId}/report`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          reason,
          ...(details.trim() ? { details: details.trim() } : {}),
        }),
      });
      if (!res.ok) throw await apiErrorFromResponse(res);
      setFiled(true);
      setOpen(false);
      showToast(t('report.filed'), 'success');
    } catch (err) {
      presentApiError(err);
    } finally {
      setSubmitting(false);
    }
  }, [journeyId, reason, details, showToast, t]);

  if (filed) {
    return (
      <p className="text-caption text-gray-500 mt-4 text-center" data-testid="report-ride-done">
        {t('report.alreadyFiled')}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="mt-4 w-full text-caption text-gray-500 underline"
        onClick={() => setOpen(true)}
        data-testid="report-ride-open"
      >
        {t('report.openLink')}
      </button>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t space-y-2 text-left" data-testid="report-ride-form">
      <p className="text-secondary text-gray-700">{t('report.title')}</p>
      <label className="block">
        <span className="text-caption text-gray-600">{t('report.reasonLabel')}</span>
        <select
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-secondary"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-testid="report-ride-reason"
        >
          <option value="">{t('report.reasonNone')}</option>
          {RIDE_REPORT_REASONS.map((key) => (
            <option key={key} value={key}>
              {t(`report.reason.${key}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-caption text-gray-600">{t('report.detailsLabel')}</span>
        <textarea
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-secondary"
          rows={3}
          maxLength={500}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder={t('report.detailsPlaceholder')}
          data-testid="report-ride-details"
        />
      </label>
      <p className="text-caption text-gray-500">{t('report.reviewNote')}</p>
      <div className="flex gap-2 pt-1">
        <Button
          fullWidth
          variant="secondary"
          size="sm"
          onClick={() => setOpen(false)}
          data-testid="report-ride-cancel"
        >
          {t('common.cancel')}
        </Button>
        <Button
          fullWidth
          size="sm"
          disabled={!reason}
          loading={submitting}
          onClick={submit}
          data-testid="report-ride-submit"
        >
          {t('report.submit')}
        </Button>
      </div>
    </div>
  );
};

export default ReportRideCard;
