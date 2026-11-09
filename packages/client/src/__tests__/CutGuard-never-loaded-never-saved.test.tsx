// CUTGUARD v2 G2 — the invariant, mounted.
//
//   A FIELD NEVER LOADED IS NEVER SAVED.
//
// This is the regression that would have caught B-1 from the client
// side, and it is written against the exact store shape B-1 produced: a
// user object with NO `emergencyContacts` key and NO `driverProfile` key,
// which is precisely what `verifyOtp` returned and what `setUser` put in
// the store at login.
//
// The old screens turned that into `[]` and `''` and then PUT it. The
// assertion here is not "the screen shows a warning" — it is that the
// destructive payload never reaches the wire. `[theNewOne]` over two
// real numbers is the failure; nothing less specific will do.
//
// Page-mounted per #203: the rule lives in a hook and a lib, but a rule
// nothing mounts is a rule the next screen forgets.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
import SettingsPage from '../pages/shared/SettingsPage';
import ProfilePage from '../pages/shared/ProfilePage';
import { useAuthStore } from '../stores/auth.store';
import { useUIStore } from '../stores/ui.store';

const apiFetch = vi.fn();
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

const REAL_CONTACTS = ['+250788111222', '+250788333444'];
const NEW_CONTACT = '+250788999000';
const NOT_LOADED = 'Your emergency contacts have not loaded yet.';
const VEHICLE_NOT_LOADED = 'Your vehicle details have not loaded yet.';

/**
 * The store shape B-1 actually produced: no `emergencyContacts`, no
 * `driverProfile`. Written out rather than built from a factory, because
 * what makes this fixture useful is the ABSENCE of two keys.
 */
const LOGIN_SHAPED_USER = {
  id: 'user-1',
  nickname: 'Mukamana',
  role: 'BOTH',
  language: 'en',
  idVerified: true,
  licenseVerified: true,
  completedRides: 9,
  cancellationCount: 0,
  totalRequests: 11,
};

/** What `/me` answers once G1's serializer is on the other end. */
const SERVED_ME = {
  ...LOGIN_SHAPED_USER,
  emergencyContacts: REAL_CONTACTS,
  driverProfile: {
    vehicleType: 'MOTO',
    registrationPlate: 'RAC456B',
    vehicleDescription: 'Blue Bajaj',
    avgRating: 4.6,
    totalRides: 9,
    isOnline: false,
  },
};

function jsonOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

/** Every PUT body sent to `PUT /api/users/me`, parsed. */
function contactPuts(): Array<Record<string, unknown>> {
  return apiFetch.mock.calls
    .filter(([url, init]: any) => String(url) === '/api/users/me' && init?.method === 'PUT')
    .map(([, init]: any) => JSON.parse(init.body));
}

function vehiclePuts(): Array<Record<string, unknown>> {
  return apiFetch.mock.calls
    .filter(
      ([url, init]: any) =>
        String(url) === '/api/users/me/driver-profile' && init?.method === 'PUT',
    )
    .map(([, init]: any) => JSON.parse(init.body));
}

let showToast: ReturnType<typeof vi.fn>;

beforeEach(() => {
  apiFetch.mockReset();
  window.localStorage.clear();
  // Asserted through the store rather than the DOM: the toast host is
  // mounted by the app shell, not by these pages, so a DOM query would be
  // testing the harness instead of the refusal.
  showToast = vi.fn();
  useUIStore.setState({ showToast } as never);
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      settings: {
        title: 'Settings',
        emergencyContacts: 'Emergency contacts',
        contactPlaceholder: '+250 7XX XXX XXX',
        removeContact: 'Remove contact',
        add: 'Add',
        saveVehicle: 'Save vehicle',
      },
      register: {
        platePlaceholder: 'RAB 123 A',
        vehicleDescriptionPlaceholder: 'Colour and model',
        vehicleDescription: 'Vehicle description',
      },
      profile: {
        contactAdded: 'Contact added',
        contactRemoved: 'Contact removed',
        addContact: 'Add contact',
        addContactButton: 'Save contact',
        contactPhone: 'Phone number',
        removeContact: 'Remove contact',
        contactPhonePlaceholder: '+250 7XX XXX XXX',
        emergencyContacts: 'Emergency contacts',
      },
      errors: {
        contactsNotLoaded: NOT_LOADED,
        vehicleNotLoaded: VEHICLE_NOT_LOADED,
      },
    },
    true,
    true,
  );
  useAuthStore.setState({ user: { ...LOGIN_SHAPED_USER } } as never);
});

/* ============================================================ SettingsPage */

describe('SettingsPage — contacts', () => {
  test('a login-shaped user cannot PUT [theNewOne] over contacts it never loaded', async () => {
    // `/me` answers with the two real numbers; the PUT then succeeds.
    apiFetch.mockImplementation(async (url: string, init?: any) => {
      if (url === '/api/users/me' && init?.method === 'PUT') {
        return jsonOk({ ...SERVED_ME, emergencyContacts: JSON.parse(init.body).emergencyContacts });
      }
      if (url === '/api/users/me') return jsonOk(SERVED_ME);
      return jsonOk({});
    });

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    const input = screen.getByPlaceholderText('+250 7XX XXX XXX');
    fireEvent.change(input, { target: { value: NEW_CONTACT } });
    await act(async () => {
      fireEvent.click(screen.getByText('Add'));
    });

    await waitFor(() => expect(contactPuts().length).toBeGreaterThan(0));

    // THE ASSERTION. Not "a PUT happened" — WHAT was in it.
    for (const body of contactPuts()) {
      expect(body.emergencyContacts).not.toEqual([NEW_CONTACT]);
    }
    expect(contactPuts()[0].emergencyContacts).toEqual([...REAL_CONTACTS, NEW_CONTACT]);
  });

  test('when the field cannot be loaded at all, NO destructive PUT is sent', async () => {
    // The heal fails — offline, or the server is down. The safe direction
    // is to send nothing, because a save that cannot prove what it is
    // replacing is the save that erased her contacts.
    apiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/users/me') return { ok: false, status: 503, json: async () => ({}) };
      return jsonOk({});
    });

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByPlaceholderText('+250 7XX XXX XXX'), {
      target: { value: NEW_CONTACT },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Add'));
    });

    expect(contactPuts()).toHaveLength(0);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(NOT_LOADED, 'error'));
  });

  test('a user who genuinely has NO contacts can still add one', async () => {
    // The other direction, and the reason this is not simply "refuse when
    // the list is empty": `[]` from the server is a real answer and must
    // still be editable.
    useAuthStore.setState({
      user: { ...LOGIN_SHAPED_USER, emergencyContacts: [] },
    } as never);
    apiFetch.mockImplementation(async (url: string, init?: any) => {
      if (url === '/api/users/me' && init?.method === 'PUT') {
        return jsonOk({ ...SERVED_ME, emergencyContacts: [NEW_CONTACT] });
      }
      return jsonOk(SERVED_ME);
    });

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByPlaceholderText('+250 7XX XXX XXX'), {
      target: { value: NEW_CONTACT },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Add'));
    });

    await waitFor(() => expect(contactPuts()).toHaveLength(1));
    expect(contactPuts()[0].emergencyContacts).toEqual([NEW_CONTACT]);
    // And it went straight out — no heal round-trip was needed.
    const gets = apiFetch.mock.calls.filter(
      ([url, init]: any) => String(url) === '/api/users/me' && init?.method !== 'PUT',
    );
    expect(gets).toHaveLength(0);
  });
});

/* ---------------------------------------------------------- U-6, vehicle */

describe('SettingsPage — vehicle identity (U-6)', () => {
  test('a driverProfile that never loaded cannot be saved as empty strings', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url === '/api/users/me') return { ok: false, status: 503, json: async () => ({}) };
      return jsonOk({});
    });

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Save vehicle'));
    });

    // The whole of U-6: `registrationPlate: ''`, `vehicleDescription: ''`.
    expect(vehiclePuts()).toHaveLength(0);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(VEHICLE_NOT_LOADED, 'error'));
  });

  test('once the profile loads, the save carries the real plate', async () => {
    useAuthStore.setState({ user: { ...SERVED_ME } } as never);
    apiFetch.mockImplementation(async () => jsonOk(SERVED_ME.driverProfile));

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Save vehicle'));
    });

    await waitFor(() => expect(vehiclePuts()).toHaveLength(1));
    expect(vehiclePuts()[0].registrationPlate).toBe('RAC456B');
    expect(vehiclePuts()[0].vehicleDescription).toBe('Blue Bajaj');
  });
});

/* ============================================================= ProfilePage */

describe('ProfilePage — the same field, the same invariant', () => {
  test('a login-shaped user cannot PUT [theNewOne] over contacts it never loaded', async () => {
    apiFetch.mockImplementation(async (url: string, init?: any) => {
      if (url === '/api/users/me' && init?.method === 'PUT') {
        return jsonOk({ ...SERVED_ME, emergencyContacts: JSON.parse(init.body).emergencyContacts });
      }
      if (url === '/api/users/me') return jsonOk(SERVED_ME);
      return jsonOk({});
    });

    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>,
    );

    // Open the add-contact modal, then submit.
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Add contact'));
    });
    fireEvent.change(screen.getByPlaceholderText('+250 7XX XXX XXX'), {
      target: { value: NEW_CONTACT },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));
    });

    await waitFor(() => expect(contactPuts().length).toBeGreaterThan(0));
    for (const body of contactPuts()) {
      expect(body.emergencyContacts).not.toEqual([NEW_CONTACT]);
    }
    expect(contactPuts()[0].emergencyContacts).toEqual([...REAL_CONTACTS, NEW_CONTACT]);
  });
});
