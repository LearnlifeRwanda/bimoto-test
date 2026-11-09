import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const isNativeRef = { value: false };
const store = new Map<string, string>();

const get: any = vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }));
const set: any = vi.fn(async ({ key, value }: { key: string; value: string }) => {
  store.set(key, value);
});
const remove: any = vi.fn(async ({ key }: { key: string }) => {
  store.delete(key);
});
const keys: any = vi.fn(async () => ({ keys: Array.from(store.keys()) }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativeRef.value },
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: (a: any) => get(a),
    set: (a: any) => set(a),
    remove: (a: any) => remove(a),
    keys: () => keys(),
  },
}));

import { prefs, usePreference } from '../hooks/usePreferences';

beforeEach(() => {
  isNativeRef.value = false;
  store.clear();
  localStorage.clear();
  vi.clearAllMocks();
});

describe('prefs — web path', () => {
  test('getSync reads from localStorage', () => {
    localStorage.setItem('greeting', 'hello');
    expect(prefs.getSync('greeting')).toBe('hello');
    expect(get).not.toHaveBeenCalled();
  });

  test('async get reads from localStorage and never calls Capacitor', async () => {
    localStorage.setItem('greeting', 'hello');
    expect(await prefs.get('greeting')).toBe('hello');
    expect(get).not.toHaveBeenCalled();
  });

  test('set writes to localStorage and never calls Capacitor', async () => {
    await prefs.set('greeting', 'world');
    expect(localStorage.getItem('greeting')).toBe('world');
    expect(set).not.toHaveBeenCalled();
  });

  test('remove clears localStorage and never calls Capacitor', async () => {
    localStorage.setItem('greeting', 'hello');
    await prefs.remove('greeting');
    expect(localStorage.getItem('greeting')).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  test('round-trip: set then get returns the same value', async () => {
    await prefs.set('lang', 'rw');
    expect(await prefs.get('lang')).toBe('rw');
    expect(prefs.getSync('lang')).toBe('rw');
  });

  test('get returns null for unknown key', async () => {
    expect(await prefs.get('nope')).toBeNull();
    expect(prefs.getSync('nope')).toBeNull();
  });

  test('hydrate is a no-op on web', async () => {
    await prefs.hydrate();
    expect(keys).not.toHaveBeenCalled();
  });
});

describe('prefs — native path', () => {
  beforeEach(() => {
    isNativeRef.value = true;
  });

  test('async get falls back to Capacitor when localStorage misses, then back-fills', async () => {
    store.set('lang', 'fr');
    const value = await prefs.get('lang');
    expect(value).toBe('fr');
    expect(get).toHaveBeenCalledWith({ key: 'lang' });
    // Subsequent sync read should hit the cache.
    expect(prefs.getSync('lang')).toBe('fr');
  });

  test('set writes to both localStorage and Capacitor', async () => {
    await prefs.set('lang', 'en');
    expect(localStorage.getItem('lang')).toBe('en');
    expect(set).toHaveBeenCalledWith({ key: 'lang', value: 'en' });
  });

  test('remove clears both stores', async () => {
    localStorage.setItem('lang', 'en');
    store.set('lang', 'en');
    await prefs.remove('lang');
    expect(localStorage.getItem('lang')).toBeNull();
    expect(remove).toHaveBeenCalledWith({ key: 'lang' });
  });

  test('hydrate copies every Capacitor key into localStorage', async () => {
    store.set('lang', 'rw');
    store.set('last-sync', '2026-05-01T10:00:00Z');
    await prefs.hydrate();
    expect(localStorage.getItem('lang')).toBe('rw');
    expect(localStorage.getItem('last-sync')).toBe('2026-05-01T10:00:00Z');
  });

  test('round-trip: set then get returns the same value via Capacitor', async () => {
    await prefs.set('k', 'v');
    localStorage.clear(); // simulate cache eviction
    expect(await prefs.get('k')).toBe('v');
  });
});

describe('usePreference hook', () => {
  test('initial value comes from sync cache', () => {
    localStorage.setItem('lang', 'fr');
    const { result } = renderHook(() => usePreference('lang'));
    expect(result.current.value).toBe('fr');
  });

  test('setValue updates cache and state', async () => {
    const { result } = renderHook(() => usePreference('lang'));
    await act(async () => {
      await result.current.setValue('en');
    });
    expect(result.current.value).toBe('en');
    expect(localStorage.getItem('lang')).toBe('en');
  });

  test('on native, refreshes from durable store on mount', async () => {
    isNativeRef.value = true;
    store.set('lang', 'rw');
    const { result } = renderHook(() => usePreference('lang'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.value).toBe('rw');
  });

  test('remove clears value', async () => {
    localStorage.setItem('lang', 'en');
    const { result } = renderHook(() => usePreference('lang'));
    await act(async () => {
      await result.current.remove();
    });
    expect(result.current.value).toBeNull();
  });
});
