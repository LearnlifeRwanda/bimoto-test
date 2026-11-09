// AUTH-UX G3 — logout, one tap from Profile.
//
// The Profile tab is in every role's bottom nav; the new logout row
// there confirms via the existing settings.logout strings and runs the
// shared performLogout sequence: POST /api/auth/logout (server-side
// family revocation), then the auth.store logout path, landing on
// /login with cleared state.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
import ProfilePage from '../pages/shared/ProfilePage';
import { useAuthStore } from '../stores/auth.store';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

beforeEach(() => {
  window.localStorage.clear();
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      profile: {
        title: 'Profile',
        ridesCompleted: 'Rides completed',
        rating: 'Rating',
        idVerified: 'ID verified',
        idNotVerified: 'ID not verified',
        editProfile: 'Edit profile',
        emergencyContacts: 'Emergency contacts',
        noContacts: 'No contacts yet',
        addContact: 'Add contact',
      },
      settings: {
        title: 'Settings',
        language: 'Language',
        logout: 'Log Out',
        logout_confirm: 'Are you sure you want to log out?',
      },
      common: { cancel: 'Cancel', close: 'Close' },
    },
    true,
    true,
  );
  useAuthStore.setState({
    user: {
      id: 'user-1',
      nickname: 'Test',
      role: 'CUSTOMER',
      language: 'en',
      idVerified: false,
      licenseVerified: false,
      completedRides: 3,
      cancellationCount: 0,
      totalRequests: 3,
    },
    isAuthenticated: true,
    isLoading: false,
    token: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={['/profile']}>
      <Routes>
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/login" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProfilePage logout (AUTH-UX G3)', () => {
  test('the logout row opens a confirm dialog; cancel keeps the session', () => {
    renderProfile();

    fireEvent.click(screen.getByTestId('profile-logout-button'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Are you sure you want to log out?')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  test('confirming logs out server-side, clears auth state, and lands on /login', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderProfile();

    fireEvent.click(screen.getByTestId('profile-logout-button'));
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Log Out' }));
    });

    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/api/auth/logout')),
    ).toBe(true);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().token).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });
});
