// COMPONENTS/MAP/OFFLINE-MAP-LAYER.TSX
//
// MAP-CACHE G3 — vector-tile layer rendered from a locally cached
// PMTiles blob (protomaps-leaflet GridLayer). Zero network: the archive
// is read by byte range straight out of the IndexedDB blob, so the map
// paints instantly on slow data and keeps working in airplane mode.
// Basic built-in 'light' flavor — labels readable at z12–z17 is the bar,
// not cartographic beauty.
//
// protomaps-leaflet references the global `L`; importing 'leaflet' here
// guarantees it is assigned (leaflet-src.js sets window.L = exports)
// before leafletLayer() subclasses L.GridLayer.
//
// MAP-RWANDA G4 — with several archives cached, ONE of them draws, and
// which one follows the map. The reasoning and the source evidence are
// in region-selection.ts; the short version is that protomaps-leaflet
// paints an opaque flavor background across every tile, so stacked
// layers erase each other rather than combining.
//
// Re-selection happens on moveend, not on every frame of a pan: swapping
// the layer mid-gesture would flicker, and a rider crossing a provincial
// boundary can wait until they stop moving.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import 'leaflet';
import { leafletLayer } from 'protomaps-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import type { PMTiles } from 'pmtiles';
import type { OfflineArchive } from '../../hooks/useOfflineMap';
import {
  pickRegion,
  type RegionBounds,
  type RegionCandidate,
} from './region-selection';

export const OFFLINE_MAP_ATTRIBUTION =
  '<a href="https://protomaps.com">Protomaps</a> &copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>';

export interface OfflineMapLayerProps {
  /** A single archive — the shape every caller used before there were
   *  several, kept so the five map surfaces did not all have to change. */
  pmtiles?: PMTiles;
  /** Every cached archive; the covering one is chosen from these. */
  archives?: OfflineArchive[];
}

/** Each archive's own coverage, read from its PMTiles v3 header. Cached
 *  per reader: the header is one range read, but it is a read. */
const boundsCache = new WeakMap<PMTiles, RegionBounds | null>();

async function boundsOf(pmtiles: PMTiles): Promise<RegionBounds | null> {
  const cached = boundsCache.get(pmtiles);
  if (cached !== undefined) return cached;
  try {
    const header = await pmtiles.getHeader();
    const bounds: RegionBounds = {
      minLon: header.minLon,
      minLat: header.minLat,
      maxLon: header.maxLon,
      maxLat: header.maxLat,
    };
    // A header with no usable bbox is worse than none — it would claim
    // to cover a point at the origin, in the Atlantic.
    const usable =
      [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat].every(
        (n) => typeof n === 'number' && Number.isFinite(n),
      ) && (bounds.maxLon > bounds.minLon || bounds.maxLat > bounds.minLat);
    const result = usable ? bounds : null;
    boundsCache.set(pmtiles, result);
    return result;
  } catch {
    boundsCache.set(pmtiles, null);
    return null;
  }
}

export const OfflineMapLayer: React.FC<OfflineMapLayerProps> = ({
  pmtiles,
  archives,
}) => {
  const map = useMap();

  const candidates = useMemo<OfflineArchive[]>(() => {
    if (archives && archives.length > 0) return archives;
    return pmtiles ? [{ region: 'kigali', pmtiles }] : [];
  }, [archives, pmtiles]);

  const [resolved, setResolved] = useState<RegionCandidate<PMTiles>[]>([]);

  // Read every archive's coverage once.
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      candidates.map(async (a) => ({
        region: a.region,
        bounds: await boundsOf(a.pmtiles),
        value: a.pmtiles,
      })),
    ).then((all) => {
      if (!cancelled) setResolved(all);
    });
    return () => {
      cancelled = true;
    };
  }, [candidates]);

  // Follow the map, but only when it settles. moveend rather than move:
  // swapping the layer mid-gesture would flicker, and a rider crossing a
  // provincial boundary can wait until they stop panning.
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const readCenter = useCallback(
    (m: LeafletMap) => {
      try {
        const c = m.getCenter();
        setCenter((prev) =>
          prev && prev.lat === c.lat && prev.lng === c.lng ? prev : { lat: c.lat, lng: c.lng },
        );
      } catch {
        // A map torn down mid-event has no centre; the previous choice
        // stands until it is replaced.
      }
    },
    [],
  );
  useMapEvents({
    moveend() {
      readCenter(map);
    },
  });
  useEffect(() => {
    readCenter(map);
  }, [map, readCenter]);

  const active = useMemo(() => pickRegion(resolved, center), [resolved, center]);

  useEffect(() => {
    if (!active) return;
    const layer = leafletLayer({
      url: active.value,
      flavor: 'light',
      lang: 'en',
      attribution: OFFLINE_MAP_ATTRIBUTION,
    });
    layer.addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, active]);

  return null;
};

export default OfflineMapLayer;
