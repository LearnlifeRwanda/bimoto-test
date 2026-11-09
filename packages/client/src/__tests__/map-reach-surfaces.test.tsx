// __TESTS__/MAP-REACH-SURFACES.TEST.TSX
//
// MAP-REACH G2/G3/G5 — the reach itself.
//
// Three claims this dispatch makes that no single-component test can
// prove, because each of them is about a RELATIONSHIP between parts:
//
//   1. every map surface a rider or motari can reach mounts the offer;
//   2. a failed map offers the download rather than going silently
//      blank, and a completed download un-fails it with no navigation;
//   3. both doors — Profile and Settings → Maps & offline — mount the
//      SAME card, and nothing this dispatch added ever clears the
//      device-level map stores.
//
// Leaflet is stubbed to plain elements. These are not tests about map
// rendering; they are tests about which components are mounted where,
// which is exactly the thing that was wrong.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Leaflet and react-leaflet, reduced to nothing that needs a DOM box.
//
// The TileLayer stub is not inert: it fires the real `tileerror` handler
// `tileErrors.count` times on mount, so a test can drive a screenful of
// failures through the REAL BaseTileLayer and the REAL MapCanvas rather
// than asserting against a hand-set boolean. TILE_ERROR_THRESHOLD is 6.
const tileErrors = vi.hoisted(() => ({ count: 0 }));

vi.mock('react-leaflet', async () => {
  const R = await import('react');
  return {
  MapContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: ({ eventHandlers }: { eventHandlers?: Record<string, () => void> }) => {
    R.useEffect(() => {
      for (let i = 0; i < tileErrors.count; i += 1) eventHandlers?.tileerror?.();
    }, [eventHandlers]);
    return <div data-testid="tile-layer" />;
  },
  Marker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Polyline: () => null,
  Polygon: () => null,
  useMap: () => ({ setView: () => {}, fitBounds: () => {} }),
  useMapEvents: () => null,
  };
});
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('leaflet', () => ({
  default: { divIcon: () => ({}), icon: () => ({}), latLngBounds: () => ({}) },
  divIcon: () => ({}),
  icon: () => ({}),
}));
vi.mock('../components/map/OfflineMapLayer', () => ({
  OfflineMapLayer: () => <div data-testid="offline-map-layer" />,
}));

const cacheRows: Array<Record<string, unknown>> = [];
vi.mock('../db/dexie', () => ({
  db: {
    mapCache: {
      toArray: async () => cacheRows,
      put: async () => undefined,
      delete: async () => undefined,
      clear: async () => undefined,
    },
    mapDownloads: {
      toArray: async () => [],
      get: async () => undefined,
      put: async () => undefined,
      delete: async () => undefined,
      clear: async () => undefined,
    },
  },
}));

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  apiErrorFromResponse: async () => new Error('api'),
}));

const connectedMock = vi.fn(() => true);
vi.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ connected: connectedMock() }),
}));

import { MapCanvas } from '../components/map/MapCanvas';
import { MapsSettingsPage } from '../pages/shared/MapsSettingsPage';
import { _resetMapCacheForTests } from '../services/map-cache';
import { i18n } from './setup';
import en from '../../public/locales/en/translation.json';

i18n.addResourceBundle(
  'en',
  'translation',
  { map: en.map, common: en.common, settings: en.settings },
  true,
  true,
);

const SIX_MB = 6 * 1024 * 1024;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

function regionsResponse(regions: Array<{ key: string; sizeBytes: number }>) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      regions: regions.map((r) => ({
        ...r,
        nameKey: `map.regions.${r.key}`,
        lastModified: 'Mon, 10 Aug 2026 09:00:00 GMT',
        etag: `"${r.sizeBytes.toString(16)}"`,
      })),
    }),
  };
}

beforeEach(() => {
  _resetMapCacheForTests();
  cacheRows.length = 0;
  apiFetchMock.mockReset().mockImplementation(async (p: string) =>
    p === '/api/map/regions'
      ? regionsResponse([{ key: 'kigali', sizeBytes: SIX_MB }])
      : { ok: false, status: 404, headers: { get: () => null }, body: null },
  );
  connectedMock.mockReset().mockReturnValue(true);
  tileErrors.count = 0;
  window.localStorage.clear();
});

// ───────────────────────────────────────────────── 1. every surface

describe('the offer reaches every map surface (G2)', () => {
  // The measurement doc's finding was that three of five surfaces had no
  // offline path at all. BaseTileLayer closed that at the RENDERING
  // level. This closes it at the OFFER level: the component that tells a
  // rider the extract exists is now on each of them.
  //
  // Asserted against the source rather than by rendering four unrelated
  // component trees, each with its own props, sockets and geolocation:
  // the claim being made is literally "this component is mounted in
  // these files", and that is what is checked. A surface added later
  // without the chip fails this list.
  const SURFACES = [
    'components/map/MapCanvas.tsx',
    'components/map/DriverNavMap.tsx',
    'components/journey/RoutePreviewMap.tsx',
    'components/journey/DriverApproachMap.tsx',
  ];

  test.each(SURFACES)('%s mounts MapDownloadChip', (rel) => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', rel),
      'utf8',
    );
    expect(src).toMatch(/import \{ MapDownloadChip \}/);
    expect(src).toMatch(/<MapDownloadChip/);
  });

  test('LocationPickerMap inherits it through MapCanvas', () => {
    // It has no MapContainer of its own — it renders MapCanvas and
    // layers a picking overlay on top, so the chip comes with it.
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'components/map/LocationPickerMap.tsx'),
      'utf8',
    );
    expect(src).toMatch(/<MapCanvas/);
    expect(src).not.toMatch(/MapContainer/);
  });

  test('MapCanvas really renders the chip when there is no extract', async () => {
    render(<MapCanvas />);
    await waitFor(() =>
      expect(screen.getByTestId('map-download-chip')).toBeInTheDocument(),
    );
  });
});

// ────────────────────────────────────────────── 2. the latch, unlatched

describe('a failed map offers the fix, and recovers (G3)', () => {
  test('tiles failed + no extract → the placeholder AND the offer', async () => {
    // One screenful of tile failures (6) is all it takes — measured in
    // docs/map-visibility-measurement.md §1. The map goes gray, and the
    // rider is told what to do about it instead of being left with a
    // rectangle.
    tileErrors.count = 6;
    render(<MapCanvas />);

    await waitFor(() =>
      expect(screen.getByTestId('map-offline-hint')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('map-download-chip')).toBeInTheDocument();
  });

  test('a completed download clears the failure and renders the extract, with no navigation', async () => {
    // The whole loop, on one mounted screen: tiles fail → the offer is
    // there → one tap → the REAL download runs → the map comes back off
    // the local extract. Nothing navigates and nothing remounts.
    tileErrors.count = 6;
    apiFetchMock.mockImplementation(async (p: string) => {
      if (p === '/api/map/regions') {
        return regionsResponse([{ key: 'kigali', sizeBytes: 100 }]);
      }
      return {
        ok: true,
        status: 200,
        headers: {
          get: (n: string) =>
            n.toLowerCase() === 'content-length' ? '100' : null,
        },
        body: {
          getReader: () => {
            let done = false;
            return {
              read: async () => {
                if (done) return { done: true, value: undefined };
                done = true;
                return { done: false, value: new Uint8Array(100) };
              },
            };
          },
        },
      };
    });

    render(<MapCanvas />);

    // Failed, and offering the fix.
    await waitFor(() =>
      expect(screen.getByTestId('map-offline-hint')).toBeInTheDocument(),
    );
    const start = await screen.findByTestId('map-download-chip-start');

    await act(async () => {
      start.click();
    });

    // The latch let go: no placeholder, the local extract is drawn, the
    // raster layer is gone, and the offer has nothing left to offer.
    await waitFor(() =>
      expect(screen.getByTestId('offline-map-layer')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('map-offline-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tile-layer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('map-download-chip')).not.toBeInTheDocument();
  });

  test('offline with no extract → the unavailable line, and NO offer', async () => {
    // The existing behaviour is preserved exactly: a rider with no
    // network sees the calm hint. What they must not see is an offer to
    // download 6 MB they cannot download.
    connectedMock.mockReturnValue(false);
    render(<MapCanvas />);

    await waitFor(() =>
      expect(screen.getByTestId('map-offline-hint')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('map-download-chip')).not.toBeInTheDocument();
  });

  test('with an extract present the surface is unchanged — no offer, no placeholder', async () => {
    cacheRows.push({
      key: 'kigali',
      blob: new Blob([new Uint8Array(64)]),
      sizeBytes: SIX_MB,
      downloadedAt: '2026-07-20T09:00:00.000Z',
    });
    connectedMock.mockReturnValue(false);
    render(<MapCanvas />);

    await waitFor(() =>
      expect(screen.getByTestId('offline-map-layer')).toBeInTheDocument(),
    );
    // Offline AND fine, because the map is local. This is the invariant
    // "explicit-behaviour surfaces unchanged when the extract is present".
    expect(screen.queryByTestId('map-offline-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('map-download-chip')).not.toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────── 3. doors + invariant

describe('two doors, one card (G4)', () => {
  test('the Settings maps page mounts the same OfflineMapCard', async () => {
    render(<MapsSettingsPage />);
    await waitFor(() =>
      expect(screen.getByTestId('offline-map-card')).toBeInTheDocument(),
    );
    await settle();
  });

  test('ProfilePage still mounts it, and Settings routes to the new page', () => {
    const profile = fs.readFileSync(
      path.join(__dirname, '..', 'pages/shared/ProfilePage.tsx'),
      'utf8',
    );
    // Profile keeps its door: a rider who knows where it lives should
    // not have to relearn it.
    expect(profile).toMatch(/<OfflineMapCard \/>/);

    const settings = fs.readFileSync(
      path.join(__dirname, '..', 'pages/shared/SettingsPage.tsx'),
      'utf8',
    );
    expect(settings).toMatch(/settings-maps-offline/);
    expect(settings).toMatch(/navigate\('\/settings\/maps'\)/);

    // …and it is NOT inside the account-rights section at the bottom.
    // That section is deliberately hard to find; this one must not be.
    const rowAt = settings.indexOf('settings-maps-offline');
    const accountSectionAt = settings.indexOf('settings-delete-account');
    expect(rowAt).toBeGreaterThan(-1);
    expect(accountSectionAt).toBeGreaterThan(-1);
    expect(rowAt).toBeLessThan(accountSectionAt);

    const app = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');
    expect(app).toMatch(/path="\/settings\/maps"/);
  });
});

describe('the device-level invariant (G5)', () => {
  // session-reset.ts:36-38 states it: mapCache and mapDownloads survive
  // logout and erasure, because a 30-50 MB map is a DEVICE asset that
  // contains nothing about anyone. Re-downloading it on a borrowed phone
  // would be a data-cost injury with no privacy gain.
  //
  // This dispatch added new code that touches the map cache. None of it
  // may clear those two tables. Pinned mechanically, because the next
  // person adding a "clean up" path will not read the comment.
  const NEW_FILES = [
    'components/map/MapDownloadChip.tsx',
    'hooks/useMapDownloadOffer.ts',
    'pages/shared/MapsSettingsPage.tsx',
  ];

  test.each(NEW_FILES)('%s never clears the device-level stores', (rel) => {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    expect(src).not.toMatch(/mapCache\s*\.\s*clear/);
    expect(src).not.toMatch(/mapDownloads\s*\.\s*clear/);
    expect(src).not.toMatch(/deleteAllRegionMaps/);
    // Nor deletes a region behind the rider's back: deletion is the
    // card's confirmed, named action and nothing else's.
    expect(src).not.toMatch(/deleteRegionMap/);
  });

  test('the dismissal lives in prefs, not in Dexie', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'components/map/MapDownloadChip.tsx'),
      'utf8',
    );
    expect(src).toMatch(/useMapOfferDismissed/);
    expect(src).not.toMatch(/from '\.\.\/\.\.\/db\/dexie'/);
  });
});
