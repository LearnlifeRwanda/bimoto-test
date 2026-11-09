// __TESTS__/MAP-CANVAS-VISIBILITY.TEST.TSX
//
// MAP-TRUTH G2 — the field complaint, as tests.
//
// "The map is frequently not visible in the app." Measured cause
// (docs/map-visibility-measurement.md): MapCanvas gated the whole map on
// useUIStore.isOnline, which App.tsx sets from `connection === 'online'`.
// The three-state's 'unreachable' means OUR API did not answer, and
// apiFetch reported failure on ANY rejected fetch including a deliberate
// abort — so a keystroke in the destination search box hid the map. None
// of that has anything to do with whether a tile can load.
//
// Each test below fails on main at b64f918.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="osm-tile-layer" />,
  useMap: () => ({ setView: vi.fn() }),
  useMapEvents: () => ({}),
}));

vi.mock('leaflet', () => ({ default: { divIcon: () => ({}) }, divIcon: () => ({}) }));

vi.mock('../hooks/useGeolocation', () => ({
  geolocation: { getCurrentPosition: vi.fn().mockRejectedValue(new Error('no fix')) },
}));

vi.mock('../components/map/OfflineMapLayer', () => ({
  OfflineMapLayer: () => <div data-testid="offline-map-layer" />,
}));

const useOfflineMapMock = vi.fn((): unknown => null);
const useMapCacheResolvedMock = vi.fn(() => true);
vi.mock('../hooks/useOfflineMap', () => ({
  useOfflineMap: () => useOfflineMapMock(),
  // MAP-RWANDA G4 — BaseTileLayer now asks for every cached archive and
  // lets the layer pick the covering one. These suites control a single
  // "is anything cached" knob, so the plural view is derived from it.
  useOfflineMaps: () => {
    const m = useOfflineMapMock();
    return m ? [{ region: 'kigali', pmtiles: m }] : [];
  },
  useMapCacheResolved: () => useMapCacheResolvedMock(),
}));

const useNetworkStatusMock = vi.fn(() => ({ connected: true, connectionType: 'wifi' }));
vi.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => useNetworkStatusMock(),
}));

import { MapCanvas } from '../components/map/MapCanvas';
import { useUIStore } from '../stores/ui.store';

const FAKE_PMTILES = { fake: 'pmtiles' };

beforeEach(() => {
  useOfflineMapMock.mockReset().mockReturnValue(null);
  useMapCacheResolvedMock.mockReset().mockReturnValue(true);
  useNetworkStatusMock.mockReset().mockReturnValue({ connected: true, connectionType: 'wifi' });
  useUIStore.setState({ isOnline: true });
});

describe('MapCanvas visibility (MAP-TRUTH G2)', () => {
  test('API unreachable but device online → the map still renders', () => {
    // Exactly the state a single aborted geocode request produces:
    // connectivity flips to 'unreachable', App.tsx mirrors that into
    // isOnline=false — while the phone's network is perfectly fine.
    useUIStore.setState({ isOnline: false });
    const onUnavailable = vi.fn();

    render(<MapCanvas onUnavailable={onUnavailable} />);

    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.queryByTestId('map-offline-hint')).not.toBeInTheDocument();
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  test('the map never reads the API-derived isOnline flag', () => {
    // Prose about the old bug is fine; importing the store is not.
    const src = readMapCanvasSource();
    expect(src).not.toMatch(/^import .*ui\.store/m);
    expect(src).not.toMatch(/useUIStore\s*\(/);
  });

  test('device truly offline, no cached extract → honest placeholder', () => {
    useNetworkStatusMock.mockReturnValue({ connected: false, connectionType: 'none' });
    const onUnavailable = vi.fn();

    render(<MapCanvas onUnavailable={onUnavailable} />);

    expect(screen.getByTestId('map-offline-hint')).toBeInTheDocument();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  test('device offline WITH a cached extract → the map still draws', () => {
    useOfflineMapMock.mockReturnValue(FAKE_PMTILES);
    useNetworkStatusMock.mockReturnValue({ connected: false, connectionType: 'none' });
    const onUnavailable = vi.fn();

    render(<MapCanvas onUnavailable={onUnavailable} />);

    expect(screen.getByTestId('offline-map-layer')).toBeInTheDocument();
    expect(screen.queryByTestId('map-offline-hint')).not.toBeInTheDocument();
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  test('no placeholder flashes while the map cache is still being read', () => {
    // First-paint ordering: a phone that HAS the extract reports null
    // from useOfflineMap until Dexie resolves. Deciding "no map" on that
    // frame flashed a placeholder over a map the phone already owned.
    useMapCacheResolvedMock.mockReturnValue(false);
    useNetworkStatusMock.mockReturnValue({ connected: false, connectionType: 'none' });
    const onUnavailable = vi.fn();

    render(<MapCanvas onUnavailable={onUnavailable} />);

    expect(screen.queryByTestId('map-offline-hint')).not.toBeInTheDocument();
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  test('recovery rearms: unavailable → available fires onAvailable', () => {
    useNetworkStatusMock.mockReturnValue({ connected: false, connectionType: 'none' });
    const onUnavailable = vi.fn();
    const onAvailable = vi.fn();

    const { rerender } = render(
      <MapCanvas onUnavailable={onUnavailable} onAvailable={onAvailable} />,
    );
    expect(onUnavailable).toHaveBeenCalledTimes(1);

    // Network comes back.
    useNetworkStatusMock.mockReturnValue({ connected: true, connectionType: 'cellular' });
    rerender(<MapCanvas onUnavailable={onUnavailable} onAvailable={onAvailable} />);

    expect(onAvailable).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
  });
});

function readMapCanvasSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('node:fs');
  const { resolve } = require('node:path');
  return readFileSync(
    resolve(__dirname, '..', 'components', 'map', 'MapCanvas.tsx'),
    'utf8',
  );
}
