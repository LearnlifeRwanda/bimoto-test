// GAP-CLOSE G2 — the emergency-contacts belt.
//
// ProfilePage seeds its contacts state from the auth store and then does
// `contacts.map(...)`. The seed used to be `user?.emergencyContacts || []`,
// which keeps a STRING as a string — and a v13 server sent one. `.map` is
// not a string method, so first render threw.
//
// PILOT-GUARD Item 8's server has sent arrays ever since
// (emergencyContactsSchema enforces it) and the field is not reachable
// from the current API — but the SHARED User type still declares
// `emergencyContacts?: string` while the client store declares
// `string[]`, so the two shapes are both still spelled out in the repo.
// Same wire-shape-vs-fixture-shape class as the avatar-initial pin
// (FIELD-UX G3), and the fixtures below are the wire's shapes, not the
// optimistic client type.
import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
import ProfilePage from '../pages/shared/ProfilePage';
import { useAuthStore } from '../stores/auth.store';

type StoreUser = NonNullable<ReturnType<typeof useAuthStore.getState>['user']>;

function serverShapedUser(emergencyContacts: unknown) {
  return {
    id: 'user-1',
    phone: '+250780000002',
    nickname: 'Chantal',
    role: 'CUSTOMER',
    language: 'rw',
    idVerified: false,
    licenseVerified: false,
    emergencyContacts,
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
      profile: {
        title: 'Profile',
        ridesCompleted: 'Rides completed',
        emergencyContacts: 'Emergency contacts',
        noContacts: 'No emergency contacts',
        addContact: 'Add contact',
        removeContact: 'Remove contact',
      },
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

describe('ProfilePage emergency-contacts shape (GAP-CLOSE G2)', () => {
  test('renders when emergencyContacts arrives as a legacy STRING', () => {
    // Pre-fix this render threw: contacts.map is not a function.
    renderProfileAs(serverShapedUser('+250788123456'));

    expect(screen.getByText('Profile')).toBeInTheDocument();
    // Treated as "none", not as three-and-a-bit characters: a string is
    // not a contact list, and inventing entries from it would be worse
    // than showing none.
    expect(screen.getByText('No emergency contacts')).toBeInTheDocument();
  });

  test('renders when emergencyContacts is a comma-joined legacy STRING', () => {
    renderProfileAs(serverShapedUser('+250788123456,+250788999888'));

    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('No emergency contacts')).toBeInTheDocument();
  });

  test('renders when emergencyContacts is absent', () => {
    renderProfileAs(serverShapedUser(undefined));

    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('No emergency contacts')).toBeInTheDocument();
  });

  test('a real ARRAY still lists every contact — the current server path', () => {
    renderProfileAs(serverShapedUser(['+250788123456', '+250788999888']));

    expect(screen.getByText('+250788123456')).toBeInTheDocument();
    expect(screen.getByText('+250788999888')).toBeInTheDocument();
    expect(screen.queryByText('No emergency contacts')).not.toBeInTheDocument();
  });
});
