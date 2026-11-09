// __TESTS__/MAP-CACHE-MIGRATION.TEST.TS
//
// MAP-RWANDA G4 — the pilot phone that already holds Kigali.
//
// This is the test the whole client generalisation is answerable to. A
// motari in Kigali has about 6 MB of map on their phone, downloaded over
// their own mobile data, and an app update must not cost them a single
// byte of it. Re-downloading "because the cache format changed" would be
// exactly the kind of quiet theft of a rider's bundle this codebase
// keeps refusing to commit.
//
// The migration is nothing, by construction: per-region entries are keyed
// BY REGION, and Kigali's region key is the string 'kigali' — the same
// string the old single-region cache used. So the row is already the row
// the new code looks for. No rewrite pass, no version bump, nothing that
// could fail halfway on a handset with no space.
//
// "Nothing happens" is still a claim about a rider's phone, so it is
// proved here against REAL Dexie over fake-indexeddb, with the row seeded
// exactly as the pre-MAP-RWANDA code wrote it.

// @vitest-environment node
//
// Node environment (not jsdom): fake-indexeddb persists Blobs via
// structuredClone, which handles Node's native Blob but mangles jsdom's —
// and this suite is about bytes surviving a round trip.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import { db } from '../db/dexie';
import {
  initMapCache,
  regionState,
  getRegionMapBlob,
  getCachedRegions,
  downloadRegionMap,
  deleteRegionMap,
  KIGALI_MAP_KEY,
  _resetMapCacheForTests,
} from '../services/map-cache';

/** ~6 MB of recognisable bytes, the size a pilot phone actually holds. */
const KIGALI_BYTES = new Uint8Array(6 * 1024 * 1024);
for (let i = 0; i < KIGALI_BYTES.length; i++) KIGALI_BYTES[i] = i % 251;

const DOWNLOADED_AT = '2026-07-20T09:00:00.000Z';

/** Exactly what the pre-MAP-RWANDA code wrote: key 'kigali', the blob,
 *  its size, and when it was fetched. Nothing else existed. */
async function seedPreMapRwandaKigali(): Promise<void> {
  await db.mapCache.put({
    key: 'kigali',
    blob: new Blob([KIGALI_BYTES], { type: 'application/octet-stream' }),
    sizeBytes: KIGALI_BYTES.byteLength,
    downloadedAt: DOWNLOADED_AT,
  });
}

beforeEach(async () => {
  _resetMapCacheForTests();
  apiFetchMock.mockReset();
  await db.mapCache.clear();
  await db.mapDownloads.clear();
});

describe('a phone that already holds Kigali loses nothing', () => {
  test('the existing row is found, with its bytes and its metadata intact', async () => {
    await seedPreMapRwandaKigali();

    await initMapCache();

    const state = regionState(KIGALI_MAP_KEY);
    expect(state.status).toBe('ready');
    expect(state.meta?.sizeBytes).toBe(KIGALI_BYTES.byteLength);
    // The download DATE survives too — a rider's "downloaded 20 July"
    // must not silently become today.
    expect(state.meta?.downloadedAt).toBe(DOWNLOADED_AT);

    // And the bytes are the same bytes, not merely the same length.
    const blob = await getRegionMapBlob(KIGALI_MAP_KEY);
    expect(blob).not.toBeNull();
    expect(blob!.size).toBe(KIGALI_BYTES.byteLength);
    const round = new Uint8Array(await blob!.arrayBuffer());
    expect(round.byteLength).toBe(KIGALI_BYTES.byteLength);
    expect(round[0]).toBe(KIGALI_BYTES[0]);
    expect(round[12345]).toBe(KIGALI_BYTES[12345]);
    expect(round[round.byteLength - 1]).toBe(KIGALI_BYTES[KIGALI_BYTES.byteLength - 1]);
    expect(Buffer.from(round).equals(Buffer.from(KIGALI_BYTES))).toBe(true);
  });

  test('NOTHING is re-downloaded — not one request', async () => {
    await seedPreMapRwandaKigali();
    await initMapCache();

    // The whole point. A cache migration that re-fetched 6 MB over Kigali
    // mobile data would be worse than no migration at all.
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  test('the row is not rewritten — the stored record is untouched', async () => {
    await seedPreMapRwandaKigali();
    const before = await db.mapCache.get('kigali');
    await initMapCache();
    const after = await db.mapCache.get('kigali');

    expect(after?.key).toBe('kigali');
    expect(after?.sizeBytes).toBe(before?.sizeBytes);
    expect(after?.downloadedAt).toBe(before?.downloadedAt);
    // Still exactly one row: the migration invented nothing.
    expect(await db.mapCache.count()).toBe(1);
  });

  test('it renders — the offline layer sees it as a cached region', async () => {
    await seedPreMapRwandaKigali();
    await initMapCache();

    const cached = await getCachedRegions();
    expect(cached.map((c) => c.region)).toEqual(['kigali']);
    expect(cached[0].blob.size).toBe(KIGALI_BYTES.byteLength);
  });

  test('adding a province leaves Kigali exactly where it was', async () => {
    await seedPreMapRwandaKigali();
    await initMapCache();

    const north = new Uint8Array(2048).fill(7);
    apiFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (n: string) =>
          n.toLowerCase() === 'content-length' ? String(north.byteLength) : null,
      },
      body: {
        getReader: () => {
          let done = false;
          return {
            read: async () => {
              if (done) return { done: true, value: undefined };
              done = true;
              return { done: false, value: north };
            },
          };
        },
      },
    });

    expect(await downloadRegionMap('north')).toBe(true);

    // Two regions now, and the old one is byte-for-byte what it was.
    expect(await db.mapCache.count()).toBe(2);
    expect(regionState('north').status).toBe('ready');
    expect(regionState(KIGALI_MAP_KEY).meta?.sizeBytes).toBe(KIGALI_BYTES.byteLength);
    expect(regionState(KIGALI_MAP_KEY).meta?.downloadedAt).toBe(DOWNLOADED_AT);
    const kigali = await getRegionMapBlob(KIGALI_MAP_KEY);
    expect(kigali!.size).toBe(KIGALI_BYTES.byteLength);

    // The province was fetched from its OWN path.
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/map/north.pmtiles',
      expect.anything(),
    );
  });

  test('deleting a province does not touch Kigali', async () => {
    await seedPreMapRwandaKigali();
    await db.mapCache.put({
      key: 'north',
      blob: new Blob([new Uint8Array(2048)]),
      sizeBytes: 2048,
      downloadedAt: '2026-08-01T00:00:00.000Z',
    });
    await initMapCache();

    await deleteRegionMap('north');

    expect(regionState('north').status).toBe('none');
    expect(regionState(KIGALI_MAP_KEY).status).toBe('ready');
    expect((await getRegionMapBlob(KIGALI_MAP_KEY))!.size).toBe(KIGALI_BYTES.byteLength);
    expect(await db.mapCache.count()).toBe(1);
  });
});

describe('the tables themselves are unchanged (LIVE-WIRE #161 survivors)', () => {
  test('regions live as ROWS in mapCache/mapDownloads, not as new tables', async () => {
    await seedPreMapRwandaKigali();
    await db.mapCache.put({
      key: 'north',
      blob: new Blob([new Uint8Array(16)]),
      sizeBytes: 16,
      downloadedAt: DOWNLOADED_AT,
    });

    // #161 excludes these two tables BY NAME from the user-switch clear,
    // because a downloaded map is a device asset rather than a user's
    // data. Per-region entries must therefore stay ROWS inside them — a
    // table-per-region would have quietly dropped out of that protection
    // and cost every rider their maps on the next user switch.
    const names = db.tables.map((t) => t.name);
    expect(names).toContain('mapCache');
    expect(names).toContain('mapDownloads');
    expect(names.filter((n) => n.startsWith('mapCache'))).toEqual(['mapCache']);
    expect(names.filter((n) => n.startsWith('mapDownloads'))).toEqual(['mapDownloads']);

    expect((await db.mapCache.toArray()).map((r) => r.key).sort()).toEqual([
      'kigali',
      'north',
    ]);
  });
});
