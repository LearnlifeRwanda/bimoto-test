// __TESTS__/BOOK-UNBLOCK-PICK-ON-MAP.TEST.TSX
//
// BOOK-UNBLOCK G2 — pick-on-map is a visible affordance, not a hidden
// gesture:
//   - a "Choose on map" control renders next to each address field
//   - pressing it collapses the sheet and selects the matching picker
//     target (the new pickRequest prop on LocationPickerMap)
//   - a pin confirmed while reverse geocoding 503s populates the field
//     with the plain coordinates label — booking works with zero
//     geocoding
//   - once address search reports unavailable, the control is promoted
//     to primary

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

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
import { coordinatesLabel } from '../components/map/LocationPickerMap';
import { useAuthStore } from '../stores/auth.store';
import { _resetGeocodeAvailabilityForTests } from '../hooks/useGeocodeSearch';

const TAP = { lat: -1.9536, lng: 30.0606 };

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      journey: {
        pickOnMap: 'Choose on map',
        pickupPlaceholder: 'pickup',
        destinationPlaceholder: 'destination',
      },
      picker: {
        pickup: 'Pickup',
        destination: 'Destination',
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

  // Pilot server: every geocode call 503s.
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

describe('BOOK-UNBLOCK G2 — pick-on-map affordance', () => {
  test('both pages render a Choose-on-map control per address field', async () => {
    const { unmount } = renderAt('/customer/new', <NewJourneyPage />);
    await act(async () => {});
    expect(screen.getByTestId('pick-on-map-pickup')).toBeInTheDocument();
    expect(screen.getByTestId('pick-on-map-destination')).toBeInTheDocument();
    unmount();

    renderAt('/customer/goods', <GoodsRequestPage />);
    await act(async () => {});
    expect(screen.getByTestId('pick-on-map-pickup')).toBeInTheDocument();
    expect(screen.getByTestId('pick-on-map-destination')).toBeInTheDocument();
  });

  test('pressing the control collapses the sheet and selects the target', async () => {
    renderAt('/customer/new', <NewJourneyPage />);
    await act(async () => {});

    expect(screen.getByTestId('bottom-sheet').dataset.sheetState).toBe('expanded');

    fireEvent.click(screen.getByTestId('pick-on-map-destination'));
    expect(screen.getByTestId('bottom-sheet').dataset.sheetState).toBe('collapsed');
    expect(screen.getByTestId('picker-mode-destination')).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // And back to pickup — the same control re-selects even after the
    // chip was changed.
    fireEvent.click(screen.getByTestId('pick-on-map-pickup'));
    expect(screen.getByTestId('picker-mode-pickup')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('confirming a pin with reverse geocoding down fills the field with a coordinates label', async () => {
    renderAt('/customer/new', <NewJourneyPage />);
    await act(async () => {});

    fireEvent.click(screen.getByTestId('pick-on-map-pickup'));
    act(() => {
      mapEventHandlers.click({ latlng: { lat: TAP.lat, lng: TAP.lng } });
    });
    fireEvent.click(screen.getByTestId('picker-confirm'));
    await act(async () => {});

    const expected = coordinatesLabel(TAP.lat, TAP.lng);
    expect(
      (screen.getByPlaceholderText('pickup') as HTMLInputElement).value,
    ).toBe(expected);
  });

  test('the control is promoted to primary once address search reports unavailable', async () => {
    renderAt('/customer/new', <NewJourneyPage />);
    await act(async () => {});

    expect(screen.getByTestId('pick-on-map-pickup').dataset.primary).toBeUndefined();

    // Typing triggers a search; the 503 flips the session flag and the
    // field reports unavailable up to the page.
    fireEvent.change(screen.getByPlaceholderText('pickup'), {
      target: { value: 'Kimironko market' },
    });
    await waitFor(
      () =>
        expect(screen.getByTestId('pick-on-map-pickup').dataset.primary).toBe(
          'true',
        ),
      { timeout: 2000 },
    );
    expect(screen.getByTestId('pick-on-map-destination').dataset.primary).toBe(
      'true',
    );
  });
});
