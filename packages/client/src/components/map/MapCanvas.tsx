// COMPONENTS/MAP/MAP-CANVAS.TSX
//
// PILOT-UX-2 G2 — the full-viewport background map (Bolt-style). The
// map fills the screen behind the customer UI (home + creation flows);
// the interactive content lives in a BottomSheet sliding over it. The
// base layer comes from BaseTileLayer, shared with every other map
// surface, which names the raster source in one place (tile-source.ts)
// and is what the APK CSP's img-src allowance has to match.
//
// Offline / tiles-can't-load behaviour: the canvas swaps to a calm
// gray placeholder with a hint and fires onUnavailable so the host
// page can expand the sheet — the GPS + typed-search methods carry the
// flow; never a blank blocking screen.
//
// MAP-CACHE G3 — when the Kigali extract is cached (opt-in download in
// Profile), the map renders the offline protomaps layer INSTEAD of the
// OSM tile layer: zero tile traffic, instant paint, and the map keeps
// working with no connection at all — so the offline placeholder (and
// onUnavailable) only ever applies to the online-tiles path. The #126
// connection banner is driven by API connectivity elsewhere and is
// untouched by tiles being local.
//
// MAP-TRUTH G2 — three reasons this map used to vanish on a working
// connection, all fixed here:
//
//  1. It gated on useUIStore.isOnline, which App.tsx sets from
//     `connection === 'online'`. That three-state's 'unreachable' means
//     OUR API did not answer — nothing to do with whether OpenStreetMap
//     can serve a tile. And apiFetch reported failure for any rejected
//     fetch INCLUDING a deliberate abort, so a keystroke in the
//     destination search box (useGeocodeSearch aborts per keystroke)
//     hid the map for up to 30s of backoff ladder. The map now asks the
//     device whether it has a network (useNetworkStatus, the Capacitor
//     source) and asks the tiles themselves whether they load. It never
//     consults API health again.
//  2. `tilesFailed` latched true forever. BaseTileLayer now reports
//     recovery too, so tiles coming back brings the map back.
//  3. `notified` latched, so a host page that expanded its sheet on
//     onUnavailable stayed expanded after the map recovered. The notify
//     guard now rearms, and onAvailable reports the recovery.
//
// The base layer itself (cached extract vs OSM raster) is chosen by
// BaseTileLayer, shared with every other map surface.
//
// MAP-REACH G2/G3 — and when there is no extract, the offer is HERE.
//
// Fixing the latch (above) made a failed map recover. It did not give a
// rider whose tiles cannot load anything to DO. MapDownloadChip is that
// something, and it is rendered in both branches deliberately: over the
// working map (a quiet offer to make it work offline later) and over the
// gray placeholder (the fix, at the moment of the failure). The chip
// decides for itself whether to appear — no extract, online, not
// dismissed — so neither branch needs a condition of its own.

import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useTranslation } from 'react-i18next';
import { KIGALI_CENTER } from '@bimoto/shared';
import { geolocation } from '../../hooks/useGeolocation';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useMapCacheResolved, useOfflineMap } from '../../hooks/useOfflineMap';
import { BaseTileLayer } from './BaseTileLayer';
import { MapDownloadChip } from './MapDownloadChip';

const DEFAULT_ZOOM = 14;

export interface MapCanvasProps {
  /** Pan target; falls back to Kigali. */
  center?: { lat: number; lng: number } | null;
  /** Try a silent GPS fix on mount and pan there when it answers. */
  centerOnUser?: boolean;
  onMapClick?: (lat: number, lng: number) => void;
  /** Fired when the map can't work (no network AND no cached extract, or
   *  tiles failing). Rearms — a map that recovers and fails again fires
   *  again, with onAvailable in between. */
  onUnavailable?: () => void;
  /** Fired when a previously-unavailable map starts working, so a host
   *  page that expanded its sheet can let it back down. */
  onAvailable?: () => void;
  children?: React.ReactNode;
}

const ClickCatcher: React.FC<{ onMapClick: (lat: number, lng: number) => void }> = ({
  onMapClick,
}) => {
  useMapEvents({
    click: (e: { latlng: { lat: number; lng: number } }) =>
      onMapClick(e.latlng.lat, e.latlng.lng),
  });
  return null;
};

const CenterOnUser: React.FC = () => {
  const map = useMap();
  useEffect(() => {
    let cancelled = false;
    geolocation
      .getCurrentPosition({ enableHighAccuracy: false, timeout: 5000 })
      .then((coords) => {
        if (!cancelled) map.setView?.([coords.lat, coords.lng], DEFAULT_ZOOM);
      })
      .catch(() => {
        // No fix (denied/unsupported/timeout) — Kigali center stands.
      });
    return () => {
      cancelled = true;
    };
  }, [map]);
  return null;
};

const PanTo: React.FC<{ center: { lat: number; lng: number } }> = ({ center }) => {
  const map = useMap();
  useEffect(() => {
    map.setView?.([center.lat, center.lng], DEFAULT_ZOOM);
  }, [center.lat, center.lng, map]);
  return null;
};

export const MapCanvas: React.FC<MapCanvasProps> = ({
  center,
  centerOnUser = false,
  onMapClick,
  onUnavailable,
  onAvailable,
  children,
}) => {
  const { t } = useTranslation();
  // Device network, from the Capacitor source — NOT API reachability.
  // A dead Bimoto tunnel does not stop OpenStreetMap serving a tile.
  const { connected } = useNetworkStatus();
  const offlineMap = useOfflineMap();
  const cacheResolved = useMapCacheResolved();
  const [tilesFailed, setTilesFailed] = useState(false);

  // With a cached extract the map needs no network — never unavailable.
  // While the cache is still being consulted, decide nothing: a phone
  // that HAS the extract would otherwise flash the placeholder over a
  // map it already owns.
  const unavailable =
    cacheResolved && !offlineMap && (!connected || tilesFailed);
  const notified = useRef(false);

  useEffect(() => {
    if (unavailable && !notified.current) {
      notified.current = true;
      onUnavailable?.();
    } else if (!unavailable && notified.current) {
      notified.current = false;
      onAvailable?.();
    }
  }, [unavailable, onUnavailable, onAvailable]);

  return (
    <div className="fixed inset-x-0 top-0 bottom-16 z-0" data-testid="map-canvas">
      {/* Top, not bottom: this map is a full-viewport background with a
          BottomSheet sliding over it, and a chip at the bottom would sit
          under the sheet. */}
      <MapDownloadChip className="absolute inset-x-0 top-3 px-3" />
      {unavailable ? (
        <div
          className="w-full h-full bg-gray-100 flex items-start justify-center pt-16 px-6"
          data-testid="map-offline-hint"
        >
          <p className="text-sm text-gray-500 text-center max-w-xs">
            {t('map.offlineHint')}
          </p>
        </div>
      ) : (
        <MapContainer
          center={[center?.lat ?? KIGALI_CENTER.lat, center?.lng ?? KIGALI_CENTER.lng]}
          zoom={DEFAULT_ZOOM}
          zoomControl={false}
          scrollWheelZoom={true}
          className="w-full h-full"
          attributionControl={true}
        >
          <BaseTileLayer onTilesFailedChange={setTilesFailed} />
          {center && <PanTo center={center} />}
          {centerOnUser && !center && <CenterOnUser />}
          {onMapClick && <ClickCatcher onMapClick={onMapClick} />}
          {children}
        </MapContainer>
      )}
    </div>
  );
};

export default MapCanvas;
