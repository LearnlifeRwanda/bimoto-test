// LOGIN-EASE G3 — the welcome is specific, and it STAYS.
//
// Jean's ask of 24 August, with Faustin's beside it: the welcome
// information on the login screen should say what Bimoto is, and it
// should still be there rather than appearing briefly.
//
// The "stays" half is pinned against a clock. login.subtitle is a plain
// paragraph outside the otpSent branch with no timer, so the honest way
// to prove it persists is to advance fake timers well past any
// plausible toast lifetime (the longest in this app is the 15s
// notification class) and assert it is still on screen.
//
// Also pinned here: roleHomePath's driver landing. The team's 24-August
// report that a motari lands on the passenger home is v13 lag — the
// mapping shipped with LOCATION-LIFE #190 and is asserted in
// intel-analyst-guards.test.tsx. It is re-asserted from this file's
// angle because that file's subject is the ANALYST fence; a future
// dispatch narrowing it should not quietly take the driver landing with
// it.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
import enTranslation from '../../public/locales/en/translation.json';
import frTranslation from '../../public/locales/fr/translation.json';
import rwTranslation from '../../public/locales/rw/translation.json';

import LoginPage from '../pages/auth/LoginPage';
import { roleHomePath } from '../lib/role-home';
import { useAuthStore } from '../stores/auth.store';

vi.mock('../hooks/useSocket', () => ({ useSocket: () => ({ isConnected: false }) }));

const EN_SUBTITLE = (enTranslation as never as { login: { subtitle: string } }).login.subtitle;

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <LoginPage />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  window.localStorage.clear();
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    token: null,
  } as never);
  i18n.addResourceBundle('en', 'translation', enTranslation, true, true);
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LOGIN-EASE — the welcome says what Bimoto is', () => {
  test('the subtitle names the product and both kinds of rider', () => {
    renderLogin();
    const welcome = screen.getByText(EN_SUBTITLE);
    expect(welcome).toBeInTheDocument();
    expect(welcome.textContent).toMatch(/Bimoto/);
    expect(welcome.textContent).toMatch(/passengers/i);
    expect(welcome.textContent).toMatch(/moto/i);
    expect(welcome.textContent).toMatch(/bicycle/i);
  });

  test('it is no longer the old "enter your phone number" instruction', () => {
    renderLogin();
    expect(screen.queryByText(/Enter your phone number to get a verification code/i)).toBeNull();
  });

  test('it is one line in all three languages, and every language was reworded', () => {
    const subs = {
      en: (enTranslation as never as { login: { subtitle: string } }).login.subtitle,
      fr: (frTranslation as never as { login: { subtitle: string } }).login.subtitle,
      rw: (rwTranslation as never as { login: { subtitle: string } }).login.subtitle,
    };
    for (const [lang, value] of Object.entries(subs)) {
      expect(value, `${lang} subtitle must exist`).toBeTruthy();
      // One line: no newline, and short enough to sit under the wordmark.
      expect(value, `${lang} subtitle must be one line`).not.toMatch(/\n/);
      expect(value.length, `${lang} subtitle should stay short`).toBeLessThan(120);
      expect(value, `${lang} subtitle must name the product`).toMatch(/Bimoto/);
    }
  });
});

describe('LOGIN-EASE — and it STAYS', () => {
  test('still on screen after 20 seconds of fake time', () => {
    vi.useFakeTimers();
    renderLogin();

    expect(screen.getByText(EN_SUBTITLE)).toBeInTheDocument();

    // Well past the longest toast lifetime in the app (15s, the
    // notification class). Nothing may remove this line.
    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    expect(screen.getByText(EN_SUBTITLE)).toBeInTheDocument();
  });

  test('no timer is what keeps it — it survives with timers never advanced too', () => {
    renderLogin();
    expect(screen.getByText(EN_SUBTITLE)).toBeInTheDocument();
  });

  test('it renders outside the code-entry branch, so it survives the screen changing', () => {
    // The paragraph is a sibling of the card that swaps between the
    // phone form and the OTP form, not a child of either. If it is ever
    // moved inside that branch this assertion still holds on first
    // render — so the structural claim is asserted directly.
    const { container } = renderLogin();
    const welcome = screen.getByText(EN_SUBTITLE);
    const card = container.querySelector('.bg-white.rounded-xl');
    expect(card).toBeTruthy();
    expect(card!.contains(welcome)).toBe(false);
  });
});

describe('LOGIN-EASE — the driver landing (v13 lag, already built)', () => {
  test('a DRIVER lands on the driver home', () => {
    expect(roleHomePath('DRIVER')).toBe('/driver');
  });

  test('a BOTH user lands on the driver home — BOTH is what onboarding produces', () => {
    expect(roleHomePath('BOTH')).toBe('/driver');
  });

  test('the passenger and the fallbacks are unchanged', () => {
    expect(roleHomePath('CUSTOMER')).toBe('/');
    expect(roleHomePath(undefined)).toBe('/');
    expect(roleHomePath(null)).toBe('/');
  });
});
