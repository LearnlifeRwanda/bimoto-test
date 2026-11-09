// __TESTS__/BOOK-UNBLOCK-MISSING-POINTS.TEST.TSX
//
// BOOK-UNBLOCK G1 — the disabled submit button explains itself. On
// both request pages the missing-points hint is in the DOM exactly
// when the button is disabled, names each missing input, and vanishes
// once the form is complete (the button enabling in the same moment).

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

// react-leaflet is not jsdom-friendly; mock it and capture the map
// event handlers so tests can plant points through the picker.
let mapEventHandlers: any = null;
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  Marker: ({ position }: any) => (
    <div data-testid="marker" data-pos={`${position[0]},${position[1]}`} />
  ),
  Polyline: ({ positions }: any) => (
    <div data-testid="polyline" data-count={positions.length} />
  ),
  Popup: ({ children }: any) => <div>{children}</div>,
  useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn() }),
  useMapEvents: (handlers: any) => {
    mapEventHandlers = handlers;
    return {};
  },
}));

vi.mock('leaflet', () => ({
  default: { divIcon: () => ({}) },
  divIcon: () => ({}),
}));

import { NewJourneyPage } from '../pages/customer/NewJourneyPage';
import { GoodsRequestPage } from '../pages/customer/GoodsRequestPage';
import { useAuthStore } from '../stores/auth.store';
import { _resetGeocodeAvailabilityForTests } from '../hooks/useGeocodeSearch';

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      journey: {
        missingPickup: 'Set your pickup point',
        missingDestination: 'Set your destination',
        findDrivers: 'Find drivers',
        pickOnMap: 'Choose on map',
      },
      goods: {
        missingDescription: 'Describe the goods',
        submit: 'Request delivery',
        descriptionPlaceholder: 'goods description',
      },
      picker: {
        confirmPickup: 'Set pickup here',
        confirmDestination: 'Set destination here',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

  useAuthStore.setState({
    token: 'tok',
    user: { id: 'c1', role: 'CUSTOMER' } as any,
  } as any);

  // Geocoding proxy is down (pilot server: LOCATIONIQ_API_KEY unset).
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/geocode/')) {
        return new Response(
          JSON.stringify({
            error: { code: 'GEOCODING_UNAVAILABLE', message: 'errors.geocodingUnavailable' },
          }),
          { status: 503 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetGeocodeAvailabilityForTests();
  mapEventHandlers = null;
});

function renderAt(path: string, element: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Plant a point through the picker: tap the map, then confirm. */
async function confirmPoint(confirmLabel: string, lat: number, lng: number) {
  act(() => {
    mapEventHandlers.click({ latlng: { lat, lng } });
  });
  fireEvent.click(screen.getByText(confirmLabel));
  await act(async () => {});
}

describe('BOOK-UNBLOCK G1 — the disabled submit explains what is missing', () => {
  test('NewJourneyPage: hint present iff disabled, and names each missing point', async () => {
    renderAt('/customer/new', <NewJourneyPage />);
    await act(async () => {});

    // Nothing set → both lines, button disabled.
    const hint = screen.getByTestId('submit-missing-hint');
    expect(hint).toHaveTextContent('Set your pickup point');
    expect(hint).toHaveTextContent('Set your destination');
    expect(screen.getByText('Find drivers').closest('button')).toBeDisabled();

    // Pickup set → only the destination line remains.
    await confirmPoint('Set pickup here', -1.95, 30.06);
    expect(screen.getByTestId('submit-missing-hint')).not.toHaveTextContent(
      'Set your pickup point',
    );
    expect(screen.getByTestId('submit-missing-hint')).toHaveTextContent(
      'Set your destination',
    );
    expect(screen.getByText('Find drivers').closest('button')).toBeDisabled();

    // Both set → hint gone, button enabled: the pairing a test can assert.
    await confirmPoint('Set destination here', -1.96, 30.1);
    expect(screen.queryByTestId('submit-missing-hint')).toBeNull();
    expect(screen.getByText('Find drivers').closest('button')).not.toBeDisabled();
  });

  test('GoodsRequestPage: hint also covers the goods description', async () => {
    renderAt('/customer/goods', <GoodsRequestPage />);
    await act(async () => {});

    const hint = screen.getByTestId('submit-missing-hint');
    expect(hint).toHaveTextContent('Set your pickup point');
    expect(hint).toHaveTextContent('Set your destination');
    expect(hint).toHaveTextContent('Describe the goods');
    expect(screen.getByText('Request delivery').closest('button')).toBeDisabled();

    await confirmPoint('Set pickup here', -1.95, 30.06);
    await confirmPoint('Set destination here', -1.96, 30.1);
    fireEvent.change(screen.getByPlaceholderText('goods description'), {
      target: { value: 'A box of books' },
    });

    expect(screen.queryByTestId('submit-missing-hint')).toBeNull();
    expect(
      screen.getByText('Request delivery').closest('button'),
    ).not.toBeDisabled();
  });
});
