// DEADWOOD G4 — one toast per toast.
//
// <Toast /> was mounted twice: once in App.tsx above the router, once
// inside AppShell. Toast reads a single message out of ui.store and
// renders it, so on every shell screen one showToast() produced two
// identical banners stacked at the same fixed position — and two
// role="alert" announcements for anyone using a screen reader.
//
// The App-level mount is the one that survives, because it is the only
// one that covers the screens rendered OUTSIDE AppShell: welcome,
// login, register, consent, driver screener/verification, and the whole
// admin island. Those screens emit toasts too; keeping AppShell's mount
// would have made their toasts silently disappear instead of double.

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import '../i18n';
import { AppShell } from '../components/layout/AppShell';
import { Toast } from '../components/ui/Toast';
import { useUIStore } from '../stores/ui.store';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
  return out;
}

beforeEach(() => {
  useUIStore.getState().hideToast();
});

afterEach(() => {
  useUIStore.getState().hideToast();
});

describe('one toast renders exactly one toast', () => {
  test('the App-level mount around a shell screen shows a single banner', () => {
    // The same composition App.tsx uses: <Toast /> above the router,
    // AppShell wrapping the routed screen.
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <Toast />
        <AppShell>
          <div>screen content</div>
        </AppShell>
      </MemoryRouter>,
    );

    act(() => {
      useUIStore.getState().showToast('Saved', 'success');
    });

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain('Saved');
  });

  test('AppShell no longer mounts a Toast of its own', () => {
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <AppShell>
          <div>screen content</div>
        </AppShell>
      </MemoryRouter>,
    );

    act(() => {
      useUIStore.getState().showToast('Saved', 'success');
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('exactly one file in client source mounts <Toast />', () => {
    const mounts = sourceFiles(SRC)
      .filter((f) => /<Toast\s*\/>/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f).split('\\').join('/'));
    expect(mounts).toEqual(['App.tsx']);
  });

  test('the surviving mount is above the router, so shell-less screens keep their toasts', () => {
    // Source-level, because the alternative is booting the whole App.
    // The order in App.tsx is what makes this true: <Toast /> is a
    // sibling of <Routes>, not a child of any route element.
    const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
    expect(app.indexOf('<Toast />')).toBeGreaterThan(-1);
    expect(app.indexOf('<Toast />')).toBeLessThan(app.indexOf('<Routes>'));
  });
});
