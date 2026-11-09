// FIELD-UX G3 — regression test for the avatar-initial crash, the known
// sibling of the PROFILE-RESCUE avgRating crash (#140).
//
// The old ProfilePage rendered `user.nickname[0].toUpperCase()`. When the
// wire carries an empty-string nickname, nickname[0] is undefined and
// .toUpperCase() throws on first render — same wire-shape-vs-fixture-shape
// class as #140. Fixtures here mirror the SERIALIZED wire shape (empty
// string / absent field), not the optimistic client type.
import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
import ProfilePage from '../pages/shared/ProfilePage';
import { useAuthStore } from '../stores/auth.store';

type StoreUser = NonNullable<ReturnType<typeof useAuthStore.getState>['user']>;

// The server-serialized customer row, verbatim shape. nickname arrives
// exactly as the DB holds it — including the empty string this test pins.
function serverShapedUser(nickname: unknown) {
  return {
    id: 'user-1',
    phone: '+250780000002',
    nickname,
    role: 'CUSTOMER',
    language: 'rw',
    idVerified: false,
    licenseVerified: false,
    emergencyContacts: [],
    completedRides: 3,
    cancellationCount: 0,
    totalRequests: 4,
  } as unknown as StoreUser;
}

beforeEach(() => {
  window.localStorage.clear();
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      profile: { title: 'Profile', ridesCompleted: 'Rides completed' },
    },
    true,
    true,
  );
});

function renderProfileAs(user: StoreUser) {
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

describe('ProfilePage avatar initial (FIELD-UX G3)', () => {
  test('renders for a user whose nickname arrives as an empty string', () => {
    renderProfileAs(serverShapedUser(''));

    // Pre-fix this render threw: nickname[0] is undefined -> .toUpperCase crash.
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByTestId('profile-avatar-initial')).toHaveTextContent('?');
  });

  test('renders for a user whose nickname is missing from the payload', () => {
    renderProfileAs(serverShapedUser(undefined));

    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByTestId('profile-avatar-initial')).toHaveTextContent('?');
  });

  test('a whitespace-only nickname gets the fallback, not an invisible initial', () => {
    renderProfileAs(serverShapedUser('   '));

    expect(screen.getByTestId('profile-avatar-initial')).toHaveTextContent('?');
  });

  test('a normal nickname still shows its uppercased first letter', () => {
    renderProfileAs(serverShapedUser('chantal'));

    expect(screen.getByTestId('profile-avatar-initial')).toHaveTextContent('C');
  });
});
