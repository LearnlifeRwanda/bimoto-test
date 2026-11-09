// __TESTS__/COCKPIT-REGISTER-LANGUAGE.TEST.TSX
//
// COCKPIT G5 — the door stops keeping its own language list.
//
// RegisterPage carried a hardcoded LANGUAGES array and a hand-rolled
// button row: a third copy of a list WelcomePage and Settings already
// render from one shared component, and the one place in the app where
// that list could quietly drift. It now mounts LanguageSwitcher.
//
// Two things are pinned: all three languages are offered at the door,
// and the choice APPLIES IMMEDIATELY — someone who cannot read the
// default locale must be able to read the form they are filling in,
// rather than waiting for a submit they cannot read the labels of.

import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
import { RegisterPage } from '../pages/auth/RegisterPage';
import { useAuthStore } from '../stores/auth.store';
import { useUIStore } from '../stores/ui.store';

beforeEach(async () => {
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    token: null,
    registrationPendingUserId: null,
  } as never);
  useUIStore.setState({ language: 'rw' } as never);
  await i18n.changeLanguage('rw');
});

const renderRegister = () =>
  render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  );

describe('COCKPIT G5 — registration speaks all three languages', () => {
  test('the door offers rw, en AND fr, from the shared switcher', () => {
    renderRegister();

    const offered = Array.from(
      document.querySelectorAll<HTMLElement>('[data-lang]'),
    ).map((b) => b.dataset.lang);

    expect(offered).toEqual(['rw', 'en', 'fr']);
  });

  test('the page renders no second language list of its own', () => {
    // The hardcoded LANGUAGES array is gone: each language name appears
    // exactly once, from LanguageSwitcher. A duplicate picker (the bug
    // this closes) would show each of them twice.
    renderRegister();

    for (const name of ['Kinyarwanda', 'English', 'Français']) {
      expect(screen.getAllByText(name)).toHaveLength(1);
    }
    // And every language control on the screen is the switcher's.
    expect(screen.getAllByText('Kinyarwanda')[0].closest('[data-lang]')).not.toBeNull();
  });

  test('choosing French changes the form under your finger, not after submit', async () => {
    renderRegister();

    fireEvent.click(document.querySelector<HTMLElement>('[data-lang="fr"]')!);

    await waitFor(() => expect(i18n.language).toBe('fr'));
    // And the choice the profile PUT will carry is the same one.
    expect(useUIStore.getState().language).toBe('fr');
  });

  test('Kinyarwanda stays the default and the leftmost option', () => {
    renderRegister();

    const first = document.querySelector<HTMLElement>('[data-lang]');
    expect(first?.dataset.lang).toBe('rw');
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Kinyarwanda')).toBeInTheDocument();
  });
});
