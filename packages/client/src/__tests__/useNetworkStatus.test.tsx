import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const isNativeRef = { value: false };
let nativeStatus = { connected: true, connectionType: 'wifi' as const };
const nativeListeners: Array<(s: any) => void> = [];

const getStatus: any = vi.fn(async () => nativeStatus);
const removeListener = vi.fn();
const addListener: any = vi.fn(async (_event: string, cb: (s: any) => void) => {
  nativeListeners.push(cb);
  return { remove: removeListener };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativeRef.value },
}));

vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: () => getStatus(),
    addListener: (event: string, cb: any) => addListener(event, cb),
  },
}));

import { useNetworkStatus } from '../hooks/useNetworkStatus';

beforeEach(() => {
  isNativeRef.value = false;
  nativeStatus = { connected: true, connectionType: 'wifi' as const };
  nativeListeners.length = 0;
  vi.clearAllMocks();
  Object.defineProperty(global.navigator, 'onLine', {
    configurable: true,
    value: true,
  });
});

function setBrowserOnline(online: boolean) {
  Object.defineProperty(global.navigator, 'onLine', {
    configurable: true,
    value: online,
  });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

describe('useNetworkStatus — web path', () => {
  test('initial state mirrors navigator.onLine', () => {
    Object.defineProperty(global.navigator, 'onLine', { configurable: true, value: false });
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.connected).toBe(false);
    expect(result.current.connectionType).toBe('unknown');
  });

  test('online event flips connected to true', async () => {
    Object.defineProperty(global.navigator, 'onLine', { configurable: true, value: false });
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.connected).toBe(false);
    await act(async () => {
      setBrowserOnline(true);
    });
    expect(result.current.connected).toBe(true);
  });

  test('offline event flips connected to false', async () => {
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.connected).toBe(true);
    await act(async () => {
      setBrowserOnline(false);
    });
    expect(result.current.connected).toBe(false);
  });

  test('cleanup removes window listeners on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useNetworkStatus());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function));
  });

  test('does not call Capacitor Network on web', () => {
    renderHook(() => useNetworkStatus());
    expect(getStatus).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
  });
});

describe('useNetworkStatus — native path', () => {
  beforeEach(() => {
    isNativeRef.value = true;
  });

  test('initial state comes from Network.getStatus', async () => {
    nativeStatus = { connected: true, connectionType: 'cellular' as any };
    const { result } = renderHook(() => useNetworkStatus());
    await waitFor(() => expect(result.current.connectionType).toBe('cellular'));
    expect(result.current.connected).toBe(true);
    expect(getStatus).toHaveBeenCalled();
  });

  test('networkStatusChange listener updates state', async () => {
    nativeStatus = { connected: true, connectionType: 'wifi' as any };
    const { result } = renderHook(() => useNetworkStatus());
    await waitFor(() => expect(addListener).toHaveBeenCalled());
    await act(async () => {
      nativeListeners.forEach((cb) => cb({ connected: false, connectionType: 'none' }));
    });
    expect(result.current.connected).toBe(false);
    expect(result.current.connectionType).toBe('none');
  });

  test('cleanup removes the native listener on unmount', async () => {
    const { unmount } = renderHook(() => useNetworkStatus());
    await waitFor(() => expect(addListener).toHaveBeenCalled());
    unmount();
    await waitFor(() => expect(removeListener).toHaveBeenCalled());
  });
});
