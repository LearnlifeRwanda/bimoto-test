// FIELD-CLOSE G3 — the user guide exists, renders its six sections
// from locale keys, and is reachable from Profile.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
import UserGuidePage from '../pages/shared/UserGuidePage';
import ProfilePage from '../pages/shared/ProfilePage';
import { useAuthStore } from '../stores/auth.store';

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      guide: {
        title: 'User guide',
        ride: { title: 'Request a ride', body: 'A ride carries you, the passenger.' },
        parcel: { title: 'Send a parcel', body: 'Only the package travels.' },
        bidding: { title: 'Offers and choosing a driver', body: 'Drivers reply with price offers.' },
        sos: { title: 'The SOS button', body: 'Alerts the team and your contacts.' },
        language: { title: 'Change language', body: 'Pick your language in Profile.' },
        help: { title: 'Where to get help', body: 'Use the chat or ask the team.' },
      },
      profile: {
        title: 'Profile',
        ridesCompleted: 'Rides completed',
        idNotVerified: 'ID not verified',
        editProfile: 'Edit profile',
        emergencyContacts: 'Emergency contacts',
        noContacts: 'No contacts yet',
        addContact: 'Add contact',
      },
      settings: { title: 'Settings', language: 'Language', logout: 'Log Out' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

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
  } as any);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('FIELD-CLOSE G3 — user guide page', () => {
  test('renders the title and all six sections', () => {
    render(
      <MemoryRouter initialEntries={['/guide']}>
        <Routes>
          <Route path="/guide" element={<UserGuidePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('User guide')).toBeInTheDocument();
    for (const id of ['ride', 'parcel', 'bidding', 'sos', 'language', 'help']) {
      expect(screen.getByTestId(`guide-section-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByText('A ride carries you, the passenger.')).toBeInTheDocument();
  });

  test('is reachable from Profile via the guide card', () => {
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <Routes>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/guide" element={<UserGuidePage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('profile-guide-link'));
    expect(screen.getByTestId('guide-section-ride')).toBeInTheDocument();
  });
});
