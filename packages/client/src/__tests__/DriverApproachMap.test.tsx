import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { i18n } from './setup';

// react-leaflet is not jsdom-friendly. Mock it with no-op components
// so the rest of the DOM (ETA pill, stale message) renders.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  Marker: ({ position }: any) => (
    <div data-testid="marker" data-pos={`${position[0]},${position[1]}`} />
  ),
  Polyline: ({ positions }: any) => (
    <div data-testid="polyline" data-count={positions.length} />
  ),
  useMap: () => ({
    fitBounds: vi.fn(),
    setView: vi.fn(),
    panTo: vi.fn(),
  }),
}));

vi.mock('leaflet', () => ({
  default: {
    divIcon: () => ({}),
  },
  divIcon: () => ({}),
}));

beforeEach(async () => {
  // Augment the i18n stub with the driverApproach namespace.
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      driverApproach: {
        etaMinutes: '≈ {{minutes}} min away',
        etaUnknown: 'Locating driver…',
        confidenceLow: 'estimated (long range)',
        confidenceMed: 'estimated',
        confidenceHigh: 'live',
        stale: 'Driver location unavailable — last seen {{seconds}}s ago',
        driverLabel: '{{driverName}}',
        mapLabel: 'Driver approach map',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

import { DriverApproachMap } from '../components/journey/DriverApproachMap';

const customerLocation = { lat: -1.95, lng: 30.06 };

describe('DriverApproachMap', () => {
  test('renders the customer pickup pin', () => {
    render(
      <DriverApproachMap
        customerLocation={customerLocation}
        driverLocation={null}
        etaMinutes={null}
        etaConfidence="unknown"
        isLive={false}
      />,
    );
    const markers = screen.getAllByTestId('marker');
    expect(markers).toHaveLength(1);
    expect(markers[0].dataset.pos).toBe('-1.95,30.06');
    expect(screen.getByTestId('eta-text').textContent).toContain('Locating driver');
  });

  test('renders driver pin and ETA pill when driverLocation is provided', () => {
    render(
      <DriverApproachMap
        customerLocation={customerLocation}
        driverLocation={{ lat: -1.951, lng: 30.062 }}
        etaMinutes={3}
        etaConfidence="med"
        isLive={true}
      />,
    );
    const markers = screen.getAllByTestId('marker');
    expect(markers).toHaveLength(2);
    expect(screen.getByTestId('eta-text').textContent).toContain('3');
    expect(screen.getByText('estimated')).toBeInTheDocument();
  });

  test('shows "live" sub-label for high confidence', () => {
    render(
      <DriverApproachMap
        customerLocation={customerLocation}
        driverLocation={{ lat: -1.95, lng: 30.061 }}
        etaMinutes={1}
        etaConfidence="high"
        isLive={true}
      />,
    );
    expect(screen.getByText('live')).toBeInTheDocument();
  });

  test('shows stale message when isLive is false but a location exists', () => {
    const tenSecondsAgo = new Date(Date.now() - 10_000);
    render(
      <DriverApproachMap
        customerLocation={customerLocation}
        driverLocation={{ lat: -1.95, lng: 30.061 }}
        etaMinutes={2}
        etaConfidence="med"
        isLive={false}
        driverAsOf={tenSecondsAgo}
      />,
    );
    expect(screen.getByTestId('driver-approach-stale').textContent).toContain('Driver location unavailable');
  });
});
