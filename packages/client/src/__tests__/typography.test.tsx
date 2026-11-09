// UI-POLISH G5 — the Wordmark renders on the two screens that carry it
// (welcome, login) in the display family. The config/@font-face side of
// the typography guard lives in typography-config.test.ts at the package
// root (outside the tsc project, next to webview-csp.test.ts).
import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import './setup';
import { Wordmark } from '../components/ui/Wordmark';
import { LoginPage } from '../pages/auth/LoginPage';
import WelcomePage from '../pages/onboarding/WelcomePage';

describe('Wordmark', () => {
  test('renders "Bimoto" in the display family and never wraps', () => {
    render(<Wordmark />);
    const mark = screen.getByTestId('wordmark');
    expect(mark.textContent).toBe('Bimoto');
    expect(mark.className).toContain('font-display');
    expect(mark.className).toContain('font-semibold'); // 600 is the only shipped Playfair weight
    expect(mark.className).toContain('whitespace-nowrap');
    expect(mark.className).toContain('text-primary');
  });

  test('renders on the login screen', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('wordmark').textContent).toBe('Bimoto');
  });

  test('renders on the welcome screen as the compact lockup', () => {
    render(
      <MemoryRouter>
        <WelcomePage />
      </MemoryRouter>,
    );
    const mark = screen.getByTestId('wordmark');
    expect(mark.textContent).toBe('Bimoto');
    expect(mark.className).toContain('text-title');
  });
});
