import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
import { BidPage } from '../pages/driver/BidPage';
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      delivery: {
        driverStopList: 'Stops on the way',
        stopOrderLabel: 'Stop {{n}}',
        driverCompleteStop: 'Complete this stop',
        driverStopCompleted: 'Completed at {{time}}',
        imAtPickup: "I'm at pickup",
      },
      bid: {
        journeyDetails: 'Details',
        wishPrice: '{{price}}',
        makeOffer: 'Offer',
        yourPrice: 'Price',
        pricePlaceholder: 'price',
        etaMinutesLabel: 'ETA',
        etaPlaceholder: 'eta',
        submitOffer: 'Submit',
        fetchFailed: 'fetch failed',
      },
      common: { back: 'Back' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

  // Auth + journey store seed.
  useAuthStore.setState({
    token: 'tok',
    user: {
      id: 'd1',
      role: 'DRIVER',
      driverProfile: { totalRides: 0 },
    } as any,
  } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const journeyWithLegs = {
  id: 'j1',
  pickupName: 'Home',
  destinationName: 'Office',
  status: 'IN_PROGRESS',
  legs: [
    {
      id: 'leg-1',
      journeyId: 'j1',
      sequence: 0,
      type: 'GOODS_DROPOFF',
      status: 'PENDING',
      lat: -1.95,
      lng: 30.06,
      name: 'Post office',
      parcelSize: 'MEDIUM',
    },
  ],
};

function renderBidPage() {
  return render(
    <MemoryRouter initialEntries={['/driver/bid/j1']}>
      <Routes>
        <Route path="/driver/bid/:id" element={<BidPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('BidPage — R3-DELIVERY leg completion wiring', () => {
  test('renders JourneyLegsDisplay when journey has legs', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/journeys/j1')) {
        return new Response(JSON.stringify(journeyWithLegs), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBidPage();
    await waitFor(() => screen.getByTestId('journey-legs-display'));
    expect(screen.getByTestId('parcel-size-badge-0').textContent).toBe('MEDIUM');
  });

  test('Complete this stop POSTs to /api/journeys/:id/legs/:legId/complete', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/journeys/j1') && (!init || init.method !== 'POST')) {
        return new Response(JSON.stringify(journeyWithLegs), { status: 200 });
      }
      if (
        url.endsWith('/api/journeys/j1/legs/leg-1/complete') &&
        init?.method === 'POST'
      ) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBidPage();
    await waitFor(() => screen.getByTestId('complete-stop-0'));
    fireEvent.click(screen.getByTestId('complete-stop-0'));

    await waitFor(() => {
      const completeCall = fetchMock.mock.calls.find(
        ([u, i]: any[]) =>
          typeof u === 'string' &&
          u.endsWith('/api/journeys/j1/legs/leg-1/complete') &&
          i?.method === 'POST',
      );
      expect(completeCall).toBeDefined();
    });
    // Optimistic update: store now has the leg flagged COMPLETED.
    const journey = useJourneyStore.getState().activeJourney;
    expect(journey.legs[0].status).toBe('COMPLETED');
  });

  test('does not render the legs display when journey has no legs', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ...journeyWithLegs, legs: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderBidPage();
    await waitFor(() => screen.getByText('Details'));
    expect(screen.queryByTestId('journey-legs-display')).toBeNull();
  });

  // R3-DELIVERY-NOTIFICATIONS-2 — driver-arrived-at-pickup wiring.
  test("'I'm at pickup' button surfaces only on PENDING GOODS_PICKUP legs", async () => {
    const journeyWithPickup = {
      ...journeyWithLegs,
      legs: [
        {
          id: 'leg-pickup',
          journeyId: 'j1',
          sequence: 0,
          type: 'GOODS_PICKUP',
          status: 'PENDING',
          lat: -1.95,
          lng: 30.06,
          name: 'Sender HQ',
          parcelSize: 'SMALL',
        },
        {
          id: 'leg-drop',
          journeyId: 'j1',
          sequence: 1,
          type: 'GOODS_DROPOFF',
          status: 'PENDING',
          lat: -1.96,
          lng: 30.07,
          name: 'Recipient flat',
          parcelSize: 'SMALL',
        },
      ],
    };
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(journeyWithPickup), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderBidPage();
    await waitFor(() => screen.getByTestId('journey-legs-display'));

    // GOODS_PICKUP leg (index 0) gets the "I'm at pickup" button.
    expect(screen.getByTestId('activate-stop-0')).toBeInTheDocument();
    // GOODS_DROPOFF leg (index 1) does NOT.
    expect(screen.queryByTestId('activate-stop-1')).toBeNull();
  });

  test("'I'm at pickup' POSTs to /api/journeys/:id/legs/:legId/activate", async () => {
    const journeyWithPickup = {
      ...journeyWithLegs,
      legs: [
        {
          id: 'leg-pickup',
          journeyId: 'j1',
          sequence: 0,
          type: 'GOODS_PICKUP',
          status: 'PENDING',
          lat: -1.95,
          lng: 30.06,
          name: 'Sender HQ',
          parcelSize: 'SMALL',
        },
      ],
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/journeys/j1') && (!init || init.method !== 'POST')) {
        return new Response(JSON.stringify(journeyWithPickup), { status: 200 });
      }
      if (
        url.endsWith('/api/journeys/j1/legs/leg-pickup/activate') &&
        init?.method === 'POST'
      ) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBidPage();
    await waitFor(() => screen.getByTestId('activate-stop-0'));
    fireEvent.click(screen.getByTestId('activate-stop-0'));

    await waitFor(() => {
      const activateCall = fetchMock.mock.calls.find(
        ([u, i]: any[]) =>
          typeof u === 'string' &&
          u.endsWith('/api/journeys/j1/legs/leg-pickup/activate') &&
          i?.method === 'POST',
      );
      expect(activateCall).toBeDefined();
    });
    // Optimistic update: leg flipped to ACTIVE locally.
    const journey = useJourneyStore.getState().activeJourney;
    expect(journey.legs[0].status).toBe('ACTIVE');
  });
});
