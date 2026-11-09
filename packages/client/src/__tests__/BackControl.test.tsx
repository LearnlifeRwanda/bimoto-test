// APP-HEADER G2/G3/G4 — the header's back affordance.
//
// Before this dispatch, exactly three of the 44 page files mounted
// <BackToHome />; the other 41 — Profile among them, which is the
// field report — had no in-app way back at all. The affordance now
// belongs to the shell, so these tests assert it at the shell level:
// what it does (history-back), what it does when there is no history
// (role home), where it must not appear (home screens), and the route
// walk that proves the coverage claim.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<any>);
  return { ...actual, useNavigate: () => mockNavigate };
});

import '../i18n';
import { AppShell } from '../components/layout/AppShell';
import { HOME_PATHS } from '../components/layout/BackControl';
import { useAuthStore } from '../stores/auth.store';

const SRC = join(__dirname, '..');

/**
 * Render the shell at `path`. `withHistory` adds a preceding entry, so
 * react-router keys the current entry with a generated key instead of
 * 'default' — the difference the control reads to tell a navigated-to
 * screen from a cold entry (deep link, pasted URL, relaunch).
 */
function renderShellAt(path: string, withHistory = false) {
  return render(
    <MemoryRouter
      initialEntries={withHistory ? ['/', path] : [path]}
      initialIndex={withHistory ? 1 : 0}
    >
      <AppShell>
        <div>screen</div>
      </AppShell>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockNavigate.mockReset();
  useAuthStore.setState({ user: { id: 'c1', role: 'CUSTOMER' } as any } as any);
});

describe('APP-HEADER G2 — where the back control appears', () => {
  test('home screens show no back control', () => {
    for (const home of HOME_PATHS) {
      const { unmount } = renderShellAt(home);
      expect(screen.queryByTestId('header-back')).toBeNull();
      // …but the mark is still there: every screen is branded.
      expect(screen.getByTestId('app-header-mark')).toBeTruthy();
      unmount();
    }
  });

  test('HOME_PATHS is exactly the two role home screens', () => {
    expect(HOME_PATHS).toEqual(['/', '/driver']);
  });

  test('a non-home screen shows the back control', () => {
    renderShellAt('/profile');
    expect(screen.getByTestId('header-back')).toBeTruthy();
  });

  test('the control keeps BackToHome’s touch-target and chevron conventions', () => {
    renderShellAt('/profile');
    const back = screen.getByTestId('header-back');
    expect(back.className).toContain('min-h-[44px]');
    expect(back.querySelector('svg')).toBeTruthy();
    expect(back.textContent?.trim()).toBeTruthy();
  });
});

describe('APP-HEADER G2 — what the back control does', () => {
  test('with history behind it, it goes back one entry (as the hardware button does)', () => {
    renderShellAt('/profile', true);
    fireEvent.click(screen.getByTestId('header-back'));
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  test('opened cold (deep link), it falls back to home rather than dead-ending', () => {
    renderShellAt('/journey/abc/receipt');
    fireEvent.click(screen.getByTestId('header-back'));
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    expect(mockNavigate).not.toHaveBeenCalledWith(-1);
  });

  test('the cold-entry fallback respects the role’s own home', () => {
    useAuthStore.setState({ user: { id: 'd1', role: 'DRIVER' } as any } as any);
    renderShellAt('/driver/account');
    fireEvent.click(screen.getByTestId('header-back'));
    // '/' is not even a tab in the driver nav — sending a driver there
    // would be the dead end the fallback exists to avoid.
    expect(mockNavigate).toHaveBeenCalledWith('/driver', { replace: true });
  });

  test('a BOTH-role user falls back to the customer home', () => {
    useAuthStore.setState({ user: { id: 'b1', role: 'BOTH' } as any } as any);
    renderShellAt('/settings');
    fireEvent.click(screen.getByTestId('header-back'));
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
  });
});

// ------------------------------------------------------------ G3 walk

/**
 * Every route in App.tsx that mounts AppShell, with params filled in.
 * Read from source so it cannot drift from what actually ships — the
 * same technique nav-route-integrity uses.
 */
function shellRoutePaths(): string[] {
  const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
  return app
    .split('\n')
    .filter((line) => line.includes('<Route path="') && line.includes('<AppShell>'))
    .map((line) => /<Route path="([^"]+)"/.exec(line)![1])
    .map((path) => path.replace(/:[A-Za-z]+/g, 'test-id'));
}

describe('APP-HEADER G3 — the route walk', () => {
  const paths = shellRoutePaths();

  test('the walk sees every shell route', () => {
    // 24 shell-wrapped routes on main at 54fce51; this only guards
    // against the extractor silently matching nothing.
    expect(paths.length).toBeGreaterThanOrEqual(20);
    expect(paths).toContain('/profile');
  });

  test('every shell screen carries the mark', () => {
    for (const path of paths) {
      const { unmount } = renderShellAt(path);
      expect(screen.getByTestId('app-header-mark'), `no mark at ${path}`).toBeTruthy();
      unmount();
    }
  });

  test('every non-home shell screen carries a back control', () => {
    const bare: string[] = [];
    for (const path of paths) {
      if (HOME_PATHS.includes(path)) continue;
      const { unmount } = renderShellAt(path);
      if (!screen.queryByTestId('header-back')) bare.push(path);
      unmount();
    }
    expect(bare).toEqual([]);
  });

  test('Profile in particular — the field report — has one', () => {
    renderShellAt('/profile', true);
    expect(screen.getByTestId('header-back')).toBeTruthy();
    fireEvent.click(screen.getByTestId('header-back'));
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });
});
