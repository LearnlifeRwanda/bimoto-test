// __TESTS__/BOOK-UNBLOCK-PICKUP-PREFILL.TEST.TSX
//
// BOOK-UNBLOCK G3 — entering a request page attempts one silent GPS
// fix and pre-fills pickup with the journey.currentLocation label:
//   - success → pickup set, the missing-points hint drops the pickup line
//   - failure → completely silent, the form is untouched
//   - a pickup the user set first is never overwritten by a late fix
//
// The GPS mock inspects options: MapCanvas centers with
// enableHighAccuracy:false, while the pre-fill (and manual button) use
// enableHighAccuracy:true — so the map's own call never eats the
// behaviour under test.

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
import { useAuthStore } from '../stores/auth.store';
import { useUIStore } from '../stores/ui.store';
import { _resetGeocodeAvailabilityForTests } from '../hooks/useGeocodeSearch';
import { geolocation } from '../hooks/useGeolocation';

const FIX = { lat: -1.9536, lng: 30.0606, accuracy: 5, speed: null, heading: null, timestamp: 1 };

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      journey: {
        currentLocation: 'Current location',
        pickupPlaceholder: 'pickup',
        destinationPlaceholder: 'destination',
        missingPickup: 'Set your pickup point',
        missingDestination: 'Set your destination',
        geoFailed: 'Could not get GPS',
        geoNotSupported: 'GPS not supported',
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

  // Reverse geocoding down (pilot server) — the generic label must stay.
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

/** GPS answers only high-accuracy requests (pre-fill / manual button);
 * MapCanvas's low-accuracy centering call is rejected. */
function stubGps(highAccuracyImpl: () => Promise<typeof FIX>) {
  return vi
    .spyOn(geolocation, 'getCurrentPosition')
    .mockImplementation(async (options?: { enableHighAccuracy?: boolean }) => {
      if (options?.enableHighAccuracy === false) {
        throw { code: 'position-unavailable', message: 'no centering fix' };
      }
      return highAccuracyImpl();
    });
}

describe('BOOK-UNBLOCK G3 — entry pre-fills pickup from GPS', () => {
  test('NewJourneyPage: a successful fix pre-fills pickup with the generic label', async () => {
    stubGps(async () => FIX);
    renderAt('/customer/new', <NewJourneyPage />);

    const pickupInput = screen.getByPlaceholderText('pickup') as HTMLInputElement;
    await waitFor(() => expect(pickupInput.value).toBe('Current location'));
    // One point ahead: only the destination is still missing.
    expect(screen.getByTestId('submit-missing-hint')).not.toHaveTextContent(
      'Set your pickup point',
    );
    expect(screen.getByTestId('submit-missing-hint')).toHaveTextContent(
      'Set your destination',
    );
  });

  test('GoodsRequestPage: the same pre-fill runs on entry', async () => {
    stubGps(async () => FIX);
    renderAt('/customer/goods', <GoodsRequestPage />);

    const pickupInput = screen.getByPlaceholderText('pickup') as HTMLInputElement;
    await waitFor(() => expect(pickupInput.value).toBe('Current location'));
  });

  test('a failed fix is silent: no toast, form untouched', async () => {
    stubGps(async () => {
      throw { code: 'permission-denied', message: 'denied' };
    });
    const showToast = vi.fn();
    useUIStore.setState({ showToast } as any);
    renderAt('/customer/new', <NewJourneyPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(
      (screen.getByPlaceholderText('pickup') as HTMLInputElement).value,
    ).toBe('');
    expect(showToast).not.toHaveBeenCalled();
    expect(screen.getByTestId('submit-missing-hint')).toHaveTextContent(
      'Set your pickup point',
    );
  });

  test('a late fix never overwrites a pickup the user already set', async () => {
    let resolveFix: (v: typeof FIX) => void = () => {};
    stubGps(
      () =>
        new Promise<typeof FIX>((resolve) => {
          resolveFix = resolve;
        }),
    );
    renderAt('/customer/new', <NewJourneyPage />);
    await act(async () => {});

    // The user plants a pickup via the map while GPS is still resolving.
    act(() => {
      mapEventHandlers.click({ latlng: { lat: -1.9, lng: 30.1 } });
    });
    fireEvent.click(screen.getByText('Set pickup here'));
    await act(async () => {});
    const pickupInput = screen.getByPlaceholderText('pickup') as HTMLInputElement;
    const userValue = pickupInput.value;
    expect(userValue).not.toBe('');

    // GPS finally resolves — the user's choice must survive.
    await act(async () => {
      resolveFix(FIX);
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(pickupInput.value).toBe(userValue);
  });
});
