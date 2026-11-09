// ACCOUNT-RIGHTS-SURFACE G6 — the banner, in every state it has.
//
// It renders the real en strings, not stubs: the words ARE the deliverable
// in this group, and a test that asserts on placeholder text would pass
// while the shipped banner said nothing useful.
//
// The state that matters most is the third one. A deletion whose 72 hours
// have run out and which the job keeps deferring is the moment a person
// most needs the app to speak — and before this dispatch it counted down
// to zero and then sat there.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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

const apiFetch = vi.fn();
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

import { DeletionBanner, countdownKey } from '../components/ui/DeletionBanner';
import { useAuthStore } from '../stores/auth.store';
import { useUIStore } from '../stores/ui.store';

const NOW = new Date('2026-08-24T12:00:00Z').getTime();
const HOUR = 60 * 60 * 1000;

const baseUser = { id: 'u1', nickname: 'Chantal', role: 'CUSTOMER' };

function signIn(accountDeletion: unknown) {
  useAuthStore.setState({
    user: { ...baseUser, accountDeletion } as never,
    isAuthenticated: true,
    isLoading: false,
    token: 'tok',
  });
}

const jsonOk = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(async () => {
  // Fake the CLOCK only, not setInterval: the banner's one-minute tick is
  // real here and simply never fires inside a test that runs in
  // milliseconds. Faking timers too made the auto-advance fire that tick
  // during the async cancel awaits, outside act().
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  apiFetch.mockReset();
  i18n.addResourceBundle('en', 'translation', { deletion: en.deletion }, true, true);
  await i18n.changeLanguage('en');
  useUIStore.setState({ toasts: [] } as never);
});

afterEach(() => {
  vi.useRealTimers();
  useAuthStore.setState({ user: null, isAuthenticated: false } as never);
});

describe('when the account has no deletion request', () => {
  test('renders nothing at all', () => {
    signIn(null);
    const { container } = render(<DeletionBanner />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('deletion-banner')).toBeNull();
  });

  test('renders nothing when the field is absent entirely (pre-#195 accounts)', () => {
    useAuthStore.setState({ user: baseUser as never, isAuthenticated: true } as never);
    const { container } = render(<DeletionBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('before executesAt', () => {
  test('counts down in whole days and carries the D1 rides sentence', () => {
    signIn({
      requestedAt: new Date(NOW).toISOString(),
      executesAt: new Date(NOW + 52 * HOUR).toISOString(),
      deferredReason: null,
    });
    render(<DeletionBanner />);

    expect(screen.getByTestId('deletion-banner-title')).toHaveTextContent(
      'Your account is being deleted',
    );
    expect(screen.getByTestId('deletion-banner-countdown')).toHaveTextContent(
      'It will be erased in about 2 days.',
    );
    // D1: rides taken during the window go with everything else.
    expect(screen.getByTestId('deletion-banner-rides-note')).toHaveTextContent(
      'erased along with everything else',
    );
    expect(screen.queryByTestId('deletion-banner-reason')).toBeNull();
  });

  test('drops to hours inside the last day', () => {
    signIn({
      requestedAt: new Date(NOW).toISOString(),
      executesAt: new Date(NOW + 5 * HOUR).toISOString(),
      deferredReason: null,
    });
    render(<DeletionBanner />);
    expect(screen.getByTestId('deletion-banner-countdown')).toHaveTextContent(
      'It will be erased in about 5 hours.',
    );
  });

  test('the cancel is offered here too — it is never the buried path', () => {
    signIn({
      requestedAt: new Date(NOW).toISOString(),
      executesAt: new Date(NOW + 10 * HOUR).toISOString(),
      deferredReason: null,
    });
    render(<DeletionBanner />);
    expect(screen.getByTestId('deletion-banner-cancel')).toHaveTextContent('Keep my account');
  });
});

describe('past executesAt with a deferral reason', () => {
  test('shows the reason sentence instead of a dead countdown', () => {
    signIn({
      requestedAt: new Date(NOW - 80 * HOUR).toISOString(),
      executesAt: new Date(NOW - 8 * HOUR).toISOString(),
      deferredReason: 'LIVE_ESCROW',
    });
    render(<DeletionBanner />);

    expect(screen.getByTestId('deletion-banner-title')).toHaveTextContent(
      'Your deletion is waiting on one thing',
    );
    expect(screen.getByTestId('deletion-banner-reason')).toHaveTextContent(
      'We cannot delete your account while the payment for one of your rides is still being settled.',
    );
    expect(screen.queryByTestId('deletion-banner-countdown')).toBeNull();
  });

  test.each([
    ['NON_TERMINAL_JOURNEY', 'while a ride is still going'],
    ['UNRESOLVED_EMERGENCY', 'an emergency you raised is still open'],
    ['ACCOUNT_FROZEN', 'Your account is frozen'],
    ['POSITIVE_DRIVER_BALANCE', 'We still owe you money'],
  ])('renders the %s sentence', (reason, fragment) => {
    signIn({
      requestedAt: new Date(NOW - 80 * HOUR).toISOString(),
      executesAt: new Date(NOW - 1 * HOUR).toISOString(),
      deferredReason: reason,
    });
    render(<DeletionBanner />);
    expect(screen.getByTestId('deletion-banner-reason')).toHaveTextContent(fragment);
  });

  test('past the deadline with no reason yet, it says it is waiting rather than lying', () => {
    signIn({
      requestedAt: new Date(NOW - 80 * HOUR).toISOString(),
      executesAt: new Date(NOW - 1 * HOUR).toISOString(),
      deferredReason: null,
    });
    render(<DeletionBanner />);
    expect(screen.getByTestId('deletion-banner-title')).toHaveTextContent(
      'Your deletion is waiting on one thing',
    );
    expect(screen.queryByTestId('deletion-banner-countdown')).toBeNull();
    // Still cancellable.
    expect(screen.getByTestId('deletion-banner-cancel')).toBeInTheDocument();
  });
});

describe('cancelling', () => {
  test('calls the endpoint, refetches /me, and the banner goes', async () => {
    signIn({
      requestedAt: new Date(NOW).toISOString(),
      executesAt: new Date(NOW + 40 * HOUR).toISOString(),
      deferredReason: null,
    });
    apiFetch
      .mockResolvedValueOnce(jsonOk({ success: true }))
      .mockResolvedValueOnce(jsonOk({ ...baseUser, accountDeletion: null }));

    render(<DeletionBanner />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('deletion-banner-cancel'));
    });

    await waitFor(() => expect(screen.queryByTestId('deletion-banner')).toBeNull());

    expect(apiFetch).toHaveBeenNthCalledWith(
      1,
      '/api/users/me/deletion/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/users/me');
    expect(useAuthStore.getState().user?.accountDeletion).toBeNull();
  });

  test('a double-tap fires the cancel exactly once', async () => {
    signIn({
      requestedAt: new Date(NOW).toISOString(),
      executesAt: new Date(NOW + 40 * HOUR).toISOString(),
      deferredReason: null,
    });
    // A second POST would find no PENDING row and answer 404, which the
    // presenter would show as an error to someone whose cancel worked.
    let release: (v: unknown) => void = () => {};
    apiFetch
      .mockImplementationOnce(() => new Promise((r) => { release = r; }))
      .mockResolvedValueOnce(jsonOk({ ...baseUser, accountDeletion: null }));

    render(<DeletionBanner />);
    const button = screen.getByTestId('deletion-banner-cancel');
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);
    });

    await waitFor(() => expect(button).toBeDisabled());
    const cancelCalls = apiFetch.mock.calls.filter(
      (c) => c[0] === '/api/users/me/deletion/cancel',
    );
    expect(cancelCalls).toHaveLength(1);

    await act(async () => {
      release(jsonOk({ success: true }));
    });
    await waitFor(() => expect(screen.queryByTestId('deletion-banner')).toBeNull());
  });

  test('a failed cancel leaves the banner up rather than pretending', async () => {
    signIn({
      requestedAt: new Date(NOW).toISOString(),
      executesAt: new Date(NOW + 40 * HOUR).toISOString(),
      deferredReason: null,
    });
    apiFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      clone: () => ({ json: async () => ({ error: { message: 'errors.noDeletionPending' } }) }),
      json: async () => ({ error: { message: 'errors.noDeletionPending' } }),
    });

    render(<DeletionBanner />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('deletion-banner-cancel'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('deletion-banner-cancel')).not.toBeDisabled(),
    );
    expect(screen.getByTestId('deletion-banner')).toBeInTheDocument();
  });
});

describe('countdownKey boundaries', () => {
  test.each([
    [48 * HOUR, 'deletion.bannerCountdownDays', 2],
    [24 * HOUR, 'deletion.bannerCountdownDays', 1],
    [24 * HOUR - 1, 'deletion.bannerCountdownHours', 23],
    [HOUR, 'deletion.bannerCountdownHours', 1],
    [HOUR - 1, 'deletion.bannerCountdownMinutes', 59],
    [60_000, 'deletion.bannerCountdownMinutes', 1],
    [59_999, 'deletion.bannerCountdownImminent', 0],
    [1, 'deletion.bannerCountdownImminent', 0],
  ])('%d ms => %s', (ms, key, count) => {
    expect(countdownKey(ms)).toEqual({ key, count });
  });

  test('null once the deadline has passed', () => {
    expect(countdownKey(0)).toBeNull();
    expect(countdownKey(-1)).toBeNull();
  });
});
