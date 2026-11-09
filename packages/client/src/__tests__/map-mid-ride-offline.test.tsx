// __TESTS__/MAP-MID-RIDE-OFFLINE.TEST.TSX
//
// MAP-TRUTH G4 — the case that matters most.
//
// The network drops mid-ride. A motari is riding, watching the map. What
// must happen: the map keeps drawing, the route stays visible, and
// nothing flashes an error at someone who is on a bike.
//
// This is an in-ride surface (DriverApproachMap), which on main carried
// its own OSM TileLayer with no offline fallback at all and was missing
// from the dispatch's file inventory — so before G2 this scenario ended
// in a blank rectangle no matter what was cached.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

let tileLayers = 0;
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => {
    tileLayers += 1;
    return <div data-testid="osm-tile-layer" />;
  },
  Marker: () => <div data-testid="marker" />,
  Polyline: ({ positions }: { positions: unknown[] }) => (
    <div data-testid="polyline" data-count={positions.length} />
  ),
  useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn(), panTo: vi.fn() }),
  useMapEvents: () => ({}),
}));

vi.mock('leaflet', () => ({
  default: { divIcon: () => ({}) },
  divIcon: () => ({}),
}));

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

const useNetworkStatusMock = vi.fn(() => ({ connected: true, connectionType: 'cellular' }));
vi.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => useNetworkStatusMock(),
}));

// The road route the rider is following, already fetched before the
// signal went. It must not vanish because the network did.
const ROUTE = {
  coordinates: [
    [-1.9536, 30.0606],
    [-1.95, 30.061],
    [-1.9441, 30.0619],
  ] as [number, number][],
  distanceM: 3200,
  durationS: 660,
};
const useRouteDirectionsMock = vi.fn((): unknown => ROUTE);
vi.mock('../hooks/useRouteDirections', () => ({
  useRouteDirections: () => useRouteDirectionsMock(),
}));

import { DriverApproachMap } from '../components/journey/DriverApproachMap';
import { DriverNavMap } from '../components/map/DriverNavMap';

const CUSTOMER = { lat: -1.9441, lng: 30.0619 };
const DRIVER = { lat: -1.9536, lng: 30.0606 };
const FAKE_PMTILES = { fake: 'pmtiles' };

function renderRide() {
  return render(
    <DriverApproachMap
      customerLocation={CUSTOMER}
      driverLocation={DRIVER}
      etaMinutes={6}
      etaConfidence="high"
      isLive={true}
      driverName="Jean"
    />,
  );
}

beforeEach(() => {
  tileLayers = 0;
  useOfflineMapMock.mockReset().mockReturnValue(null);
  useNetworkStatusMock.mockReset().mockReturnValue({ connected: true, connectionType: 'cellular' });
  useRouteDirectionsMock.mockReset().mockReturnValue(ROUTE);
});

describe('mid-ride: the network drops (MAP-TRUTH G4)', () => {
  test('with the extract cached, the map keeps drawing when signal goes', () => {
    useOfflineMapMock.mockReturnValue(FAKE_PMTILES);
    const { rerender } = renderRide();
    expect(screen.getByTestId('offline-map-layer')).toBeInTheDocument();

    // Into a tunnel.
    useNetworkStatusMock.mockReturnValue({ connected: false, connectionType: 'none' });
    rerender(
      <DriverApproachMap
        customerLocation={CUSTOMER}
        driverLocation={DRIVER}
        etaMinutes={6}
        etaConfidence="high"
        isLive={false}
        driverName="Jean"
      />,
    );

    // Still a map, still local, and it never reached for the network.
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('offline-map-layer')).toBeInTheDocument();
    expect(tileLayers).toBe(0);
  });

  test('the route stays visible after the signal goes', () => {
    useOfflineMapMock.mockReturnValue(FAKE_PMTILES);
    renderRide();

    const drawn = screen.getAllByTestId('polyline');
    const road = drawn.find((p) => p.dataset.count === String(ROUTE.coordinates.length));
    expect(road).toBeDefined();

    // Where he is, and where he is going.
    expect(screen.getAllByTestId('marker').length).toBeGreaterThanOrEqual(2);
  });

  test('nothing flashes an error at a motari who is riding', () => {
    useOfflineMapMock.mockReturnValue(FAKE_PMTILES);
    useNetworkStatusMock.mockReturnValue({ connected: false, connectionType: 'none' });
    renderRide();

    // No offline placeholder, no can't-load hint, no error surface —
    // just the map. The ETA pill is allowed to go stale; a red banner
    // over the map of someone on a bike is not.
    expect(screen.queryByTestId('map-offline-hint')).toBeNull();
    expect(screen.queryByTestId('offline-map-error')).toBeNull();
    expect(screen.getByTestId('driver-approach-map')).toBeInTheDocument();
  });

  test('route unavailable mid-ride degrades to the calm dashed connector', () => {
    // Signal gone AND no cached route: the map still draws, and the
    // fallback is the shared visibly-not-a-route treatment, not an error.
    useOfflineMapMock.mockReturnValue(FAKE_PMTILES);
    useNetworkStatusMock.mockReturnValue({ connected: false, connectionType: 'none' });
    useRouteDirectionsMock.mockReturnValue(null);

    renderRide();

    expect(screen.getByTestId('offline-map-layer')).toBeInTheDocument();
    // A two-point crow line stands in for the road route.
    const drawn = screen.getAllByTestId('polyline');
    expect(drawn.some((p) => p.dataset.count === '2')).toBe(true);
  });

  test('without a cached extract the in-ride map still tries online tiles', () => {
    // The honest degradation: no extract means the raster layer, which
    // is what a rider who never downloaded the map should get.
    useOfflineMapMock.mockReturnValue(null);
    renderRide();

    expect(screen.getByTestId('osm-tile-layer')).toBeInTheDocument();
    expect(screen.queryByTestId('offline-map-layer')).toBeNull();
  });
});

// COCKPIT G2 — the same field case, now from the seat that was blind.
//
// Everything above is the map the PASSENGER watches. The motari's own
// two screens carried a grey rectangle, so "the network drops mid-ride"
// had no meaning for him — there was nothing to lose. These pin the same
// promise on his side: cached region in, tiles keep drawing, no network
// reached for, no error banner over someone who is on a bike.
describe('mid-ride: the motari\'s own map (COCKPIT G2)', () => {
  const OWN = { lat: -1.9536, lng: 30.0606 };
  const TARGET = { lat: -1.9441, lng: 30.0619 };

  test('with the region cached, the driver\'s map draws with no network', () => {
    useOfflineMapMock.mockReturnValue(FAKE_PMTILES);
    useNetworkStatusMock.mockReturnValue({ connected: false, connectionType: 'none' });

    render(<DriverNavMap origin={OWN} target={TARGET} targetKind="destination" />);

    expect(screen.getByTestId('driver-nav-map')).toBeInTheDocument();
    expect(screen.getByTestId('offline-map-layer')).toBeInTheDocument();
    // It never reached for a raster tile.
    expect(tileLayers).toBe(0);
    // And nothing shouted at him.
    expect(screen.queryByTestId('map-offline-hint')).toBeNull();
    expect(screen.queryByTestId('offline-map-error')).toBeNull();
  });

  test('offline with no route known, his map degrades to the calm dashed line', () => {
    useOfflineMapMock.mockReturnValue(FAKE_PMTILES);
    useNetworkStatusMock.mockReturnValue({ connected: false, connectionType: 'none' });
    useRouteDirectionsMock.mockReturnValue(null);

    render(<DriverNavMap origin={OWN} target={TARGET} targetKind="pickup" />);

    expect(screen.getByTestId('offline-map-layer')).toBeInTheDocument();
    const drawn = screen.getAllByTestId('polyline');
    expect(drawn.some((p) => p.dataset.count === '2')).toBe(true);
    expect(screen.getByTestId('route-fallback-notice')).toBeInTheDocument();
  });

  test('without a cached region his map still tries online tiles', () => {
    useOfflineMapMock.mockReturnValue(null);

    render(<DriverNavMap origin={OWN} target={TARGET} targetKind="pickup" />);

    expect(screen.getByTestId('osm-tile-layer')).toBeInTheDocument();
    expect(screen.queryByTestId('offline-map-layer')).toBeNull();
  });
});
