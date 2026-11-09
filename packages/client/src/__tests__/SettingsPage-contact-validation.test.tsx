// VALIDATE-MEND G2 — the inline half of the contact rule.
//
// The server is the authority (PUT /me now parses updateMeSchema), but
// a person typing "mama" into the emergency-contact field should be
// told at the input, not by a toast after a round trip that already
// spent their data. What is proved here is that the client refuses
// BEFORE the request — no apiFetch call at all — and that a real number
// still goes through untouched.
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
import SettingsPage from '../pages/shared/SettingsPage';
import { useAuthStore } from '../stores/auth.store';

const apiFetch = vi.fn();
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

const INVALID = 'That is not a phone number we can call.';
const HINT = '07XX XXX XXX, or with a country code';

beforeEach(() => {
  apiFetch.mockReset();
  window.localStorage.clear();
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      settings: {
        title: 'Settings',
        emergencyContacts: 'Emergency contacts',
        contactPlaceholder: '+250 7XX XXX XXX',
        contactFormatHint: HINT,
        removeContact: 'Remove contact',
        add: 'Add',
      },
      errors: { invalidEmergencyContact: INVALID },
      profile: { contactAdded: 'Contact added' },
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

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

function typeContact(value: string) {
  const input = screen.getByPlaceholderText('+250 7XX XXX XXX');
  fireEvent.change(input, { target: { value } });
  return input;
}

describe('the emergency-contact input', () => {
  test('hints the expected format before anything is typed', () => {
    renderPage();
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  test('refuses a word inline and never makes the request', async () => {
    renderPage();
    typeContact('mama');
    await act(async () => {
      fireEvent.click(screen.getByText('Add'));
    });

    expect(screen.getByRole('alert').textContent).toContain(INVALID);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  test('clears the error as soon as the person edits the field again', async () => {
    renderPage();
    typeContact('mama');
    await act(async () => {
      fireEvent.click(screen.getByText('Add'));
    });
    expect(screen.queryByRole('alert')).toBeTruthy();

    typeContact('0788123456');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('lets a real Rwandan number through to the server', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'user-1', emergencyContacts: ['+250788123456'] }),
    });
    renderPage();
    typeContact('0788 123 456');
    await act(async () => {
      fireEvent.click(screen.getByText('Add'));
    });

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [url, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/users/me');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string).emergencyContacts).toEqual(['0788 123 456']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('lets an international number through too', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'user-1', emergencyContacts: ['+447700900123'] }),
    });
    renderPage();
    typeContact('+44 7700 900123');
    await act(async () => {
      fireEvent.click(screen.getByText('Add'));
    });

    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
