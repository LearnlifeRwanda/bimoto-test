import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// react-leaflet is not jsdom-friendly; mock it the same way
// DriverApproachMap.test.tsx does so we can assert structure without
// pulling in canvas.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, bounds }: any) => (
    <div data-testid="map-container" data-bounds={JSON.stringify(bounds)}>
      {children}
    </div>
  ),
  TileLayer: () => null,
  Marker: ({ position, children }: any) => (
    <div data-testid="marker" data-pos={`${position[0]},${position[1]}`}>
      {children}
    </div>
  ),
  Polyline: ({ positions }: any) => (
    <div data-testid="polyline" data-count={positions.length} />
  ),
  Popup: ({ children }: any) => <div data-testid="popup">{children}</div>,
  useMap: () => ({
    fitBounds: vi.fn(),
  }),
}));

vi.mock('leaflet', () => ({
  default: {
    divIcon: () => ({}),
  },
  divIcon: () => ({}),
}));

// TRUE-ROUTES G1 — the preview now asks the directions proxy per
// segment; keep these structural tests offline-deterministic (every
// segment renders its dashed fallback).
const apiFetchMock = vi.fn().mockRejectedValue(new Error('unreachable'));
vi.mock('../lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import { RoutePreviewMap } from '../components/journey/RoutePreviewMap';
import { _resetRouteDirectionsForTests } from '../hooks/useRouteDirections';
import type { LegInput } from '@bimoto/shared';

beforeEach(() => {
  _resetRouteDirectionsForTests();
});

describe('RoutePreviewMap — R3-DELIVERY-V2', () => {
  test('renders MapContainer + polyline with 2 positions for a no-stop route', () => {
    render(
      <RoutePreviewMap
        pickupLat={-1.95}
        pickupLng={30.06}
        pickupName="Home"
        destinationLat={-1.94}
        destinationLng={30.07}
        destinationName="Office"
        legs={[]}
      />,
    );
    expect(screen.getByTestId('route-preview-map')).toBeInTheDocument();
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('polyline').dataset.count).toBe('2');
  });

  test('one segment polyline per consecutive stop pair', () => {
    const legs: LegInput[] = [
      {
        type: 'GOODS_DROPOFF',
        lat: -1.945,
        lng: 30.065,
        name: 'Post office',
        parcelSize: 'SMALL',
      },
      {
        type: 'GOODS_PICKUP',
        lat: -1.948,
        lng: 30.068,
        name: 'Warehouse',
        parcelSize: 'MEDIUM',
      },
    ];
    render(
      <RoutePreviewMap
        pickupLat={-1.95}
        pickupLng={30.06}
        pickupName="Home"
        destinationLat={-1.94}
        destinationLng={30.07}
        destinationName="Office"
        legs={legs}
      />,
    );
    // pickup → stop 1 → stop 2 → destination = 3 segments, each a
    // 2-point dashed fallback here (directions unreachable in test).
    const polylines = screen.getAllByTestId('polyline');
    expect(polylines).toHaveLength(3);
    for (const p of polylines) expect(p.dataset.count).toBe('2');
  });

  test('renders sequence-numbered markers including pickup (0), legs, destination (last)', () => {
    const legs: LegInput[] = [
      {
        type: 'GOODS_DROPOFF',
        lat: -1.945,
        lng: 30.065,
        name: 'Post office',
        parcelSize: 'SMALL',
      },
    ];
    render(
      <RoutePreviewMap
        pickupLat={-1.95}
        pickupLng={30.06}
        pickupName="Home"
        destinationLat={-1.94}
        destinationLng={30.07}
        destinationName="Office"
        legs={legs}
      />,
    );
    const markers = screen.getAllByTestId('marker');
    expect(markers).toHaveLength(3);
    expect(markers[0].dataset.pos).toBe('-1.95,30.06');
    expect(markers[1].dataset.pos).toBe('-1.945,30.065');
    expect(markers[2].dataset.pos).toBe('-1.94,30.07');
  });

  test('marker popup carries the stop name', () => {
    render(
      <RoutePreviewMap
        pickupLat={-1.95}
        pickupLng={30.06}
        pickupName="Home pickup"
        destinationLat={-1.94}
        destinationLng={30.07}
        destinationName="Office destination"
        legs={[]}
      />,
    );
    const popups = screen.getAllByTestId('popup');
    expect(popups.map((p) => p.textContent)).toEqual([
      'Home pickup',
      'Office destination',
    ]);
  });

  test('handles degenerate single-point route (pickup === destination) without throwing', () => {
    expect(() =>
      render(
        <RoutePreviewMap
          pickupLat={-1.95}
          pickupLng={30.06}
          pickupName="Same"
          destinationLat={-1.95}
          destinationLng={30.06}
          destinationName="Same"
          legs={[]}
        />,
      ),
    ).not.toThrow();
  });
});
