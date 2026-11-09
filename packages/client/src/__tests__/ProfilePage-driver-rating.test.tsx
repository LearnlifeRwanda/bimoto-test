// PROFILE-RESCUE G2/G6 — regression test for the Kigali Profile crash.
//
// GET /api/users/me returns the raw Prisma row; driverProfile.avgRating
// is a Decimal(3,2) that JSON-serializes as a STRING ("4.85"). The old
// ProfilePage called .toFixed(1) on it directly, throwing for every
// logged-in driver during the first render — before any network call.
// This test mounts ProfilePage with the user shaped exactly as the
// server serializes it; it crashed pre-fix and must stay green.
import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
import ProfilePage from '../pages/shared/ProfilePage';
import { useAuthStore } from '../stores/auth.store';

// The server-serialized driver, verbatim shape (Decimal -> string,
// DateTime -> ISO string). Cast through unknown because the client-side
// User type optimistically says `avgRating: number` — the wire says
// otherwise, which is exactly what this test pins.
function serverShapedDriver(avgRating: string) {
  return {
    id: 'driver-1',
    phone: '+250780000001',
    nickname: 'Emmanuel',
    role: 'DRIVER',
    language: 'rw',
    idVerified: true,
    licenseVerified: true,
    emergencyContacts: [],
    completedRides: 12,
    cancellationCount: 0,
    totalRequests: 15,
    driverProfile: {
      vehicleType: 'MOTO',
      vehicleDescription: 'Red TVS moto',
      avgRating,
      totalRides: 240,
      isOnline: false,
    },
  } as unknown as NonNullable<ReturnType<typeof useAuthStore.getState>['user']>;
}

beforeEach(() => {
  window.localStorage.clear();
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      profile: { title: 'Profile', rating: 'Rating', ridesCompleted: 'Rides completed' },
      driver: { stats: { noRatingsYet: 'No ratings yet' } },
    },
    true,
    true,
  );
});

function renderProfileAs(user: ReturnType<typeof serverShapedDriver>) {
  useAuthStore.setState({
    user,
    isAuthenticated: true,
    isLoading: false,
    token: null,
  });
  return render(
    <MemoryRouter initialEntries={['/profile']}>
      <Routes>
        <Route path="/profile" element={<ProfilePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProfilePage driver rating (PROFILE-RESCUE G2)', () => {
  test('renders for a driver whose avgRating arrives as a Decimal string', () => {
    renderProfileAs(serverShapedDriver('4.85'));

    // Pre-fix this render threw: "4.85".toFixed is not a function.
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByTestId('profile-rating-value')).toHaveTextContent('4.8');
  });

  test('a never-rated driver (Decimal "0") gets the calm empty label, not 0.0', () => {
    renderProfileAs(serverShapedDriver('0'));

    expect(screen.getByTestId('profile-rating-empty')).toHaveTextContent('No ratings yet');
    expect(screen.queryByTestId('profile-rating-value')).not.toBeInTheDocument();
  });

  test('a numeric avgRating (in-memory fixtures, PUT /users/me echoes) still renders', () => {
    const user = serverShapedDriver('4.85') as { driverProfile?: { avgRating: unknown } };
    user.driverProfile!.avgRating = 4.85;
    renderProfileAs(user as ReturnType<typeof serverShapedDriver>);

    expect(screen.getByTestId('profile-rating-value')).toHaveTextContent('4.8');
  });
});
