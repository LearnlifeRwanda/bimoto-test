// SOCKET-FIX G6 — the freeze notice blocks until acknowledged, and the
// acknowledge runs the EXISTING auth-store logout path (not hand-rolled
// token clearing).

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { i18n } from './setup';

vi.mock('../hooks/usePushNotifications', () => ({
  deregisterPush: vi.fn(async () => {}),
}));
vi.mock('../lib/secure-token-store', () => ({
  clearStoredRefreshToken: vi.fn(async () => {}),
  getStoredRefreshToken: vi.fn(async () => null),
  storeRefreshToken: vi.fn(async () => {}),
}));

import { AccountFrozenNotice } from '../components/ui/AccountFrozenNotice';
import { useAuthStore } from '../stores/auth.store';
import { useUIStore } from '../stores/ui.store';

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      account: {
        frozenTitle: 'Account frozen',
        frozenBody: 'Your account has been frozen — contact support.',
      },
      common: { ok: 'OK' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  useAuthStore.setState({
    token: 'tok',
    user: { id: 'u1' } as any,
    isAuthenticated: true,
    isLoading: false,
  });
});

describe('AccountFrozenNotice (SOCKET-FIX G4)', () => {
  test('renders nothing while the account is not frozen', () => {
    useUIStore.setState({ accountFrozen: false });
    render(<AccountFrozenNotice />);
    expect(screen.queryByTestId('account-frozen-notice')).toBeNull();
  });

  test('shows the blocking notice, and acknowledge logs out via the auth store', () => {
    useUIStore.setState({ accountFrozen: true });
    render(<AccountFrozenNotice />);

    expect(screen.getByTestId('account-frozen-notice')).toBeInTheDocument();
    expect(
      screen.getByText('Your account has been frozen — contact support.'),
    ).toBeInTheDocument();
    // Notice first, session intact until the user acts (mid-ride safety).
    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    fireEvent.click(screen.getByTestId('account-frozen-ack'));

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().token).toBeNull();
    expect(useUIStore.getState().accountFrozen).toBe(false);
  });
});
