// PILOT-UX G2 — language switcher reachability + persistence net.
//
// The founder's pilot phone was stuck on the onboarding language choice
// because nothing post-onboarding surfaced a switcher. These tests pin
// the mechanism end to end: switching updates i18n AND persists to the
// prefs store (localStorage on web), and a cold boot re-applies the
// stored language via the real i18n init.
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { i18n } from './setup';

import { LanguageSwitcher } from '../components/ui/LanguageSwitcher';
import { useUIStore } from '../stores/ui.store';

beforeEach(async () => {
  window.localStorage.clear();
  useUIStore.setState({ language: 'rw' });
  await i18n.changeLanguage('en');
});

describe('LanguageSwitcher persistence', () => {
  test('switching calls i18n.changeLanguage and persists the choice', () => {
    render(<LanguageSwitcher variant="compact" />);

    const frButton = screen
      .getAllByRole('button')
      .find((b) => b.getAttribute('data-lang') === 'fr');
    expect(frButton).toBeDefined();
    fireEvent.click(frButton!);

    expect(i18n.language).toBe('fr');
    expect(useUIStore.getState().language).toBe('fr');
    // prefs.set writes through to localStorage on web — this is the
    // value the real i18n init reads back at boot.
    expect(window.localStorage.getItem('bimoto-lang')).toBe('fr');
  });

  test('all three languages are offered with flag glyphs', () => {
    render(<LanguageSwitcher variant="compact" />);
    const langs = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('data-lang'));
    expect(langs).toEqual(['rw', 'en', 'fr']);
    for (const flag of ['🇷🇼', '🇬🇧', '🇫🇷']) {
      expect(screen.getByText(flag)).toBeInTheDocument();
    }
  });
});

describe('boot re-application of the stored language', () => {
  test('the real i18n init starts in the stored non-default language', async () => {
    window.localStorage.setItem('bimoto-lang', 'fr');
    // Fresh module registry so ../i18n (and its i18next singleton)
    // re-initialises exactly as it does on a cold app start.
    vi.resetModules();
    const { default: bootI18n } = await import('../i18n');
    expect(bootI18n.language).toBe('fr');
  });

  test('the real i18n init defaults to rw when nothing is stored', async () => {
    vi.resetModules();
    const { default: bootI18n } = await import('../i18n');
    expect(bootI18n.language).toBe('rw');
  });
});
