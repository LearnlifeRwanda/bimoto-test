// __TESTS__/MAP-CACHE.TEST.TS
//
// MAP-CACHE G2 — download manager coverage against REAL Dexie over
// fake-indexeddb (a genuine blob round-trip, not a mocked db):
//   - streaming download reports progress and lands the blob in mapCache
//   - 404 MAP_NOT_AVAILABLE → calm 'unavailable', nothing stored
//   - network failure mid-stream → restartable 'failed', second try wins
//   - cancel aborts and leaves no partial state
//   - delete removes the row and the layer source
//   - multi-megabyte blob survives the IndexedDB round trip intact

// @vitest-environment node
//
// Node environment (not jsdom): fake-indexeddb persists Blobs via
// structuredClone, which handles Node's native Blob but mangles jsdom's
// — and this suite needs a REAL blob round trip. The service under test
// touches no DOM.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import { db } from '../db/dexie';
import {
  useMapCacheStore,
  downloadRegionMap,
  deleteRegionMap,
  cancelRegionDownload,
  getRegionMapBlob,
  regionState,
  KIGALI_MAP_KEY,
  _resetMapCacheForTests,
} from '../services/map-cache';

// MAP-RWANDA G4 — the same coverage, now expressed per region. Kigali is
// used throughout because it is the region an already-installed app
// holds: if any of this changed for kigali, a pilot phone would notice.
const KIGALI = KIGALI_MAP_KEY;
const downloadKigaliMap = () => downloadRegionMap(KIGALI);
const deleteKigaliMap = () => deleteRegionMap(KIGALI);
const cancelMapDownload = () => cancelRegionDownload(KIGALI);
const getKigaliMapBlob = () => getRegionMapBlob(KIGALI);

function streamResponse(chunks: Uint8Array[], opts: { contentLength?: number | null } = {}) {
  const total =
    opts.contentLength === undefined
      ? chunks.reduce((n, c) => n + c.byteLength, 0)
      : opts.contentLength;
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-length' && total !== null ? String(total) : null) },
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined },
      }),
    },
  };
}

function errorResponse(status: number) {
  return { ok: false, status, headers: { get: () => null }, body: null };
}

async function until(pred: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('condition never became true');
}

beforeEach(async () => {
  _resetMapCacheForTests();
  apiFetchMock.mockReset();
  await db.mapCache.clear();
});

describe('downloadKigaliMap', () => {
  test('streams with progress and stores the blob', async () => {
    const chunks = [new Uint8Array(1000).fill(1), new Uint8Array(500).fill(2)];
    apiFetchMock.mockResolvedValue(streamResponse(chunks));

    const progressSeen: (number | null)[] = [];
    const unsub = useMapCacheStore.subscribe(() => {
      const s = regionState(KIGALI);
      if (s.status === 'downloading') progressSeen.push(s.progress);
    });

    const ok = await downloadKigaliMap();
    unsub();

    expect(ok).toBe(true);
    const state = regionState(KIGALI);
    expect(state.status).toBe('ready');
    expect(state.meta?.sizeBytes).toBe(1500);
    expect(state.meta?.downloadedAt).toBeTruthy();
    // Progress moved monotonically toward 1 while streaming.
    expect(progressSeen).toContain(1000 / 1500);
    expect(progressSeen).toContain(1);

    const row = await db.mapCache.get(KIGALI_MAP_KEY);
    expect(row?.sizeBytes).toBe(1500);
    expect(await getKigaliMapBlob()).not.toBeNull();
  });

  test('404 MAP_NOT_AVAILABLE ends calm: unavailable, nothing stored', async () => {
    apiFetchMock.mockResolvedValue(errorResponse(404));
    const ok = await downloadKigaliMap();
    expect(ok).toBe(false);
    const state = regionState(KIGALI);
    expect(state.status).toBe('none');
    expect(state.lastError).toBe('unavailable');
    expect(await db.mapCache.get(KIGALI_MAP_KEY)).toBeUndefined();
    expect(await getKigaliMapBlob()).toBeNull();
  });

  test('a failed download is restartable and the retry succeeds', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('network down'));
    expect(await downloadKigaliMap()).toBe(false);
    expect(regionState(KIGALI).lastError).toBe('failed');
    expect(regionState(KIGALI).status).toBe('none');

    apiFetchMock.mockResolvedValue(streamResponse([new Uint8Array(64).fill(7)]));
    expect(await downloadKigaliMap()).toBe(true);
    expect(regionState(KIGALI).status).toBe('ready');
    expect(regionState(KIGALI).lastError).toBeNull();
  });

  test('a short read (connection dropped mid-stream) fails restartably', async () => {
    // Content-Length promises 2000 bytes; the stream delivers 1000.
    apiFetchMock.mockResolvedValue(
      streamResponse([new Uint8Array(1000)], { contentLength: 2000 }),
    );
    expect(await downloadKigaliMap()).toBe(false);
    expect(regionState(KIGALI).lastError).toBe('failed');
    expect(await db.mapCache.get(KIGALI_MAP_KEY)).toBeUndefined();
  });

  test('cancel aborts the in-flight download with no partial state', async () => {
    let rejectFetch: (err: unknown) => void = () => {};
    apiFetchMock.mockImplementation(
      (_path: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          rejectFetch = reject;
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const downloading = downloadKigaliMap();
    await until(() => regionState(KIGALI).status === 'downloading');
    cancelMapDownload();
    expect(await downloading).toBe(false);
    expect(regionState(KIGALI).status).toBe('none');
    expect(await db.mapCache.get(KIGALI_MAP_KEY)).toBeUndefined();
    void rejectFetch;
  });

  test('a second call while downloading is a no-op', async () => {
    apiFetchMock.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(streamResponse([new Uint8Array(8)])), 10),
        ),
    );
    const first = downloadKigaliMap();
    // The re-entry guard is synchronous — a second tap in the same tick
    // must be a no-op, even before the store reaches 'downloading'.
    expect(await downloadKigaliMap()).toBe(false);
    expect(await first).toBe(true);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('deleteKigaliMap', () => {
  test('removes the cached blob and resets state', async () => {
    apiFetchMock.mockResolvedValue(streamResponse([new Uint8Array(256).fill(3)]));
    expect(await downloadKigaliMap()).toBe(true);

    await deleteKigaliMap();
    const state = regionState(KIGALI);
    expect(state.status).toBe('none');
    expect(state.meta).toBeNull();
    expect(await db.mapCache.get(KIGALI_MAP_KEY)).toBeUndefined();
    expect(await getKigaliMapBlob()).toBeNull();
  });
});

describe('blob storage round trip', () => {
  test('a multi-megabyte blob survives IndexedDB intact', async () => {
    // 8 MB in 1 MB chunks — a scaled stand-in for the ~40 MB extract
    // (kept small for CI time; the real-size check is the reviewer's
    // on-device acceptance).
    const MB = 1024 * 1024;
    const chunks = Array.from({ length: 8 }, (_, i) => new Uint8Array(MB).fill(i + 1));
    apiFetchMock.mockResolvedValue(streamResponse(chunks));

    expect(await downloadKigaliMap()).toBe(true);
    expect(regionState(KIGALI).meta?.sizeBytes).toBe(8 * MB);

    const row = await db.mapCache.get(KIGALI_MAP_KEY);
    expect(row?.blob.size).toBe(8 * MB);
    // Spot-check content integrity at both ends of the blob.
    const head = new Uint8Array(await row!.blob.slice(0, 4).arrayBuffer());
    const tail = new Uint8Array(await row!.blob.slice(8 * MB - 4).arrayBuffer());
    expect(Array.from(head)).toEqual([1, 1, 1, 1]);
    expect(Array.from(tail)).toEqual([8, 8, 8, 8]);
  });
});
