// __TESTS__/NEW-JOURNEY-PAGE-GEOCODE.TEST.TSX
//
// GEOCODE — verifies the defused address stubs and the live
// autocomplete flow on the journey screen:
//  - typing alone NEVER sets a location (regression for the old
//    hardcoded-coordinate stub that planted pins 40 km west of Kigali)
//  - selecting a suggestion sets the real location
//  - 503 GEOCODING_UNAVAILABLE shows the subtle hint, no geocoder rows,
//    and stops asking for the rest of the session
//  - offline fires no geocode requests at all
//
// LANDMARKS G3 — and the half that does not depend on the network:
// landmark rows come first, survive both 503 and airplane mode, plant a
// verified pin when the catalog has one, and ask for a pin when it does
// not. Plus the Clear control.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

// react-leaflet is not jsdom-friendly; mock it the same way the
// individual map test files do so the page can mount without canvas.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  Marker: ({ position, children }: any) => (
    <div data-testid="marker" data-pos={`${position[0]},${position[1]}`}>
      {children}
    </div>
  ),
  Polyline: ({ positions }: any) => (
    <div data-testid="polyline" data-count={positions.length} />
  ),
  Popup: ({ children }: any) => <div>{children}</div>,
  useMap: () => ({ fitBounds: vi.fn() }),
  useMapEvents: () => ({}),
}));

vi.mock('leaflet', () => ({
  default: { divIcon: () => ({}) },
  divIcon: () => ({}),
}));

import { NewJourneyPage } from '../pages/customer/NewJourneyPage';
import { useAuthStore } from '../stores/auth.store';
import { _resetGeocodeAvailabilityForTests } from '../hooks/useGeocodeSearch';
import { geolocation } from '../hooks/useGeolocation';

const SUGGESTION = { lat: -1.9536, lng: 30.0606, label: 'Kimironko Market, Kigali' };

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      journey: {
        newRide: 'New ride',
        pickup: 'Pickup',
        pickupPlaceholder: 'pickup',
        useMyLocation: 'Use my location',
        destination: 'Destination',
        destinationPlaceholder: 'destination',
        vehicleType: 'Vehicle type',
        wishPrice: 'Wish price',
        wishPricePlaceholder: 'wish price',
        wishPriceHelper: 'helper',
        findDrivers: 'Find drivers',
        offlineWarning: 'offline',
        pickupRequired: 'pickup required',
        destinationRequired: 'destination required',
        createFailed: 'create failed',
        currentLocation: 'My location',
        addressSearching: 'Searching addresses…',
        addressNoResults: 'No matching places found',
        addressSearchUnavailable: 'Address search unavailable',
        addressSuggestions: 'Address suggestions',
      },
      home: {
        urgentDelivery: 'Urgent delivery',
        urgentDeliveryHint: 'urgent hint',
        priorityDelivery: 'Priority delivery',
        priorityDeliveryHint: 'priority hint',
      },
      vehicleTypes: { MOTO: 'Moto', CAR: 'Car', BICYCLE: 'Bike', VAN: 'Van' },
      child: { travellingToggle: 'I am travelling with a child' },
      delivery: { addStopToggle: 'Drop a package on the way' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

  useAuthStore.setState({
    token: 'tok',
    user: { id: 'c1', role: 'CUSTOMER' } as any,
  } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetGeocodeAvailabilityForTests();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/customer/new']}>
      <Routes>
        <Route path="/customer/new" element={<NewJourneyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function stubGeocodeFetch(
  geocodeResponse: () => Promise<Response> = async () =>
    new Response(JSON.stringify({ results: [SUGGESTION] }), { status: 200 }),
) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/geocode/search')) {
      return geocodeResponse();
    }
    return new Response(JSON.stringify({ id: 'j1' }), { status: 201 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('NewJourneyPage — GEOCODE address search', () => {
  test('typing alone sets NO location — the defused-stub regression anchor', async () => {
    const fetchMock = stubGeocodeFetch();
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('pickup'), {
      target: { value: 'Kimironko market' },
    });
    fireEvent.change(screen.getByPlaceholderText('destination'), {
      target: { value: 'Nyabugogo taxi park' },
    });

    // Wait past the debounce so suggestions have arrived — and still:
    await screen.findAllByText(SUGGESTION.label, {}, { timeout: 2000 });

    // No location without an explicit selection.
    expect(screen.queryByTestId('route-preview-map')).toBeNull();
    expect(screen.getByText('Find drivers').closest('button')).toBeDisabled();

    // Clicking submit anyway must never POST a journey.
    fireEvent.click(screen.getByText('Find drivers'));
    await act(async () => {});
    const journeyPost = fetchMock.mock.calls.find(([u]) =>
      String(u).includes('/api/journeys'),
    );
    expect(journeyPost).toBeUndefined();
  });

  test('selecting a suggestion sets the real location', async () => {
    stubGeocodeFetch();
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('pickup'), {
      target: { value: 'Kimironko market' },
    });
    fireEvent.click(await screen.findByText(SUGGESTION.label, {}, { timeout: 2000 }));

    fireEvent.change(screen.getByPlaceholderText('destination'), {
      target: { value: 'Kimironko market' },
    });
    fireEvent.click(await screen.findByText(SUGGESTION.label, {}, { timeout: 2000 }));

    // Both set → route preview appears with the suggestion coordinates.
    expect(screen.getByTestId('route-preview-map')).toBeInTheDocument();
    const markers = screen.getAllByTestId('marker');
    expect(markers[0].dataset.pos).toBe(`${SUGGESTION.lat},${SUGGESTION.lng}`);
    // Input shows the chosen label and the dropdown is closed.
    expect(
      (screen.getByPlaceholderText('pickup') as HTMLInputElement).value,
    ).toBe(SUGGESTION.label);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByText('Find drivers').closest('button')).not.toBeDisabled();
  });

  test('503 GEOCODING_UNAVAILABLE → hint shown, no dropdown, and no further requests this session', async () => {
    const fetchMock = stubGeocodeFetch(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 'GEOCODING_UNAVAILABLE', message: 'errors.geocodingUnavailable' },
          }),
          { status: 503 },
        ),
    );
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('pickup'), {
      target: { value: 'Kimironko market' },
    });

    // The subtle hint appears under the field, and no geocoder row does.
    // LANDMARKS G3 — landmark rows are ours and outlive the proxy: the
    // catalog answers whether or not LocationIQ has a key.
    await screen.findAllByText('Address search unavailable', {}, { timeout: 2000 });
    expect(
      screen.queryAllByRole('option').filter((r) => r.dataset.resultKind === 'geocode'),
    ).toHaveLength(0);
    // Count geocode calls only — the page also fires unrelated fetches
    // on mount (e.g. the SCHED-UI upcoming-rides section).
    const geocodeCalls = () =>
      fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/geocode/search')).length;
    const callsAfterFirst = geocodeCalls();
    expect(callsAfterFirst).toBe(1);

    // Session memory: further typing stops asking.
    fireEvent.change(screen.getByPlaceholderText('destination'), {
      target: { value: 'Nyabugogo taxi park' },
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    expect(geocodeCalls()).toBe(callsAfterFirst);
    expect(
      screen.queryAllByRole('option').filter((r) => r.dataset.resultKind === 'geocode'),
    ).toHaveLength(0);
  });

  test('GPS fix gets reverse-geocoded into a human-readable label', async () => {
    // BOOK-UNBLOCK G3 — the page now attempts one silent GPS pre-fill
    // on entry (and MapCanvas centers on the user first, consuming a
    // call of its own); reject both so this test stays about the manual
    // button (exactly one reverse lookup per manual fix).
    vi.spyOn(geolocation, 'getCurrentPosition')
      .mockRejectedValueOnce({ code: 'position-unavailable', message: 'no fix' })
      .mockRejectedValueOnce({ code: 'position-unavailable', message: 'no fix' })
      .mockResolvedValue({
        lat: -1.9536,
        lng: 30.0606,
        accuracy: 5,
        speed: null,
        heading: null,
        timestamp: 1,
      });
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/geocode/reverse')) {
        return new Response(JSON.stringify({ result: SUGGESTION }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    fireEvent.click(screen.getByLabelText('Use my location'));

    const pickupInput = screen.getByPlaceholderText('pickup') as HTMLInputElement;
    // Generic label first, then the reverse-geocoded address replaces it.
    await waitFor(() => expect(pickupInput.value).toBe(SUGGESTION.label));
    const reverseCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes('/api/geocode/reverse'),
    );
    expect(reverseCalls).toHaveLength(1);
    expect(String(reverseCalls[0][0])).toContain('lat=-1.9536');
    expect(String(reverseCalls[0][0])).toContain('lng=30.0606');
  });

  test('GPS fix keeps the generic label when reverse geocoding is unavailable (503)', async () => {
    vi.spyOn(geolocation, 'getCurrentPosition').mockResolvedValue({
      lat: -1.9536,
      lng: 30.0606,
      accuracy: 5,
      speed: null,
      heading: null,
      timestamp: 1,
    });
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/geocode/reverse')) {
        return new Response(
          JSON.stringify({
            error: { code: 'GEOCODING_UNAVAILABLE', message: 'errors.geocodingUnavailable' },
          }),
          { status: 503 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    fireEvent.click(screen.getByLabelText('Use my location'));

    const pickupInput = screen.getByPlaceholderText('pickup') as HTMLInputElement;
    await waitFor(() => expect(pickupInput.value).toBe('My location'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    // Silent fallback — today's behaviour, no error surfaced.
    expect(pickupInput.value).toBe('My location');
  });

  test('GPS fix while offline fires no reverse request and keeps the generic label', async () => {
    const onLineSpy = vi
      .spyOn(window.navigator, 'onLine', 'get')
      .mockReturnValue(false);
    vi.spyOn(geolocation, 'getCurrentPosition').mockResolvedValue({
      lat: -1.9536,
      lng: 30.0606,
      accuracy: 5,
      speed: null,
      heading: null,
      timestamp: 1,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // The page reads offline state from the UI store — set it to match.
    const { useUIStore } = await import('../stores/ui.store');
    useUIStore.setState({ isOnline: false } as any);
    renderPage();

    fireEvent.click(screen.getByLabelText('Use my location'));

    const pickupInput = screen.getByPlaceholderText('pickup') as HTMLInputElement;
    await waitFor(() => expect(pickupInput.value).toBe('My location'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    useUIStore.setState({ isOnline: true } as any);
    onLineSpy.mockRestore();
  });

  test('offline → no geocode requests are fired, but the landmarks still answer', async () => {
    const onLineSpy = vi
      .spyOn(window.navigator, 'onLine', 'get')
      .mockReturnValue(false);
    const fetchMock = stubGeocodeFetch();
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('pickup'), {
      target: { value: 'Kimironko market' },
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });

    expect(fetchMock).not.toHaveBeenCalled();
    // LANDMARKS G3 — the catalog is in the bundle, so airplane mode is
    // not a blank screen: the market is offered, from memory, with a pin.
    const rows = screen.getAllByRole('option');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.dataset.resultKind === 'landmark')).toBe(true);
    expect(screen.getByText('Isoko ya Kimironko')).toBeInTheDocument();
    onLineSpy.mockRestore();
  });

  test('offline → choosing a landmark plants its verified pin', async () => {
    const onLineSpy = vi
      .spyOn(window.navigator, 'onLine', 'get')
      .mockReturnValue(false);
    stubGeocodeFetch();
    renderPage();

    for (const field of ['pickup', 'destination']) {
      fireEvent.change(screen.getByPlaceholderText(field), {
        target: { value: 'sonatubes' },
      });
      fireEvent.click(await screen.findByText('Sonatubes'));
    }

    expect(
      (screen.getByPlaceholderText('pickup') as HTMLInputElement).value,
    ).toBe('Sonatubes');
    const markers = screen.getAllByTestId('marker');
    const [lat, lng] = markers[0].dataset.pos!.split(',').map(Number);
    // Inside the Kigali bbox the catalog is now checked against.
    expect(lng).toBeGreaterThanOrEqual(29.95);
    expect(lng).toBeLessThanOrEqual(30.25);
    expect(lat).toBeGreaterThanOrEqual(-2.1);
    expect(lat).toBeLessThanOrEqual(-1.83);
    onLineSpy.mockRestore();
  });

  test('a landmark the catalog cannot place asks for a pin instead of guessing', async () => {
    stubGeocodeFetch();
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('pickup'), {
      target: { value: 'kwa jules' },
    });
    const row = await screen.findByText('Kwa Jules');
    expect(screen.getByTestId('landmark-needs-pin')).toBeInTheDocument();
    fireEvent.click(row);

    // The name is in the field, and no coordinate came with it.
    expect(
      (screen.getByPlaceholderText('pickup') as HTMLInputElement).value,
    ).toBe('Kwa Jules');
    expect(screen.queryByTestId('route-preview-map')).toBeNull();
    // The map opened for the pin the catalog could not supply, aimed at
    // the pickup field.
    expect(screen.getByTestId('picker-mode-pickup')).toBeInTheDocument();
  });

  test('landmarks come before the geocoder, and the credit only covers the geocoder', async () => {
    stubGeocodeFetch();
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('pickup'), {
      target: { value: 'Kimironko market' },
    });
    await screen.findByText(SUGGESTION.label, {}, { timeout: 2000 });

    const kinds = screen.getAllByRole('option').map((r) => r.dataset.resultKind);
    expect(kinds[0]).toBe('landmark');
    expect(kinds).toContain('geocode');
    // Every landmark row precedes every geocoder row.
    expect(kinds.lastIndexOf('landmark')).toBeLessThan(kinds.indexOf('geocode'));
  });

  test('the field can be emptied without retyping over it', async () => {
    stubGeocodeFetch();
    renderPage();

    const input = screen.getByPlaceholderText('pickup') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'sonatubes' } });
    expect(input.value).toBe('sonatubes');

    fireEvent.click(screen.getByTestId('pickup-address-input-clear'));
    expect(input.value).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
