import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const isNativeRef = { value: false };
const capPosition = {
  coords: {
    latitude: 1.94,
    longitude: 30.06,
    accuracy: 5,
    speed: 4.2,
    heading: 180,
  },
  timestamp: 1_700_000_000_000,
};

type PermState = 'granted' | 'denied' | 'prompt';
const checkPermissions: any = vi.fn(async () => ({ location: 'granted' as PermState }));
const requestPermissions: any = vi.fn(async () => ({ location: 'granted' as PermState }));
const getCurrentPositionNative: any = vi.fn(async () => capPosition);
const watchPositionNative: any = vi.fn(async () => 'cap-watch-id-1');
const clearWatchNative: any = vi.fn(async () => undefined);

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNativeRef.value,
  },
}));

vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    checkPermissions: (a: any) => checkPermissions(a),
    requestPermissions: (a: any) => requestPermissions(a),
    getCurrentPosition: (a: any) => getCurrentPositionNative(a),
    watchPosition: (a: any, cb: any) => watchPositionNative(a, cb),
    clearWatch: (a: any) => clearWatchNative(a),
  },
}));

import { geolocation, useGeolocation } from '../hooks/useGeolocation';

beforeEach(() => {
  isNativeRef.value = false;
  vi.clearAllMocks();
  checkPermissions.mockResolvedValue({ location: 'granted' });
  requestPermissions.mockResolvedValue({ location: 'granted' });
  getCurrentPositionNative.mockResolvedValue(capPosition);
  watchPositionNative.mockResolvedValue('cap-watch-id-1');
});

function installBrowserGeolocation(coords: Partial<GeolocationCoordinates> = {}) {
  const browserCoords = {
    latitude: 1.95,
    longitude: 30.07,
    accuracy: 12,
    speed: 1.5,
    heading: 90,
    altitude: null,
    altitudeAccuracy: null,
    ...coords,
  } as GeolocationCoordinates;
  const browserPos = { coords: browserCoords, timestamp: 1_700_000_001_000 } as GeolocationPosition;
  const getCurrentPosition = vi.fn((ok: PositionCallback) => ok(browserPos));
  const watchPosition = vi.fn((ok: PositionCallback) => {
    ok(browserPos);
    return 42;
  });
  const clearWatch = vi.fn();
  Object.defineProperty(global.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition, watchPosition, clearWatch },
  });
  return { getCurrentPosition, watchPosition, clearWatch };
}

describe('geolocation utility — web path', () => {
  test('getCurrentPosition maps browser coords to GeoCoords', async () => {
    installBrowserGeolocation();
    const coords = await geolocation.getCurrentPosition();
    expect(coords).toEqual({
      lat: 1.95,
      lng: 30.07,
      accuracy: 12,
      speed: 1.5,
      heading: 90,
      timestamp: 1_700_000_001_000,
    });
  });

  test('getCurrentPosition rejects with GeoError when browser errors', async () => {
    Object.defineProperty(global.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (_ok: any, fail: any) =>
          fail({ code: 1, message: 'User denied geolocation' }),
        watchPosition: vi.fn(),
        clearWatch: vi.fn(),
      },
    });
    await expect(geolocation.getCurrentPosition()).rejects.toMatchObject({
      code: 'permission-denied',
      message: 'User denied geolocation',
    });
  });

  test('watchPosition returns string watcher id and forwards positions', async () => {
    const { watchPosition, clearWatch } = installBrowserGeolocation();
    const onPos = vi.fn();
    const onErr = vi.fn();
    const id = await geolocation.watchPosition(onPos, onErr);
    expect(typeof id).toBe('string');
    expect(id).toBe('42');
    expect(watchPosition).toHaveBeenCalled();
    expect(onPos).toHaveBeenCalledWith(expect.objectContaining({ lat: 1.95, lng: 30.07 }));
    await geolocation.clearWatch(id);
    expect(clearWatch).toHaveBeenCalledWith(42);
  });
});

describe('geolocation utility — native path', () => {
  beforeEach(() => {
    isNativeRef.value = true;
  });

  test('getCurrentPosition maps Capacitor Position to GeoCoords', async () => {
    const coords = await geolocation.getCurrentPosition();
    expect(coords).toEqual({
      lat: 1.94,
      lng: 30.06,
      accuracy: 5,
      speed: 4.2,
      heading: 180,
      timestamp: 1_700_000_000_000,
    });
    expect(checkPermissions).toHaveBeenCalled();
  });

  test('requests permission when not yet granted', async () => {
    checkPermissions.mockResolvedValueOnce({ location: 'prompt' });
    await geolocation.getCurrentPosition();
    expect(requestPermissions).toHaveBeenCalled();
  });

  test('rejects with permission-denied when user refuses', async () => {
    checkPermissions.mockResolvedValueOnce({ location: 'prompt' });
    requestPermissions.mockResolvedValueOnce({ location: 'denied' });
    await expect(geolocation.getCurrentPosition()).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  test('watchPosition forwards Capacitor watcher id as string', async () => {
    const onPos = vi.fn();
    const onErr = vi.fn();
    const id = await geolocation.watchPosition(onPos, onErr);
    expect(id).toBe('cap-watch-id-1');
    expect(watchPositionNative).toHaveBeenCalled();
    await geolocation.clearWatch(id);
    expect(clearWatchNative).toHaveBeenCalledWith({ id: 'cap-watch-id-1' });
  });
});

describe('useGeolocation hook', () => {
  test('starts with no coords, no error, not loading', () => {
    const { result } = renderHook(() => useGeolocation());
    expect(result.current.coords).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  test('requestPosition populates coords and toggles loading', async () => {
    installBrowserGeolocation();
    const { result } = renderHook(() => useGeolocation());
    await act(async () => {
      await result.current.requestPosition();
    });
    expect(result.current.coords).toMatchObject({ lat: 1.95, lng: 30.07 });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  test('requestPosition surfaces GeoError on failure', async () => {
    Object.defineProperty(global.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (_ok: any, fail: any) => fail({ code: 3, message: 'Timeout' }),
        watchPosition: vi.fn(),
        clearWatch: vi.fn(),
      },
    });
    const { result } = renderHook(() => useGeolocation());
    await act(async () => {
      await result.current.requestPosition();
    });
    await waitFor(() => {
      expect(result.current.error).toMatchObject({ code: 'timeout', message: 'Timeout' });
    });
    expect(result.current.coords).toBeNull();
  });
});
