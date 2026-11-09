// __TESTS__/DRIVER-NAV-MAP.TEST.TSX
//
// COCKPIT G2 — the composition on the motari's own screens.
//
// What is pinned here is what the driver actually gets where a grey
// rectangle used to be: a tile layer (the offline one when a region is
// cached, the raster one otherwise), the pin for where he is going, his
// own pin once GPS answers, and a line between them that is the real
// road when the directions proxy answers and the shared dashed
// connector — never an error — when it can't.

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
  Marker: ({ icon }: { icon?: { options?: { className?: string } } }) => (
    <div data-testid="marker" data-icon={icon?.options?.className} />
  ),
  Polyline: ({ positions }: { positions: unknown[] }) => (
    <div data-testid="polyline" data-count={positions.length} />
  ),
  useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn(), panTo: vi.fn() }),
}));

vi.mock('leaflet', () => {
  const divIcon = (opts: { className?: string }) => ({ options: opts });
  return { default: { divIcon }, divIcon };
});

vi.mock('../components/map/OfflineMapLayer', () => ({
  OfflineMapLayer: () => <div data-testid="offline-map-layer" />,
}));

const useOfflineMapMock = vi.fn((): unknown => null);
vi.mock('../hooks/useOfflineMap', () => ({
  useOfflineMap: () => useOfflineMapMock(),
  useOfflineMaps: () => {
    const m = useOfflineMapMock();
    return m ? [{ region: 'kigali', pmtiles: m }] : [];
  },
  useMapCacheResolved: () => true,
}));

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
  useRouteDirections: (...args: unknown[]) => useRouteDirectionsMock(...(args as [])),
}));

import { DriverNavMap } from '../components/map/DriverNavMap';

const OWN = { lat: -1.9536, lng: 30.0606 };
const TARGET = { lat: -1.9441, lng: 30.0619 };
const FAKE_PMTILES = { fake: 'pmtiles' };

beforeEach(() => {
  tileLayers = 0;
  useOfflineMapMock.mockReset().mockReturnValue(null);
  useRouteDirectionsMock.mockReset().mockReturnValue(ROUTE);
});

describe('DriverNavMap (COCKPIT G2)', () => {
  test('mounts a real map with his position, the target and the road route', () => {
    render(<DriverNavMap origin={OWN} target={TARGET} targetKind="pickup" />);

    expect(screen.getByTestId('driver-nav-map')).toBeInTheDocument();
    expect(screen.getByTestId('map-container')).toBeInTheDocument();

    // Where he is and where he is going.
    const markers = screen.getAllByTestId('marker');
    expect(markers).toHaveLength(2);
    expect(markers.map((m) => m.dataset.icon)).toContain('driver-nav-pickup-pin');
    expect(markers.map((m) => m.dataset.icon)).toContain('driver-nav-own-pin');

    // The road route, not a straight line.
    const drawn = screen.getAllByTestId('polyline');
    expect(drawn).toHaveLength(1);
    expect(drawn[0].dataset.count).toBe(String(ROUTE.coordinates.length));
    expect(screen.queryByTestId('route-fallback-notice')).toBeNull();
  });

  test('destination screens get the destination pin', () => {
    render(<DriverNavMap origin={OWN} target={TARGET} targetKind="destination" />);

    expect(screen.getByTestId('driver-nav-map').dataset.targetKind).toBe('destination');
    expect(
      screen.getAllByTestId('marker').map((m) => m.dataset.icon),
    ).toContain('driver-nav-destination-pin');
  });

  test('no road route degrades to the shared dashed connector plus its pill', () => {
    // The path the executor sandbox and a rural cell actually take: the
    // directions provider has no answer. Calm, not an error.
    useRouteDirectionsMock.mockReturnValue(null);
    render(<DriverNavMap origin={OWN} target={TARGET} targetKind="pickup" />);

    const drawn = screen.getAllByTestId('polyline');
    expect(drawn).toHaveLength(1);
    expect(drawn[0].dataset.count).toBe('2');
    expect(screen.getByTestId('route-fallback-notice')).toBeInTheDocument();
  });

  test('before the first GPS fix it still shows where he is going, and says it is looking', () => {
    render(<DriverNavMap origin={null} target={TARGET} targetKind="pickup" />);

    expect(screen.getByTestId('driver-nav-locating')).toBeInTheDocument();
    // The target pin is there; there is no own-position pin to draw yet,
    // and no line to nowhere.
    expect(screen.getAllByTestId('marker')).toHaveLength(1);
    expect(screen.queryAllByTestId('polyline')).toHaveLength(0);
    expect(screen.queryByTestId('route-fallback-notice')).toBeNull();
  });

  test('a cached region draws the map with no network at all', () => {
    useOfflineMapMock.mockReturnValue(FAKE_PMTILES);
    render(<DriverNavMap origin={OWN} target={TARGET} targetKind="pickup" />);

    expect(screen.getByTestId('offline-map-layer')).toBeInTheDocument();
    expect(tileLayers).toBe(0);
  });

  test('without a cached region it falls back to online tiles', () => {
    render(<DriverNavMap origin={OWN} target={TARGET} targetKind="destination" />);

    expect(screen.getByTestId('osm-tile-layer')).toBeInTheDocument();
    expect(screen.queryByTestId('offline-map-layer')).toBeNull();
  });

  test('the moving origin is quantised before it reaches the directions hook', () => {
    // Otherwise every few metres of a ride mints a new cache key and a
    // new request, draining the shared geocode rate limit.
    render(
      <DriverNavMap
        origin={{ lat: -1.95361234, lng: 30.06067891 }}
        target={TARGET}
        targetKind="pickup"
      />,
    );

    expect(useRouteDirectionsMock).toHaveBeenCalledWith(
      { lat: -1.954, lng: 30.061 },
      TARGET,
    );
  });

  test('page chrome passed as children renders over the tiles', () => {
    render(
      <DriverNavMap origin={OWN} target={TARGET} targetKind="destination">
        <span data-testid="gps-pill">GPS</span>
      </DriverNavMap>,
    );

    expect(screen.getByTestId('gps-pill')).toBeInTheDocument();
  });
});
