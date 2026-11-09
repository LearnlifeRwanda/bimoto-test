// COMPONENTS/MAP/BASE-TILE-LAYER.TSX
//
// MAP-TRUTH G2 — the base map, for every surface that has one.
//
// Before this, only MapCanvas could fall back to the cached Kigali
// extract; MiniMap, RoutePreviewMap and DriverApproachMap each carried
// their own OSM <TileLayer> and went blank the moment tiles could not
// load — including the in-ride approach map a customer watches while
// their motari rides toward them. Every surface now renders this
// component instead, so the offline extract reaches all of them and the
// raster source is named in exactly one file (tile-source.ts).
//
// Layer choice, in order:
//   1. a cached Kigali extract  → the local vector layer, zero network;
//   2. otherwise                → OSM raster, the documented fallback.
//
// Tile-failure reporting is TWO-WAY. The old MapCanvas latched
// `tilesFailed` to true and never cleared it, so one bad burst grayed
// the map for the rest of the component's life even after tiles came
// back. Here a successful tileload both resets the error count and
// reports recovery, so a passing tunnel or a cell handover costs a
// moment, not the session.

import React, { useCallback, useEffect, useRef } from 'react';
import { TileLayer } from 'react-leaflet';
import { useOfflineMaps } from '../../hooks/useOfflineMap';
import { OfflineMapLayer } from './OfflineMapLayer';
import { OSM_ATTRIBUTION, OSM_TILE_URL, TILE_ERROR_THRESHOLD } from './tile-source';

export interface BaseTileLayerProps {
  /**
   * Called with true when a screenful of raster tiles has failed with no
   * successful load in between, and with false as soon as one loads
   * again. Never called while the cached extract is in use — local tiles
   * cannot suffer a network outage, so that path has no failure state.
   */
  onTilesFailedChange?: (failed: boolean) => void;
}

export const BaseTileLayer: React.FC<BaseTileLayerProps> = ({
  onTilesFailedChange,
}) => {
  // MAP-RWANDA G4 — every cached archive is handed down; the layer picks
  // the one covering the view. A rider holding two provinces gets the
  // right one without this component knowing anything about geography.
  const offlineMaps = useOfflineMaps();
  const offlineMap = offlineMaps.length > 0;
  const errorCount = useRef(0);
  const failed = useRef(false);

  const report = useCallback(
    (next: boolean) => {
      if (failed.current === next) return;
      failed.current = next;
      onTilesFailedChange?.(next);
    },
    [onTilesFailedChange],
  );

  // Swapping to the local extract clears any raster failure — the map
  // is working again, by a different route.
  useEffect(() => {
    if (offlineMap) {
      errorCount.current = 0;
      report(false);
    }
  }, [offlineMap, report]);

  if (offlineMap) return <OfflineMapLayer archives={offlineMaps} />;

  return (
    <TileLayer
      url={OSM_TILE_URL}
      attribution={OSM_ATTRIBUTION}
      eventHandlers={{
        tileerror: () => {
          errorCount.current += 1;
          if (errorCount.current >= TILE_ERROR_THRESHOLD) report(true);
        },
        tileload: () => {
          errorCount.current = 0;
          report(false);
        },
      }}
    />
  );
};

export default BaseTileLayer;
