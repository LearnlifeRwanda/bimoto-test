// HOOKS/USE-MAP-DOWNLOAD-OFFER.TS
//
// MAP-REACH G1 — one region's download offer, in the one shape every
// surface that offers it needs.
//
// The download machinery itself is NOT here and is not duplicated here.
// services/map-cache.ts owns starting, streaming, banking a partial,
// resuming with `bytes=<have>-` + If-Range, cancelling and discarding;
// this hook only subscribes to that store and hands back the four verbs
// and the derived state a piece of UI needs to draw an offer. There is
// exactly one implementation of a download in this app, and this is a
// window onto it, not a second one.
//
// WHY IT EXISTS: the offer used to be reachable only from the Profile
// card, because the wiring (which store slices, which verbs, in which
// order the states are decided) lived inside OfflineMapRegionRow. A
// chip on a blank map needs the same wiring and must not re-derive it —
// two derivations of "is this region downloading?" are two chances for
// the map chip and the Settings row to disagree about the same phone.
//
// THE PHASE ORDER IS LOAD-BEARING. It reproduces exactly the branch
// order OfflineMapRegionRow already decided its rendering by:
//
//   downloading → a stream is running right now
//   ready       → the archive is on this phone (status ready AND meta)
//   paused      → bytes survived an interrupted attempt
//   unprovisioned → this server has no archive for this region
//   idle        → nothing here yet, and it can be fetched
//
// A region that is BOTH downloading and partially banked is
// 'downloading', not 'paused' — the running stream is the truer thing
// to say. Reordering these changes what the card renders.

import { useCallback } from 'react';
import {
  useMapCacheStore,
  downloadRegionMap,
  cancelRegionDownload,
  discardRegionDownload,
  EMPTY_REGION_STATE,
  type MapCacheError,
  type MapCacheMeta,
  type RegionCacheState,
} from '../services/map-cache';

export type MapDownloadPhase =
  | 'downloading'
  | 'ready'
  | 'paused'
  | 'unprovisioned'
  | 'idle';

export interface MapDownloadOffer {
  /** Which of the five states this region is in — see the header. */
  phase: MapDownloadPhase;
  /** 0..1 while downloading; null when the total is unknown. */
  progress: number | null;
  /** `progress` as a whole percent, or null. What UI actually renders. */
  percent: number | null;
  /** Bytes of an interrupted attempt kept on disk, 0 when none. */
  partialBytes: number;
  /** The REAL byte size from GET /api/map/regions, or null when this
   *  server has not got this region. Never an estimate — see
   *  shared/constants/map-regions.ts on why no size is hardcoded. */
  sizeBytes: number | null;
  /** Size + date of the archive already on the phone, when there is one. */
  meta: MapCacheMeta | null;
  lastError: MapCacheError | null;
  /** The raw store slice, for the row's existing per-state rendering. */
  state: RegionCacheState;
  /** Start (or resume) the download. EXPLICIT TAPS ONLY — never call
   *  this from an effect. 30 MB on Kigali mobile data is the rider's
   *  money and the rider's choice. */
  start: () => void;
  /** Stop the stream, KEEPING the bytes so it can resume. */
  cancel: () => void;
  /** Throw the interrupted bytes away and free the space. */
  discard: () => void;
}

export function useMapDownloadOffer(regionKey: string): MapDownloadOffer {
  // Two narrow slices rather than the whole store: a progress tick
  // rewrites `regions` several times a second, and a component that
  // subscribed to the store object would re-render on every one of them
  // even when it only wanted the size.
  const state = useMapCacheStore((s) => s.regions[regionKey]);
  const available = useMapCacheStore((s) => s.available);

  const resolved = state ?? EMPTY_REGION_STATE;
  const { status, progress, meta, lastError, partialBytes } = resolved;
  const sizeBytes =
    available?.find((r) => r.key === regionKey)?.sizeBytes ?? null;

  const phase: MapDownloadPhase =
    status === 'downloading'
      ? 'downloading'
      : status === 'ready' && meta
        ? 'ready'
        : partialBytes > 0
          ? 'paused'
          : sizeBytes === null
            ? 'unprovisioned'
            : 'idle';

  const start = useCallback(() => {
    void downloadRegionMap(regionKey);
  }, [regionKey]);

  const cancel = useCallback(() => {
    cancelRegionDownload(regionKey);
  }, [regionKey]);

  const discard = useCallback(() => {
    void discardRegionDownload(regionKey);
  }, [regionKey]);

  return {
    phase,
    progress,
    percent: progress === null ? null : Math.round(progress * 100),
    partialBytes,
    sizeBytes,
    meta,
    lastError,
    state: resolved,
    start,
    cancel,
    discard,
  };
}
