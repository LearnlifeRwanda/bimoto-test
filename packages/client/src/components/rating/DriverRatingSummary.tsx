// COMPONENTS/RATING/DRIVER-RATING-SUMMARY.TSX
//
// Dispatch RATE-DISPLAY — the one shared "driver reputation" strip
// mounted wherever a driver identity is shown (bid cards, matched-
// driver header, the driver's own stats card). Renders from the
// normalized DriverRatingInfo the lib/driver-rating accessor extracts:
//
//   unrated (avgRating null)        → calm "New driver" label, never
//                                     NaN or 0.0 stars;
//   rated, rides count available    → compact stars + numeric average
//                                     + ReliabilityBadge (which itself
//                                     shows the "New driver" pill under
//                                     5 completed rides);
//   rated, rides count NOT in the
//   payload                         → stars + average only — the badge
//                                     needs the real count for its
//                                     under-5 gate, so it is omitted
//                                     rather than fed a fake value.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { StarRating } from './StarRating';
import { ReliabilityBadge } from './ReliabilityBadge';
import type { DriverRatingInfo } from '../../lib/driver-rating';

export interface DriverRatingSummaryProps {
  info: DriverRatingInfo;
}

export const DriverRatingSummary: React.FC<DriverRatingSummaryProps> = ({
  info,
}) => {
  const { t } = useTranslation();

  if (info.avgRating === null) {
    return (
      <span
        className="text-sm text-gray-500"
        data-testid="driver-rating-new-driver"
      >
        {t('reliability.newDriver')}
      </span>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="driver-rating-summary"
    >
      <div className="flex items-center gap-1">
        <StarRating value={info.avgRating} readonly size="sm" />
        <span
          className="text-sm text-gray-600"
          data-testid="driver-rating-average"
        >
          {info.avgRating.toFixed(1)}
        </span>
      </div>
      {info.completedRides !== null && (
        <ReliabilityBadge
          completedRides={info.completedRides}
          avgRating={info.avgRating}
        />
      )}
    </div>
  );
};

export default DriverRatingSummary;
