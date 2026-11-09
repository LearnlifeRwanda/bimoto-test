// __TESTS__/LOCATION-PICKER-MAP.TEST.TSX
//
// PILOT-UX-2 G5 — pick-on-map unit coverage:
//   - tapping the map sets a tentative (draggable) pin + confirm button
//   - confirm returns {lat,lng} with the reverse-geocoded name when the
//     geocode proxy answers
//   - coordinates-label fallback when the proxy is unavailable (503 —
//     LocationIQ may be unset)
//   - pickup confirms first, then the mode auto-advances to destination
//   - dragging the pending pin adjusts the confirmed coordinates

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// react-leaflet is not jsdom-friendly; mock it and capture the map
// event handlers so tests can simulate taps, plus each marker's props
// so tests can simulate a pin drag.
let mapEventHandlers: any = null;
let markerProps: any[] = [];
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  Marker: (props: any) => {
    markerProps.push(props);
    return (
      <div
        data-testid="marker"
        data-pos={`${props.position[0]},${props.position[1]}`}
        data-draggable={props.draggable ? 'true' : undefined}
      />
    );
  },
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

vi.mock('../hooks/useGeocodeSearch', () => ({
  reverseGeocodeOnce: vi.fn(),
  // MAP-CACHE G4 — useRouteDirections consults the shared session flag.
  isGeocodingUnavailable: () => false,
  markGeocodingUnavailable: vi.fn(),
}));

// Route preview is covered by route-preview.test.tsx; here the pair
// stays on the straight-line fallback (no directions answer).
// MAP-TRUTH G2 — the map's can't-draw state is the DEVICE's network,
// not the Bimoto API's reachability. (LocationPickerMap still reads
// useUIStore.isOnline for its reverse-geocode choice, which genuinely
// does need the API — that part is unchanged.)
const useNetworkStatusMock = vi.fn(() => ({ connected: true, connectionType: 'wifi' }));
vi.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => useNetworkStatusMock(),
}));

vi.mock('../hooks/useRouteDirections', () => ({
  useRouteDirections: () => null,
}));

import { LocationPickerMap, coordinatesLabel } from '../components/map/LocationPickerMap';
import { reverseGeocodeOnce } from '../hooks/useGeocodeSearch';
import { useAuthStore } from '../stores/auth.store';
import { useUIStore } from '../stores/ui.store';

const mockReverse = vi.mocked(reverseGeocodeOnce);

const TAP = { lat: -1.9536, lng: 30.0606 };

function tapMap(lat = TAP.lat, lng = TAP.lng) {
  act(() => {
    mapEventHandlers.click({ latlng: { lat, lng } });
  });
}

describe('LocationPickerMap — PILOT-UX-2 G2 pick-on-map', () => {
  beforeEach(() => {
    mapEventHandlers = null;
    markerProps = [];
    mockReverse.mockReset();
    useAuthStore.setState({ token: 'tok' } as any);
    useUIStore.setState({ isOnline: true });
    useNetworkStatusMock.mockReset().mockReturnValue({ connected: true, connectionType: 'wifi' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('tapping the map sets a draggable tentative pin and shows the confirm button', () => {
    render(
      <LocationPickerMap pickup={null} destination={null} onConfirm={vi.fn()} />,
    );
    expect(screen.queryByTestId('picker-confirm')).toBeNull();
    expect(screen.getByTestId('picker-tap-hint')).toBeInTheDocument();

    tapMap();

    expect(screen.getByTestId('picker-confirm')).toBeInTheDocument();
    const pending = screen
      .getAllByTestId('marker')
      .find((m) => m.dataset.draggable === 'true');
    expect(pending?.dataset.pos).toBe(`${TAP.lat},${TAP.lng}`);
  });

  test('confirm returns the tapped coords with the reverse-geocoded name when the proxy answers', async () => {
    mockReverse.mockResolvedValue({ lat: TAP.lat, lng: TAP.lng, label: 'Kimironko Market' });
    const onConfirm = vi.fn();
    render(
      <LocationPickerMap pickup={null} destination={null} onConfirm={onConfirm} />,
    );

    tapMap();
    fireEvent.click(screen.getByTestId('picker-confirm'));

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith('pickup', {
        lat: TAP.lat,
        lng: TAP.lng,
        address: 'Kimironko Market',
      }),
    );
  });

  test('falls back to a coordinates label when the geocode proxy 503s (returns null)', async () => {
    mockReverse.mockResolvedValue(null);
    const onConfirm = vi.fn();
    render(
      <LocationPickerMap pickup={null} destination={null} onConfirm={onConfirm} />,
    );

    tapMap();
    fireEvent.click(screen.getByTestId('picker-confirm'));

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith('pickup', {
        lat: TAP.lat,
        lng: TAP.lng,
        address: coordinatesLabel(TAP.lat, TAP.lng),
      }),
    );
    expect(coordinatesLabel(TAP.lat, TAP.lng)).toBe('-1.95360, 30.06060');
  });

  test('pickup first, then the mode auto-advances to destination', async () => {
    mockReverse.mockResolvedValue(null);
    const onConfirm = vi.fn();
    render(
      <LocationPickerMap pickup={null} destination={null} onConfirm={onConfirm} />,
    );
    expect(screen.getByTestId('picker-mode-pickup')).toHaveAttribute('aria-checked', 'true');

    tapMap();
    fireEvent.click(screen.getByTestId('picker-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('picker-mode-destination')).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toBe('pickup');
  });

  test('arriving with a pickup already set starts on destination mode', () => {
    render(
      <LocationPickerMap
        pickup={{ lat: -1.95, lng: 30.06, address: 'Home' }}
        destination={null}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByTestId('picker-mode-destination')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('dragging the tentative pin adjusts the confirmed coordinates', async () => {
    mockReverse.mockResolvedValue(null);
    const onConfirm = vi.fn();
    render(
      <LocationPickerMap pickup={null} destination={null} onConfirm={onConfirm} />,
    );

    tapMap();
    const dragged = { lat: -1.9401, lng: 30.0712 };
    const pending = markerProps.find((p) => p.draggable);
    act(() => {
      pending.eventHandlers.dragend({ target: { getLatLng: () => dragged } });
    });
    fireEvent.click(screen.getByTestId('picker-confirm'));

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith('pickup', {
        lat: dragged.lat,
        lng: dragged.lng,
        address: coordinatesLabel(dragged.lat, dragged.lng),
      }),
    );
  });

  test('renders both pins and the straight-line preview when pickup and destination exist', () => {
    render(
      <LocationPickerMap
        pickup={{ lat: -1.95, lng: 30.06, address: 'A' }}
        destination={{ lat: -1.94, lng: 30.07, address: 'B' }}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId('marker')).toHaveLength(2);
    expect(screen.getByTestId('polyline').dataset.count).toBe('2');
  });

  test('device offline: shows the calm hint instead of the map and fires onUnavailable', () => {
    useNetworkStatusMock.mockReturnValue({ connected: false, connectionType: 'none' });
    const onUnavailable = vi.fn();
    render(
      <LocationPickerMap
        pickup={null}
        destination={null}
        onConfirm={vi.fn()}
        onUnavailable={onUnavailable}
      />,
    );
    expect(screen.getByTestId('map-offline-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('map-container')).toBeNull();
    expect(onUnavailable).toHaveBeenCalled();
  });

  test('API unreachable but device online: the map still renders', () => {
    // One aborted geocode request used to set isOnline=false and gray
    // out the whole map. It must not any more.
    useUIStore.setState({ isOnline: false });
    const onUnavailable = vi.fn();
    render(
      <LocationPickerMap
        pickup={null}
        destination={null}
        onConfirm={vi.fn()}
        onUnavailable={onUnavailable}
      />,
    );
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.queryByTestId('map-offline-hint')).toBeNull();
    expect(onUnavailable).not.toHaveBeenCalled();
  });
});
