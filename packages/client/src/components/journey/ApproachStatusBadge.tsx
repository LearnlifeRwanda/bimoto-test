// R3-N-3 — surfaces the server-derived approach status under the
// driver-approach map so the customer can see whether the driver is
// silent, approaching, lost, or arrived. Same signal feeds the
// MatchedPage cancel-modal gating, so the customer never sees a
// "DRIVER_NO_SHOW" button for a driver who is visibly closing in.
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ApproachStatus } from '@bimoto/shared';

interface Props {
  status: ApproachStatus | null;
  distanceMeters: number | null;
  etaMinutes: number | null;
  isLive: boolean;
}

const colorClassByStatus: Record<ApproachStatus, string> = {
  silent: 'bg-gray-100 text-gray-700',
  approaching: 'bg-green-100 text-green-800',
  arrived: 'bg-blue-100 text-blue-800',
  lost: 'bg-yellow-100 text-yellow-800',
};

export const ApproachStatusBadge: React.FC<Props> = ({
  status,
  distanceMeters,
  etaMinutes,
  isLive,
}) => {
  const { t } = useTranslation();

  if (!isLive || !status) return null;

  const distance =
    distanceMeters !== null && distanceMeters >= 0
      ? `${Math.round(distanceMeters)}m`
      : '';
  const eta =
    etaMinutes !== null && etaMinutes > 0
      ? t('matched.approach.etaShort', { minutes: etaMinutes })
      : '';

  return (
    <div
      data-testid="approach-status-badge"
      data-status={status}
      className={`px-3 py-2 rounded-lg ${colorClassByStatus[status]} flex items-center gap-2`}
      role="status"
      aria-live="polite"
    >
      <span className="text-sm font-medium">
        {t(`matched.approach.${status}`)}
      </span>
      {distance && <span className="text-xs opacity-75">· {distance}</span>}
      {eta && <span className="text-xs opacity-75">· {eta}</span>}
    </div>
  );
};

export default ApproachStatusBadge;
