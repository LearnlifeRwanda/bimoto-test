// __TESTS__/TRUE-ROUTES-MAPS.TEST.TSX
//
// TRUE-ROUTES G4 — the three formerly-dark maps consume the directions
// proxy and render honestly:
//   - road geometry → SOLID polyline along the returned coordinates;
//   - hook returns null (offline / unreachable / no route) → dashed
//     muted straight connector + the shared "route unavailable" pill —
//     never a solid line between two points;
//   - booking preview (RoutePreviewMap, no stops): alternatives render
//     as a choice — chosen solid, others dimmed, chips with distance
//     and duration, tap to switch; a single returned route renders
//     without chips (provider may find no alternative).
//
// (MiniMap was a third surface here until DEADWOOD G2 retired it: it
// was never imported by any screen, so its coverage proved nothing
// about what a rider sees.)

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

let polylines: Array<{
  positions: [number, number][];
  pathOptions: Record<string, unknown>;
  eventHandlers?: { click?: () => void };
}> = [];
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  Marker: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="marker">{children}</div>
  ),
  Polyline: (props: {
    positions: [number, number][];
    pathOptions: Record<string, unknown>;
    eventHandlers?: { click?: () => void };
  }) => {
    polylines.push(props);
    return (
      <div
        data-testid="polyline"
        data-count={props.positions.length}
        data-dash={String(props.pathOptions.dashArray ?? '')}
      />
    );
  },
  Popup: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="popup">{children}</div>
  ),
  useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn(), panTo: vi.fn() }),
}));

vi.mock('leaflet', () => ({
  default: { divIcon: () => ({}) },
  divIcon: () => ({}),
}));

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import { RoutePreviewMap } from '../components/journey/RoutePreviewMap';
import { DriverApproachMap } from '../components/journey/DriverApproachMap';
import { _resetRouteDirectionsForTests } from '../hooks/useRouteDirections';
import { _resetRouteAlternativesForTests } from '../hooks/useRouteAlternatives';
import { _resetGeocodeAvailabilityForTests } from '../hooks/useGeocodeSearch';
import { useUIStore } from '../stores/ui.store';

const PICKUP = { lat: -1.9536, lng: 30.0606 };
const DEST = { lat: -1.9441, lng: 30.0619 };

const ROUTE_A: [number, number][] = [
  [-1.9536, 30.0606],
  [-1.95, 30.061],
  [-1.9441, 30.0619],
];
const ROUTE_B: [number, number][] = [
  [-1.9536, 30.0606],
  [-1.951, 30.058],
  [-1.947, 30.059],
  [-1.9441, 30.0619],
];

function singleRouteOk(coordinates: [number, number][] = ROUTE_A) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ coordinates, distanceM: 3200, durationS: 660 }),
  };
}

function alternativesOk(routes: [number, number][][]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      routes: routes.map((coordinates, i) => ({
        coordinates,
        distanceM: 3200 + i * 500,
        durationS: 660 + i * 120,
      })),
    }),
  };
}

// Three visual classes (see route-style.ts): emphasized road (solid,
// full opacity), dimmed alternative (solid but translucent), fallback
// connector (dashed). The mock records pathOptions verbatim.
function solidPolylines() {
  return polylines.filter(
    (p) => p.pathOptions.dashArray === undefined && p.pathOptions.opacity === undefined,
  );
}

function dimmedPolylines() {
  return polylines.filter(
    (p) => p.pathOptions.dashArray === undefined && p.pathOptions.opacity !== undefined,
  );
}

function dashedPolylines() {
  return polylines.filter((p) => p.pathOptions.dashArray !== undefined);
}

beforeEach(() => {
  polylines = [];
  apiFetchMock.mockReset();
  _resetRouteDirectionsForTests();
  _resetRouteAlternativesForTests();
  _resetGeocodeAvailabilityForTests();
  useUIStore.setState({ isOnline: true });
});

describe('RoutePreviewMap (booking preview)', () => {
  function renderPreview() {
    return render(
      <RoutePreviewMap
        pickupLat={PICKUP.lat}
        pickupLng={PICKUP.lng}
        pickupName="Kimironko"
        destinationLat={DEST.lat}
        destinationLng={DEST.lng}
        destinationName="Kacyiru"
        legs={[]}
      />,
    );
  }

  test('road geometry renders as the solid route; no fallback pill', async () => {
    apiFetchMock.mockResolvedValue(alternativesOk([ROUTE_A]));
    renderPreview();
    await waitFor(() => {
      const solid = solidPolylines();
      expect(solid).toHaveLength(1);
      expect(solid[0].positions).toEqual(ROUTE_A);
    });
    expect(screen.queryByTestId('route-fallback-notice')).not.toBeInTheDocument();
    // A single returned route is not a choice — no chips, no hint.
    expect(screen.queryByTestId('route-alternatives')).not.toBeInTheDocument();
    expect(screen.queryByTestId('route-choice-hint')).not.toBeInTheDocument();
    // The preview asked for alternatives explicitly.
    expect(String(apiFetchMock.mock.calls[0][0])).toContain('alternatives=3');
  });

  test('hook null → dashed muted connector + "route unavailable" pill, never a solid line', async () => {
    apiFetchMock.mockRejectedValue(new Error('unreachable'));
    renderPreview();
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(solidPolylines()).toHaveLength(0);
    const dashed = dashedPolylines();
    expect(dashed.length).toBeGreaterThan(0);
    expect(dashed[dashed.length - 1].positions).toEqual([
      [PICKUP.lat, PICKUP.lng],
      [DEST.lat, DEST.lng],
    ]);
    expect(screen.getByTestId('route-fallback-notice')).toBeInTheDocument();
  });

  test('alternatives render as a choice: chosen solid, others dimmed, chips labelled', async () => {
    apiFetchMock.mockResolvedValue(alternativesOk([ROUTE_A, ROUTE_B]));
    renderPreview();
    await waitFor(() =>
      expect(screen.getByTestId('route-alternatives')).toBeInTheDocument(),
    );
    // Route 0 selected by default (provider ranks best-first).
    const solid = solidPolylines();
    expect(solid).toHaveLength(1);
    expect(solid[0].positions).toEqual(ROUTE_A);
    const dimmed = dimmedPolylines();
    expect(dimmed).toHaveLength(1);
    expect(dimmed[0].positions).toEqual(ROUTE_B);
    // Chips carry distance · duration and the radio state.
    expect(screen.getByTestId('route-option-0').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('route-option-1').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('route-choice-hint')).toBeInTheDocument();
  });

  test('tapping an option switches the emphasized polyline', async () => {
    apiFetchMock.mockResolvedValue(alternativesOk([ROUTE_A, ROUTE_B]));
    renderPreview();
    await waitFor(() =>
      expect(screen.getByTestId('route-alternatives')).toBeInTheDocument(),
    );
    polylines = [];
    fireEvent.click(screen.getByTestId('route-option-1'));
    await waitFor(() => {
      const solid = solidPolylines();
      expect(solid).toHaveLength(1);
      expect(solid[0].positions).toEqual(ROUTE_B);
    });
    expect(screen.getByTestId('route-option-1').getAttribute('aria-checked')).toBe('true');
    // A dimmed alternative polyline is tappable too.
    const dimmed = dimmedPolylines();
    expect(dimmed[0].eventHandlers?.click).toBeTypeOf('function');
  });
});

describe('DriverApproachMap', () => {
  const driver = { lat: -1.96, lng: 30.05 };

  function renderApproach() {
    return render(
      <DriverApproachMap
        customerLocation={PICKUP}
        driverLocation={driver}
        etaMinutes={4}
        etaConfidence="med"
        isLive={true}
      />,
    );
  }

  test('road geometry renders as the solid approach route', async () => {
    apiFetchMock.mockResolvedValue(singleRouteOk());
    renderApproach();
    await waitFor(() => {
      const solid = solidPolylines();
      expect(solid.length).toBeGreaterThan(0);
      expect(solid[solid.length - 1].positions).toEqual(ROUTE_A);
    });
    expect(screen.queryByTestId('route-fallback-notice')).not.toBeInTheDocument();
    // The driver origin is quantised to 3 decimals so a moving driver
    // doesn't mint a request per GPS jitter step.
    expect(String(apiFetchMock.mock.calls[0][0])).toContain('fromLat=-1.96&fromLng=30.05');
  });

  test('hook null → dashed crow line + pill', async () => {
    apiFetchMock.mockRejectedValue(new Error('unreachable'));
    renderApproach();
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const dashed = dashedPolylines();
    expect(dashed.length).toBeGreaterThan(0);
    expect(dashed[dashed.length - 1].positions).toEqual([
      [driver.lat, driver.lng],
      [PICKUP.lat, PICKUP.lng],
    ]);
    expect(screen.getByTestId('route-fallback-notice')).toBeInTheDocument();
  });
});
