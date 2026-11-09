// PILOT-GUARD Item 8 — the same editor, validated the same way.
//
// ProfilePage and SettingsPage edit the same field, on the same user,
// through the same PUT /api/users/me. VALIDATE-MEND G2 gave SettingsPage
// an inline check with isValidEmergencyContact; ProfilePage kept
// submitting whatever was typed, so a person entering "mama" here spent
// a round trip to be told "not accepted" — on the one list that only
// matters during an emergency.
//
// This file is deliberately the mirror of
// SettingsPage-contact-validation.test.tsx: the two screens are tested
// side by side so a change that re-forks them turns one of the two red.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
import ProfilePage from '../pages/shared/ProfilePage';
import { useAuthStore } from '../stores/auth.store';
import { MAX_EMERGENCY_CONTACTS } from '@bimoto/shared';

const apiFetch = vi.fn();
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

const INVALID = 'That is not a phone number we can call.';

beforeEach(() => {
  apiFetch.mockReset();
  window.localStorage.clear();
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      profile: {
        title: 'Profile',
        ridesCompleted: 'Rides completed',
        emergencyContacts: 'Emergency contacts',
        noContacts: 'No contacts yet',
        addContact: 'Add contact',
        addContactButton: 'Add',
        contactPhone: 'Phone',
        contactPhonePlaceholder: '+250 7XX XXX XXX',
        editProfile: 'Edit profile',
        contactAdded: 'Contact added',
      },
      settings: { title: 'Settings', logout: 'Log Out' },
      guide: { title: 'User guide' },
      payments: { title: 'Payments' },
      wallet: { title: 'Wallet' },
      common: { cancel: 'Cancel' },
      errors: { invalidEmergencyContact: INVALID },
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
      emergencyContacts: [],
    },
  } as never);
});

function openContactModal() {
  render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByLabelText('Add contact'));
}

function typeContact(value: string) {
  fireEvent.change(screen.getByPlaceholderText('+250 7XX XXX XXX'), {
    target: { value },
  });
}

const clickAdd = async () => {
  await act(async () => {
    fireEvent.click(screen.getByText('Add'));
  });
};

// ProfilePage's OfflineMapCard fetches /api/map/regions on mount, so the
// assertions below count only the call this screen would make for the
// contact — PUT /api/users/me — and the stub answers the map call in its
// own shape rather than the contact one.
const contactPuts = () =>
  apiFetch.mock.calls.filter(([url]) => String(url) === '/api/users/me');

function answerContactPutWith(contacts: string[]) {
  apiFetch.mockImplementation(async (url: unknown) => {
    if (String(url) === '/api/users/me') {
      // The page does setUser(await res.json()), so the stub answers
      // with a whole user rather than a fragment.
      return {
        ok: true,
        json: async () => ({
          id: 'user-1',
          nickname: 'Test',
          role: 'CUSTOMER',
          language: 'en',
          emergencyContacts: contacts,
        }),
      };
    }
    return { ok: true, json: async () => ({ regions: [] }) };
  });
}

describe('ProfilePage emergency contact — validated like its sibling', () => {
  test('refuses a word inline and never makes the request', async () => {
    openContactModal();
    typeContact('mama');
    await clickAdd();

    expect(screen.getByRole('alert').textContent).toContain(INVALID);
    expect(contactPuts()).toHaveLength(0);
  });

  test('refuses a too-short number', async () => {
    openContactModal();
    typeContact('0788');
    await clickAdd();
    expect(contactPuts()).toHaveLength(0);
  });

  test('clears the error as soon as the person edits the field again', async () => {
    openContactModal();
    typeContact('mama');
    await clickAdd();
    expect(screen.queryByRole('alert')).toBeTruthy();

    typeContact('0788123456');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('lets a real Rwandan number through to the server', async () => {
    answerContactPutWith(['0788 123 456']);
    openContactModal();
    typeContact('0788 123 456');
    await clickAdd();

    expect(contactPuts()).toHaveLength(1);
    const [, init] = contactPuts()[0] as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string).emergencyContacts).toEqual(['0788 123 456']);
  });

  test('lets an international number through too', async () => {
    answerContactPutWith(['+44 7700 900123']);
    openContactModal();
    typeContact('+44 7700 900123');
    await clickAdd();
    expect(contactPuts()).toHaveLength(1);
  });
});

describe('the cap is declared once', () => {
  test('both screens read the shared constant, not a local copy', () => {
    const read = (rel: string) =>
      require('node:fs').readFileSync(
        require('node:path').join(__dirname, rel),
        'utf8',
      );
    for (const page of ['../pages/shared/ProfilePage.tsx', '../pages/shared/SettingsPage.tsx']) {
      const src = read(page);
      const code = src
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      expect(code).not.toMatch(/const\s+MAX_EMERGENCY_CONTACTS\s*=/);
      expect(code).toMatch(/MAX_EMERGENCY_CONTACTS/);
    }
    // And the one that survives is the one the server's schema caps at.
    expect(MAX_EMERGENCY_CONTACTS).toBe(3);
  });
});
