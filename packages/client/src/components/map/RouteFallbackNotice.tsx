// COMPONENTS/MAP/ROUTE-FALLBACK-NOTICE.TSX
//
// TRUE-ROUTES G1 — the honest-absence label that accompanies the
// dashed straight connector whenever a map can't show the real road
// route. Every map uses this same pill so degraded rendering looks
// identical everywhere: "route unavailable — showing direct line".

import React from 'react';
import { useTranslation } from 'react-i18next';

export const RouteFallbackNotice: React.FC<{ className?: string }> = ({
  className,
}) => {
  const { t } = useTranslation();
  return (
    <span
      data-testid="route-fallback-notice"
      className={`px-3 py-1 rounded-full bg-white/90 text-[11px] text-gray-600 shadow ${className ?? ''}`}
    >
      {t('map.routeUnavailable')}
    </span>
  );
};

export default RouteFallbackNotice;
