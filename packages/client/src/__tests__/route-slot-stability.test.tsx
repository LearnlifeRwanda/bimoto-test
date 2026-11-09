// __TESTS__/ROUTE-SLOT-STABILITY.TEST.TSX
//
// OUTBOX G5 — the booking button stays still while the route provider
// has a bad day.
//
// jsdom has no layout engine — every getBoundingClientRect is zero — so
// this proves the STRUCTURAL invariant that produces the stability, and
// the e2e measurement in the completion report is the observational
// half. The invariant: the slot below the map occupies the same box in
// every state of useRouteAlternatives, so nothing below it can move
// when the provider answers, fails, or retries.
//
// It also pins the finding that redirected this work: RouteFallbackNotice
// was blamed for the shift and cannot cause one, because it is
// absolutely positioned inside a fixed-height map in every consumer.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { i18n } from './setup';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }: any) => <div>{children}</div>,
  Polyline: () => <div data-testid="polyline" />,
  Popup: ({ children }: any) => <div>{children}</div>,
  useMap: () => ({ fitBounds: vi.fn() }),
  useMapEvents: () => ({}),
}));
vi.mock('leaflet', () => ({ default: { divIcon: () => ({}) }, divIcon: () => ({}) }));

const alternativesMock = vi.fn();
vi.mock('../hooks/useRouteAlternatives', () => ({
  useRouteAlternatives: (...args: unknown[]) => alternativesMock(...args),
}));
vi.mock('../hooks/useRouteDirections', () => ({
  useRouteDirections: () => null,
}));

import { RoutePreviewMap } from '../components/journey/RoutePreviewMap';

const PICKUP = { lat: -1.9536, lng: 30.0606 };
const DEST = { lat: -1.9441, lng: 30.0619 };

function route(distanceM: number, durationS: number) {
  return {
    coordinates: [
      [PICKUP.lat, PICKUP.lng],
      [DEST.lat, DEST.lng],
    ],
    distanceM,
    durationS,
  };
}

function renderPreview() {
  return render(
    <RoutePreviewMap
      pickupLat={PICKUP.lat}
      pickupLng={PICKUP.lng}
      pickupName="Sonatubes"
      destinationLat={DEST.lat}
      destinationLng={DEST.lng}
      destinationName="Giporoso"
      legs={[]}
    />,
  );
}

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      map: {
        routeUnavailable: 'route unavailable — showing direct line',
        routeOptionsLabel: 'Route options',
        routeOption: 'Route {{n}}',
        routeChoiceHint: 'Drivers are not held to this route.',
      },
      picker: { routeSummary: '{{distance}} · {{duration}}' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('the route-alternatives slot is reserved in every state', () => {
  test('the slot is present when the provider has answered', () => {
    alternativesMock.mockReturnValue([route(3200, 720), route(3800, 690)]);
    renderPreview();

    expect(screen.getByTestId('route-alternatives-slot')).toBeInTheDocument();
    expect(screen.getByTestId('route-alternatives')).toBeInTheDocument();
  });

  test('and still present when it has not — the space is held, not collapsed', () => {
    alternativesMock.mockReturnValue(null);
    renderPreview();

    expect(screen.getByTestId('route-alternatives-slot')).toBeInTheDocument();
    // Nothing inside it: this is the failing/retrying state.
    expect(screen.queryByTestId('route-alternatives')).toBeNull();
    // And the honest-absence pill is up, which is the state the old
    // code turned into a jumping form.
    expect(screen.getByTestId('route-fallback-notice')).toBeInTheDocument();
  });

  test('the slot box is IDENTICAL across the fallback/retry cycle', () => {
    // Answered.
    alternativesMock.mockReturnValue([route(3200, 720), route(3800, 690)]);
    const answered = renderPreview();
    const withRoutes = screen.getByTestId('route-alternatives-slot').className;
    answered.unmount();

    // Failed, and retrying.
    alternativesMock.mockReturnValue(null);
    renderPreview();
    const withoutRoutes = screen.getByTestId('route-alternatives-slot').className;

    // Same reserved box either way — which is the whole mechanism by
    // which the submit button below it cannot move.
    expect(withoutRoutes).toBe(withRoutes);
    expect(withRoutes).toContain('min-h-[72px]');
  });

  test('a single alternative renders no chips but still reserves', () => {
    alternativesMock.mockReturnValue([route(3200, 720)]);
    renderPreview();

    expect(screen.getByTestId('route-alternatives-slot')).toBeInTheDocument();
    expect(screen.queryByTestId('route-alternatives')).toBeNull();
  });

  test('chips cannot wrap onto a second line and defeat the reserve', () => {
    alternativesMock.mockReturnValue([route(3200, 720), route(3800, 690), route(4100, 900)]);
    renderPreview();

    const row = screen.getByTestId('route-alternatives');
    expect(row.className).toContain('flex-nowrap');
    expect(row.className).toContain('overflow-x-auto');
    expect(row.className).not.toContain('flex-wrap');
    for (const chip of screen.getAllByRole('radio')) {
      expect(chip.className).toContain('whitespace-nowrap');
      expect(chip.className).toContain('shrink-0');
    }
  });

  test('a multi-stop preview reserves nothing — it never asks for alternatives', () => {
    alternativesMock.mockReturnValue(null);
    render(
      <RoutePreviewMap
        pickupLat={PICKUP.lat}
        pickupLng={PICKUP.lng}
        pickupName="Sonatubes"
        destinationLat={DEST.lat}
        destinationLng={DEST.lng}
        destinationName="Giporoso"
        legs={[
          {
            sequence: 1,
            name: 'Post office',
            lat: -1.95,
            lng: 30.07,
            type: 'GOODS_DROPOFF',
          } as any,
        ]}
      />,
    );

    expect(screen.queryByTestId('route-alternatives-slot')).toBeNull();
  });
});

describe('the notice that was blamed and could not have done it', () => {
  test('RouteFallbackNotice is absolutely positioned inside the fixed-height map', () => {
    alternativesMock.mockReturnValue(null);
    renderPreview();

    const notice = screen.getByTestId('route-fallback-notice');
    // Its wrapper takes it out of flow entirely, so mounting and
    // unmounting it cannot move a single pixel of the form below.
    expect(notice.parentElement?.className).toContain('absolute');
  });
});
