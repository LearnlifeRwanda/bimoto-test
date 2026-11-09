// Tests for the first-launch welcome flow (Dispatch R3-WELCOME-FIRST-LAUNCH).
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import React from 'react';
import enLocale from '../../../../public/locales/en/translation.json';
import { i18n } from '../../../__tests__/setup';
import { useAuthStore } from '../../../stores/auth.store';
import { useUIStore } from '../../../stores/ui.store';
import { prefs, PREF_KEYS } from '../../../hooks/usePreferences';
import WelcomePage from '../WelcomePage';
import { AuthRoute } from '../../../App';

// Layer the welcome.* namespace onto the global test i18n bundle so
// translation lookups in WelcomePage / LanguageSwitcher resolve to
// real strings rather than the raw key. i18n.addResource expects the
// 4th arg typed as string, but tolerates nested objects at runtime —
// the cast keeps tsc happy without dropping back to flat keys.
const welcomeBundle = (enLocale as Record<string, unknown>).welcome as unknown as string;
i18n.addResource('en', 'translation', 'welcome', welcomeBundle);
i18n.addResource('rw', 'translation', 'welcome', welcomeBundle);
i18n.addResource('fr', 'translation', 'welcome', welcomeBundle);

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

beforeEach(() => {
  window.localStorage.clear();
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, token: null });
  useUIStore.setState({ language: 'en' });
  void i18n.changeLanguage('en');
});

describe('WelcomePage', () => {
  test('renders the 3-screen carousel with screen 1 active on first render', () => {
    render(
      <MemoryRouter>
        <WelcomePage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Welcome to Bimoto')).toBeInTheDocument();

    const dots = screen.getAllByRole('tab');
    expect(dots).toHaveLength(3);
    expect(dots[0]).toHaveAttribute('aria-current', 'true');
    expect(dots[1]).not.toHaveAttribute('aria-current');
    expect(dots[2]).not.toHaveAttribute('aria-current');
  });

  test('clicking the Kinyarwanda language button switches the i18n language', () => {
    render(
      <MemoryRouter>
        <WelcomePage />
      </MemoryRouter>,
    );

    expect(i18n.language).toBe('en');

    const rwButton = screen
      .getAllByRole('button')
      .find((b) => b.getAttribute('data-lang') === 'rw');
    expect(rwButton).toBeDefined();

    act(() => {
      fireEvent.click(rwButton!);
    });

    expect(i18n.language).toBe('rw');
    expect(useUIStore.getState().language).toBe('rw');
  });

  test('Continue persists hasSeenWelcome=true and navigates to /login', async () => {
    render(
      <MemoryRouter initialEntries={['/welcome']}>
        <Routes>
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/login" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const continueButton = screen.getByRole('button', { name: 'Continue' });
    await act(async () => {
      fireEvent.click(continueButton);
    });

    expect(screen.getByTestId('location').textContent).toBe('/login');
    expect(prefs.getSync(PREF_KEYS.hasSeenWelcome)).toBe('true');
  });

  test('Skip behaves identically to Continue', async () => {
    render(
      <MemoryRouter initialEntries={['/welcome']}>
        <Routes>
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/login" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const skipButton = screen.getByRole('button', { name: 'Skip' });
    await act(async () => {
      fireEvent.click(skipButton);
    });

    expect(screen.getByTestId('location').textContent).toBe('/login');
    expect(prefs.getSync(PREF_KEYS.hasSeenWelcome)).toBe('true');
  });

  // §8 smallest-wrongness anchor: without this, the WelcomePage could
  // ship but never reach a first-launch user.
  test('AuthRoute redirects unauthenticated + hasSeenWelcome=null users to /welcome', () => {
    expect(prefs.getSync(PREF_KEYS.hasSeenWelcome)).toBeNull();

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route
            path="/login"
            element={
              <AuthRoute>
                <div data-testid="login-rendered">Login</div>
              </AuthRoute>
            }
          />
          <Route path="/welcome" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('login-rendered')).toBeNull();
    expect(screen.getByTestId('location').textContent).toBe('/welcome');
  });

  test('AuthRoute renders LoginPage when hasSeenWelcome=true', () => {
    void prefs.set(PREF_KEYS.hasSeenWelcome, 'true');

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route
            path="/login"
            element={
              <AuthRoute>
                <div data-testid="login-rendered">Login</div>
              </AuthRoute>
            }
          />
          <Route path="/welcome" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('login-rendered')).toBeInTheDocument();
    expect(screen.queryByTestId('location')).toBeNull();
  });
});
