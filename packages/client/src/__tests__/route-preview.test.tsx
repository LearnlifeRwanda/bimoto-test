// __TESTS__/ROUTE-PREVIEW.TEST.TSX
//
// MAP-CACHE G4 — road-route preview on the picker map:
//   - directions success → solid polyline along the returned coordinates
//     + distance/minutes chip near the confirm control
//   - any failure (404 pre-bundle server / no-route, 503 key unset,
//     network throw) → the original straight dashed line, silently
//   - 503 flips the shared session flag so nothing keeps asking
//   - per point-pair the server is asked at most once per app run
//   - routeSummaryParts formatting (incl. the 1-minute floor)

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

let polylines: Array<{ positions: [number, number][]; pathOptions: Record<string, unknown> }> = [];
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  Marker: () => <div data-testid="marker" />,
  Polyline: (props: { positions: [number, number][]; pathOptions: Record<string, unknown> }) => {
    polylines.push(props);
    return <div data-testid="polyline" data-count={props.positions.length} />;
  },
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

vi.mock('../hooks/useOfflineMap', () => ({
  useOfflineMap: () => null,
  // MAP-RWANDA G4 — BaseTileLayer now asks for every cached archive and
  // lets the layer pick the covering one. These suites control a single
  // "is anything cached" knob, so the plural view is derived from it.
  useOfflineMaps: () => [],
  useMapCacheResolved: () => true,
}));

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import {
  LocationPickerMap,
  routeSummaryParts,
} from '../components/map/LocationPickerMap';
import { _resetRouteDirectionsForTests } from '../hooks/useRouteDirections';
import {
  isGeocodingUnavailable,
  _resetGeocodeAvailabilityForTests,
} from '../hooks/useGeocodeSearch';
import { useUIStore } from '../stores/ui.store';

const PICKUP = { lat: -1.9536, lng: 30.0606, address: 'Kimironko' };
const DEST = { lat: -1.9441, lng: 30.0619, address: 'Kacyiru' };
const ROUTE_COORDS: [number, number][] = [
  [-1.9536, 30.0606],
  [-1.95, 30.061],
  [-1.9441, 30.0619],
];

function directionsOk() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ coordinates: ROUTE_COORDS, distanceM: 3200, durationS: 660 }),
  };
}

function directionsError(status: number) {
  return { ok: false, status, json: async () => ({ error: { code: 'X' } }) };
}

function renderPicker() {
  return render(
    <LocationPickerMap pickup={PICKUP} destination={DEST} onConfirm={vi.fn()} />,
  );
}

beforeEach(() => {
  polylines = [];
  apiFetchMock.mockReset();
  _resetRouteDirectionsForTests();
  _resetGeocodeAvailabilityForTests();
  useUIStore.setState({ isOnline: true });
});

describe('route preview (MAP-CACHE G4)', () => {
  test('directions success draws the road polyline + summary chip', async () => {
    apiFetchMock.mockResolvedValue(directionsOk());
    renderPicker();

    await waitFor(() =>
      expect(screen.getByTestId('picker-route-summary')).toBeInTheDocument(),
    );
    const road = polylines.find((p) => p.positions.length === ROUTE_COORDS.length);
    expect(road).toBeTruthy();
    expect(road!.positions).toEqual(ROUTE_COORDS);
    expect(road!.pathOptions.dashArray).toBeUndefined(); // solid
    expect(apiFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/geocode/directions?'),
      expect.anything(),
    );
  });

  test('404 (pre-bundle server / no route) falls back to the straight line, calm', async () => {
    apiFetchMock.mockResolvedValue(directionsError(404));
    renderPicker();

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    // Straight dashed 2-point line; no chip, no error surface.
    await waitFor(() => {
      const straight = polylines.filter((p) => p.positions.length === 2);
      expect(straight.length).toBeGreaterThan(0);
      expect(straight[straight.length - 1].pathOptions.dashArray).toBe('6 8');
    });
    expect(screen.queryByTestId('picker-route-summary')).not.toBeInTheDocument();
  });

  test('503 falls back AND flips the shared geocoding-unavailable flag', async () => {
    apiFetchMock.mockResolvedValue(directionsError(503));
    renderPicker();

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    await waitFor(() => expect(isGeocodingUnavailable()).toBe(true));
    expect(screen.queryByTestId('picker-route-summary')).not.toBeInTheDocument();
  });

  test('network throw falls back silently to the straight line', async () => {
    apiFetchMock.mockRejectedValue(new Error('unreachable'));
    renderPicker();

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const straight = polylines.filter((p) => p.positions.length === 2);
    expect(straight.length).toBeGreaterThan(0);
    expect(screen.queryByTestId('picker-route-summary')).not.toBeInTheDocument();
  });

  test('offline: no directions request is made', () => {
    useUIStore.setState({ isOnline: false });
    // isOnline is the API-reachability flag. Since MAP-TRUTH G2 it no
    // longer hides the map (that is the device's network signal now),
    // but it does still — correctly — stop us asking an unreachable API
    // for directions. That is what this test pins.
    renderPicker();
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('picker-route-summary')).not.toBeInTheDocument();
  });

  test('a point-pair is asked at most once per app run (memory cache)', async () => {
    apiFetchMock.mockResolvedValue(directionsOk());
    const first = renderPicker();
    await waitFor(() =>
      expect(screen.getByTestId('picker-route-summary')).toBeInTheDocument(),
    );
    first.unmount();

    renderPicker();
    await waitFor(() =>
      expect(screen.getByTestId('picker-route-summary')).toBeInTheDocument(),
    );
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('routeSummaryParts', () => {
  test('formats km with one decimal and rounds minutes', () => {
    expect(routeSummaryParts(3200, 660)).toEqual({ km: '3.2', min: '11' });
    expect(routeSummaryParts(12345, 1000)).toEqual({ km: '12.3', min: '17' });
  });

  test('minutes floor at 1 — never "0 min"', () => {
    expect(routeSummaryParts(200, 20)).toEqual({ km: '0.2', min: '1' });
  });
});
