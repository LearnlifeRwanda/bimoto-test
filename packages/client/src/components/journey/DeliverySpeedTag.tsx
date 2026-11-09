// COMPONENTS/JOURNEY/DELIVERY-SPEED-TAG.TSX
//
// TEAM-SAID G3 — the tier the sender chose, on the motari's screen.
//
// This is the whole of what "express" means in the pilot: the motari
// sees the word and prices the job accordingly in his bid. There is no
// surcharge attached to it, no percentage, and nothing here or
// downstream reads it into a fare — which is precisely the decision the
// team made when they asked to drop predetermined surcharges (item 13).
// If a future change gives this tag a price, it belongs in a dispatch
// that revisits that decision, not in this component.
//
// Returns null for a parcel booked before tiers existed, so an old
// request card looks exactly as it did.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { DeliverySpeed } from '@bimoto/shared';

export interface DeliverySpeedTagProps {
  deliverySpeed?: DeliverySpeed | string | null;
  /**
   * LIVE-WIRE G5 — the sender's optional 1/2/3-hour window on a
   * STANDARD parcel. Shown inside the same tag rather than as a second
   * chip: it is a qualifier on the tier, not a tier of its own, and the
   * motari should read "Standard · within 2 hours" as one fact. Still
   * no price attached — the same guarantee the tier itself carries.
   */
  standardDeliveryHours?: number | null;
  className?: string;
}

export const DeliverySpeedTag: React.FC<DeliverySpeedTagProps> = ({
  deliverySpeed,
  standardDeliveryHours = null,
  className = '',
}) => {
  const { t } = useTranslation();
  if (deliverySpeed !== DeliverySpeed.STANDARD && deliverySpeed !== DeliverySpeed.EXPRESS) {
    return null;
  }
  const isExpress = deliverySpeed === DeliverySpeed.EXPRESS;
  return (
    <span
      className={`px-2 py-1 rounded ${
        isExpress ? 'bg-blue-100 text-blue-800 font-medium' : 'bg-gray-100 text-gray-600'
      } ${className}`}
      data-testid="delivery-speed-tag"
      data-speed={deliverySpeed}
    >
      {t(isExpress ? 'delivery.speedExpress' : 'delivery.speedStandard')}
      {!isExpress && standardDeliveryHours ? (
        <span data-testid="delivery-speed-window">
          {' · '}
          {t('delivery.standardHoursWithin', { count: standardDeliveryHours })}
        </span>
      ) : null}
    </span>
  );
};

export default DeliverySpeedTag;
