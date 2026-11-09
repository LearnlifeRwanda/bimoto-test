import React from 'react';
import { useTranslation } from 'react-i18next';

// PILOT-READY G3 — LocationIQ's free tier permits commercial use only
// with an attribution link in the application, so this credit renders
// wherever geocoding results are shown (address search suggestions and
// the pick-on-map overlay). Separate obligation from the OSM tile
// credit that Leaflet's attributionControl carries (MapCanvas.tsx).
export const GeocodingAttribution: React.FC<{ className?: string }> = ({
  className = '',
}) => {
  const { t } = useTranslation();
  return (
    <p
      data-testid="geocoding-attribution"
      className={`text-[10px] text-gray-500 ${className}`}
    >
      {t('attribution.searchBy')}{' '}
      <a
        href="https://locationiq.com"
        target="_blank"
        rel="noreferrer"
        className="underline text-gray-600"
      >
        LocationIQ
      </a>
    </p>
  );
};

export default GeocodingAttribution;
