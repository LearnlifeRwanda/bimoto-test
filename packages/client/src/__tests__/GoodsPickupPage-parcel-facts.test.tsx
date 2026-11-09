// VALIDATE-MEND G3 — the two facts the motari needs while the parcel is
// in his hands.
//
// GoodsPickupPage read `activeJourney.goodsSize` and
// `activeJourney.isFragile`. Neither field exists. The journey row
// carries `goodsSizeCategory` and `goodsFragile` — the same names the
// customer's form writes (GoodsRequestPage), the same names the driver's
// feed card reads (ParcelSummary, PARCEL-VISIBLE G4), the same names
// the local table declares (db/tables.ts). So the assigned motari, at
// the one moment he is picking the thing up, saw NO size and NO fragile
// warning at all — the C1 #8 chip class, one screen further along.
//
// Nothing typechecked it because journey.store types activeJourney as
// `any`. A test is the only oracle this class has.
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

vi.mock('../hooks/useRouteDirections', () => ({ useRouteDirections: () => null }));

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

vi.mock('../hooks/useRideTraceRecorder', () => ({
  useRideTraceRecorder: () => ({ isRecording: false }),
}));

import { GoodsPickupPage } from '../pages/driver/GoodsPickupPage';
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';
import { useChatStore } from '../stores/chat.store';

// A fragile MEDIUM parcel, at the pickup stage: no photo uploaded yet,
// so recoverStep lands on 'pickup_photo' — the screen that shows the
// goods panel.
const PARCEL_JOURNEY = {
  id: 'j-parcel',
  status: 'MATCHED',
  journeyType: 'GOODS',
  pickupName: 'Kimironko Market',
  destinationName: 'Nyabugogo',
  pickupLat: -1.95,
  pickupLng: 30.06,
  destinationLat: -1.9441,
  destinationLng: 30.0619,
  agreedPrice: 2000,
  goodsDescription: 'A box of glassware',
  goodsSizeCategory: 'MEDIUM',
  goodsFragile: true,
  pickupPhotoUrl: null,
  deliveryPhotoUrl: null,
  customer: { nickname: 'Alice' },
  driver: { id: 'driver-1', driverProfile: { vehicleType: 'MOTO' } },
};

function renderPickup() {
  return render(
    <MemoryRouter initialEntries={['/driver/goods-pickup/j-parcel']}>
      <Routes>
        <Route path="/driver/goods-pickup/:id" element={<GoodsPickupPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      goodsPickup: {
        takePickupPhoto: 'Take the pickup photo',
        pickupPhotoDesc: 'Photograph the goods',
        goodsDesc: 'Goods',
        size: 'Size',
        fragileWarning: 'Fragile — handle with care',
      },
      goods: { size_small: 'Small', size_medium: 'Medium', size_large: 'Large' },
      // PARCEL-CATEGORY — the same keys the feed card and the leg badge
      // read, so nothing renames itself between deciding and carrying.
      delivery: {
        parcelCategoryFood: 'Food',
        parcelCategoryElectronics: 'Electronics',
        parcelCategoryDocuments: 'Documents',
        parcelCategoryFragile: 'Fragile',
        parcelCategoryOther: 'Other',
      },
    },
    true,
    true,
  );

  useAuthStore.setState({
    token: 'tok',
    user: { id: 'driver-1', nickname: 'Driver Bob', role: 'DRIVER', language: 'en' },
    isAuthenticated: true,
    isLoading: false,
  } as never);
  useJourneyStore.setState({ activeJourney: PARCEL_JOURNEY as never });
  useChatStore.setState({ messages: [], isLoading: false } as never);

  (globalThis as { fetch?: unknown }).fetch = vi.fn(async (url: unknown) => {
    if (typeof url === 'string' && url.includes('/messages')) {
      return { ok: true, json: async () => [] };
    }
    return { ok: true, json: async () => PARCEL_JOURNEY };
  });
});

describe('the pickup screen shows what the motari is carrying', () => {
  test('names the size of the parcel', async () => {
    renderPickup();
    await waitFor(() => expect(screen.getByText('A box of glassware')).toBeTruthy());

    // Read through the same locale keys ParcelSummary uses: the catalogue
    // keys are lowercase (goods.size_medium) while the column is
    // uppercase (MEDIUM), so the read has to fold the case or it renders
    // the raw key back at him.
    expect(screen.getByText(/Size: Medium/)).toBeTruthy();
  });

  test('warns that it is fragile', async () => {
    renderPickup();
    await waitFor(() => expect(screen.getByText('A box of glassware')).toBeTruthy());

    expect(screen.getByText('Fragile — handle with care')).toBeTruthy();
  });

  // PARCEL-CATEGORY — what the sender said is in it, in his hands.
  test('names what the parcel contains', async () => {
    const withCategory = { ...PARCEL_JOURNEY, parcelCategory: 'ELECTRONICS' };
    useJourneyStore.setState({ activeJourney: withCategory as never });
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => withCategory,
    }));

    renderPickup();
    await waitFor(() => expect(screen.getByText('A box of glassware')).toBeTruthy());

    const badge = screen.getByTestId('goods-pickup-category');
    expect(badge).toHaveTextContent('Electronics');
    expect(badge).toHaveAttribute('data-category', 'ELECTRONICS');
    // The fragile WARNING is a separate answer to a separate question
    // and is untouched by the category.
    expect(screen.getByText('Fragile — handle with care')).toBeTruthy();
  });

  test('a parcel booked before the question was asked shows no category', async () => {
    // The fixture carries no parcelCategory at all — a legacy row. NULL
    // means "was never asked", and a badge here would invent an answer.
    renderPickup();
    await waitFor(() => expect(screen.getByText('A box of glassware')).toBeTruthy());

    expect(screen.queryByTestId('goods-pickup-category')).toBeNull();
  });

  test('says nothing about size or fragility when the parcel has neither', async () => {
    // Every parcel column is nullable and a run booked before a field
    // existed simply has no answer. Absent must render as absent, never
    // as a default — the ParcelSummary rule.
    const plain = {
      ...PARCEL_JOURNEY,
      goodsSizeCategory: null,
      goodsFragile: false,
    };
    useJourneyStore.setState({ activeJourney: plain as never });
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => plain,
    }));

    renderPickup();
    await waitFor(() => expect(screen.getByText('A box of glassware')).toBeTruthy());

    expect(screen.queryByText(/Size:/)).toBeNull();
    expect(screen.queryByText('Fragile — handle with care')).toBeNull();
  });
});
