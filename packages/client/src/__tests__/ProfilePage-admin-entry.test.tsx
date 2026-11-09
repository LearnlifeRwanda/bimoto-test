// WIRE-FIX G4 — the admin island's persistent in-app entry
// (wiring-report §1.5). Before this, roleHomePath(ADMIN) at login was
// the ONLY path to /admin: an admin who navigated to /profile had no
// way back short of re-login or typing the URL. The role-conditional
// Profile card is the way back; every other role must never see it.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
import ProfilePage from '../pages/shared/ProfilePage';
import { useAuthStore } from '../stores/auth.store';

beforeEach(() => {
  window.localStorage.clear();
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      profile: {
        title: 'Profile',
        adminDashboard: 'Admin dashboard',
        ridesCompleted: 'Rides completed',
        emergencyContacts: 'Emergency contacts',
        noContacts: 'No contacts yet',
        addContact: 'Add contact',
        editProfile: 'Edit profile',
      },
      settings: { title: 'Settings', logout: 'Log Out' },
      guide: { title: 'User guide' },
      payments: { title: 'Payments' },
      wallet: { title: 'Wallet' },
      common: { cancel: 'Cancel' },
    },
    true,
    true,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function setUserWithRole(role: string) {
  useAuthStore.setState({
    user: {
      id: 'user-1',
      nickname: 'Test',
      role,
      language: 'en',
      idVerified: false,
      licenseVerified: false,
      completedRides: 0,
      cancellationCount: 0,
      totalRequests: 0,
    } as any,
    isAuthenticated: true,
    isLoading: false,
    token: null,
  });
}

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={['/profile']}>
      <Routes>
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/admin" element={<div data-testid="admin-home">admin</div>} />
        <Route path="*" element={<div data-testid="not-found">404</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProfilePage admin entry (WIRE-FIX G4)', () => {
  test('an ADMIN sees the card and it lands on the declared /admin route', async () => {
    setUserWithRole('ADMIN');
    renderProfile();

    const link = screen.getByTestId('profile-admin-link');
    expect(link).toHaveTextContent('Admin dashboard');
    fireEvent.click(link);

    await waitFor(() => expect(screen.getByTestId('admin-home')).toBeInTheDocument());
    expect(screen.queryByTestId('not-found')).toBeNull();
  });

  test.each(['CUSTOMER', 'DRIVER', 'BOTH'])('a %s user never sees the card', (role) => {
    setUserWithRole(role);
    renderProfile();
    expect(screen.queryByTestId('profile-admin-link')).toBeNull();
  });
});
