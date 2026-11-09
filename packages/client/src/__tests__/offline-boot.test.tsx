// __TESTS__/OFFLINE-BOOT.TEST.TSX
//
// OUTBOX G4 — the boot that remembers you.
//
// The field failure: a motari who has used Bimoto for months kills the
// app in a dead zone, reopens it, and meets the welcome carousel —
// because the boot's only question ("who am I?") goes to the network,
// and a network that cannot answer looked exactly like a server saying
// "nobody".
//
// The two failures this file keeps apart, forever:
//
//   the server said no   → sign out. Unchanged.
//   we could not ASK     → draw this person's own home.
//
// Plus the three things the stand-in must never do: outlive a logout,
// outrank a server verdict, or appear for somebody who has never
// signed in.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

import { ProtectedRoute, DriverRoute, AuthRoute } from '../App';
import { useAuthStore } from '../stores/auth.store';
import { prefs, PREF_KEYS } from '../hooks/usePreferences';
import {
  readSessionSnapshot,
  writeSessionSnapshot,
  clearSessionSnapshot,
} from '../lib/session-snapshot';

const MOTARI = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  role: 'DRIVER',
  nickname: 'Jean',
};
const PASSENGER = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  role: 'CUSTOMER',
  nickname: 'Alice',
};

/** The app's real guards over stand-in screens for each destination. */
function renderApp(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <div data-testid="customer-home" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/driver"
          element={
            <ProtectedRoute>
              <DriverRoute>
                <div data-testid="driver-home" />
              </DriverRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/login"
          element={
            <AuthRoute>
              <div data-testid="login" />
            </AuthRoute>
          }
        />
        <Route path="/welcome" element={<div data-testid="welcome" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Boot has finished and found no live session. */
function bootedWithNoSession() {
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    token: null,
  } as any);
}

beforeEach(async () => {
  localStorage.clear();
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    token: null,
    offlineSession: null,
  } as any);
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the session snapshot itself', () => {
  test('round-trips identity, and only identity', async () => {
    writeSessionSnapshot(MOTARI);
    const snap = readSessionSnapshot();
    expect(snap).toEqual({
      userId: MOTARI.id,
      role: 'DRIVER',
      displayName: 'Jean',
    });
    // No credential of any kind is written. This is the condition the
    // whole feature was allowed to exist under.
    const raw = prefs.getSync(PREF_KEYS.sessionSnapshot)!;
    expect(raw).not.toMatch(/token/i);
    expect(raw).not.toMatch(/refresh/i);
    expect(raw).not.toMatch(/phone/i);
  });

  test('signing in writes it; logging out erases it', () => {
    useAuthStore.getState().setUser({ ...MOTARI } as any);
    expect(readSessionSnapshot()).not.toBeNull();

    useAuthStore.getState().logout();
    expect(readSessionSnapshot()).toBeNull();
    expect(useAuthStore.getState().offlineSession).toBeNull();
  });

  test('a corrupted or half-written snapshot is simply not a snapshot', async () => {
    await prefs.set(PREF_KEYS.sessionSnapshot, 'not json at all');
    expect(readSessionSnapshot()).toBeNull();

    await prefs.set(PREF_KEYS.sessionSnapshot, JSON.stringify({ userId: 'x' }));
    expect(readSessionSnapshot()).toBeNull();

    await prefs.set(PREF_KEYS.sessionSnapshot, JSON.stringify({ userId: '', role: '', displayName: '' }));
    expect(readSessionSnapshot()).toBeNull();
  });
});

describe('cold boot with no network, signed in before', () => {
  test('a passenger lands on their own home, not the carousel', async () => {
    bootedWithNoSession();
    useAuthStore.getState().setOfflineSession({
      userId: PASSENGER.id,
      role: 'CUSTOMER',
      displayName: 'Alice',
    });

    renderApp('/');
    await screen.findByTestId('customer-home');
    expect(screen.queryByTestId('welcome')).toBeNull();
    expect(screen.queryByTestId('login')).toBeNull();
  });

  test('a motari reaches his own dashboard', async () => {
    bootedWithNoSession();
    useAuthStore.getState().setOfflineSession({
      userId: MOTARI.id,
      role: 'DRIVER',
      displayName: 'Jean',
    });

    renderApp('/driver');
    await screen.findByTestId('driver-home');
  });

  test('the login screen sends a remembered user home rather than asking again', async () => {
    bootedWithNoSession();
    useAuthStore.getState().setOfflineSession({
      userId: PASSENGER.id,
      role: 'CUSTOMER',
      displayName: 'Alice',
    });

    renderApp('/login');
    await screen.findByTestId('customer-home');
  });

  test('the role check still applies: a passenger is not given the driver screens', async () => {
    bootedWithNoSession();
    useAuthStore.getState().setOfflineSession({
      userId: PASSENGER.id,
      role: 'CUSTOMER',
      displayName: 'Alice',
    });

    renderApp('/driver');
    await screen.findByTestId('customer-home');
    expect(screen.queryByTestId('driver-home')).toBeNull();
  });
});

describe('cold boot with no network, never signed in — unchanged', () => {
  test('a first-time user still meets the carousel', async () => {
    bootedWithNoSession();
    expect(readSessionSnapshot()).toBeNull();

    // hasSeenWelcome unset — AuthRoute's existing first-launch hand-off.
    renderApp('/');
    await screen.findByTestId('welcome');
  });

  test('someone who dismissed the carousel but never signed in gets the login form', async () => {
    await prefs.set(PREF_KEYS.hasSeenWelcome, 'true');
    bootedWithNoSession();
    expect(readSessionSnapshot()).toBeNull();

    renderApp('/');
    await screen.findByTestId('login');
  });
});

describe('the server always wins', () => {
  test('a real session replaces the stand-in', () => {
    useAuthStore.getState().setOfflineSession({
      userId: PASSENGER.id,
      role: 'CUSTOMER',
      displayName: 'Alice',
    });
    expect(useAuthStore.getState().offlineSession).not.toBeNull();

    // The network came back and /api/users/me answered.
    useAuthStore.getState().setUser({ ...PASSENGER } as any);

    expect(useAuthStore.getState().offlineSession).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  test('a rejected session takes the normal logout path and erases the memory', () => {
    writeSessionSnapshot(PASSENGER);
    useAuthStore.getState().setOfflineSession({
      userId: PASSENGER.id,
      role: 'CUSTOMER',
      displayName: 'Alice',
    });

    // apiFetch's 401 handling calls exactly this.
    useAuthStore.getState().logout();

    expect(useAuthStore.getState().offlineSession).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(readSessionSnapshot()).toBeNull();
  });

  test('a stand-in for a user who then signs out cannot be resurrected', async () => {
    // This phone HAS been used — the carousel is long dismissed — so
    // the honest destination after a logout is the login form.
    await prefs.set(PREF_KEYS.hasSeenWelcome, 'true');
    writeSessionSnapshot(MOTARI);
    clearSessionSnapshot();
    bootedWithNoSession();

    renderApp('/');
    await screen.findByTestId('login');
  });
});

describe('the stand-in is not a session', () => {
  test('it carries no token, so nothing can be sent as this user', () => {
    bootedWithNoSession();
    useAuthStore.getState().setOfflineSession({
      userId: MOTARI.id,
      role: 'DRIVER',
      displayName: 'Jean',
    });
    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
  });

  test('and the outbox replay refuses to run on one', async () => {
    // The replay engine gates on isAuthenticated AND a real user id.
    // A remembered identity satisfies neither, so a held booking cannot
    // be sent by a session the server has never confirmed.
    const { OutboxReplay } = await import('../sync/OutboxReplay');
    bootedWithNoSession();
    useAuthStore.getState().setOfflineSession({
      userId: MOTARI.id,
      role: 'DRIVER',
      displayName: 'Jean',
    });

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await new OutboxReplay().replayAll();

    expect(result).toEqual({ sent: 0, rejected: 0, deferred: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('waiting for the boot to finish', () => {
  test('nothing is drawn while isLoading — no flash of the login screen', async () => {
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: true,
      offlineSession: null,
    } as any);

    renderApp('/');
    await waitFor(() => {
      expect(screen.queryByTestId('login')).toBeNull();
      expect(screen.queryByTestId('customer-home')).toBeNull();
      expect(screen.queryByTestId('welcome')).toBeNull();
    });
  });
});
