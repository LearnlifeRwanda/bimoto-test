// FEED-CONTRACT G1 — the dashboard asks the server the question it
// always meant to ask.
//
// The feed branch selector on the server is `viewAs` (validated by the
// shared journeyQuerySchema, which STRIPS undeclared keys). The old
// request sent `role=driver` — a key the handler never reads — so a
// BOTH-role driver (the shape real onboarding produces:
// createDriverProfile writes role='BOTH') fell into the customer branch
// and saw their own journeys instead of nearby requests.
//
// Two layers pinned here:
//   1. component — the URL the dashboard actually builds carries
//      viewAs=driver and no role key;
//   2. contract — that same URL's query string survives the shared
//      journeyQuerySchema with viewAs intact (the server half — BOTH +
//      viewAs=driver reaching the driver branch — is pinned by
//      packages/server/src/__tests__/journey-viewas.test.ts).

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { journeyQuerySchema } from '@bimoto/shared';
import { i18n } from './setup';

const { mockSocket, ioMock } = vi.hoisted(() => {
  const mockSocket = {
    on: () => mockSocket,
    emit: () => mockSocket,
    disconnect: () => {},
    connected: false,
  };
  return { mockSocket, ioMock: { io: () => mockSocket } };
});
vi.mock('socket.io-client', () => ioMock);

vi.mock('../hooks/useGeolocation', () => ({
  geolocation: {
    getCurrentPosition: vi.fn(async () => ({ lat: -1.95, lng: 30.06 })),
  },
}));

import { DashboardPage } from '../pages/driver/DashboardPage';
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';

let journeyFeedUrls: string[];

beforeEach(async () => {
  journeyFeedUrls = [];
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      dashboard: {
        imOnline: "I'm online",
        imOffline: "I'm offline",
        onlineSubtitle: 'Available for rides',
        goOnline: 'Go online to receive ride requests',
        noRequests: 'No requests',
        noRequestsSubtitle: 'Hang tight',
        nearbyRequests: '{{count}} nearby',
        newRequestNearby: 'New request nearby',
      },
      account: { viewAccount: 'View account status' },
      journey: {
        geoFailed: 'Could not get GPS',
        geoNotSupported: 'GPS not supported',
      },
      common: { retry: 'Retry' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

  // The shape real onboarding produces: createDriverProfile flips the
  // user to role BOTH — exactly the role that used to fall into the
  // customer branch.
  useAuthStore.setState({
    token: 'tok',
    user: { id: 'both-1', role: 'BOTH' } as any,
    isAuthenticated: true,
    isLoading: false,
  });
  useJourneyStore.setState({ nearbyRequests: [], availableSignal: null });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/journeys?')) {
        journeyFeedUrls.push(url);
        return { ok: true, status: 200, json: async () => [] } as Response;
      }
      if (
        url.includes('/api/users/me/location') ||
        url.includes('/api/users/me/online-status')
      ) {
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }
      // G3 mount restore — this driver starts server-offline.
      if (url.endsWith('/api/users/me')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'both-1', role: 'BOTH', driverProfile: { isOnline: false } }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as any,
  );
});

async function goOnline() {
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText("I'm offline"));
  await waitFor(() => expect(journeyFeedUrls.length).toBeGreaterThan(0));
  return new URL(journeyFeedUrls[0], 'http://localhost');
}

describe('FEED-CONTRACT G1 — dashboard feed request carries viewAs=driver', () => {
  test('the feed URL sends viewAs=driver with coordinates and no role key', async () => {
    const url = await goOnline();

    expect(url.pathname).toBe('/api/journeys');
    expect(url.searchParams.get('viewAs')).toBe('driver');
    expect(url.searchParams.get('role')).toBeNull();
    expect(Number(url.searchParams.get('lat'))).toBeCloseTo(-1.95);
    expect(Number(url.searchParams.get('lng'))).toBeCloseTo(30.06);
  });

  test("contract: the built query survives the server's shared schema with viewAs intact", async () => {
    const url = await goOnline();

    // validate(journeyQuerySchema, 'query') REPLACES req.query with the
    // parsed result — an undeclared key (like the old `role`) would be
    // silently stripped before the handler ever saw it. viewAs must
    // come out the other side as the driver-branch selector.
    const parsed = journeyQuerySchema.parse(
      Object.fromEntries(url.searchParams.entries()),
    );
    expect(parsed.viewAs).toBe('driver');
    expect(parsed.lat).toBeCloseTo(-1.95);
    expect(parsed.lng).toBeCloseTo(30.06);
    expect('role' in parsed).toBe(false);
  });
});
