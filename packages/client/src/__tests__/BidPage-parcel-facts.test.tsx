// PARCEL-CATEGORY G5 — the bid screen tells the motari what he is being
// asked to carry.
//
// THE GAP THIS FILE PINS. An ordinary GoodsRequestPage booking is
// LEG-LESS: the sender names a pickup and a destination and the journey
// carries no Leg rows at all. BidPage's only parcel-bearing render was
// JourneyLegsDisplay, which renders nothing for a leg-less journey — so
// a bidding motari opening a plain parcel request saw no size, no
// weight, no fragile warning and no description, on the one screen
// where he commits to carrying the thing. The feed card he opened it
// FROM showed all four (PARCEL-VISIBLE G4).
//
// Every one of these fields has been on the wire the whole time: the
// #191 raw-body E2E (journey-read-authorization.spec.ts) pins that they
// all REMAIN in the pre-match body this page fetches, while the three
// columns that name PEOPLE are deleted from it. Nothing new is
// collected or transmitted to render any of this.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
import { BidPage } from '../pages/driver/BidPage';
import { useAuthStore } from '../stores/auth.store';

/**
 * A pre-match bidder's view of an ordinary parcel booking, shaped as the
 * service actually returns it: the whole journey row minus the three
 * deleted identity columns. No legs, because the send-a-package form
 * does not create any.
 */
const STRIPPED_PARCEL = {
  id: 'j1',
  type: 'GOODS',
  status: 'REQUESTED',
  pickupName: 'Kimironko Market',
  destinationName: 'Kigali Convention Centre',
  estimatedDistance: 6.1,
  vehiclePreference: null,
  wishPrice: 2000,
  goodsSizeCategory: 'MEDIUM',
  goodsWeightKg: 4.5,
  goodsFragile: true,
  goodsDescription: 'A wrapped box of medicine',
  parcelCategory: 'ELECTRONICS',
  customer: { id: 'c1', nickname: 'Passenger', completedRides: 3 },
  // recipientName / recipientPhone / childGuardianPhone are ABSENT, as
  // the strip leaves them.
};

const PASSENGER_RIDE = {
  id: 'j1',
  type: 'PASSENGER',
  status: 'REQUESTED',
  pickupName: 'Nyabugogo',
  destinationName: 'Remera',
  estimatedDistance: 3.4,
  vehiclePreference: 'MOTO',
  wishPrice: 1200,
  customer: { id: 'c1', nickname: 'Passenger', completedRides: 3 },
};

function stubJourney(journey: object) {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/api/journeys/j1')) {
      return new Response(JSON.stringify(journey), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      // The SAME keys the leg badge and the feed card read. Nothing new.
      delivery: {
        parcelCategoryFood: 'Food',
        parcelCategoryElectronics: 'Electronics',
        parcelCategoryDocuments: 'Documents',
        parcelCategoryFragile: 'Fragile',
        parcelCategoryOther: 'Other',
      },
      goods: {
        size: 'Size',
        size_small: 'Small',
        size_medium: 'Medium',
        size_large: 'Large',
        fragile: 'Fragile',
      },
      parcel: { weightKg: '{{weight}} kg' },
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
      journey: { any_vehicle: 'Any vehicle' },
      common: { back: 'Back' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

  useAuthStore.setState({
    token: 'tok',
    user: { id: 'd1', role: 'DRIVER', driverProfile: { totalRides: 0 } } as any,
  } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderBidPage() {
  return render(
    <MemoryRouter initialEntries={['/driver/bid/j1']}>
      <Routes>
        <Route path="/driver/bid/:id" element={<BidPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('the bid screen, on a leg-less parcel', () => {
  test('shows what the parcel contains', async () => {
    stubJourney(STRIPPED_PARCEL);
    renderBidPage();

    const badge = await screen.findByTestId('parcel-category');
    expect(badge).toHaveTextContent('Electronics');
    expect(badge).toHaveAttribute('data-category', 'ELECTRONICS');
  });

  test('shows the size, weight, fragility and description beside it', async () => {
    stubJourney(STRIPPED_PARCEL);
    renderBidPage();

    expect(await screen.findByTestId('parcel-size')).toHaveTextContent('Medium');
    expect(screen.getByTestId('parcel-weight')).toHaveTextContent('4.5 kg');
    expect(screen.getByTestId('parcel-fragile')).toHaveTextContent('Fragile');
    expect(screen.getByTestId('parcel-description')).toHaveTextContent(
      'A wrapped box of medicine',
    );
  });

  test('and still names no recipient — the privacy floor is untouched', async () => {
    // The strip deletes the three identity columns before the payload
    // leaves the server; this screen renders only what survives it.
    stubJourney(STRIPPED_PARCEL);
    renderBidPage();

    await screen.findByTestId('parcel-category');
    expect(document.body.textContent).not.toContain('recipientName');
    expect(document.body.textContent).not.toContain('recipientPhone');
  });

  test('a parcel booked before the question shows NO category badge', async () => {
    stubJourney({ ...STRIPPED_PARCEL, parcelCategory: null });
    renderBidPage();

    expect(await screen.findByTestId('parcel-size')).toBeTruthy();
    expect(screen.queryByTestId('parcel-category')).toBeNull();
  });

  test('a value outside the five shows NO badge, not a broken one', async () => {
    stubJourney({ ...STRIPPED_PARCEL, parcelCategory: 'LIVESTOCK' });
    renderBidPage();

    expect(await screen.findByTestId('parcel-size')).toBeTruthy();
    expect(screen.queryByTestId('parcel-category')).toBeNull();
  });
});

describe('a passenger ride is unchanged', () => {
  test('renders no parcel block at all', async () => {
    stubJourney(PASSENGER_RIDE);
    renderBidPage();

    await waitFor(() => expect(screen.getByText('Nyabugogo')).toBeTruthy());
    expect(screen.queryByTestId('parcel-summary')).toBeNull();
    expect(screen.queryByTestId('parcel-category')).toBeNull();
  });
});
