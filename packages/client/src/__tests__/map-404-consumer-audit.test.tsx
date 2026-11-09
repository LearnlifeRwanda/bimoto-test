// PROFILE-RESCUE G5 — the pmtiles 404 (MAP_NOT_AVAILABLE) is a STATE,
// not an error. The pilot server legitimately answers 404 until the
// ops bundle ships the extract; every consumer must stay calm:
//   - the Profile card shows its 'unavailable' line (covered in
//     OfflineMapCard.test.tsx);
//   - MAP-RWANDA G4 changed one thing here, deliberately: mounting the
//     card now makes exactly ONE request, to /api/map/regions, because
//     the list of provisioned regions is derived from the server's
//     filesystem rather than hardcoded — that is the whole point of the
//     design, and a card that never asked could not know what exists.
//     It must still download NOTHING without a tap, which is what this
//     file now pins;
//   - no retry storm: exactly one request per explicit user tap,
//     nothing automatic afterwards;
//   - no unhandled rejection escapes initMapCache or useOfflineMap;
//   - the map canvas falls back to online tiles (covered in
//     MapCanvas-layer-switch.test.tsx: "no cached extract → OSM
//     tile layer").
import 'fake-indexeddb/auto';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { i18n } from './setup';

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import { db } from '../db/dexie';
import {
  initMapCache,
  downloadRegionMap,
  regionState,
  _resetMapCacheForTests,
} from '../services/map-cache';
import { useOfflineMap } from '../hooks/useOfflineMap';
import { OfflineMapCard } from '../components/map/OfflineMapCard';

function mapNotAvailable404() {
  return {
    ok: false,
    status: 404,
    headers: { get: () => null },
    body: null,
    json: async () => ({
      error: { code: 'MAP_NOT_AVAILABLE', message: 'errors.mapNotAvailable' },
    }),
  };
}

const unhandledRejections: unknown[] = [];
const onUnhandled = (reason: unknown) => {
  unhandledRejections.push(reason);
};

beforeEach(async () => {
  _resetMapCacheForTests();
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue(mapNotAvailable404());
  await db.mapCache.clear();
  unhandledRejections.length = 0;
  process.on('unhandledRejection', onUnhandled);
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      map: {
        offline: {
          title: 'Offline map',
          intro: 'Keep maps on this phone',
          size: '{{mb}} MB',
          tierCountry: 'The whole country',
          tierProvince: 'Provinces',
          wifiHint: 'WiFi recommended',
          download: 'Download',
          notAvailable: 'Not available yet',
          failed: 'Download failed',
          downloading: 'Downloading',
          update: 'Update',
          delete: 'Delete',
          deleteConfirmNamed: 'Delete the map for {{region}}?',
          downloadedMeta: 'Downloaded {{date}} · {{mb}} MB',
        },
        regions: {
          rwanda: 'All of Rwanda',
          kigali: 'Kigali City',
          north: 'Northern Province',
          south: 'Southern Province',
          east: 'Eastern Province',
          west: 'Western Province',
        },
      },
      common: { cancel: 'Cancel' },
    },
    true,
    true,
  );
});

afterEach(async () => {
  // Let any stray promise settle before asserting none rejected.
  await new Promise((r) => setTimeout(r, 20));
  process.off('unhandledRejection', onUnhandled);
  expect(unhandledRejections).toEqual([]);
});

describe('pmtiles 404 consumer audit (PROFILE-RESCUE G5)', () => {
  test('mounting the card asks what regions exist — and downloads nothing', async () => {
    render(<OfflineMapCard />);
    await waitFor(() =>
      expect(screen.getByTestId('offline-map-row-kigali')).toBeInTheDocument(),
    );

    // Exactly one request, and it is the cheap JSON listing — never an
    // archive. Nothing on this screen may spend a rider's bundle without
    // an explicit tap.
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith('/api/map/regions');
    for (const call of apiFetchMock.mock.calls) {
      expect(String(call[0])).not.toContain('.pmtiles');
    }

    // A server with nothing provisioned (this one 404s the listing too)
    // leaves every row honestly unavailable rather than erroring.
    await waitFor(() =>
      expect(screen.getByTestId('offline-map-row-kigali-unavailable')).toBeInTheDocument(),
    );
    expect(regionState('kigali').status).toBe('none');
  });

  test('one explicit download tap = exactly one request; the 404 triggers no retries', async () => {
    const ok = await downloadRegionMap('kigali');
    expect(ok).toBe(false);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    const state = regionState('kigali');
    expect(state.status).toBe('none');
    expect(state.lastError).toBe('unavailable');

    // Nothing schedules itself afterwards.
    await new Promise((r) => setTimeout(r, 50));
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    // A second TAP asks again (restartable) — still one request per tap.
    await downloadRegionMap('kigali');
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });

  test('initMapCache resolves calmly even when IndexedDB itself fails', async () => {
    const getSpy = vi
      .spyOn(db.mapCache, 'toArray')
      .mockRejectedValue(new Error('idb dead'));
    try {
      await expect(initMapCache()).resolves.toBeUndefined();
      expect(regionState('kigali').status).toBe('none');
    } finally {
      getSpy.mockRestore();
    }
  });

  test('useOfflineMap yields null (online-tiles path) with no cache, no rejection', async () => {
    const { result } = renderHook(() => useOfflineMap());
    await waitFor(() => expect(regionState('kigali').status).toBe('none'));
    expect(result.current).toBeNull();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
