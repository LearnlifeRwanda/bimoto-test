// ACCOUNT-RIGHTS-SURFACE G6 — the buried entry, and the gate behind it.
//
// Two founder rulings are pinned here, and they pull in opposite
// directions on purpose:
//
//   the ENTRY is buried  — one row, at the bottom of Settings, BELOW the
//     logout button, with no link from anywhere else in the app;
//   the GATE is real     — no DELETE request may leave the client until
//     the user has passed step 1 AND held the confirm button down.
//
// The gate test is the one that would catch the worst regression this
// group could have: a confirm control that fires on tap.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
import en from '../../public/locales/en/translation.json';

vi.mock('../hooks/usePushNotifications', () => ({
  deregisterPush: vi.fn(async () => {}),
}));
vi.mock('../lib/secure-token-store', () => ({
  clearStoredRefreshToken: vi.fn(async () => {}),
  getStoredRefreshToken: vi.fn(async () => null),
  storeRefreshToken: vi.fn(async () => {}),
}));
vi.mock('../hooks/usePreferences', async () => {
  const actual = await vi.importActual<typeof import('../hooks/usePreferences')>(
    '../hooks/usePreferences',
  );
  return {
    ...actual,
    useDiagnosticsUpload: () => ({ enabled: true, loading: false, setEnabled: vi.fn() }),
  };
});

const apiFetch = vi.fn();
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

import { SettingsPage } from '../pages/shared/SettingsPage';
import { DeleteAccountPage } from '../pages/shared/DeleteAccountPage';
import { useAuthStore } from '../stores/auth.store';

const HOLD_MS = 2000;

beforeEach(async () => {
  apiFetch.mockReset();
  i18n.addResourceBundle(
    'en',
    'translation',
    { deletion: en.deletion, account: en.account, settings: en.settings, common: en.common },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  useAuthStore.setState({
    user: { id: 'u1', nickname: 'Chantal', role: 'CUSTOMER' } as never,
    isAuthenticated: true,
    isLoading: false,
    token: 'tok',
  });
});

afterEach(() => {
  vi.useRealTimers();
  useAuthStore.setState({ user: null, isAuthenticated: false } as never);
});

function renderFlow(initial = '/settings') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/delete-account" element={<DeleteAccountPage />} />
        <Route path="/" element={<div data-testid="home" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('the buried entry', () => {
  test('renders account.deleteAccount — the key that had no home until now', () => {
    renderFlow();
    expect(screen.getByTestId('settings-delete-account')).toHaveTextContent('Delete My Account');
  });

  test('sits BELOW the logout button, at the bottom of the page', () => {
    const { container } = renderFlow();
    const html = container.innerHTML;
    const logoutAt = html.indexOf(i18n.t('settings.logout'));
    const deleteAt = html.indexOf('settings-delete-account');
    expect(logoutAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(-1);
    // Buried means buried: below the sign-out control, not above it.
    expect(deleteAt).toBeGreaterThan(logoutAt);
  });

  test('the row navigates to the flow and nothing else does', () => {
    renderFlow();
    expect(screen.queryByTestId('delete-account-step-1')).toBeNull();
    fireEvent.click(screen.getByTestId('settings-delete-account'));
    expect(screen.getByTestId('delete-account-step-1')).toBeInTheDocument();
    // Landing on the flow must not have asked the server for anything.
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe('the confirm gate', () => {
  test('step 1 says what is erased AND what is kept, before any confirm exists', () => {
    renderFlow('/settings/delete-account');
    expect(screen.getByText('Your phone number')).toBeInTheDocument();
    expect(screen.getByText(/each ride happened/)).toBeInTheDocument();
    expect(screen.getByText(/nothing in them points back to you/)).toBeInTheDocument();
    // No confirm control on step 1 at all.
    expect(screen.queryByTestId('delete-account-hold')).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  test('reaching step 2 still fires no request', () => {
    renderFlow('/settings/delete-account');
    fireEvent.click(screen.getByTestId('delete-account-continue'));
    expect(screen.getByTestId('delete-account-step-2')).toBeInTheDocument();
    expect(screen.getByTestId('delete-account-hold')).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  test('a TAP on the confirm control fires nothing — it is not a button', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderFlow('/settings/delete-account');
    fireEvent.click(screen.getByTestId('delete-account-continue'));

    const hold = screen.getByTestId('delete-account-hold');
    // Press and release immediately, the way a mis-tap looks.
    fireEvent.pointerDown(hold);
    fireEvent.pointerUp(hold);
    await act(async () => {
      vi.advanceTimersByTime(HOLD_MS * 2);
    });

    expect(apiFetch).not.toHaveBeenCalled();
  });

  test('a hold that leaves the button before time fires nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderFlow('/settings/delete-account');
    fireEvent.click(screen.getByTestId('delete-account-continue'));

    const hold = screen.getByTestId('delete-account-hold');
    fireEvent.pointerDown(hold);
    await act(async () => {
      vi.advanceTimersByTime(HOLD_MS - 100);
    });
    fireEvent.pointerLeave(hold);
    await act(async () => {
      vi.advanceTimersByTime(HOLD_MS);
    });

    expect(apiFetch).not.toHaveBeenCalled();
  });

  test('a completed hold opens the window and lands home', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const executesAt = '2026-08-27T12:00:00.000Z';
    apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, executesAt }),
    });

    renderFlow('/settings/delete-account');
    fireEvent.click(screen.getByTestId('delete-account-continue'));

    fireEvent.pointerDown(screen.getByTestId('delete-account-hold'));
    await act(async () => {
      vi.advanceTimersByTime(HOLD_MS);
    });

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/users/me',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    // Exactly one request, and the store carries the window so the shell
    // banner is up before the navigation settles.
    expect(apiFetch).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(useAuthStore.getState().user?.accountDeletion?.executesAt).toBe(executesAt),
    );
    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument());
  });

  test('a 409 already-pending leaves the user where they are', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const body = { error: { code: 'DELETION_ALREADY_PENDING', message: 'errors.deletionAlreadyPending' } };
    apiFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      clone: () => ({ json: async () => body }),
      json: async () => body,
    });

    renderFlow('/settings/delete-account');
    fireEvent.click(screen.getByTestId('delete-account-continue'));
    fireEvent.pointerDown(screen.getByTestId('delete-account-hold'));
    await act(async () => {
      vi.advanceTimersByTime(HOLD_MS);
    });

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    // No navigation home, and no invented deletion window in the store.
    expect(screen.queryByTestId('home')).toBeNull();
    expect(useAuthStore.getState().user?.accountDeletion).toBeUndefined();
  });

  test('backing out of step 2 returns to Settings with nothing fired', () => {
    renderFlow('/settings/delete-account');
    fireEvent.click(screen.getByTestId('delete-account-continue'));
    fireEvent.click(screen.getByTestId('delete-account-abort'));
    expect(screen.getByTestId('settings-delete-account')).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
