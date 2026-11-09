// DRIVER-ID v3 G5 — the person-first identifier (jacket number) on
// every customer surface: the accepted-booking screen (MatchedPage)
// and the chat header. Shown ONLY for VERIFIED drivers — an
// unverified number must never look official.
// (DriverCard was production-dead and deleted in WIRE-AUDIT G3;
// BidCard went the same way in DEADWOOD G2. The live bid surface is
// BidListPage, covered by pages/customer/__tests__.)

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { i18n } from './setup';

vi.mock('../hooks/useSocket', () => ({
  useSocket: () => ({
    socket: null,
    isConnected: false,
    joinJourneyRoom: vi.fn(),
    leaveJourneyRoom: vi.fn(),
  }),
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  Marker: () => null,
  Polyline: () => null,
  useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn(), panTo: vi.fn() }),
}));

vi.mock('leaflet', () => ({
  default: { divIcon: () => ({}) },
  divIcon: () => ({}),
}));

vi.mock('../hooks/useDriverLocationStream', () => ({
  useDriverLocationStream: () => ({
    driverLocation: null,
    etaMinutes: null,
    etaConfidence: 'unknown',
    etaAsOf: null,
    isLive: false,
    approachStatus: null,
    distanceMeters: null,
  }),
}));

import { MatchedPage } from '../pages/customer/MatchedPage';
import { ChatPage } from '../pages/shared/ChatPage';
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';
import { useChatStore } from '../stores/chat.store';

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      driver: {
        jacketNumber: 'Jacket Nº {{number}}',
        vehicle: 'Vehicle',
        plate: 'Plate',
        totalRides: 'Total rides',
      },
      vehicle: { moto: 'Moto taxi' },
      badges: { ruraAuthorized: 'RURA', insured: 'Insured' },
      bid: { rides: '{{count}} rides', eta: '{{minutes}} min', accept: 'Accept' },
      transparency: {
        platformFeeAmount: 'Fee {{amount}} ({{rate}}%)',
        driverReceives: 'Driver gets {{amount}}',
        tierSavings: 'Tier {{tier}} saves {{amount}}',
      },
      matched: { driver: 'Driver', arriving: 'Arriving', driverOnTheWay: 'On the way' },
      chat: { title: 'Chat', noMessages: 'No messages yet' },
      common: { back: 'Back' },
      driverApproach: { mapLabel: 'Driver approach map', etaUnknown: 'Locating…' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

  useAuthStore.setState({
    token: 'tok',
    user: { id: 'cust', nickname: 'C', role: 'CUSTOMER' } as any,
    isAuthenticated: true,
    isLoading: false,
  });
  useChatStore.setState({ messages: [], isLoading: false });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: any) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).includes('/messages') ? [] : {}),
    })) as any,
  );
});

describe('MatchedPage (accepted-booking screen)', () => {
  function seedJourney(profile: any) {
    const journey = {
      id: 'j-1',
      status: 'MATCHED',
      pickupLat: -1.95,
      pickupLng: 30.06,
      driver: { nickname: 'Jean', driverProfile: profile },
    };
    useJourneyStore.setState({ activeJourney: journey as any });
    // The page re-fetches the journey on mount — return the same
    // payload so the store seed isn't overwritten.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => ({
        ok: true,
        status: 200,
        json: async () => (String(url).includes('/messages') ? [] : journey),
      })) as any,
    );
  }

  test('shows the jacket number from the journey payload for a VERIFIED driver', async () => {
    seedJourney({
      verificationStatus: 'VERIFIED',
      ruraAuthorizationNumber: 'RURA-0001',
      vehicleType: 'MOTO',
    });
    render(
      <MemoryRouter initialEntries={['/journey/j-1/matched']}>
        <Routes>
          <Route path="/journey/:id/matched" element={<MatchedPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('jacket-number')).toHaveTextContent('Jacket Nº RURA-0001'),
    );
  });

  test('no jacket number when the profile is not VERIFIED', async () => {
    seedJourney({
      verificationStatus: 'REVOKED',
      ruraAuthorizationNumber: 'RURA-0001',
      vehicleType: 'MOTO',
    });
    render(
      <MemoryRouter initialEntries={['/journey/j-1/matched']}>
        <Routes>
          <Route path="/journey/:id/matched" element={<MatchedPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Jean')).toBeInTheDocument());
    expect(screen.queryByTestId('jacket-number')).not.toBeInTheDocument();
  });
});

describe('ChatPage header', () => {
  test('shows the jacket number under the chat title', async () => {
    useJourneyStore.setState({
      activeJourney: {
        id: 'j-1',
        status: 'MATCHED',
        driver: {
          nickname: 'Jean',
          driverProfile: {
            verificationStatus: 'VERIFIED',
            ruraAuthorizationNumber: 'RURA-0001',
            vehicleType: 'MOTO',
          },
        },
      } as any,
    });
    render(
      <MemoryRouter initialEntries={['/journey/j-1/chat']}>
        <Routes>
          <Route path="/journey/:id/chat" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('jacket-number')).toHaveTextContent('Jacket Nº RURA-0001'),
    );
  });
});
