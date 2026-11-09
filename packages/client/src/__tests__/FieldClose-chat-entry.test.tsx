// FIELD-CLOSE G2 — chat has a findable front door on every screen of
// an active ride, and the live map is named as driver tracking.
//
// /journey/:id/chat has been routed all along but nothing navigated
// there, so the field team reported chat as missing. These tests pin
// the ChatEntryButton (icon + the word from chat.title) on all four
// screens — customer MatchedPage and InProgressPage, driver
// ApproachPage and ActiveRidePage — and the tracking heading over the
// MatchedPage approach map.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  Marker: ({ position }: any) => (
    <div data-testid="marker" data-pos={`${position[0]},${position[1]}`} />
  ),
  Polyline: () => null,
  Popup: ({ children }: any) => <div>{children}</div>,
  useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn(), panTo: vi.fn() }),
  useMapEvents: () => ({}),
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

vi.mock('../hooks/useDriverLocationBroadcast', () => ({
  useDriverLocationBroadcast: vi.fn(),
}));

import { MatchedPage } from '../pages/customer/MatchedPage';
import { InProgressPage } from '../pages/customer/InProgressPage';
import { ApproachPage } from '../pages/driver/ApproachPage';
import { ActiveRidePage } from '../pages/driver/ActiveRidePage';
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';
import { useChatStore } from '../stores/chat.store';

const JOURNEY = {
  id: 'j-1',
  status: 'MATCHED',
  pickupLat: -1.95,
  pickupLng: 30.06,
  pickupName: 'Kimironko',
  destinationName: 'Kicukiro',
  driver: { nickname: 'Driver Bob' },
  customer: { nickname: 'Customer C' },
};

function stubJourneyFetch() {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('/messages')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response(JSON.stringify(JOURNEY), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      matched: {
        driver: 'Driver',
        arriving: 'Arriving',
        driverOnTheWay: 'Driver on the way',
        chat: 'Chat',
        cancelRide: 'Cancel ride',
        liveTracking: 'Live driver tracking',
        approach: {
          silent: "Driver hasn't started moving yet",
          approaching: 'Driver is approaching',
          arrived: 'Driver has arrived',
          lost: 'Driver appears to be lost',
          etaShort: '~{{minutes}} min',
        },
      },
      driverApproach: {
        etaUnknown: 'Locating driver…',
        mapLabel: 'Driver approach map',
      },
      inProgress: {
        title: 'Ride in progress',
        duration: 'Duration',
        mapPlaceholder: 'map',
        recording: 'Recording',
      },
      approach: {
        title: 'Heading to pickup',
        pickingUp: 'Picking up {{name}}',
        pickupAt: 'Pickup at',
        chat: 'Chat',
        cantMakeTrip: "I can't make this trip",
      },
      activeRide: {
        readyToStart: 'Ready to start',
        readySubtitle: 'Meet your passenger',
        startJourney: 'Start journey',
        endJourney: 'End journey',
        mapPlaceholder: 'map',
        recording: 'Recording',
        duration: 'Duration',
      },
      common: { yes: 'Yes', no: 'No', dismiss: 'Dismiss' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

  useAuthStore.setState({
    token: 'tok',
    user: { id: 'u-1', nickname: 'U', role: 'BOTH', language: 'en' } as any,
    isAuthenticated: true,
    isLoading: false,
  } as any);
  useJourneyStore.setState({ activeJourney: JOURNEY as any });
  useChatStore.setState({ messages: [], isLoading: false });
  stubJourneyFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderAt(path: string, routePath: string, element: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={element} />
        <Route path="/journey/:id/chat" element={<div data-testid="chat-page-probe" />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function expectChatEntryNavigates() {
  const entry = await screen.findByTestId('chat-entry', {}, { timeout: 3000 });
  // Icon + the word, never an icon alone.
  expect(entry.textContent).toContain('Chat');
  expect(entry.querySelector('svg')).not.toBeNull();
  fireEvent.click(entry);
  await waitFor(() =>
    expect(screen.getByTestId('chat-page-probe')).toBeInTheDocument(),
  );
}

describe('FIELD-CLOSE G2 — labelled chat entry on all four ride screens', () => {
  test('customer MatchedPage: chat entry navigates to the chat route', async () => {
    renderAt('/journey/j-1/matched', '/journey/:id/matched', <MatchedPage />);
    await expectChatEntryNavigates();
  });

  test('customer InProgressPage: chat entry navigates to the chat route', async () => {
    renderAt('/journey/j-1/progress', '/journey/:id/progress', <InProgressPage />);
    await expectChatEntryNavigates();
  });

  test('driver ApproachPage: chat entry navigates to the chat route', async () => {
    renderAt('/driver/approach/j-1', '/driver/approach/:id', <ApproachPage />);
    await expectChatEntryNavigates();
  });

  test('driver ActiveRidePage: chat entry navigates to the chat route', async () => {
    renderAt('/driver/ride/j-1', '/driver/ride/:id', <ActiveRidePage />);
    await expectChatEntryNavigates();
  });
});

describe('FIELD-CLOSE G2 — the live map is named as driver tracking', () => {
  test('MatchedPage shows the tracking heading over the approach map', async () => {
    renderAt('/journey/j-1/matched', '/journey/:id/matched', <MatchedPage />);
    const heading = await screen.findByTestId('tracking-heading', {}, { timeout: 3000 });
    expect(heading.textContent).toBe('Live driver tracking');
  });
});
