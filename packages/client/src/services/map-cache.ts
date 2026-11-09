// SERVICES/MAP-CACHE.TS
//
// MAP-CACHE G2 — download manager for the offline map extracts
// (single-file PMTiles archives served by OUR server; bulk-downloading
// OSM raster tiles would violate the OSM tile usage policy).
//
// The download is strictly opt-in (a tap in Profile), streams through
// apiFetch with progress events, and lands as one Blob per region in the
// Dexie `mapCache` store.
//
// MAP-TRUTH G4 — it RESUMES. It used to be "not resumable by design",
// which over Kigali mobile data meant a rider who got to 90% and hit a
// tunnel started again from zero. Interrupted downloads persist to the
// `mapDownloads` store and the next attempt asks for
// `bytes=<already-have>-` with If-Range set to the ETag the partial was
// fetched under. The server answers 206 to append, or 200 with the whole
// file if the archive changed under us — in which case the partial is
// dropped rather than spliced onto a different archive.
//
// It also checks the space FIRST. An Android WebView's quota is a
// fraction of free disk, not the whole card, so a large archive can
// genuinely not fit on a low-end handset. Asking navigator.storage
// before spending the user's data is the difference between a refusal
// they can act on and megabytes downloaded and then dropped.
//
// MAP-RWANDA G4 — and now there are six of them.
//
// Everything above used to key on the single string 'kigali'. It now
// keys on a region, and every piece of machinery — resume, cancel,
// space check, delete — is the SAME machinery, parameterised, rather
// than a second copy per region.
//
// THE MIGRATION, AND WHY IT IS NOT ONE
//
// A pilot phone already holds about 6 MB under the Dexie key 'kigali'.
// Per-region entries are keyed BY REGION, and Kigali's region key is
// 'kigali' — so the row that phone already has is already the row this
// code looks for. There is no data to move, no version bump, no rewrite
// pass that could fail halfway on a handset with no space. The
// generalisation was chosen this way precisely so that the migration
// could be nothing at all; a scheme that renamed the key would have made
// 6 MB of a rider's data depend on a rewrite completing.
//
// "Nothing happens" is still a claim about a rider's phone, so it is
// tested rather than asserted — see map-cache-migration.test.ts, which
// seeds the pre-MAP-RWANDA row and checks the bytes and the metadata
// survive, and that no re-download is attempted.
//
// Server-degradation contract: a server with no archive for a region
// answers 404 MAP_NOT_AVAILABLE. That surfaces here as status
// 'unavailable' — calm copy in Profile, online tiles everywhere else.
// Nothing depends on any archive existing.

import { create } from 'zustand';
import { LEGACY_MAP_REGION, isMapRegionKey } from '@bimoto/shared';
import { db } from '../db/dexie';
import type { MapDownloadPartial } from '../db/tables';
import { apiFetch } from '../lib/api';

/** The region the feature used to be. Exported because the Dexie row an
 *  already-installed app holds is keyed with exactly this string, and
 *  because the legacy route is still spelled with it. */
export const KIGALI_MAP_KEY = LEGACY_MAP_REGION;


export type MapCacheStatus =
  | 'none' // nothing cached
  | 'downloading'
  | 'ready'; // blob cached and usable

export type MapCacheError = 'unavailable' | 'failed' | 'no-space';

export interface MapCacheMeta {
  sizeBytes: number;
  downloadedAt: string;
}

/** One region's cache state. Every region has one of these; regions
 *  nobody has touched sit at the default below. */
export interface RegionCacheState {
  status: MapCacheStatus;
  /** 0..1 while downloading; null when the total is unknown. */
  progress: number | null;
  receivedBytes: number;
  meta: MapCacheMeta | null;
  /** Last download outcome, cleared on the next attempt.
   *  'unavailable' — server has no archive for this region;
   *  'no-space'   — the device's storage quota cannot hold it;
   *  'failed' — anything else (offline, 5xx, short read, quota). */
  lastError: MapCacheError | null;
  /** Bytes of an interrupted download kept on disk, 0 when none. The
   *  row says so instead of pretending it starts over. */
  partialBytes: number;
}

/** What the server says it has. Availability and size NEVER come from a
 *  constant in the app — only from here. */
export interface RegionAvailability {
  key: string;
  sizeBytes: number;
  lastModified?: string;
}

interface MapCacheState {
  /** False until Dexie has actually been consulted. Distinguishing
   *  "nothing cached" from "haven't looked yet" matters at first paint:
   *  a phone WITH an archive would otherwise flash a placeholder over a
   *  map it already had. */
  resolved: boolean;
  regions: Record<string, RegionCacheState>;
  /** null until /api/map/regions has answered; [] means a server with
   *  nothing provisioned, which is a correct state and not an error. */
  available: RegionAvailability[] | null;
  /** The availability request itself failed (offline, 5xx). Distinct
   *  from "the server has nothing". */
  availabilityFailed: boolean;
}

export const EMPTY_REGION_STATE: RegionCacheState = {
  status: 'none',
  progress: null,
  receivedBytes: 0,
  meta: null,
  lastError: null,
  partialBytes: 0,
};

export const useMapCacheStore = create<MapCacheState>(() => ({
  resolved: false,
  regions: {},
  available: null,
  availabilityFailed: false,
}));

/** One region's state, defaulted. Safe to call for any key. */
export function regionState(region: string): RegionCacheState {
  return useMapCacheStore.getState().regions[region] ?? EMPTY_REGION_STATE;
}

function setRegion(region: string, patch: Partial<RegionCacheState>): void {
  useMapCacheStore.setState((s) => ({
    regions: {
      ...s.regions,
      [region]: { ...(s.regions[region] ?? EMPTY_REGION_STATE), ...patch },
    },
  }));
}

// ---------------------------------------------------------------- partials

/** The kept partial download for a region, or null. Never throws — a
 *  device whose IndexedDB is unavailable simply has no partial. */
async function readPartial(region: string): Promise<MapDownloadPartial | null> {
  try {
    return (await db.mapDownloads.get(region)) ?? null;
  } catch {
    return null;
  }
}

async function savePartial(
  region: string,
  blob: Blob,
  totalBytes: number | null,
  etag: string | null,
): Promise<void> {
  try {
    await db.mapDownloads.put({
      key: region,
      blob,
      receivedBytes: blob.size,
      totalBytes,
      etag,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // Out of space for the partial — the next attempt just starts over.
  }
}

async function clearPartial(region: string): Promise<void> {
  try {
    await db.mapDownloads.delete(region);
  } catch {
    // Nothing to do; a stale partial is discarded on validator mismatch.
  }
}

// ------------------------------------------------------------------ space

/** How often banked progress is written to Dexie while streaming. Small
 *  enough that an interruption costs seconds of re-download, large
 *  enough not to thrash IndexedDB on a cheap handset. */
const PARTIAL_BANK_INTERVAL_BYTES = 4 * 1024 * 1024;

/** Bytes we require free before starting, over and above the archive:
 *  the blob is briefly held twice while Dexie commits it, plus slack. */
const STORAGE_HEADROOM_BYTES = 8 * 1024 * 1024;

export interface StorageVerdict {
  /** False only when we positively know it will not fit. */
  fits: boolean;
  quotaBytes: number | null;
  usageBytes: number | null;
  availableBytes: number | null;
}

/**
 * Ask the device whether the archive can fit BEFORE spending the user's
 * data on it. An Android WebView's quota is a fraction of free disk, not
 * the card's capacity, so this is a real constraint on a low-end handset
 * and not a formality — and it matters more now that a rider might hold
 * two provinces and want a third.
 *
 * Unknown is treated as permission to try: browsers that do not
 * implement storage.estimate() must not lose the feature, and the
 * download's own quota failure remains the backstop.
 */
export async function checkStorageFor(
  neededBytes: number,
): Promise<StorageVerdict> {
  const unknown: StorageVerdict = {
    fits: true,
    quotaBytes: null,
    usageBytes: null,
    availableBytes: null,
  };
  try {
    const estimate = await navigator?.storage?.estimate?.();
    const quota = estimate?.quota;
    const usage = estimate?.usage;
    if (typeof quota !== 'number' || typeof usage !== 'number') return unknown;
    const available = Math.max(0, quota - usage);
    return {
      fits: available >= neededBytes + STORAGE_HEADROOM_BYTES,
      quotaBytes: quota,
      usageBytes: usage,
      availableBytes: available,
    };
  } catch {
    return unknown;
  }
}

// ------------------------------------------------------------------- init

let initPromise: Promise<void> | null = null;
/** In-flight download controllers, one per region — two regions can be
 *  downloaded at once and cancelling one must not touch the other. */
const controllers = new Map<string, AbortController>();
/** Synchronous re-entry guard per region: the store's 'downloading'
 *  status only flips after the async Dexie read, so two rapid taps on
 *  the same row would otherwise both start a download. */
const inFlight = new Set<string>();
/** Cached Blob handles by region (IndexedDB Blobs are disk-backed —
 *  holding the handle is cheap; the bytes are read lazily by the pmtiles
 *  reader). */
const cachedBlobs = new Map<string, Blob>();

/**
 * Read cached-map metadata from Dexie once; safe to call repeatedly.
 *
 * Reads the WHOLE table rather than one key. An already-installed app's
 * 'kigali' row is picked up by this with no special case: its key is
 * already the region key, which is the entire migration.
 */
export function initMapCache(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const regions: Record<string, RegionCacheState> = {};
      try {
        for (const entry of await db.mapCache.toArray()) {
          if (!entry?.key) continue;
          cachedBlobs.set(entry.key, entry.blob);
          regions[entry.key] = {
            ...EMPTY_REGION_STATE,
            status: 'ready',
            meta: { sizeBytes: entry.sizeBytes, downloadedAt: entry.downloadedAt },
          };
        }
        // An interrupted download is honest state, not a hidden one: the
        // row offers "resume from N MB", not a fresh start.
        for (const partial of await db.mapDownloads.toArray()) {
          if (!partial?.key || regions[partial.key]?.status === 'ready') continue;
          regions[partial.key] = {
            ...EMPTY_REGION_STATE,
            partialBytes: partial.receivedBytes ?? 0,
          };
        }
      } catch {
        // IndexedDB unavailable (private mode, storage pressure) — the
        // feature is simply absent this session; online tiles carry on.
      }
      useMapCacheStore.setState({ resolved: true, regions });
    })();
  }
  return initPromise;
}

/**
 * Ask the server which regions it has, and how big they are.
 *
 * This is the ONLY source of availability and size. Nothing in the app
 * carries a region's size as a constant, because a typed number goes
 * stale and this one cannot: the server reads it off the file.
 */
export async function refreshRegionAvailability(): Promise<void> {
  try {
    const res = await apiFetch('/api/map/regions');
    if (!res.ok) {
      useMapCacheStore.setState({ availabilityFailed: true });
      return;
    }
    const body = (await res.json()) as { regions?: RegionAvailability[] };
    const regions = Array.isArray(body?.regions) ? body.regions : [];
    useMapCacheStore.setState({
      // Keep only what this app can name — a key with no display name in
      // any of the three languages has no row to appear in.
      available: regions.filter((r) => r && isMapRegionKey(r.key)),
      availabilityFailed: false,
    });
  } catch {
    // Offline, or a server too old to have the endpoint. Rows that are
    // already downloaded keep working; the rest say "not available yet".
    useMapCacheStore.setState({ availabilityFailed: true });
  }
}

/**
 * MAP-REACH G2 — availability, asked for ONCE per session.
 *
 * refreshRegionAvailability() above is deliberately unconditional: the
 * offline-map card asks on every open, because a region provisioned on
 * the server this morning must appear without a new app build. That is
 * right for a screen a rider opens on purpose.
 *
 * The map chip is different. It can be mounted on several map surfaces
 * at once, on screens the rider did not open to manage downloads, and an
 * unconditional refresh there would fire one request per mounted map per
 * navigation. This is the same call behind a session-level guard: the
 * first chip that needs a size asks, the rest wait on that promise.
 *
 * A failed attempt is NOT cached — `availabilityFailed` leaves the door
 * open, so a chip mounted after the connection comes back asks again.
 */
let availabilityPromise: Promise<void> | null = null;

export function ensureRegionAvailability(): Promise<void> {
  if (useMapCacheStore.getState().available !== null) return Promise.resolve();
  if (!availabilityPromise) {
    availabilityPromise = refreshRegionAvailability().finally(() => {
      if (useMapCacheStore.getState().available === null) {
        availabilityPromise = null;
      }
    });
  }
  return availabilityPromise;
}

/** The cached PMTiles blob for a region, or null. Consults Dexie on
 *  first call so the map layer works right after app boot. */
export async function getRegionMapBlob(region: string): Promise<Blob | null> {
  await initMapCache();
  return regionState(region).status === 'ready'
    ? (cachedBlobs.get(region) ?? null)
    : null;
}

/** Every region currently cached, with its blob. Used by the renderer to
 *  choose which archive covers where the map is looking. */
export async function getCachedRegions(): Promise<
  Array<{ region: string; blob: Blob }>
> {
  await initMapCache();
  const { regions } = useMapCacheStore.getState();
  const out: Array<{ region: string; blob: Blob }> = [];
  for (const [region, state] of Object.entries(regions)) {
    const blob = cachedBlobs.get(region);
    if (state.status === 'ready' && blob) out.push({ region, blob });
  }
  return out;
}

// --------------------------------------------------------------- download

/**
 * Download a region's archive (explicit user tap only — never call this
 * automatically). Streams for progress; stores the Blob on success.
 * Returns true when that region's cache is ready afterwards.
 */
export async function downloadRegionMap(region: string): Promise<boolean> {
  if (inFlight.has(region)) return false;
  inFlight.add(region);
  try {
    return await runDownload(region);
  } finally {
    inFlight.delete(region);
  }
}

async function runDownload(region: string): Promise<boolean> {
  await initMapCache();

  const controller = new AbortController();
  controllers.set(region, controller);

  // Resume from whatever survived the last attempt.
  const partial = await readPartial(region);
  let carried: Blob | null = partial?.blob ?? null;
  let received = carried?.size ?? 0;

  // Updated as bytes are banked, so a failure reports what survived.
  let keptPartialBytes = received;

  const fail = (kind: MapCacheError) => {
    setRegion(region, {
      status: cachedBlobs.has(region) ? 'ready' : 'none',
      progress: null,
      receivedBytes: 0,
      lastError: kind,
      partialBytes: keptPartialBytes,
    });
    controllers.delete(region);
    return false;
  };

  // The archive has to fit before we spend the rider's data on it. The
  // expected total comes from the server's own listing when we have it —
  // there is no estimated size in this app any more.
  const listed = useMapCacheStore
    .getState()
    .available?.find((r) => r.key === region);
  const expectedTotal = partial?.totalBytes ?? listed?.sizeBytes ?? 0;
  if (expectedTotal > 0) {
    const space = await checkStorageFor(Math.max(0, expectedTotal - received));
    if (!space.fits) return fail('no-space');
  }

  setRegion(region, {
    status: 'downloading',
    progress: partial?.totalBytes ? received / partial.totalBytes : 0,
    receivedBytes: received,
    lastError: null,
  });

  let blob: Blob;
  try {
    const headers: Record<string, string> = {};
    if (carried && received > 0) {
      headers.Range = `bytes=${received}-`;
      // If-Range makes the resume safe: a changed archive comes back as
      // a plain 200 and we start over, rather than splicing two files.
      if (partial?.etag) headers['If-Range'] = partial.etag;
    }

    const res = await apiFetch(`/api/map/${region}.pmtiles`, {
      signal: controller.signal,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });
    if (!res.ok) {
      // 404 MAP_NOT_AVAILABLE = this server has no archive for this
      // region — a dormant row, not an error worth alarming anyone about.
      if (res.status === 404) {
        await clearPartial(region);
        keptPartialBytes = 0;
        return fail('unavailable');
      }
      return fail('failed');
    }

    // 200 to a Range request means the server declined to resume (the
    // archive changed, or it never had our bytes) — drop the partial.
    const resuming = res.status === 206;
    if (!resuming) {
      carried = null;
      received = 0;
      keptPartialBytes = 0;
      await clearPartial(region);
    }

    const etag = res.headers.get('etag');
    const totalBytes = resolveTotalBytes(res, resuming, received);

    const body = res.body;
    if (body && typeof body.getReader === 'function') {
      const reader = body.getReader();
      const chunks: BlobPart[] = carried ? [carried] : [];
      let sinceBank = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          sinceBank += value.byteLength;
          setRegion(region, {
            receivedBytes: received,
            progress: totalBytes ? Math.min(received / totalBytes, 1) : null,
          });
          // Bank progress periodically so an interruption costs at most
          // one chunk of work, not the whole download.
          if (sinceBank >= PARTIAL_BANK_INTERVAL_BYTES) {
            sinceBank = 0;
            const soFar = new Blob(chunks, { type: 'application/octet-stream' });
            await savePartial(region, soFar, totalBytes, etag);
            keptPartialBytes = soFar.size;
          }
        }
      }
      if (totalBytes !== null && received < totalBytes) {
        // Short read (connection dropped mid-stream) — keep what we have
        // so the next attempt resumes instead of restarting.
        const soFar = new Blob(chunks, { type: 'application/octet-stream' });
        await savePartial(region, soFar, totalBytes, etag);
        keptPartialBytes = soFar.size;
        return fail('failed');
      }
      blob = new Blob(chunks, { type: 'application/octet-stream' });
    } else {
      // No streaming body (older WebView / test env) — one-shot blob.
      const whole = await res.blob();
      blob = carried
        ? new Blob([carried, whole], { type: 'application/octet-stream' })
        : whole;
    }
  } catch {
    // Abort, offline, unreachable — all restartable, and resumable:
    // whatever was banked above survives. (Cancel also lands here;
    // discardRegionDownload clears the partial when the user meant it.)
    return fail('failed');
  }

  try {
    const entry = {
      key: region,
      blob,
      sizeBytes: blob.size,
      downloadedAt: new Date().toISOString(),
    };
    await db.mapCache.put(entry);
    cachedBlobs.set(region, blob);
    await clearPartial(region);
    setRegion(region, {
      status: 'ready',
      progress: null,
      receivedBytes: 0,
      meta: { sizeBytes: entry.sizeBytes, downloadedAt: entry.downloadedAt },
      lastError: null,
      partialBytes: 0,
    });
    controllers.delete(region);
    return true;
  } catch {
    // Quota/storage failure writing the finished archive. The partial is
    // deliberately left alone: it is the closest thing to progress the
    // device still has room for.
    return fail('no-space');
  }
}

/** Total size of the WHOLE archive, from Content-Range on a resumed
 *  response or Content-Length on a fresh one. */
function resolveTotalBytes(
  res: Response,
  resuming: boolean,
  alreadyHave: number,
): number | null {
  if (resuming) {
    const contentRange = res.headers.get('content-range');
    const m = contentRange ? /\/(\d+)\s*$/.exec(contentRange) : null;
    if (m) return Number(m[1]);
    const remaining = Number(res.headers.get('content-length'));
    return Number.isFinite(remaining) && remaining > 0
      ? alreadyHave + remaining
      : null;
  }
  return Number(res.headers.get('content-length')) || null;
}

/**
 * Stop an in-flight download, KEEPING what has been fetched so it can be
 * resumed. The row says so in as many words — silently leaving tens of
 * megabytes on a phone whose owner just pressed Cancel would be exactly
 * the dishonesty about space this is meant to remove. To get the space
 * back, discardRegionDownload().
 */
export function cancelRegionDownload(region: string): void {
  controllers.get(region)?.abort();
}

/** Throw away an interrupted download and free its space. */
export async function discardRegionDownload(region: string): Promise<void> {
  cancelRegionDownload(region);
  await clearPartial(region);
  setRegion(region, {
    progress: null,
    receivedBytes: 0,
    lastError: null,
    partialBytes: 0,
  });
}

/**
 * Delete one region's cached archive; that area falls back to online
 * tiles. Frees the partial too — a "delete" that leaves 20 MB of
 * half-download behind is not a delete, and the space is the whole
 * reason to tap it.
 */
export async function deleteRegionMap(region: string): Promise<void> {
  await initMapCache();
  cancelRegionDownload(region);
  try {
    await db.mapCache.delete(region);
    await clearPartial(region);
  } finally {
    cachedBlobs.delete(region);
    setRegion(region, { ...EMPTY_REGION_STATE });
  }
}

/** Delete every cached archive. The ErrorBoundary's "clear caches" rung
 *  uses this: rebuildable local state goes, and an offline map is
 *  rebuildable by definition — it can be downloaded again. */
export async function deleteAllRegionMaps(): Promise<void> {
  await initMapCache();
  for (const region of controllers.keys()) cancelRegionDownload(region);
  try {
    await db.mapCache.clear();
    await db.mapDownloads.clear();
  } finally {
    cachedBlobs.clear();
    useMapCacheStore.setState({ regions: {} });
  }
}

/** Test-only: rewind module + store state between cases. */
export function _resetMapCacheForTests(): void {
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
  inFlight.clear();
  initPromise = null;
  availabilityPromise = null;
  cachedBlobs.clear();
  useMapCacheStore.setState({
    resolved: false,
    regions: {},
    available: null,
    availabilityFailed: false,
  });
}
