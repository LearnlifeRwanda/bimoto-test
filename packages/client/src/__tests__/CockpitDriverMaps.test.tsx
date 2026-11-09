// __TESTS__/COCKPIT-DRIVER-MAPS.TEST.TSX
//
// COCKPIT G2 — the two driver screens, at page level.
//
// DriverNavMap.test.tsx proves the composition. This proves the WIRING:
// that the grey "Map view" rectangle is gone from both driver screens,
// that a real map stands where it stood, that it is pointed at the right
// place (pickup on approach, destination in the ride), and that the
// surfaces around it — the chat entry, the ride controls, the GPS pill —
// are all still there.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

vi.mock('../hooks/useSocket', () => ({
  useSocket: () => ({
    socket: null,
    isConnected: false,
    joinJourneyRoom: vi.fn(),
    leaveJourneyRoom: vi.fn(),
  }),
}));

vi.mock('../hooks/useDriverLocationBroadcast', () => ({
  useDriverLocationBroadcast: () => ({ isBroadcasting: false, lastError: null }),
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="osm-tile-layer" />,
  Marker: () => <div data-testid="marker" />,
  Polyline: () => <div data-testid="polyline" />,
  useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn(), panTo: vi.fn() }),
}));

vi.mock('leaflet', () => {
  const divIcon = (opts: { className?: string }) => ({ options: opts });
  return { default: { divIcon }, divIcon };
});

vi.mock('../hooks/useRouteDirections', () => ({
  useRouteDirections: () => null,
}));

// The driver's own GPS. Handed a fix so the own-position path is the one
// under test; the no-fix path is covered in DriverNavMap.test.tsx.
vi.mock('../hooks/useOwnPosition', () => ({
  useOwnPosition: () => ({
    lat: -1.9536,
    lng: 30.0606,
    accuracy: 8,
    speed: null,
    heading: null,
    timestamp: 0,
  }),
}));

import { ApproachPage } from '../pages/driver/ApproachPage';
import { ActiveRidePage } from '../pages/driver/ActiveRidePage';
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';
import { useChatStore } from '../stores/chat.store';

const JOURNEY = {
  id: 'j-1',
  status: 'MATCHED',
  pickupName: 'Kimironko Market',
  destinationName: 'Nyabugogo',
  pickupLat: -1.95,
  pickupLng: 30.06,
  destinationLat: -1.9441,
  destinationLng: 30.0619,
  agreedPrice: 2000,
  customer: { nickname: 'Alice' },
  driver: { driverProfile: { vehicleType: 'MOTO' } },
};

function stubFetch(journey: unknown) {
  (globalThis as { fetch?: unknown }).fetch = vi.fn(async (url: unknown) => {
    if (typeof url === 'string' && url.includes('/messages')) {
      return { ok: true, json: async () => [] };
    }
    return { ok: true, json: async () => journey };
  });
}

beforeEach(async () => {
  await i18n.changeLanguage('en');

  useAuthStore.setState({
    token: 'tok',
    user: {
      id: 'driver-1',
      nickname: 'Driver Bob',
      role: 'DRIVER',
      language: 'en',
      idVerified: true,
      licenseVerified: true,
      completedRides: 5,
      cancellationCount: 0,
      totalRequests: 0,
    },
    isAuthenticated: true,
    isLoading: false,
  } as never);
  useJourneyStore.setState({ activeJourney: JOURNEY as never });
  useChatStore.setState({ messages: [], isLoading: false } as never);
  stubFetch(JOURNEY);
});

describe('COCKPIT G2 — the motari stops riding blind', () => {
  test('ApproachPage renders a real map to the PICKUP where the placeholder was', async () => {
    render(
      <MemoryRouter initialEntries={['/driver/approach/j-1']}>
        <Routes>
          <Route path="/driver/approach/:id" element={<ApproachPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const map = await waitFor(() => screen.getByTestId('driver-nav-map'));
    expect(map.dataset.targetKind).toBe('pickup');
    expect(screen.getByTestId('map-container')).toBeInTheDocument();

    // The grey rectangle is gone — the key it rendered no longer exists,
    // so a regression would show as the raw key on screen.
    expect(screen.queryByText('approach.mapPlaceholder')).toBeNull();
    expect(screen.queryByText('Map view')).toBeNull();

    // What lived around it still lives around it.
    expect(screen.getByText('Kimironko Market')).toBeInTheDocument();
  });

  test('ActiveRidePage renders a real map to the DESTINATION where the placeholder was', async () => {
    render(
      <MemoryRouter initialEntries={['/driver/ride/j-1']}>
        <Routes>
          <Route path="/driver/ride/:id" element={<ActiveRidePage />} />
        </Routes>
      </MemoryRouter>,
    );

    const map = await waitFor(() => screen.getByTestId('driver-nav-map'));
    expect(map.dataset.targetKind).toBe('destination');

    expect(screen.queryByText('activeRide.mapPlaceholder')).toBeNull();
    expect(screen.queryByText('Map view')).toBeNull();

    // The ride control is still below the map, where his thumb expects it.
    expect(screen.getByText(i18n.t('activeRide.startJourney'))).toBeInTheDocument();
  });

  test('a journey with no coordinates shows no map rather than a map of nowhere', async () => {
    const noCoords = { ...JOURNEY, pickupLat: undefined, pickupLng: undefined };
    useJourneyStore.setState({ activeJourney: noCoords as never });
    stubFetch(noCoords);

    render(
      <MemoryRouter initialEntries={['/driver/approach/j-1']}>
        <Routes>
          <Route path="/driver/approach/:id" element={<ApproachPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // The address text still tells him where to go.
    await waitFor(() => screen.getByText('Kimironko Market'));
    expect(screen.queryByTestId('driver-nav-map')).toBeNull();
  });
});
