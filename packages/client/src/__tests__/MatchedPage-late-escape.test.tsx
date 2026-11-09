// MONEY-VIEW v2 G4 — the escape hatch, and the clock that never worked.
//
// "Choose another driver" has been unreachable. Its gate was
//
//     Date.now() - matchedTime > DRIVER_LATE_THRESHOLD_MINUTES * 60_000
//       && etaSeconds === 0
//
// and BOTH halves were broken.
//
//   THE GATE. `etaSeconds` was fed by exactly one read,
//   `data.driverEtaMinutes`, and #206 removed it because the field exists
//   in no API payload, no Prisma model and no shared type. So `etaSeconds`
//   is always NULL, `null === 0` is false, and the whole condition was
//   permanently false. The button could not appear at all — on the screen
//   where a stranded passenger most needs it.
//
//   THE CLOCK. `matchedTime` was `useState(() => Date.now())` — the moment
//   the SCREEN OPENED, not the moment the ride matched. It reset on every
//   reload, so a passenger who had waited 40 minutes and reopened the app
//   was 0 minutes late again. That was wrong INDEPENDENTLY of the dead
//   gate, and would have outlived fixing it.
//
// It now anchors to `journey.matchedAt` — set in the same transaction as
// the REQUESTED->MATCHED transition (R3-N-1), and already what the cancel
// flow beside it uses — and asks whether the stream can vouch for him.
//
// THE ARRIVED CASE IS THE ONE THAT MATTERS. A naive "late = offer a way
// out" gate would show the button to a passenger whose motari is standing
// at the kerb, because lateness alone says nothing about where he is. It
// is pinned below, and it is the reason `etaMinutes` plays no part in the
// gate at all.
//
// PAGE-mounted, per #203.
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

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  Marker: ({ position }: any) => (
    <div data-testid="marker" data-pos={`${position[0]},${position[1]}`} />
  ),
  Polyline: () => null,
  useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn(), panTo: vi.fn() }),
}));
vi.mock('leaflet', () => ({ default: { divIcon: () => ({}) }, divIcon: () => ({}) }));

let mockStreamState: any;
vi.mock('../hooks/useDriverLocationStream', () => ({
  useDriverLocationStream: () => mockStreamState,
}));

import { MatchedPage } from '../pages/customer/MatchedPage';
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';
import { useChatStore } from '../stores/chat.store';

const MINUTE = 60 * 1000;
/** Comfortably past DRIVER_LATE_THRESHOLD_MINUTES (10). */
const LATE_MINUTES = 15;

function matchedMinutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * MINUTE).toISOString();
}

/**
 * The journey as `GET /api/journeys/:id` returns it to a participant.
 * `matchedAt` is an ordinary Journey scalar and that read is an `include`,
 * so it has always been on this payload — `elapsedSinceMatched` and the
 * no-show gate beside it already read it.
 */
function journeyMatchedMinutesAgo(minutes: number, over: Record<string, unknown> = {}) {
  return {
    id: 'j-1',
    status: 'MATCHED',
    pickupLat: -1.95,
    pickupLng: 30.06,
    matchedAt: matchedMinutesAgo(minutes),
    startedAt: null,
    driver: { nickname: 'Driver Bob' },
    ...over,
  };
}

function stubFetch(journey: Record<string, unknown>) {
  const mock = vi.fn(async (url: any) => {
    if (typeof url === 'string' && url.includes('/messages')) {
      return { ok: true, json: async () => [] } as any;
    }
    return { ok: true, json: async () => journey } as any;
  });
  (globalThis as any).fetch = mock;
  return mock;
}

beforeEach(async () => {
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
        stale: 'Driver location unavailable',
        driverLabel: '{{driverName}}',
        mapLabel: 'Driver approach map',
      },
      matched: {
        driver: 'Driver',
        arriving: 'Arriving',
        driverOnTheWay: 'Driver on the way',
        chooseAnother: 'Choose another driver',
        chat: 'Chat',
        cancelRide: 'Cancel ride',
        liveTracking: 'Live tracking',
        approach: {
          silent: "Driver hasn't started moving yet",
          approaching: 'Driver is approaching',
          arrived: 'Driver has arrived',
          lost: 'Driver appears to be lost',
          etaShort: '~{{minutes}} min',
        },
      },
      common: { yes: 'Yes', no: 'No', dismiss: 'Dismiss' },
      chat: { noMessages: 'No messages yet' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

  useAuthStore.setState({
    token: 'tok',
    user: { id: 'cust', nickname: 'C', role: 'CUSTOMER', language: 'en' },
    isAuthenticated: true,
    isLoading: false,
  } as any);
  useChatStore.setState({ messages: [], isLoading: false });
  useJourneyStore.setState({ activeJourney: null } as any);

  mockStreamState = {
    driverLocation: null,
    etaMinutes: null,
    etaConfidence: 'unknown',
    etaAsOf: null,
    isLive: false,
    approachStatus: null,
    distanceMeters: null,
  };
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/journey/j-1/matched']}>
      <Routes>
        <Route path="/journey/:id/matched" element={<MatchedPage />} />
        <Route path="/journey/:id/bids" element={<div data-testid="bid-list-stub" />} />
      </Routes>
    </MemoryRouter>,
  );

/** Mount with a given lateness and approach status, then settle. */
async function mount(minutesLate: number, approachStatus: string | null, extra: any = {}) {
  mockStreamState = { ...mockStreamState, approachStatus, ...extra };
  stubFetch(journeyMatchedMinutesAgo(minutesLate));
  renderPage();
  await waitFor(() => expect(screen.getByText('Cancel ride')).toBeInTheDocument());
}

const escapeHatch = () => screen.queryByText('Choose another driver');

describe('the four verdicts', () => {
  test('late + SILENT → the way out is offered', async () => {
    // No recent GPS at all: nobody can say where he is.
    await mount(LATE_MINUTES, 'silent');
    expect(escapeHatch()).toBeInTheDocument();
  });

  test('late + LOST → the way out is offered', async () => {
    // Recent GPS, far from pickup, not closing.
    await mount(LATE_MINUTES, 'lost');
    expect(escapeHatch()).toBeInTheDocument();
  });

  test('late + ARRIVED → NO button, however late he is', async () => {
    // THE PIN THAT CLOSES THE HOLE A NAIVE GATE WOULD LEAVE. An arrived
    // driver is within ARRIVED_RADIUS_M of the pickup — he is AT the
    // kerb. Offering to replace him because a clock says 15 minutes is
    // exactly the wrong answer, and lateness alone cannot tell.
    await mount(LATE_MINUTES, 'arrived', { distanceMeters: 12, isLive: true });
    expect(escapeHatch()).not.toBeInTheDocument();
  });

  test('late + APPROACHING → no button; he is demonstrably closing', async () => {
    // And if he stops closing or his GPS drops, the server flips him to
    // lost/silent and the button appears on the next status frame — the
    // right moment, rather than a guessed one.
    await mount(LATE_MINUTES, 'approaching', { distanceMeters: 800, isLive: true });
    expect(escapeHatch()).not.toBeInTheDocument();
  });

  test('NOT late + silent → no button', async () => {
    await mount(2, 'silent');
    expect(escapeHatch()).not.toBeInTheDocument();
  });

  test('late + no status at all (server unreachable) → offered', async () => {
    // The same never-strand-the-customer fallback the no-show gate makes.
    await mount(LATE_MINUTES, null);
    expect(escapeHatch()).toBeInTheDocument();
  });
});

describe('the clock is the ride, not the screen', () => {
  test('a journey matched 15 minutes ago shows the button on a FRESH mount', async () => {
    // THE RED-PROOF FOR THE CLOCK FIX, and it is the whole of it: under
    // the old page-load clock `Date.now() - matchedTime` is ~0 on a fresh
    // mount, so this case was impossible no matter what the ETA gate did.
    // This is what a passenger reopening the app after a long wait sees.
    await mount(LATE_MINUTES, 'silent');
    expect(escapeHatch()).toBeInTheDocument();
  });

  test('a journey with no matchedAt shows no button rather than guessing', async () => {
    // Falling back to page-load time is what was wrong; falling back to
    // "0 elapsed" is at least honest, and the no-show gate above already
    // requires `matchedAt` for the same reason.
    mockStreamState = { ...mockStreamState, approachStatus: 'silent' };
    stubFetch(journeyMatchedMinutesAgo(LATE_MINUTES, { matchedAt: null }));
    renderPage();
    await waitFor(() => expect(screen.getByText('Cancel ride')).toBeInTheDocument());
    expect(escapeHatch()).not.toBeInTheDocument();
  });

  test('the ETA plays no part: a live ETA does not suppress the offer', async () => {
    // `etaMinutes` is display-only. A stale or optimistic number must not
    // be able to keep a stranded passenger from her way out.
    await mount(LATE_MINUTES, 'silent', { etaMinutes: 2, etaConfidence: 'low' });
    expect(escapeHatch()).toBeInTheDocument();
  });
});

describe('the dead ETA path is gone', () => {
  test('the fallback strip says where he is, and never a number', async () => {
    // The strip is the `!driverLocation` fallback: when it shows there
    // are no positions, so there can be no ETA and any number would be
    // invented.
    await mount(2, null);
    expect(screen.getByText('Driver on the way')).toBeInTheDocument();
    expect(screen.queryByText('Arriving')).not.toBeInTheDocument();
    // A countdown would have rendered as m:ss.
    expect(document.body.textContent ?? '').not.toMatch(/\d+:\d{2}/);
  });

  test('the live ETA still renders on the map when a position exists', async () => {
    // Nothing was duplicated and nothing was lost: the map has rendered
    // the live ETA since R3-E and still does.
    await mount(2, 'approaching', {
      // `DriverLocationFix.asOf` is a Date, not a string (the stream
      // constructs one), and DriverApproachMap calls .getTime() on it.
      driverLocation: { lat: -1.94, lng: 30.05, asOf: new Date() },
      etaMinutes: 4,
      etaConfidence: 'high',
      isLive: true,
      distanceMeters: 900,
    });
    await waitFor(() =>
      expect(screen.getByTestId('driver-approach-map')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('eta-text').textContent).toContain('4');
    // And the fallback strip is not showing at the same time.
    expect(screen.queryByText('Driver on the way')).not.toBeInTheDocument();
  });
});
