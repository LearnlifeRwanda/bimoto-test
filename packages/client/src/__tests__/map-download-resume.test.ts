// __TESTS__/MAP-DOWNLOAD-RESUME.TEST.TS
//
// MAP-TRUTH G4 — the download works like a download.
//
// It used to be "not resumable by design", which over Kigali mobile data
// meant a rider who reached 90% and rode into a tunnel started again from
// zero. These tests pin: progress that moves, resume from a partial with
// If-Range, a validator mismatch discarding the partial rather than
// splicing two archives, deletion that actually frees the space, and the
// storage check that refuses BEFORE spending the rider's data.

// @vitest-environment node
//
// Node environment (not jsdom), matching map-cache.test.ts: fake-indexeddb
// persists Blobs via structuredClone, which handles Node's native Blob but
// mangles jsdom's — and these tests need REAL blob round trips to prove a
// resumed download reassembles byte for byte. The service touches no DOM.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import {
  downloadRegionMap,
  deleteRegionMap,
  discardRegionDownload,
  regionState,
  checkStorageFor,
  useMapCacheStore,
  _resetMapCacheForTests,
  KIGALI_MAP_KEY,
} from '../services/map-cache';

// MAP-RWANDA G4 — resume is now per region; kigali is used here because
// it is the region an already-installed app holds, so this suite doubles
// as the proof that a pilot phone's resume behaviour did not change.
const KIGALI = KIGALI_MAP_KEY;
const downloadKigaliMap = () => downloadRegionMap(KIGALI);
const deleteKigaliMap = () => deleteRegionMap(KIGALI);
const discardMapDownload = () => discardRegionDownload(KIGALI);

import { db } from '../db/dexie';

/** Bytes over a real ArrayBuffer — TS 5.7+ made Uint8Array generic over
 *  its buffer, and only an ArrayBuffer-backed view is a valid BlobPart. */
function makeBytes(length: number, byteAt: (i: number) => number): Uint8Array<ArrayBuffer> {
  const view = new Uint8Array(new ArrayBuffer(length));
  for (let i = 0; i < length; i++) view[i] = byteAt(i);
  return view;
}

const ARCHIVE = makeBytes(300, (i) => i % 251);
const HALF = ARCHIVE.length / 2;

/** A Response whose body streams the given bytes in one chunk. */
function streamResponse(
  bytes: Uint8Array<ArrayBuffer>,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  const headers = new Map(
    Object.entries({
      'content-length': String(bytes.length),
      ...(init.headers ?? {}),
    }).map(([k, v]) => [k.toLowerCase(), v]),
  );
  let sent = false;
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    body: {
      getReader: () => ({
        read: async () =>
          sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes }),
      }),
    },
    blob: async () => new Blob([bytes]),
  };
}

function truncatedResponse(bytes: Uint8Array<ArrayBuffer>, claimedTotal: number) {
  const res = streamResponse(bytes, { headers: { 'content-length': String(claimedTotal) } });
  return res;
}

beforeEach(async () => {
  apiFetchMock.mockReset();
  _resetMapCacheForTests();
  await db.mapCache.clear();
  await db.mapDownloads.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('progress (MAP-TRUTH G4)', () => {
  test('progress moves and lands on a ready cache', async () => {
    apiFetchMock.mockResolvedValue(streamResponse(ARCHIVE));

    const ok = await downloadKigaliMap();

    expect(ok).toBe(true);
    const s = regionState(KIGALI);
    expect(s.status).toBe('ready');
    expect(s.meta?.sizeBytes).toBe(ARCHIVE.length);
    expect(s.partialBytes).toBe(0);
    // Nothing half-finished left behind.
    expect(await db.mapDownloads.get(KIGALI_MAP_KEY)).toBeUndefined();
  });
});

describe('resume (MAP-TRUTH G4)', () => {
  test('an interrupted download keeps its bytes instead of losing them', async () => {
    // Server promises 300 bytes but the connection dies after 150.
    apiFetchMock.mockResolvedValue(
      truncatedResponse(ARCHIVE.slice(0, HALF), ARCHIVE.length),
    );

    const ok = await downloadKigaliMap();

    expect(ok).toBe(false);
    expect(regionState(KIGALI).lastError).toBe('failed');
    expect(regionState(KIGALI).partialBytes).toBe(HALF);

    const partial = await db.mapDownloads.get(KIGALI_MAP_KEY);
    expect(partial?.receivedBytes).toBe(HALF);
    expect(partial?.totalBytes).toBe(ARCHIVE.length);
  });

  test('the next attempt asks for the REST, with If-Range', async () => {
    apiFetchMock.mockResolvedValueOnce(
      truncatedResponse(ARCHIVE.slice(0, HALF), ARCHIVE.length),
    );
    await downloadKigaliMap();

    // Second attempt: the server answers 206 with the remainder.
    apiFetchMock.mockResolvedValueOnce(
      streamResponse(ARCHIVE.slice(HALF), {
        status: 206,
        headers: {
          'content-range': `bytes ${HALF}-${ARCHIVE.length - 1}/${ARCHIVE.length}`,
          etag: '"abc-123"',
        },
      }),
    );

    const ok = await downloadKigaliMap();

    expect(ok).toBe(true);
    const [, init] = apiFetchMock.mock.calls[1] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Range).toBe(`bytes=${HALF}-`);

    // And the reassembled archive is the original, byte for byte — not
    // 150 bytes, and not 450.
    const entry = await db.mapCache.get(KIGALI_MAP_KEY);
    expect(entry?.sizeBytes).toBe(ARCHIVE.length);
    const bytes = new Uint8Array(await entry!.blob.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(ARCHIVE));
  });

  test('If-Range carries the validator the partial was fetched under', async () => {
    apiFetchMock.mockResolvedValueOnce(
      streamResponse(ARCHIVE.slice(0, HALF), {
        headers: { 'content-length': String(ARCHIVE.length), etag: '"v1"' },
      }),
    );
    await downloadKigaliMap();

    apiFetchMock.mockResolvedValueOnce(
      streamResponse(ARCHIVE.slice(HALF), {
        status: 206,
        headers: {
          'content-range': `bytes ${HALF}-${ARCHIVE.length - 1}/${ARCHIVE.length}`,
        },
      }),
    );
    await downloadKigaliMap();

    const [, init] = apiFetchMock.mock.calls[1] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['If-Range']).toBe('"v1"');
  });

  test('a 200 answer to a resume discards the partial rather than splicing', async () => {
    // The archive changed under us (update bundle swap). The server
    // declines the Range and sends the whole new file.
    apiFetchMock.mockResolvedValueOnce(
      truncatedResponse(ARCHIVE.slice(0, HALF), ARCHIVE.length),
    );
    await downloadKigaliMap();

    const NEW_ARCHIVE = makeBytes(200, () => 7);
    apiFetchMock.mockResolvedValueOnce(streamResponse(NEW_ARCHIVE, { status: 200 }));

    const ok = await downloadKigaliMap();

    expect(ok).toBe(true);
    const entry = await db.mapCache.get(KIGALI_MAP_KEY);
    // 200 exactly — the new archive alone. A splice would be 350.
    expect(entry?.sizeBytes).toBe(NEW_ARCHIVE.length);
    const bytes = new Uint8Array(await entry!.blob.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(NEW_ARCHIVE));
  });

  test('a 404 clears the partial — the server has no extract at all', async () => {
    apiFetchMock.mockResolvedValueOnce(
      truncatedResponse(ARCHIVE.slice(0, HALF), ARCHIVE.length),
    );
    await downloadKigaliMap();
    expect(await db.mapDownloads.get(KIGALI_MAP_KEY)).toBeDefined();

    apiFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: { get: () => null },
    });
    const ok = await downloadKigaliMap();

    expect(ok).toBe(false);
    expect(regionState(KIGALI).lastError).toBe('unavailable');
    expect(regionState(KIGALI).partialBytes).toBe(0);
    expect(await db.mapDownloads.get(KIGALI_MAP_KEY)).toBeUndefined();
  });
});

describe('freeing the space (MAP-TRUTH G4)', () => {
  test('discard removes the partial', async () => {
    apiFetchMock.mockResolvedValueOnce(
      truncatedResponse(ARCHIVE.slice(0, HALF), ARCHIVE.length),
    );
    await downloadKigaliMap();

    await discardMapDownload();

    expect(await db.mapDownloads.get(KIGALI_MAP_KEY)).toBeUndefined();
    expect(regionState(KIGALI).partialBytes).toBe(0);
  });

  test('delete frees BOTH the archive and any partial', async () => {
    apiFetchMock.mockResolvedValueOnce(streamResponse(ARCHIVE));
    await downloadKigaliMap();
    // A later interrupted "Update" leaves a partial alongside the cache.
    apiFetchMock.mockResolvedValueOnce(
      truncatedResponse(ARCHIVE.slice(0, HALF), ARCHIVE.length),
    );
    await downloadKigaliMap();
    expect(await db.mapDownloads.get(KIGALI_MAP_KEY)).toBeDefined();

    await deleteKigaliMap();

    // A "delete" that leaves half a download behind is not a delete —
    // the space is the entire reason a rider taps it.
    expect(await db.mapCache.get(KIGALI_MAP_KEY)).toBeUndefined();
    expect(await db.mapDownloads.get(KIGALI_MAP_KEY)).toBeUndefined();
    expect(regionState(KIGALI).status).toBe('none');
    expect(regionState(KIGALI).partialBytes).toBe(0);
  });
});

describe('storage check (MAP-TRUTH G4)', () => {
  // MAP-RWANDA G4 — the pre-flight check needs an expected size, and the
  // only honest one is the server's. There is no estimate in this app any
  // more: the old KIGALI_MAP_ESTIMATED_MB = 40 sat beside an archive of
  // about 6 MB. So availability is seeded here exactly as production has
  // it — OfflineMapRegionRow only renders a Download button for a region
  // whose real size came back from GET /api/map/regions, so a tap is not
  // reachable without this being known.
  beforeEach(() => {
    useMapCacheStore.setState({
      available: [{ key: KIGALI, sizeBytes: ARCHIVE.length }],
    });
  });

  test('refuses BEFORE spending the rider data when it cannot fit', async () => {
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      storage: { estimate: async () => ({ quota: 20 * 1024 * 1024, usage: 19 * 1024 * 1024 }) },
    });

    const ok = await downloadKigaliMap();

    expect(ok).toBe(false);
    expect(regionState(KIGALI).lastError).toBe('no-space');
    // The point: no request was ever made.
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  test('proceeds when there is room', async () => {
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      storage: { estimate: async () => ({ quota: 500 * 1024 * 1024, usage: 10 * 1024 * 1024 }) },
    });
    apiFetchMock.mockResolvedValue(streamResponse(ARCHIVE));

    expect(await downloadKigaliMap()).toBe(true);
  });

  test('an unknown quota is permission to try, not a refusal', async () => {
    // Browsers without storage.estimate() must not lose the feature; the
    // download's own quota failure stays the backstop.
    vi.stubGlobal('navigator', { ...globalThis.navigator, storage: undefined });
    apiFetchMock.mockResolvedValue(streamResponse(ARCHIVE));

    const verdict = await checkStorageFor(40 * 1024 * 1024);
    expect(verdict.fits).toBe(true);
    expect(verdict.quotaBytes).toBeNull();
    expect(await downloadKigaliMap()).toBe(true);
  });

  test('reports the real numbers it measured', async () => {
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      storage: { estimate: async () => ({ quota: 100 * 1024 * 1024, usage: 25 * 1024 * 1024 }) },
    });

    const verdict = await checkStorageFor(30 * 1024 * 1024);
    expect(verdict.quotaBytes).toBe(100 * 1024 * 1024);
    expect(verdict.usageBytes).toBe(25 * 1024 * 1024);
    expect(verdict.availableBytes).toBe(75 * 1024 * 1024);
    expect(verdict.fits).toBe(true);
  });
});
