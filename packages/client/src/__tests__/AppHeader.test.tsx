// APP-HEADER G1/G4 — the shell carries the brand.
//
// Before this dispatch AppShell rendered nothing above <main>, so no
// screen inside the app showed the Bimoto mark. These tests pin that
// the header is a property of the SHELL (not of any page), that it
// carries the mark, and that the screens which deliberately render
// outside AppShell — the auth/onboarding flow and the admin screens —
// do not get one.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// SHIPSHAPE G4 — the mark navigates now, so the destination has to be
// observable. Same idiom as BackControl.test.tsx: MemoryRouter still
// comes from the real module, only useNavigate is replaced.
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<any>);
  return { ...actual, useNavigate: () => mockNavigate };
});

import '../i18n';
import { AppShell } from '../components/layout/AppShell';
import { useAuthStore } from '../stores/auth.store';

const SRC = join(__dirname, '..');

function renderShell(initialPath = '/profile') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppShell>
        <div>screen content</div>
      </AppShell>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockNavigate.mockReset();
  useAuthStore.setState({ user: undefined } as any);
});

describe('APP-HEADER G1 — the header exists and carries the mark', () => {
  test('AppShell renders the header above the main content', () => {
    renderShell();
    const header = screen.getByTestId('app-header');
    expect(header).toBeTruthy();
    expect(header.tagName).toBe('HEADER');

    // Order matters: the header must precede <main> in the document,
    // not sit inside or after it.
    const main = document.querySelector('main');
    expect(main).toBeTruthy();
    expect(
      header.compareDocumentPosition(main as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(header.contains(main as Node)).toBe(false);
  });

  test('the Bimoto mark is present and comes from the brand asset', () => {
    renderShell();
    const mark = screen.getByTestId('app-header-mark') as HTMLImageElement;
    expect(mark.getAttribute('alt')).toBe('Bimoto');
    expect(mark.getAttribute('src')).toMatch(/BiMoto-mark\.svg/);
  });

  test('the header owns the top safe area, symmetric to BottomNav', () => {
    renderShell();
    const header = screen.getByTestId('app-header');
    expect(header.className).toContain('pt-[env(safe-area-inset-top)]');
  });

  test('the header IS the band now, and carries the connection itself', () => {
    renderShell();
    const header = screen.getByTestId('app-header');
    const band = header.parentElement as HTMLElement;
    // The band is lifted above the full-bleed map (fixed z-0) but stays
    // below the bottom sheet (z-30) and BottomNav (z-40).
    expect(band.className).toContain('z-10');
    // CHROME-C G2 — the three conditional strips that used to sit in
    // this band are gone. What they said ambiently is the status pill
    // INSIDE the header; what they said about events is a toast plus
    // the pill's badge. So the band has exactly one child, and the
    // question "can these overlap each other" no longer has a subject.
    expect(band.children.length).toBe(1);
    expect(header.querySelector('[data-testid="connection-status"]')).toBeTruthy();
    // …and the band is a sibling of <main>, not a wrapper around it.
    expect(band.contains(document.querySelector('main'))).toBe(false);
  });
});

describe('APP-HEADER G1 — the header belongs to the shell only', () => {
  test('no page mounts AppHeader directly', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__') continue;
          walk(full);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          if (readFileSync(full, 'utf8').includes('AppHeader')) {
            offenders.push(full.slice(SRC.length + 1));
          }
        }
      }
    };
    walk(join(SRC, 'pages'));
    expect(offenders).toEqual([]);
  });

  test('shell-less routes stay shell-less (auth, onboarding, admin)', () => {
    const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
    // Every <Route> line that mounts a shell-less screen must not
    // mention AppShell — the header rides along with the shell, so this
    // is also the guard that keeps it off those screens.
    const shellLess = [
      '/login',
      '/register',
      '/consent',
      '/welcome',
      '/check-driver',
      '/guide',
      '/driver/screener',
      '/driver/verification',
      '/admin',
    ];
    for (const path of shellLess) {
      const line = app
        .split('\n')
        .find((l) => l.includes(`<Route path="${path}"`));
      expect(line, `route ${path} not found in App.tsx`).toBeTruthy();
      expect(line).not.toContain('AppShell');
    }
  });
});

// SHIPSHAPE G4 — tapping the mark goes home.
//
// Every platform has trained users that the logo in the chrome is the
// way back to the start, and until now Bimoto's was a bare <img>: the
// one affordance a user is most likely to try, doing nothing. The
// destination is roleHomePath — the same function login lands on, so
// the mark and the login redirect cannot disagree about where home is.
describe('SHIPSHAPE G4 — the mark is the home affordance', () => {
  test('a CUSTOMER taps the mark and lands on /', () => {
    useAuthStore.setState({ user: { id: 'c1', role: 'CUSTOMER' } as any } as any);
    renderShell('/profile');
    fireEvent.click(screen.getByTestId('app-header-home'));
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  test("a DRIVER lands on the dashboard, not the customer's home", () => {
    useAuthStore.setState({ user: { id: 'd1', role: 'DRIVER' } as any } as any);
    renderShell('/profile');
    fireEvent.click(screen.getByTestId('app-header-home'));
    expect(mockNavigate).toHaveBeenCalledWith('/driver');
  });

  test('an ANALYST lands in the reading room', () => {
    useAuthStore.setState({ user: { id: 'a1', role: 'ANALYST' } as any } as any);
    renderShell('/profile');
    fireEvent.click(screen.getByTestId('app-header-home'));
    expect(mockNavigate).toHaveBeenCalledWith('/intel');
  });

  test('tapping it while already home pushes nothing', () => {
    useAuthStore.setState({ user: { id: 'c1', role: 'CUSTOMER' } as any } as any);
    renderShell('/');
    fireEvent.click(screen.getByTestId('app-header-home'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("a DRIVER on / is NOT home — the driver's home is the dashboard", () => {
    useAuthStore.setState({ user: { id: 'd1', role: 'DRIVER' } as any } as any);
    renderShell('/');
    fireEvent.click(screen.getByTestId('app-header-home'));
    expect(mockNavigate).toHaveBeenCalledWith('/driver');
  });

  test('the mark keeps its own geometry inside the button', () => {
    renderShell('/profile');
    const button = screen.getByTestId('app-header-home');
    const mark = screen.getByTestId('app-header-mark');
    // The button took over the band-level positioning; the mark keeps
    // its size. Neither may drift, or the header band moves.
    expect(button.className).toContain('ml-auto');
    expect(button.className).toContain('mr-1');
    expect(mark.className).toContain('h-7');
    expect(mark.className).toContain('shrink-0');
    expect(mark.parentElement).toBe(button);
    // Still a real button, and still labelled for a screen reader that
    // cannot see a logo. The label is asserted through i18n rather than
    // against English: the suite's locale is not en, and a key missing
    // from a locale would surface here as the raw key.
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    const label = button.getAttribute('aria-label');
    expect(label).toBeTruthy();
    expect(label).not.toBe('layout.logoHome');
  });
});
