// COMPONENTS/MAP/DRIVER-NAV-MAP.TSX
//
// COCKPIT G2 — the map on the MOTARI's own screens.
//
// ApproachPage and ActiveRidePage each rendered a grey rectangle with
// the word "Map view" in it. The driver — the one person on the trip who
// actually has to find the place — was the only participant riding
// blind, while the passenger watched a real live map of him coming.
//
// WHY NOT DriverApproachMap. That component is the CUSTOMER's view of
// the driver: its props (etaMinutes, etaConfidence, isLive, driverAsOf)
// all come from useDriverLocationStream, the socket subscription that
// carries someone ELSE's position across the network, and it renders an
// ETA pill and a "last seen N seconds ago" line about that someone else.
// On the driver's own screen there is no stream — he IS the source — and
// a staleness notice about oneself is meaningless. Reusing it would mean
// passing nulls into half its props to suppress a customer-facing
// chrome. So this composes the same PRIMITIVES instead: one MapContainer,
// BaseTileLayer (which is where offline lives — see below),
// useRouteDirections, the shared route styles and the shared fallback
// pill. No second tile pipeline, no forked geometry code.
//
// OFFLINE comes for free and is not re-implemented here: BaseTileLayer
// asks useOfflineMaps() for every cached archive and renders
// OfflineMapLayer when one covers the view, falling back to OSM raster
// otherwise. That is the same path the five existing map surfaces take,
// so a motari with a downloaded province gets tiles in airplane mode
// without this file knowing anything about PMTiles.
//
// ROUTE lines follow TRUE-ROUTES: solid road polyline when the
// directions proxy answers, the shared dashed connector plus
// RouteFallbackNotice when it can't. Never an error — a red banner over
// the map of someone on a bike is not a thing this app does.

import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, Marker, Polyline, useMap } from 'react-leaflet';
import L, { type LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useRouteDirections } from '../../hooks/useRouteDirections';
import { ROAD_ROUTE_STYLE, FALLBACK_LINE_STYLE } from './route-style';
import { RouteFallbackNotice } from './RouteFallbackNotice';
import { BaseTileLayer } from './BaseTileLayer';
import { MapDownloadChip } from './MapDownloadChip';

export interface NavPoint {
  lat: number;
  lng: number;
}

export interface DriverNavMapProps {
  /** Where the motari is. Null until the first GPS fix. */
  origin: NavPoint | null;
  /** Where he is going on this screen. */
  target: NavPoint;
  /**
   * Which leg this is. Only affects the target pin's colour, matching
   * the green pickup / red destination dots the pages already use in
   * their text rows.
   */
  targetKind: 'pickup' | 'destination';
  /** Tailwind height for the map box. Pages own their own layout. */
  heightClass?: string;
  /** Overlay chrome (the in-ride GPS pill), placed above the tiles. */
  children?: React.ReactNode;
}

const originIcon = L.divIcon({
  className: 'driver-nav-own-pin',
  html: '<div style="background:#2E75B6;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 2px #2E75B6;"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const pickupIcon = L.divIcon({
  className: 'driver-nav-pickup-pin',
  html: '<div style="background:#15803D;width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 2px #15803D;"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const destinationIcon = L.divIcon({
  className: 'driver-nav-destination-pin',
  html: '<div style="background:#DC2626;width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 2px #DC2626;"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const FitBounds: React.FC<{ points: NavPoint[] }> = ({ points }) => {
  const map = useMap();
  // Key on the coordinates, not the array identity: a re-render with an
  // unchanged position must not re-run fitBounds and fight the rider's
  // own panning.
  const key = points.map((p) => `${p.lat},${p.lng}`).join('|');
  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(points.map((p) => [p.lat, p.lng]) as [number, number][], {
        padding: [40, 40],
        animate: true,
      });
    } else if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 15, { animate: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
};

export const DriverNavMap: React.FC<DriverNavMapProps> = ({
  origin,
  target,
  targetKind,
  heightClass = 'h-56',
  children,
}) => {
  const { t } = useTranslation();

  // Same quantisation DriverApproachMap applies for the same reason: a
  // moving driver would otherwise mint a fresh directions cache key
  // (and a request) every few metres and drain the shared geocode rate
  // limit. 3 decimals ≈ 111 m; the router snaps the start to a road
  // anyway, so the drawn route does not change meaningfully.
  const routeOrigin = origin
    ? {
        lat: Number(origin.lat.toFixed(3)),
        lng: Number(origin.lng.toFixed(3)),
      }
    : null;
  const fetched = useRouteDirections(routeOrigin, target);
  // A route belongs to a journey that has a start. Until GPS answers
  // there is nothing to draw a line FROM, so nothing is drawn — not a
  // line to nowhere and not a fallback pill about a line nobody asked
  // for. (The hook already answers null for a null origin; this makes
  // the component say so itself rather than depend on that.)
  const route = origin ? fetched : null;

  const boundPoints: NavPoint[] = [
    target,
    ...(origin ? [origin] : []),
    // Fit the real road geometry, not just the two ends — a road can
    // bow well outside the box the endpoints make.
    ...(route ? route.coordinates.map(([lat, lng]) => ({ lat, lng })) : []),
  ];

  const crowLine: LatLngExpression[] | null =
    origin && !route
      ? [
          [origin.lat, origin.lng],
          [target.lat, target.lng],
        ]
      : null;

  return (
    <div
      className={`relative w-full ${heightClass} overflow-hidden border-b border-gray-200`}
      aria-label={
        targetKind === 'pickup'
          ? t('driverNav.mapLabelPickup')
          : t('driverNav.mapLabelDestination')
      }
      data-testid="driver-nav-map"
      data-target-kind={targetKind}
    >
      <MapContainer
        center={[target.lat, target.lng]}
        zoom={15}
        scrollWheelZoom={false}
        className="w-full h-full"
        attributionControl={true}
      >
        <BaseTileLayer />
        <FitBounds points={boundPoints} />

        <Marker
          position={[target.lat, target.lng]}
          icon={targetKind === 'pickup' ? pickupIcon : destinationIcon}
        />
        {origin && (
          <Marker position={[origin.lat, origin.lng]} icon={originIcon} />
        )}

        {route && (
          <Polyline positions={route.coordinates} pathOptions={ROAD_ROUTE_STYLE} />
        )}
        {crowLine && (
          <Polyline positions={crowLine} pathOptions={FALLBACK_LINE_STYLE} />
        )}
      </MapContainer>

      {/* MAP-REACH G2 — the offer, on the motari's own navigation map.
          Bottom, because top-centre is taken by the locating pill and the
          route-fallback notice; shows only when there is no extract, the
          device is online and it has not been dismissed. */}
      <MapDownloadChip className="absolute inset-x-0 bottom-3 px-3" />

      {/* Waiting for the first fix. Says what is happening rather than
          leaving the rider wondering why there is no blue dot; it never
          blocks the map, which already shows where he is going. */}
      {!origin && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none">
          <span
            data-testid="driver-nav-locating"
            className="px-3 py-1 rounded-full bg-white/90 text-[11px] text-gray-600 shadow"
          >
            {t('driverNav.locating')}
          </span>
        </div>
      )}

      {origin && !route && (
        <div className="absolute top-3 inset-x-0 flex justify-center pointer-events-none">
          <RouteFallbackNotice />
        </div>
      )}

      {children}
    </div>
  );
};

export default DriverNavMap;
