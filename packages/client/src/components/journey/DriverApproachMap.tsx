import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, Marker, Polyline, useMap } from 'react-leaflet';
import L, { type LatLngExpression } from 'leaflet';
import type { EtaConfidence } from '../../hooks/useDriverLocationStream';
import { useRouteDirections } from '../../hooks/useRouteDirections';
import { ROAD_ROUTE_STYLE, FALLBACK_LINE_STYLE } from '../map/route-style';
import { RouteFallbackNotice } from '../map/RouteFallbackNotice';
import { BaseTileLayer } from '../map/BaseTileLayer';
import { MapDownloadChip } from '../map/MapDownloadChip';

export interface MapPoint {
  lat: number;
  lng: number;
}

export interface DriverApproachMapProps {
  customerLocation: MapPoint;
  driverLocation: MapPoint | null;
  etaMinutes: number | null;
  etaConfidence: EtaConfidence;
  isLive: boolean;
  /** Last seen timestamp for the stale-fallback message. */
  driverAsOf?: Date | null;
  /** Optional driver name to label the pin. */
  driverName?: string;
}

const TRAIL_LIMIT = 5;

const customerIcon = L.divIcon({
  className: 'driver-approach-customer-pin',
  html: '<div style="background:#1B4F72;width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 2px #1B4F72;"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const driverIcon = L.divIcon({
  className: 'driver-approach-driver-pin',
  html: '<div style="background:#F39C12;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 2px #F39C12;"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const FitBounds: React.FC<{ points: MapPoint[] }> = ({ points }) => {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(points.map((p) => [p.lat, p.lng]) as [number, number][], {
        padding: [40, 40],
        animate: true,
      });
    } else if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 15, { animate: true });
    }
  }, [points, map]);
  return null;
};

const SmoothPan: React.FC<{ to: MapPoint | null }> = ({ to }) => {
  const map = useMap();
  useEffect(() => {
    if (to) map.panTo([to.lat, to.lng], { animate: true });
  }, [to, map]);
  return null;
};

export const DriverApproachMap: React.FC<DriverApproachMapProps> = ({
  customerLocation,
  driverLocation,
  etaMinutes,
  etaConfidence,
  isLive,
  driverAsOf,
  driverName,
}) => {
  const { t } = useTranslation();
  const trailRef = useRef<MapPoint[]>([]);

  // TRUE-ROUTES G1 — the driver→customer road route. The driver point
  // is quantised to 3 decimals (~111 m) before it reaches the hook: a
  // moving driver would otherwise mint a new cache key (and a directions
  // request) every few metres and drain the shared 20/min geocode rate
  // limit. OSRM snaps the start to the nearest road anyway, so the
  // coarser origin doesn't change the drawn route meaningfully.
  const routeOrigin = driverLocation
    ? {
        lat: Number(driverLocation.lat.toFixed(3)),
        lng: Number(driverLocation.lng.toFixed(3)),
      }
    : null;
  const approachRoute = useRouteDirections(routeOrigin, customerLocation);

  // Maintain a bounded trail of the last N driver positions.
  if (driverLocation) {
    const last = trailRef.current[trailRef.current.length - 1];
    if (!last || last.lat !== driverLocation.lat || last.lng !== driverLocation.lng) {
      trailRef.current = [...trailRef.current, driverLocation].slice(-TRAIL_LIMIT);
    }
  }
  const trail = trailRef.current;

  const center: LatLngExpression = [customerLocation.lat, customerLocation.lng];
  const allPoints: MapPoint[] = [
    ...(driverLocation ? [customerLocation, driverLocation] : [customerLocation]),
    // Fit the real road geometry, not just the endpoints.
    ...(approachRoute
      ? approachRoute.coordinates.map(([lat, lng]) => ({ lat, lng }))
      : []),
  ];

  // Straight connector only when the road route is unavailable —
  // rendered in the shared visibly-not-a-route treatment.
  const crowLine: LatLngExpression[] | null =
    driverLocation && !approachRoute
      ? [[driverLocation.lat, driverLocation.lng], [customerLocation.lat, customerLocation.lng]]
      : null;

  const trailLine: LatLngExpression[] | null =
    trail.length > 1 ? trail.map((p) => [p.lat, p.lng] as LatLngExpression) : null;

  const etaText =
    etaMinutes != null
      ? t('driverApproach.etaMinutes', { minutes: etaMinutes })
      : t('driverApproach.etaUnknown');
  const confidenceText =
    etaConfidence === 'high'
      ? t('driverApproach.confidenceHigh')
      : etaConfidence === 'med'
        ? t('driverApproach.confidenceMed')
        : etaConfidence === 'low'
          ? t('driverApproach.confidenceLow')
          : '';

  const staleSeconds = driverAsOf
    ? Math.max(0, Math.floor((Date.now() - driverAsOf.getTime()) / 1000))
    : null;

  return (
    <div className="w-full">
      <div
        className="relative w-full h-[60vh] md:h-[40vh] rounded-lg overflow-hidden border border-gray-200"
        aria-label={t('driverApproach.mapLabel') || 'Driver approach map'}
        data-testid="driver-approach-map"
      >
        <MapContainer
          center={center}
          zoom={15}
          scrollWheelZoom={false}
          className="w-full h-full"
          attributionControl={true}
        >
          <BaseTileLayer />

          <FitBounds points={allPoints} />
          <SmoothPan to={driverLocation} />

          <Marker position={center} icon={customerIcon} />

          {driverLocation && (
            <Marker
              position={[driverLocation.lat, driverLocation.lng]}
              icon={driverIcon}
            />
          )}

          {approachRoute && (
            <Polyline
              positions={approachRoute.coordinates}
              pathOptions={ROAD_ROUTE_STYLE}
            />
          )}

          {crowLine && (
            <Polyline positions={crowLine} pathOptions={FALLBACK_LINE_STYLE} />
          )}

          {trailLine && (
            <Polyline
              positions={trailLine}
              pathOptions={{ color: '#F39C12', weight: 3, opacity: 0.7 }}
            />
          )}
        </MapContainer>

        {/* MAP-REACH G2 — the offer, on the map a customer watches while
            their motari rides toward them. Bottom, clear of the ETA pill
            above; shows only when there is no extract, the device is
            online and the rider has not dismissed it. */}
        <MapDownloadChip className="absolute inset-x-0 bottom-12 px-3" />

        {/* ETA pill */}
        <div
          data-testid="driver-approach-eta-pill"
          className="absolute top-3 left-1/2 -translate-x-1/2 bg-white rounded-full shadow-md px-4 py-2 flex flex-col items-center min-w-[140px]"
        >
          <span className="text-sm font-bold text-[#1B4F72]" data-testid="eta-text">
            {etaText}
          </span>
          {confidenceText && (
            <span className="text-[10px] text-gray-500 uppercase tracking-wide">
              {confidenceText}
            </span>
          )}
        </div>

        {driverName && (
          <div className="absolute bottom-3 left-3 bg-white/90 rounded-full px-3 py-1 shadow text-xs font-medium text-gray-700">
            {t('driverApproach.driverLabel', { driverName })}
          </div>
        )}

        {driverLocation && !approachRoute && (
          <div className="absolute top-16 inset-x-0 flex justify-center pointer-events-none">
            <RouteFallbackNotice />
          </div>
        )}
      </div>

      {!isLive && driverLocation && staleSeconds != null && (
        <p
          className="mt-2 text-xs text-gray-500 italic"
          data-testid="driver-approach-stale"
        >
          {t('driverApproach.stale', { seconds: staleSeconds })}
        </p>
      )}
    </div>
  );
};

export default DriverApproachMap;
