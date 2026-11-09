// INTEL-DECK G4 — the client half of the ANALYST access contract.
//
// The server refuses an analyst everywhere but the intel reads; these
// tests pin the same shape in the router, so an analyst never renders a
// booking flow they could not complete, and nobody without the role
// renders the reading room.
import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import React from 'react';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '@bimoto/shared';
import './setup';
import { ProtectedRoute, IntelGuard } from '../App';
import { useAuthStore } from '../stores/auth.store';
import { roleHomePath } from '../lib/role-home';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function userWithRole(role: string) {
  return {
    id: `user-${role}`,
    nickname: 'Test',
    role,
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
  } as any;
}

function signIn(role: string) {
  useAuthStore.setState({
    user: userWithRole(role),
    isAuthenticated: true,
    isLoading: false,
    offlineSession: null,
  });
}

function renderAt(path: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="/intel" element={<div data-testid="intel">reading room</div>} />
        <Route path="/" element={<div data-testid="home">home</div>} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    offlineSession: null,
  });
});

describe('roleHomePath', () => {
  test('an analyst lands in the reading room after login', () => {
    expect(roleHomePath('ANALYST')).toBe('/intel');
  });

  test('every other role is unchanged', () => {
    expect(roleHomePath('ADMIN')).toBe('/admin');
    expect(roleHomePath('DRIVER')).toBe('/driver');
    expect(roleHomePath('CUSTOMER')).toBe('/');
    // LOCATION-LIFE A G5 — a both-role user is a motari in practice
    // (onboarding produces BOTH), so login lands on the driver home.
    expect(roleHomePath('BOTH')).toBe('/driver');
    expect(roleHomePath('COOPERATIVE_LEADER')).toBe('/');
    expect(roleHomePath(undefined)).toBe('/');
  });
});

describe('ProtectedRoute — an analyst is fenced to the reading room', () => {
  test('a booking screen bounces an analyst to /intel', () => {
    signIn('ANALYST');
    renderAt(
      '/journey/new',
      <ProtectedRoute>
        <div data-testid="booking">book a ride</div>
      </ProtectedRoute>,
    );
    expect(screen.queryByTestId('booking')).toBeNull();
    expect(screen.getByTestId('intel')).toBeTruthy();
  });

  test('the admin dashboard bounces an analyst to /intel', () => {
    signIn('ANALYST');
    renderAt(
      '/admin',
      <ProtectedRoute>
        <div data-testid="admin">admin</div>
      </ProtectedRoute>,
    );
    expect(screen.queryByTestId('admin')).toBeNull();
    expect(screen.getByTestId('intel')).toBeTruthy();
  });

  test('the shared basics stay open via allowAnalyst', () => {
    signIn('ANALYST');
    renderAt(
      '/settings',
      <ProtectedRoute allowAnalyst>
        <div data-testid="settings">settings</div>
      </ProtectedRoute>,
    );
    expect(screen.getByTestId('settings')).toBeTruthy();
  });

  test('every other role passes through exactly as before', () => {
    for (const role of ['CUSTOMER', 'DRIVER', 'BOTH', 'ADMIN', 'COOPERATIVE_LEADER']) {
      signIn(role);
      const view = renderAt(
        '/journey/new',
        <ProtectedRoute>
          <div data-testid="booking">book a ride</div>
        </ProtectedRoute>,
      );
      expect(screen.getByTestId('booking')).toBeTruthy();
      view.unmount();
    }
  });
});

describe('IntelGuard — the reading room admits two roles', () => {
  test('an analyst is admitted', () => {
    signIn('ANALYST');
    renderAt(
      '/intel-test',
      <IntelGuard>
        <div data-testid="room">hexagons</div>
      </IntelGuard>,
    );
    expect(screen.getByTestId('room')).toBeTruthy();
  });

  test('an admin is admitted', () => {
    signIn('ADMIN');
    renderAt(
      '/intel-test',
      <IntelGuard>
        <div data-testid="room">hexagons</div>
      </IntelGuard>,
    );
    expect(screen.getByTestId('room')).toBeTruthy();
  });

  test('a customer, a driver and a cooperative leader are sent home', () => {
    for (const role of ['CUSTOMER', 'DRIVER', 'BOTH', 'COOPERATIVE_LEADER']) {
      signIn(role);
      const view = renderAt(
        '/intel-test',
        <IntelGuard>
          <div data-testid="room">hexagons</div>
        </IntelGuard>,
      );
      expect(screen.queryByTestId('room')).toBeNull();
      expect(screen.getByTestId('home')).toBeTruthy();
      view.unmount();
    }
  });
});
