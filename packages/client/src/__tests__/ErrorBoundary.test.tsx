// PUSH-CRASH G2/G4 / PROFILE-RESCUE G3 — boot error boundary. A child
// that throws during render must degrade to the retry screen, never a
// blank tree; retry recovers IN-APP (reset + home route), never via
// location.reload() — the reload re-entered the crashed route inside
// the Capacitor WebView and sealed the Kigali testers in.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';

function Bomb(): React.ReactElement {
  throw new Error('boot went sideways');
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React logs caught boundary errors via console.error — keep the
  // test output clean without hiding real failures elsewhere.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe('ErrorBoundary', () => {
  test('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>healthy app</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('healthy app')).toBeInTheDocument();
  });

  test('a throwing child renders the retry screen, not a blank tree', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  test('retry recovers in-app: no location.reload, children remount', () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    });
    try {
      let armed = true;
      function Fuse(): React.ReactElement {
        if (armed) throw new Error('one-shot failure');
        return <p>recovered app</p>;
      }
      render(
        <ErrorBoundary>
          <Fuse />
        </ErrorBoundary>,
      );
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      armed = false;
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(reload).not.toHaveBeenCalled();
      expect(screen.getByText('recovered app')).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  test('siblings above the boundary are unaffected by a throwing subtree', () => {
    render(
      <div>
        <p>outside</p>
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>
      </div>,
    );
    expect(screen.getByText('outside')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});
