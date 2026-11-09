// APP-LOCK G6 — the reachability proof, the pierce, and D26.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { i18n } from './setup';

const store = new Map<string, string>();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
    },
    remove: async ({ key }: { key: string }) => {
      store.delete(key);
    },
  },
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => false },
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: vi.fn() })) },
}));
vi.mock('../lib/api', () => ({ apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })) }));
vi.mock('../hooks/usePushNotifications', () => ({ deregisterPush: vi.fn(async () => {}) }));
vi.mock('../lib/secure-token-store', () => ({
  clearStoredRefreshToken: vi.fn(async () => {}),
  getStoredRefreshToken: vi.fn(async () => null),
  storeRefreshToken: vi.fn(async () => {}),
}));

import { AppLockGate } from '../components/lock/AppLockGate';
import { LockScreen } from '../components/lock/LockScreen';
import { useAppLockStore } from '../stores/app-lock.store';
import { useJourneyStore } from '../stores/journey.store';
import {
  armAppLock,
  disarmAppLock,
  verifyAppLockCode,
  isAppLockArmed,
  validateAppLockCode,
} from '../lib/app-lock';
import { performLogout } from '../lib/logout';

beforeEach(async () => {
  vi.clearAllMocks();
  store.clear();
  await i18n.changeLanguage('en');
  useAppLockStore.setState({
    armed: false,
    locked: false,
    backgroundedAt: null,
    timeoutMinutes: 0,
  });
  useJourneyStore.setState({ activeJourney: null } as never);
});

describe('the code format IS the money-PIN separation', () => {
  test('a 4-digit code — a money PIN’s shape — is refused outright', async () => {
    // The money PIN is never on the device, so this cannot compare
    // against it. It refuses by SHAPE instead, which makes a duplicate
    // impossible to enter rather than merely detected.
    expect(validateAppLockCode('1234')).toBe('LOOKS_LIKE_MONEY_PIN');
    expect(await armAppLock('1234')).toBe('LOOKS_LIKE_MONEY_PIN');
    expect(await isAppLockArmed()).toBe(false);
  });

  test('shorter than the minimum is refused', async () => {
    expect(validateAppLockCode('12345')).toBe('TOO_SHORT');
  });

  test('non-digits are refused', () => {
    expect(validateAppLockCode('abcdef')).toBe('NOT_DIGITS');
  });

  test('six or more digits is accepted', async () => {
    expect(await armAppLock('123456')).toBeNull();
    expect(await isAppLockArmed()).toBe(true);
  });
});

describe('device-local storage', () => {
  test('verifies offline, with no network call at all', async () => {
    await armAppLock('123456');
    expect(await verifyAppLockCode('123456')).toBe(true);
    expect(await verifyAppLockCode('654321')).toBe(false);
  });

  test('the code is NEVER stored in plaintext', async () => {
    await armAppLock('123456');
    const written = [...store.values()].join('|');
    expect(written).not.toContain('123456');
  });

  test('disarm removes it', async () => {
    await armAppLock('123456');
    await disarmAppLock();
    expect(await isAppLockArmed()).toBe(false);
  });
});

describe('the yield-all router gate', () => {
  function routed(initial: string) {
    return render(
      <MemoryRouter initialEntries={[initial]}>
        <AppLockGate>
          <Routes>
            <Route path="/" element={<div data-testid="home">home</div>} />
            <Route
              path="/journey/:id/chat"
              element={<div data-testid="deep-link">chat</div>}
            />
          </Routes>
        </AppLockGate>
      </MemoryRouter>,
    );
  }

  test('armed cold start locks the HOME route', async () => {
    await armAppLock('123456');
    routed('/');
    await waitFor(() => expect(screen.getByTestId('lock-screen')).toBeInTheDocument());
    expect(screen.queryByTestId('home')).not.toBeInTheDocument();
  });

  test('armed cold start locks a DEEP LINK too — no route is mounted at all', async () => {
    // A notification tap sets the URL, but <Routes> is never rendered, so
    // nothing behind the lock renders, mounts or fetches.
    await armAppLock('123456');
    routed('/journey/abc/chat');
    await waitFor(() => expect(screen.getByTestId('lock-screen')).toBeInTheDocument());
    expect(screen.queryByTestId('deep-link')).not.toBeInTheDocument();
  });

  test('not armed → every route renders normally', async () => {
    routed('/journey/abc/chat');
    await waitFor(() => expect(screen.getByTestId('deep-link')).toBeInTheDocument());
    expect(screen.queryByTestId('lock-screen')).not.toBeInTheDocument();
  });

  test('unlocking restores the app, and lands on home rather than the deep link', async () => {
    await armAppLock('123456');
    routed('/journey/abc/chat');
    await waitFor(() => expect(screen.getByTestId('lock-screen')).toBeInTheDocument());

    act(() => useAppLockStore.getState().unlock());
    await waitFor(() => expect(screen.queryByTestId('lock-screen')).not.toBeInTheDocument());
    // The URL that was in the bar when the lock came down is dropped.
    expect(screen.queryByTestId('deep-link')).not.toBeInTheDocument();
  });
});

describe('the SOS pierce', () => {
  test('112 is offered ALWAYS, with no journey and no session', () => {
    render(<LockScreen />);
    const link = screen.getByTestId('lock-screen-112');
    // A plain tel: href the OS dials — this component could be entirely
    // broken and it would still work.
    expect(link).toHaveAttribute('href', 'tel:112');
  });

  test('EmergencySOS is NOT mounted when there is no active journey', () => {
    render(<LockScreen />);
    expect(screen.queryByTestId('lock-screen-sos')).not.toBeInTheDocument();
  });

  test('EmergencySOS IS mounted when a journey is live', () => {
    useJourneyStore.setState({ activeJourney: { id: 'j1' } } as never);
    render(<LockScreen />);
    expect(screen.getByTestId('lock-screen-sos')).toBeInTheDocument();
  });

  test('THE PINNED INVARIANT: raising SOS unlocks nothing', () => {
    useJourneyStore.setState({ activeJourney: { id: 'j1' } } as never);
    useAppLockStore.setState({ armed: true, locked: true });
    render(<LockScreen />);

    fireEvent.click(screen.getByTestId('lock-screen-sos'));
    // Still locked, and still locked after the emergency UI is touched.
    expect(useAppLockStore.getState().locked).toBe(true);
    expect(screen.getByTestId('lock-screen')).toBeInTheDocument();
  });

  test('the store exposes NO bypass an emergency path could call', () => {
    // Structural, on purpose: a function that does not exist cannot be
    // called by mistake in six months.
    const state = useAppLockStore.getState() as unknown as Record<string, unknown>;
    for (const name of ['bypass', 'unlockForEmergency', 'emergencyUnlock', 'forceUnlock']) {
      expect(state[name]).toBeUndefined();
    }
  });
});

describe('unlocking', () => {
  test('the right code unlocks', async () => {
    await armAppLock('123456');
    useAppLockStore.setState({ armed: true, locked: true });
    render(<LockScreen />);

    for (const d of ['1', '2', '3', '4', '5', '6']) {
      fireEvent.click(screen.getByTestId(`app-lock-key-${d}`));
    }
    fireEvent.click(screen.getByTestId('lock-screen-unlock'));
    await waitFor(() => expect(useAppLockStore.getState().locked).toBe(false));
  });

  test('a wrong code does not, and says so', async () => {
    await armAppLock('123456');
    useAppLockStore.setState({ armed: true, locked: true });
    render(<LockScreen />);

    for (const d of ['6', '5', '4', '3', '2', '1']) {
      fireEvent.click(screen.getByTestId(`app-lock-key-${d}`));
    }
    fireEvent.click(screen.getByTestId('lock-screen-unlock'));
    await waitFor(() => expect(screen.getByTestId('lock-screen-error')).toBeInTheDocument());
    expect(useAppLockStore.getState().locked).toBe(true);
  });
});

describe('recovery', () => {
  test('logout disarms the lock — the one recovery path', async () => {
    await armAppLock('123456');
    useAppLockStore.setState({ armed: true, locked: true });

    await performLogout();

    expect(await isAppLockArmed()).toBe(false);
    expect(useAppLockStore.getState().armed).toBe(false);
  });

  test('the lock screen carries its own logout, since Settings is behind it', async () => {
    await armAppLock('123456');
    useAppLockStore.setState({ armed: true, locked: true });
    render(<LockScreen />);

    fireEvent.click(screen.getByTestId('lock-screen-logout'));
    await waitFor(() => expect(useAppLockStore.getState().armed).toBe(false));
  });
});
