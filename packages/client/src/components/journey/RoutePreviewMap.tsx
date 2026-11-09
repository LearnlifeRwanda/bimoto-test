// COMPONENTS/JOURNEY/ROUTE-PREVIEW-MAP.TSX
//
// R3-DELIVERY-V2 — Leaflet map preview of a multi-stop route. Renders
// pickup → intermediate goods stops (in order) → destination with
// sequence-numbered markers. Used on the customer's new-journey page so
// they can visually confirm the route makes geographical sense before
// submitting.
//
// TRUE-ROUTES G1 — real road polylines from the directions proxy
// (useRouteDirections), drawn solid when they answer. When a route
// can't be fetched (offline, pre-bundle pilot server, key unset, no
// route known) the connector falls back to the shared visibly-not-a-
// route treatment: dashed, muted, plus the "route unavailable" pill.
// Map bounds fit the fetched road geometry, not just the endpoints.
//
// TRUE-ROUTES G3 — for a plain pickup→destination preview (no goods
// stops) the map asks for route ALTERNATIVES and lets the customer
// pick: chosen route emphasized, others dimmed and tappable, each
// option chip labelled with distance and duration. The choice is
// informational — fare estimation uses straight-line distance
// (FairPriceHint's haversine), and drivers are never forced onto the
// chosen route, as the one-line hint says. Multi-stop previews keep
// the per-segment single-route rendering.

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import L, { type LatLngBoundsExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LegInput } from '@bimoto/shared';
import { useRouteDirections } from '../../hooks/useRouteDirections';
import { useRouteAlternatives } from '../../hooks/useRouteAlternatives';
import {
  ROAD_ROUTE_STYLE,
  ROAD_ROUTE_DIMMED_STYLE,
  FALLBACK_LINE_STYLE,
  routeSummaryParts,
} from '../map/route-style';
import { RouteFallbackNotice } from '../map/RouteFallbackNotice';
import { BaseTileLayer } from '../map/BaseTileLayer';
import { MapDownloadChip } from '../map/MapDownloadChip';

interface Stop {
  lat: number;
  lng: number;
  name: string;
  sequence: number;
}

interface LatLng {
  lat: number;
  lng: number;
}

export interface RoutePreviewMapProps {
  pickupLat: number;
  pickupLng: number;
  pickupName: string;
  destinationLat: number;
  destinationLng: number;
  destinationName: string;
  legs: LegInput[];
}

// Pad bounds slightly so the lines don't touch the map edges. ~0.005°
// is roughly 500 m at the equator; also handles the degenerate case
// where pickup === destination (single point).
function computeBounds(points: [number, number][]): LatLngBoundsExpression {
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  const pad = 0.005;
  return [
    [Math.min(...lats) - pad, Math.min(...lngs) - pad],
    [Math.max(...lats) + pad, Math.max(...lngs) + pad],
  ];
}

const FitBounds: React.FC<{ bounds: LatLngBoundsExpression }> = ({ bounds }) => {
  const map = useMap();
  React.useEffect(() => {
    map.fitBounds(bounds, { padding: [24, 24], animate: false });
  }, [bounds, map]);
  return null;
};

function makeNumberedIcon(sequence: number): L.DivIcon {
  return L.divIcon({
    className: 'route-stop-marker',
    html: `<div style="background:#2E75B6;color:#fff;width:24px;height:24px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 2px #2E75B6;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;">${sequence}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// One stop-to-stop leg of a multi-stop preview: real road polyline when
// the directions proxy answers, the shared dashed fallback when it
// can't. A component (not a loop of hook calls) because the segment
// count varies with the number of goods stops.
const RouteSegment: React.FC<{
  from: LatLng;
  to: LatLng;
  segmentKey: string;
  onGeometry: (key: string, coords: [number, number][] | null) => void;
}> = ({ from, to, segmentKey, onGeometry }) => {
  const route = useRouteDirections(from, to);
  React.useEffect(() => {
    onGeometry(segmentKey, route ? route.coordinates : null);
  }, [route, segmentKey, onGeometry]);
  return route ? (
    <Polyline positions={route.coordinates} pathOptions={ROAD_ROUTE_STYLE} />
  ) : (
    <Polyline
      positions={[
        [from.lat, from.lng],
        [to.lat, to.lng],
      ]}
      pathOptions={FALLBACK_LINE_STYLE}
    />
  );
};

export const RoutePreviewMap: React.FC<RoutePreviewMapProps> = ({
  pickupLat,
  pickupLng,
  pickupName,
  destinationLat,
  destinationLng,
  destinationName,
  legs,
}) => {
  const { t } = useTranslation();

  const stops: Stop[] = [
    { lat: pickupLat, lng: pickupLng, name: pickupName, sequence: 0 },
    ...legs.map((leg, idx) => ({
      lat: leg.lat,
      lng: leg.lng,
      name: leg.name,
      sequence: idx + 1,
    })),
    {
      lat: destinationLat,
      lng: destinationLng,
      name: destinationName,
      sequence: legs.length + 1,
    },
  ];

  // TRUE-ROUTES G3 — a plain A→B preview offers route alternatives;
  // multi-stop previews route each segment singly (a per-leg choice
  // matrix isn't a decision a customer can sensibly make on a phone).
  const directPair = legs.length === 0;
  const alternatives = useRouteAlternatives(
    directPair ? { lat: pickupLat, lng: pickupLng } : null,
    directPair ? { lat: destinationLat, lng: destinationLng } : null,
  );

  const [selectedIdx, setSelectedIdx] = useState(0);
  const pairId = `${pickupLat},${pickupLng};${destinationLat},${destinationLng}`;
  useEffect(() => {
    setSelectedIdx(0);
  }, [pairId]);
  // The provider may answer with fewer routes than a stale selection.
  const activeIdx =
    alternatives && selectedIdx < alternatives.length ? selectedIdx : 0;

  const segments = directPair
    ? []
    : stops.slice(0, -1).map((from, i) => {
        const to = stops[i + 1];
        return {
          from,
          to,
          key: `${from.lat},${from.lng};${to.lat},${to.lng}`,
        };
      });

  // Road geometry per segment, reported up so bounds can fit the real
  // route (a road path can bow well outside the endpoints' box).
  const [segmentGeometries, setSegmentGeometries] = useState<
    Record<string, [number, number][] | null>
  >({});
  const handleGeometry = useCallback(
    (key: string, coords: [number, number][] | null) => {
      setSegmentGeometries((prev) =>
        prev[key] === coords ? prev : { ...prev, [key]: coords },
      );
    },
    [],
  );

  const boundPoints: [number, number][] = [
    ...stops.map((s): [number, number] => [s.lat, s.lng]),
    // Fit every offered route so the choice is visible, or every
    // fetched segment geometry on multi-stop previews.
    ...(directPair
      ? (alternatives ?? []).flatMap((r) => r.coordinates)
      : segments.flatMap((s) => segmentGeometries[s.key] ?? [])),
  ];
  const bounds = computeBounds(boundPoints);

  const showFallbackNotice = directPair
    ? !alternatives
    : segments.some((s) => !segmentGeometries[s.key]);

  return (
    <div data-testid="route-preview-map" className="w-full">
      <div className="relative w-full h-[240px] rounded-lg overflow-hidden border border-gray-200">
        <MapContainer
          bounds={bounds}
          scrollWheelZoom={false}
          className="w-full h-full"
          attributionControl={true}
        >
          <BaseTileLayer />
          <FitBounds bounds={bounds} />
          {directPair &&
            (alternatives ? (
              <>
                {alternatives.map(
                  (r, idx) =>
                    idx !== activeIdx && (
                      <Polyline
                        key={`alt-${idx}`}
                        positions={r.coordinates}
                        pathOptions={ROAD_ROUTE_DIMMED_STYLE}
                        eventHandlers={{ click: () => setSelectedIdx(idx) }}
                      />
                    ),
                )}
                <Polyline
                  positions={alternatives[activeIdx].coordinates}
                  pathOptions={ROAD_ROUTE_STYLE}
                />
              </>
            ) : (
              <Polyline
                positions={[
                  [pickupLat, pickupLng],
                  [destinationLat, destinationLng],
                ]}
                pathOptions={FALLBACK_LINE_STYLE}
              />
            ))}
          {segments.map((s) => (
            <RouteSegment
              key={s.key}
              from={s.from}
              to={s.to}
              segmentKey={s.key}
              onGeometry={handleGeometry}
            />
          ))}
          {stops.map((s) => (
            <Marker
              key={`${s.sequence}-${s.lat}-${s.lng}`}
              position={[s.lat, s.lng]}
              icon={makeNumberedIcon(s.sequence)}
            >
              <Popup>{s.name}</Popup>
            </Marker>
          ))}
        </MapContainer>
        {showFallbackNotice && (
          <div className="absolute bottom-2 inset-x-0 flex justify-center pointer-events-none">
            <RouteFallbackNotice />
          </div>
        )}
        {/* MAP-REACH G2 — the offer, on this surface too. Sits at the TOP
            here because the bottom of this box is the route-fallback
            notice's. Shows only when there is no extract, the device is
            online and the rider has not dismissed it. */}
        <MapDownloadChip className="absolute inset-x-0 top-2 px-2" />
      </div>
      {/* OUTBOX G5 — the reserved slot, and the reason the booking button
          stops moving under a thumb.

          This block — not the fallback pill, which is absolutely
          positioned inside the fixed-height map and never moved anything
          — is what shifts the form. It mounts when useRouteAlternatives
          answers and unmounts when it fails, and on a bad connection the
          directions provider does that repeatedly, so everything below
          it on the booking form travels up and down by its full height
          while the passenger is reaching for "Find drivers".

          RESERVED rather than animated. An animation still moves the
          button, just more politely, and on the connection this is for
          the notice is ABSENT most of the time — so the honest choice is
          to spend the space permanently and let the button sit at one
          y for the whole fallback/retry cycle. Reserved only for a plain
          A→B preview, because that is the only shape that ever asks for
          alternatives; a multi-stop preview reserves nothing.

          The chip row is nowrap + horizontally scrollable so a third
          option, or a long street name, cannot wrap onto a second line
          and defeat the reserve. */}
      {directPair && (
      <div className="mt-2 min-h-[72px]" data-testid="route-alternatives-slot">
      {alternatives && alternatives.length > 1 && (
        <>
          <div
            className="flex flex-nowrap gap-2 overflow-x-auto"
            role="radiogroup"
            aria-label={t('map.routeOptionsLabel')}
            data-testid="route-alternatives"
          >
            {alternatives.map((r, idx) => (
              <button
                key={idx}
                type="button"
                role="radio"
                aria-checked={activeIdx === idx}
                data-testid={`route-option-${idx}`}
                onClick={() => setSelectedIdx(idx)}
                className={`min-h-[44px] shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  activeIdx === idx
                    ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                }`}
              >
                {t('map.routeOption', { n: idx + 1 })} ·{' '}
                {t('picker.routeSummary', routeSummaryParts(r.distanceM, r.durationS))}
              </button>
            ))}
          </div>
          <p
            className="mt-1 text-caption text-gray-500"
            data-testid="route-choice-hint"
          >
            {t('map.routeChoiceHint')}
          </p>
        </>
      )}
      </div>
      )}
    </div>
  );
};

export default RoutePreviewMap;
