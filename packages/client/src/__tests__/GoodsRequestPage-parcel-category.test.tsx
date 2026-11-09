// PARCEL-CATEGORY G5 — the sender is asked what is in the package, and
// what he answers is what travels.
//
// Faustin settled the field on 24 August: the send-a-package form must
// ask the same contents question the drop-a-package flow already asks,
// and the motari must see the answer before he accepts. This file pins
// the sender's half — the five choices are offered in the same words
// the leg flow uses, an untouched form still sends a concrete answer,
// and a touched one sends what was touched.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<any>);
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  Marker: ({ children }: any) => <div data-testid="marker">{children}</div>,
  Polyline: () => null,
  Popup: ({ children }: any) => <div>{children}</div>,
  useMap: () => ({ fitBounds: vi.fn() }),
  useMapEvents: () => ({}),
}));

vi.mock('leaflet', () => ({
  default: { divIcon: () => ({}) },
  divIcon: () => ({}),
}));

import { GoodsRequestPage } from '../pages/customer/GoodsRequestPage';
import { useAuthStore } from '../stores/auth.store';
import { _resetGeocodeAvailabilityForTests } from '../hooks/useGeocodeSearch';
import { createJourneySchema } from '@bimoto/shared';

const SUGGESTION = { lat: -1.9536, lng: 30.0606, label: 'Kimironko Market, Kigali' };

function stubFetch(journeyResponse: any = { id: 'j1', status: 'REQUESTED' }) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/geocode/search')) {
      return new Response(JSON.stringify({ results: [SUGGESTION] }), { status: 200 });
    }
    return new Response(JSON.stringify(journeyResponse), { status: 201 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function pickAddress(placeholder: string, text: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), {
    target: { value: text },
  });
  const option = await screen.findByText(SUGGESTION.label, {}, { timeout: 2000 });
  fireEvent.click(option);
}

function journeyPostBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.find(
    ([u, init]: any[]) => String(u).endsWith('/api/journeys') && init?.method === 'POST',
  );
  return call ? JSON.parse((call[1] as any).body) : undefined;
}

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      goods: {
        title: 'Send goods',
        details: 'Goods details',
        description: 'Description',
        descriptionPlaceholder: 'What is being sent?',
        size: 'Size',
        size_small: 'Small',
        size_medium: 'Medium',
        size_large: 'Large',
        fragile: 'Fragile',
        recipientName: 'Recipient name',
        recipientNamePlaceholder: 'recipient name',
        recipientPhone: 'Recipient phone',
        recipientPhonePlaceholder: 'recipient phone',
        submit: 'Request delivery',
      },
      // The SAME keys the drop-a-package leg flow reads. Nothing here is
      // new — all eighteen existed in en/fr/rw before this dispatch.
      delivery: {
        parcelCategoryLabel: 'Parcel contents',
        parcelCategoryFood: 'Food',
        parcelCategoryElectronics: 'Electronics',
        parcelCategoryDocuments: 'Documents',
        parcelCategoryFragile: 'Fragile',
        parcelCategoryOther: 'Other',
      },
      journey: {
        pickup: 'Pickup',
        pickupPlaceholder: 'pickup',
        useMyLocation: 'Use my location',
        destination: 'Destination',
        destinationPlaceholder: 'destination',
        vehicleType: 'Vehicle type',
        wishPrice: 'Wish price',
        wishPricePlaceholder: 'wish price',
      },
      vehicles: {
        bike: 'Bicycle Taxi',
        moto: 'Moto Taxi',
        emoto: 'E-Moto Taxi',
        ebike: 'E-Bike Taxi',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  mockNavigate.mockReset();
  useAuthStore.setState({ token: 'tok', user: { id: 'c1', role: 'CUSTOMER' } as any } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetGeocodeAvailabilityForTests();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/journey/goods']}>
      <Routes>
        <Route path="/journey/goods" element={<GoodsRequestPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillRequiredFields() {
  await pickAddress('pickup', 'Kimironko market');
  await pickAddress('destination', 'Kimironko market');
  fireEvent.change(screen.getByPlaceholderText('What is being sent?'), {
    target: { value: 'Spare parts' },
  });
  fireEvent.change(screen.getByPlaceholderText('recipient name'), {
    target: { value: 'Alice' },
  });
  fireEvent.change(screen.getByPlaceholderText('recipient phone'), {
    target: { value: '+250788111111' },
  });
}

async function submitAndReadBody(fetchMock: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByText('Request delivery'));
  await waitFor(() => expect(journeyPostBody(fetchMock)).toBeDefined());
  return journeyPostBody(fetchMock);
}

describe('the sender is asked what is in the package', () => {
  test('offers exactly the five choices the drop-a-package flow offers', async () => {
    stubFetch();
    renderPage();

    // The question itself, in the sender's language.
    expect(screen.getByText('Parcel contents')).toBeInTheDocument();
    // Faustin's list, and nothing else.
    for (const c of ['FOOD', 'DOCUMENTS', 'ELECTRONICS', 'FRAGILE', 'OTHER']) {
      expect(screen.getByTestId(`goods-category-${c}`)).toBeInTheDocument();
    }
    expect(screen.getAllByTestId(/^goods-category-/)).toHaveLength(5);
  });

  test('nothing is pre-selected — the sender has not answered yet', async () => {
    stubFetch();
    renderPage();

    for (const c of ['FOOD', 'DOCUMENTS', 'ELECTRONICS', 'FRAGILE', 'OTHER']) {
      expect(screen.getByTestId(`goods-category-${c}`)).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }
  });
});

describe('what the sender answers is what travels', () => {
  test('an untouched form sends OTHER — the leg-flow default, on submit', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await fillRequiredFields();

    const body = await submitAndReadBody(fetchMock);
    expect(body.parcelCategory).toBe('OTHER');
    // And the body the server will actually see still parses.
    expect(createJourneySchema.safeParse(body).error?.issues ?? []).toEqual([]);
  });

  test.each(['FOOD', 'DOCUMENTS', 'ELECTRONICS', 'FRAGILE', 'OTHER'])(
    'a sender who picks %s sends %s',
    async (category) => {
      const fetchMock = stubFetch();
      renderPage();
      await fillRequiredFields();

      fireEvent.click(screen.getByTestId(`goods-category-${category}`));
      expect(screen.getByTestId(`goods-category-${category}`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      const body = await submitAndReadBody(fetchMock);
      expect(body.parcelCategory).toBe(category);
      expect(createJourneySchema.safeParse(body).error?.issues ?? []).toEqual([]);
    },
  );

  test('picking FRAGILE the category does not tick the fragile switch', async () => {
    // The two are different questions and stay different questions. A
    // fragile electronics parcel is ELECTRONICS + goodsFragile:true; a
    // sender who names FRAGILE as the CONTENTS has not thereby answered
    // the handling question, and nothing may answer it for him.
    const fetchMock = stubFetch();
    renderPage();
    await fillRequiredFields();

    fireEvent.click(screen.getByTestId('goods-category-FRAGILE'));

    const body = await submitAndReadBody(fetchMock);
    expect(body.parcelCategory).toBe('FRAGILE');
    expect(body.goodsFragile).toBe(false);
  });

  test('the two questions compose — ELECTRONICS with the fragile switch on', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await fillRequiredFields();

    fireEvent.click(screen.getByTestId('goods-category-ELECTRONICS'));
    fireEvent.click(screen.getByRole('switch'));

    const body = await submitAndReadBody(fetchMock);
    expect(body.parcelCategory).toBe('ELECTRONICS');
    expect(body.goodsFragile).toBe(true);
  });
});
