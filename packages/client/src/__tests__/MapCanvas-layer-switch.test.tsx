// __TESTS__/MAP-CANVAS-LAYER-SWITCH.TEST.TSX
//
// MAP-CACHE G3 — cache-hit layer selection:
//   - no cached extract → the existing OSM TileLayer, unchanged
//   - cached extract → the offline protomaps layer, NO network tiles
//   - cached extract + device offline → the map still renders (no
//     placeholder, no onUnavailable) — local tiles are not an outage
//   - no cache + offline → placeholder + onUnavailable (pre-existing
//     behaviour preserved)
//
// MAP-TRUTH G2 — two things moved under this test's feet, both
// deliberately. The layer choice itself now lives in the shared
// BaseTileLayer (so MiniMap, RoutePreviewMap and DriverApproachMap get
// it too), which MapCanvas renders; the assertions below are unchanged
// because the rendered output is unchanged. And "device offline" is now
// expressed through useNetworkStatus — the Capacitor device signal —
// instead of useUIStore.isOnline, which conflated a device with no
// network and a Bimoto API that did not answer.

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

vi.mock('leaflet', () => ({
  default: { divIcon: () => ({}) },
  divIcon: () => ({}),
}));

vi.mock('../hooks/useGeolocation', () => ({
  geolocation: {
    getCurrentPosition: vi.fn().mockRejectedValue(new Error('no fix')),
  },
}));

// The layer component itself talks to protomaps-leaflet imperatively —
// here only WHICH layer gets picked matters.
vi.mock('../components/map/OfflineMapLayer', () => ({
  OfflineMapLayer: () => <div data-testid="offline-map-layer" />,
}));

const useOfflineMapMock = vi.fn((): unknown => null);
vi.mock('../hooks/useOfflineMap', () => ({
  useOfflineMap: () => useOfflineMapMock(),
  // MAP-RWANDA G4 — BaseTileLayer now asks for every cached archive and
  // lets the layer pick the covering one. These suites control a single
  // "is anything cached" knob, so the plural view is derived from it.
  useOfflineMaps: () => {
    const m = useOfflineMapMock();
    return m ? [{ region: 'kigali', pmtiles: m }] : [];
  },
  useMapCacheResolved: () => true,
}));

const useNetworkStatusMock = vi.fn(() => ({ connected: true, connectionType: 'wifi' }));
vi.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => useNetworkStatusMock(),
}));

import { MapCanvas } from '../components/map/MapCanvas';

const FAKE_PMTILES = { fake: 'pmtiles' };
const DEVICE_OFFLINE = { connected: false, connectionType: 'none' as const };

beforeEach(() => {
  useOfflineMapMock.mockReset().mockReturnValue(null);
  useNetworkStatusMock.mockReset().mockReturnValue({ connected: true, connectionType: 'wifi' });
});

describe('MapCanvas layer selection (MAP-CACHE G3)', () => {
  test('no cached extract → OSM tile layer', () => {
    render(<MapCanvas />);
    expect(screen.getByTestId('osm-tile-layer')).toBeInTheDocument();
    expect(screen.queryByTestId('offline-map-layer')).not.toBeInTheDocument();
  });

  test('cached extract → offline layer, no network tiles', () => {
    useOfflineMapMock.mockReturnValue(FAKE_PMTILES);
    render(<MapCanvas />);
    expect(screen.getByTestId('offline-map-layer')).toBeInTheDocument();
    expect(screen.queryByTestId('osm-tile-layer')).not.toBeInTheDocument();
  });

  test('cached extract + offline device → map renders, no unavailable', () => {
    useOfflineMapMock.mockReturnValue(FAKE_PMTILES);
    useNetworkStatusMock.mockReturnValue(DEVICE_OFFLINE);
    const onUnavailable = vi.fn();
    render(<MapCanvas onUnavailable={onUnavailable} />);
    expect(screen.getByTestId('offline-map-layer')).toBeInTheDocument();
    expect(screen.queryByTestId('map-offline-hint')).not.toBeInTheDocument();
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  test('no cache + offline device → placeholder + onUnavailable (unchanged)', () => {
    useNetworkStatusMock.mockReturnValue(DEVICE_OFFLINE);
    const onUnavailable = vi.fn();
    render(<MapCanvas onUnavailable={onUnavailable} />);
    expect(screen.getByTestId('map-offline-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('map-container')).not.toBeInTheDocument();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });
});
