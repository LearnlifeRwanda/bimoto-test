// PROFILE-RESCUE G4 — Android hardware Back semantics.
//
//   history exists → navigate back one router entry;
//   root screen    → minimize (background) the app, never exit;
//   web platform   → no listener registered at all.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import React from 'react';
import { useAndroidBackButton, shouldNavigateBack } from '../hooks/useAndroidBackButton';

// Capture the registered backButton callback.
let backButtonCallback: (() => void) | null = null;
const addListener = vi.fn(async (_event: string, cb: () => void) => {
  backButtonCallback = cb;
  return { remove: vi.fn() };
});
const minimizeApp = vi.fn(async () => {});
let isNative = true;

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNative },
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (event: string, cb: () => void) => addListener(event, cb),
    minimizeApp: () => minimizeApp(),
  },
}));

function Bridge() {
  useAndroidBackButton();
  return null;
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Bridge />
      <Routes>
        <Route
          path="/"
          element={
            <div>
              <p>home screen</p>
              <Link to="/profile">to profile</Link>
            </div>
          }
        />
        <Route path="/profile" element={<p>profile screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  isNative = true;
  backButtonCallback = null;
  addListener.mockClear();
  minimizeApp.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('shouldNavigateBack', () => {
  test('root history entry (key "default") backgrounds; navigated entries go back', () => {
    expect(shouldNavigateBack({ key: 'default' })).toBe(false);
    expect(shouldNavigateBack({ key: 'a1b2c3' })).toBe(true);
  });
});

describe('useAndroidBackButton (PROFILE-RESCUE G4)', () => {
  test('with history: hardware Back navigates to the previous screen', async () => {
    renderApp();
    await waitFor(() => expect(backButtonCallback).not.toBeNull());

    fireEvent.click(screen.getByText('to profile'));
    expect(screen.getByText('profile screen')).toBeInTheDocument();

    act(() => backButtonCallback!());
    expect(screen.getByText('home screen')).toBeInTheDocument();
    expect(minimizeApp).not.toHaveBeenCalled();
  });

  test('at the root screen: hardware Back backgrounds the app, never exits', async () => {
    renderApp();
    await waitFor(() => expect(backButtonCallback).not.toBeNull());

    act(() => backButtonCallback!());
    expect(minimizeApp).toHaveBeenCalledTimes(1);
    expect(screen.getByText('home screen')).toBeInTheDocument();
  });

  test('back to the root entry, then Back again backgrounds', async () => {
    renderApp();
    await waitFor(() => expect(backButtonCallback).not.toBeNull());

    fireEvent.click(screen.getByText('to profile'));
    act(() => backButtonCallback!()); // profile -> home
    act(() => backButtonCallback!()); // home is root -> background
    expect(minimizeApp).toHaveBeenCalledTimes(1);
  });

  test('on the web, no listener is registered', async () => {
    isNative = false;
    renderApp();
    // Give the (never-started) async registration a beat.
    await new Promise((r) => setTimeout(r, 20));
    expect(addListener).not.toHaveBeenCalled();
  });
});
