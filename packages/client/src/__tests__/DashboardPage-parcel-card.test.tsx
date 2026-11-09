// PARCEL-VISIBLE G4 — the card learns what it is showing.
//
// Three defects, one card:
//   #5 the driver could not tell a parcel from a passenger. The payload
//      carried `type` and every parcel field; the card rendered none of it,
//      and <UrgentBadge> returns null for a plain GOODS journey, so the
//      commonest parcel there is carried no marker at all.
//   #8 two chips that have never rendered. `request.distance` and
//      `request.vehicleType` are not fields on Journey — the real names are
//      `estimatedDistance` (already in km) and `vehiclePreference`.
//
// The passenger card is asserted UNCHANGED in the same file, because the
// point of the parcel marker is the contrast.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
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

const PARCEL = {
  id: 'j-parcel',
  type: 'GOODS',
  status: 'REQUESTED',
  pickupName: 'Kimironko Market',
  destinationName: 'Kigali Convention Centre',
  estimatedDistance: 5.22,
  vehiclePreference: null,
  wishPrice: 2000,
  goodsSizeCategory: 'MEDIUM',
  goodsWeightKg: 4.5,
  goodsFragile: true,
  goodsDescription: 'A wrapped box of medicine for the clinic',
  createdAt: new Date().toISOString(),
};

const PASSENGER = {
  id: 'j-passenger',
  type: 'PASSENGER',
  status: 'REQUESTED',
  pickupName: 'Nyabugogo',
  destinationName: 'Remera',
  estimatedDistance: 3.4,
  vehiclePreference: 'MOTO',
  wishPrice: 1200,
  createdAt: new Date().toISOString(),
};

let feed: object[];

beforeEach(async () => {
  feed = [];
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
        justNow: 'just now',
        minutesAgo: '{{n}}m ago',
        hoursAgo: '{{n}}h ago',
        fetchFailed: 'Could not load nearby requests',
      },
      parcel: {
        badge: 'PARCEL',
        badgeAriaLabel: 'Parcel delivery',
        weightKg: '{{weight}} kg',
      },
      goods: {
        size: 'Size',
        size_small: 'Small',
        size_medium: 'Medium',
        size_large: 'Large',
        fragile: 'Fragile',
      },
      // PARCEL-CATEGORY — the SAME keys the drop-a-package leg badge
      // reads. Nothing new: all eighteen existed in en/fr/rw before.
      delivery: {
        parcelCategoryFood: 'Food',
        parcelCategoryElectronics: 'Electronics',
        parcelCategoryDocuments: 'Documents',
        parcelCategoryFragile: 'Fragile',
        parcelCategoryOther: 'Other',
      },
      journey: {
        any_vehicle: 'Any vehicle',
        geoFailed: 'Could not get GPS',
        geoNotSupported: 'GPS not supported',
      },
      vehicles: { moto: 'Moto Taxi' },
      account: {
        viewAccount: 'View account status',
        statusFlagged: 'Flagged',
        statusSuspended: 'Suspended until {{until}}',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

  useAuthStore.setState({
    token: 'tok',
    user: { id: 'driver-1', role: 'DRIVER' } as any,
    isAuthenticated: true,
    isLoading: false,
  });
  useJourneyStore.setState({ nearbyRequests: [], availableSignal: null });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/journeys?viewAs=driver')) {
        return { ok: true, status: 200, json: async () => feed } as Response;
      }
      if (
        url.includes('/api/users/me/location') ||
        url.includes('/api/users/me/online-status')
      ) {
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }
      if (url.endsWith('/api/users/me')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'driver-1', role: 'DRIVER', driverProfile: { isOnline: false } }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as any,
  );
});

/** Go online, which is what makes the dashboard fetch and render the feed. */
async function openFeed() {
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText("I'm offline"));
  await waitFor(() => expect(screen.queryByText(/nearby/)).toBeTruthy());
}

describe('the driver feed card, on a parcel (PARCEL-VISIBLE G4)', () => {
  test('a plain GOODS parcel is marked as a parcel', async () => {
    feed = [PARCEL];
    await openFeed();

    const badge = await screen.findByTestId('parcel-badge');
    expect(badge).toHaveTextContent('PARCEL');
    // UrgentBadge still returns null for a plain GOODS journey — its
    // contract is untouched; the parcel marker is a sibling, not a change
    // to it.
    expect(screen.queryByTestId('urgent-badge')).toBeNull();
  });

  test('the card shows what prices the job: size, weight, fragile, description', async () => {
    feed = [PARCEL];
    await openFeed();

    expect(await screen.findByTestId('parcel-size')).toHaveTextContent('Size: Medium');
    expect(screen.getByTestId('parcel-weight')).toHaveTextContent('4.5 kg');
    expect(screen.getByTestId('parcel-fragile')).toHaveTextContent('Fragile');
    expect(screen.getByTestId('parcel-description')).toHaveTextContent(
      'A wrapped box of medicine',
    );
  });

  test('a passenger card is unchanged — no parcel marker, no parcel fields', async () => {
    feed = [PASSENGER];
    await openFeed();

    await waitFor(() => expect(screen.getByText('Nyabugogo')).toBeTruthy());
    expect(screen.queryByTestId('parcel-badge')).toBeNull();
    expect(screen.queryByTestId('parcel-summary')).toBeNull();
  });

  test('a parcel with no weight and no description renders the rest, not blanks', async () => {
    feed = [{ ...PARCEL, goodsWeightKg: null, goodsDescription: null, goodsFragile: false }];
    await openFeed();

    expect(await screen.findByTestId('parcel-size')).toHaveTextContent('Medium');
    expect(screen.queryByTestId('parcel-weight')).toBeNull();
    expect(screen.queryByTestId('parcel-description')).toBeNull();
    expect(screen.queryByTestId('parcel-fragile')).toBeNull();
  });
});

describe('what is IN the parcel, on the card (PARCEL-CATEGORY G4)', () => {
  // The fixture is SERVICE-SHAPED: a bidder feed row is the whole
  // journey row minus the three deleted identity columns, so the
  // category arrives as a plain string on the same object as the size.
  test('the category the sender chose is on the card, pre-match', async () => {
    feed = [{ ...PARCEL, parcelCategory: 'ELECTRONICS' }];
    await openFeed();

    const badge = await screen.findByTestId('parcel-category');
    expect(badge).toHaveTextContent('Electronics');
    expect(badge).toHaveAttribute('data-category', 'ELECTRONICS');
  });

  test('it composes — the category sits beside the size, weight and fragile chips', async () => {
    feed = [{ ...PARCEL, parcelCategory: 'FOOD' }];
    await openFeed();

    expect(await screen.findByTestId('parcel-category')).toHaveTextContent('Food');
    expect(screen.getByTestId('parcel-size')).toHaveTextContent('Medium');
    expect(screen.getByTestId('parcel-weight')).toHaveTextContent('4.5 kg');
    expect(screen.getByTestId('parcel-fragile')).toHaveTextContent('Fragile');
    // And the PARCEL marker is untouched: badges compose, nothing
    // replaced the ParcelBadge contract.
    expect(screen.getByTestId('parcel-badge')).toHaveTextContent('PARCEL');
  });

  test('a legacy parcel — booked before the question existed — shows NO badge', async () => {
    // NULL means "was never asked". Rendering OTHER here would put an
    // answer in a sender's mouth that he never gave.
    feed = [{ ...PARCEL, parcelCategory: null }];
    await openFeed();

    expect(await screen.findByTestId('parcel-size')).toBeTruthy();
    expect(screen.queryByTestId('parcel-category')).toBeNull();
  });

  test('a parcel with no category key at all shows NO badge', async () => {
    feed = [PARCEL];
    await openFeed();

    expect(await screen.findByTestId('parcel-size')).toBeTruthy();
    expect(screen.queryByTestId('parcel-category')).toBeNull();
  });

  test('a value outside the five shows NO badge, not a broken one', async () => {
    feed = [{ ...PARCEL, parcelCategory: 'LIVESTOCK' }];
    await openFeed();

    expect(await screen.findByTestId('parcel-size')).toBeTruthy();
    expect(screen.queryByTestId('parcel-category')).toBeNull();
  });

  test('a passenger card still shows nothing — the category changes no ride', async () => {
    feed = [PASSENGER];
    await openFeed();

    await waitFor(() => expect(screen.getByText('Nyabugogo')).toBeTruthy());
    expect(screen.queryByTestId('parcel-category')).toBeNull();
    expect(screen.queryByTestId('parcel-summary')).toBeNull();
  });
});

describe('the two chips that had never rendered (PARCEL-VISIBLE G4 / C1 #8)', () => {
  test('the distance chip reads estimatedDistance, in kilometres', async () => {
    feed = [PASSENGER];
    await openFeed();

    // 3.4 km — NOT 0.0, which is what the old `distance / 1000` produced
    // for every journey that had a distance at all.
    expect(await screen.findByTestId('request-distance')).toHaveTextContent('3.4 km');
  });

  test('the vehicle chip reads vehiclePreference', async () => {
    feed = [PASSENGER];
    await openFeed();

    expect(await screen.findByTestId('request-vehicle')).toHaveTextContent('Moto Taxi');
  });

  test('a null vehiclePreference renders the any-vehicle label, not an empty chip', async () => {
    feed = [PARCEL];
    await openFeed();

    expect(await screen.findByTestId('request-vehicle')).toHaveTextContent('Any vehicle');
  });

  test('a journey with no estimatedDistance shows no distance chip', async () => {
    feed = [{ ...PASSENGER, estimatedDistance: null }];
    await openFeed();

    await waitFor(() => expect(screen.getByText('Nyabugogo')).toBeTruthy());
    expect(screen.queryByTestId('request-distance')).toBeNull();
  });
});
