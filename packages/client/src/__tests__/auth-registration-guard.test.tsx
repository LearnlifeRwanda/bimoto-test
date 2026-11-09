// AUTH-UX G1 — registration routing guard.
//
// /register used to sit behind AuthRoute, whose authenticated→/ bounce
// made the page unreachable (verify-otp authenticates BEFORE navigating
// there). These tests pin the replacement: RegisterRoute renders the
// page only for a signed-in user whose registration is pending, and
// ProtectedRoute walks every pending user back to /register so deep
// links cannot skip the step. Returning users (seeded accounts have
// nicknames/roles) never see it.
import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import React from 'react';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '@bimoto/shared';
import './setup';
import { ProtectedRoute, RegisterRoute } from '../App';
import { useAuthStore, isRegistrationPending } from '../stores/auth.store';
import { prefs, PREF_KEYS } from '../hooks/usePreferences';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

const consentedUser = {
  id: 'user-1',
  nickname: 'Test',
  role: 'CUSTOMER',
  language: 'en',
  idVerified: false,
  licenseVerified: false,
  completedRides: 0,
  cancellationCount: 0,
  totalRequests: 0,
  privacyConsentAt: '2026-01-01T00:00:00Z',
  privacyConsentVersion: CURRENT_PRIVACY_VERSION,
  termsAcceptedAt: '2026-01-01T00:00:00Z',
  termsAcceptedVersion: CURRENT_TERMS_VERSION,
};

function renderGuards(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <div data-testid="app-shell">home</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="/register"
          element={
            <RegisterRoute>
              <div data-testid="register-page">register</div>
            </RegisterRoute>
          }
        />
        <Route path="/login" element={<LocationProbe />} />
        <Route path="/consent" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    token: null,
    registrationPendingUserId: null,
  });
});

describe('registration guard (AUTH-UX G1)', () => {
  test('a pending new user deep-linking into the app shell is walked back to /register', () => {
    useAuthStore.setState({
      user: { ...consentedUser },
      isAuthenticated: true,
      registrationPendingUserId: 'user-1',
    });
    renderGuards('/');
    expect(screen.getByTestId('register-page')).toBeInTheDocument();
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
  });

  test('RegisterRoute renders RegisterPage for the pending user', () => {
    useAuthStore.setState({
      user: { ...consentedUser },
      isAuthenticated: true,
      registrationPendingUserId: 'user-1',
    });
    renderGuards('/register');
    expect(screen.getByTestId('register-page')).toBeInTheDocument();
  });

  test('a returning user deep-linking to /register is bounced to home', () => {
    useAuthStore.setState({
      user: { ...consentedUser },
      isAuthenticated: true,
      registrationPendingUserId: null,
    });
    renderGuards('/register');
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('register-page')).not.toBeInTheDocument();
  });

  test('an unauthenticated visit to /register lands on /login', () => {
    renderGuards('/register');
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });

  test('completing registration (flag cleared) opens the app shell', () => {
    useAuthStore.setState({
      user: { ...consentedUser },
      isAuthenticated: true,
      registrationPendingUserId: 'user-1',
    });
    useAuthStore.getState().setRegistrationPending(null);
    renderGuards('/');
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
  });

  test('the pending flag is durable (prefs) and keyed by user id', () => {
    useAuthStore.getState().setRegistrationPending('user-1');
    expect(prefs.getSync(PREF_KEYS.registrationPending)).toBe('user-1');

    // Same half-registered user: still pending after a relaunch/re-login.
    expect(
      isRegistrationPending({
        user: { ...consentedUser },
        registrationPendingUserId: prefs.getSync(PREF_KEYS.registrationPending),
      }),
    ).toBe(true);

    // A DIFFERENT account on the same device never inherits the flag.
    expect(
      isRegistrationPending({
        user: { ...consentedUser, id: 'user-2' },
        registrationPendingUserId: prefs.getSync(PREF_KEYS.registrationPending),
      }),
    ).toBe(false);
  });

  test('logout clears in-store auth state but keeps the id-keyed pref for the next login', () => {
    useAuthStore.setState({ user: { ...consentedUser }, isAuthenticated: true });
    useAuthStore.getState().setRegistrationPending('user-1');
    useAuthStore.getState().logout();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(prefs.getSync(PREF_KEYS.registrationPending)).toBe('user-1');
  });
});
