// PROFILE-RESCUE G3 (containment) — a screen's render crash must leave
// the shell and navigation alive, recovery navigates home in-app, and
// route changes heal the boundary.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
import { ScreenErrorBoundary } from '../components/ScreenErrorBoundary';
import { useAuthStore } from '../stores/auth.store';

let armed = true;
function BombScreen(): React.ReactElement {
  if (armed) throw new Error('screen exploded');
  return <p>bomb screen healthy</p>;
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  armed = true;
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      errors: {
        screenCrashTitle: 'This screen hit a problem',
        goHome: 'Go to home screen',
        boundaryRetry: 'Retry',
      },
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
      idVerified: false,
      licenseVerified: false,
      completedRides: 0,
      cancellationCount: 0,
      totalRequests: 0,
    },
    isAuthenticated: true,
    isLoading: false,
    token: null,
  });
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

// Mimics AppShell: nav lives OUTSIDE the boundary, screens inside.
function renderShell(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <nav data-testid="shell-nav">
        <Link to="/rides">Rides tab</Link>
      </nav>
      <ScreenErrorBoundary>
        <Routes>
          <Route path="/" element={<p>customer home</p>} />
          <Route path="/driver" element={<p>driver home</p>} />
          <Route path="/profile" element={<BombScreen />} />
          <Route path="/rides" element={<p>rides list</p>} />
        </Routes>
      </ScreenErrorBoundary>
    </MemoryRouter>,
  );
}

describe('ScreenErrorBoundary (PROFILE-RESCUE G3 containment)', () => {
  test('a crashing screen degrades in place; the shell nav stays alive', () => {
    renderShell('/profile');
    expect(screen.getByTestId('screen-error-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('shell-nav')).toBeInTheDocument();
  });

  test('"Go to home screen" recovers in-app onto the role home', () => {
    renderShell('/profile');
    fireEvent.click(screen.getByTestId('screen-error-home'));
    expect(screen.getByText('customer home')).toBeInTheDocument();
    expect(screen.queryByTestId('screen-error-fallback')).not.toBeInTheDocument();
  });

  test('a DRIVER goes home to /driver', () => {
    useAuthStore.setState((s) => ({ user: { ...s.user!, role: 'DRIVER' } }));
    renderShell('/profile');
    fireEvent.click(screen.getByTestId('screen-error-home'));
    expect(screen.getByText('driver home')).toBeInTheDocument();
  });

  test('navigating away via the still-alive nav heals the boundary', () => {
    renderShell('/profile');
    expect(screen.getByTestId('screen-error-fallback')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Rides tab'));
    expect(screen.getByText('rides list')).toBeInTheDocument();
    expect(screen.queryByTestId('screen-error-fallback')).not.toBeInTheDocument();
  });

  test('Retry re-renders the same screen once the fault is gone', () => {
    renderShell('/profile');
    armed = false;
    fireEvent.click(screen.getByTestId('screen-error-retry'));
    expect(screen.getByText('bomb screen healthy')).toBeInTheDocument();
  });
});
