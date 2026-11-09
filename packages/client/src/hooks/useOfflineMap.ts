// HOOKS/USE-OFFLINE-MAP.TS
//
// MAP-CACHE G3 — the cached extracts as ready-to-render PMTiles handles.
// Consults Dexie on first use (so the offline layer works right after
// boot) and tracks the map-cache store, so a completed download or a
// delete flips every open map between the offline layer and online tiles
// live.
//
// MAP-RWANDA G4 — plural. A rider may hold their province, their city
// and the whole country at once; every cached archive is offered here
// and the layer picks the one covering the view (see
// components/map/region-selection.ts for why one is picked rather than
// all being stacked).

import { useEffect, useState } from 'react';
import { PMTiles, FileSource } from 'pmtiles';
import {
  useMapCacheStore,
  getCachedRegions,
  initMapCache,
} from '../services/map-cache';

export interface OfflineArchive {
  region: string;
  pmtiles: PMTiles;
}

// One PMTiles reader per blob, shared across every map on screen — the
// reader caches the archive's header/directories internally, so throwing
// these away per component would re-read the header on every mount.
const readers = new Map<string, { blob: Blob; pmtiles: PMTiles }>();

function readerFor(region: string, blob: Blob): PMTiles {
  const existing = readers.get(region);
  if (existing && existing.blob === blob) return existing.pmtiles;
  const pmtiles = new PMTiles(
    new FileSource(new File([blob], `${region}.pmtiles`)),
  );
  readers.set(region, { blob, pmtiles });
  return pmtiles;
}

/**
 * MAP-TRUTH G2 — false until the map cache has actually been consulted.
 *
 * useOfflineMap() returns null for both "no extract" and "haven't looked
 * yet", which are very different things at first paint: a phone WITH an
 * extract cached still reported null for the first frames while Dexie
 * resolved, so any surface that decided "no map is possible" on that
 * frame flashed a placeholder over a map it already had. Callers that
 * make such a decision must wait for this to be true.
 */
export function useMapCacheResolved(): boolean {
  const resolved = useMapCacheStore((s) => s.resolved);
  useEffect(() => {
    if (!resolved) void initMapCache();
  }, [resolved]);
  return resolved;
}

/** Every cached archive, as PMTiles handles. */
export function useOfflineMaps(): OfflineArchive[] {
  const regions = useMapCacheStore((s) => s.regions);
  const resolved = useMapCacheStore((s) => s.resolved);
  const [archives, setArchives] = useState<OfflineArchive[]>([]);

  useEffect(() => {
    if (!resolved) {
      void initMapCache();
      return;
    }
    let cancelled = false;
    void getCachedRegions().then((cached) => {
      if (cancelled) return;
      setArchives(
        cached.map(({ region, blob }) => ({
          region,
          pmtiles: readerFor(region, blob),
        })),
      );
    });
    return () => {
      cancelled = true;
    };
    // `regions` is the dependency that matters: a finished download or a
    // delete changes it, and every open map re-resolves.
  }, [resolved, regions]);

  return archives;
}

/**
 * One cached archive, or null when nothing is cached.
 *
 * Surfaces outside a MapContainer (MapCanvas deciding whether the map is
 * possible at all) cannot know the viewport, so this answers the simpler
 * question — is there any offline map? The choice of WHICH archive to
 * draw is made inside the map, by OfflineMapLayer.
 */
export function useOfflineMap(): PMTiles | null {
  const archives = useOfflineMaps();
  return archives[0]?.pmtiles ?? null;
}
