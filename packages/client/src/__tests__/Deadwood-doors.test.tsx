// DEADWOOD G3 — the doors this dispatch opened, pinned to the route
// table.
//
// Three screens were built, routed, and then reachable only by typing a
// URL: /driver/no-show-disputes (a motari's only way to contest a
// no-show), /admin/funnel, and /admin/conflicts/audit. The wiring map
// called all three unreachable; the wiring guard's allowlist had been
// carrying them as known gaps.
//
// These tests do what WireFix-nav-targets.test.tsx does for broken
// wires, in the other direction: mount the screen inside a router that
// declares the REAL paths from App.tsx plus the same `*` catch-all, tap
// the new entry, and assert it lands on the declared screen — not the
// 404. A door that renders but points at nothing is not a door.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { i18n } from './setup';

import { AccountPage } from '../pages/driver/AccountPage';
import AdminDashboard from '../pages/admin/AdminDashboard';
import { useAuthStore } from '../stores/auth.store';

const NotFound = () => <div data-testid="not-found">404</div>;

const accountStatus = {
  status: 'ACTIVE' as const,
  suspendedUntil: null,
  isFlagged: false,
  counters: {
    noShowCount: 2,
    cancellationCount: 0,
    lateMarkCount: 0,
    wrongVehicleCount: 0,
    driverInitiatedCancellationCount: 0,
    completedRides: 12,
  },
  thresholds: { noShowWarning: 3, noShowSuspension24h: 5, noShowFlag: 10 },
  recentDisputes: [],
};

const dashboardStats = {
  totalUsers: 3,
  totalDrivers: 1,
  totalCustomers: 2,
  totalJourneys: 4,
  completedJourneys: 2,
  totalRevenue: 5000,
  activeDisputes: 0,
  flaggedUsers: 0,
  pendingVerifications: 1,
};

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      driver: {
        cancelledTrips: {
          title: 'Recent cancelled trips',
          entryLabel: 'Dispute a no-show',
          entryHint: 'If a customer was marked absent by mistake, say so here.',
          empty: 'You have no cancelled trips marked as no-show.',
          fetchFailed: 'Could not load cancelled trips.',
        },
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  useAuthStore.setState({
    token: 'tok',
    user: { id: 'driver-1', role: 'DRIVER' } as any,
    isAuthenticated: true,
    isLoading: false,
  });
});

describe('the driver reaches his no-show disputes', () => {
  test('the account screen carries an entry that lands on /driver/no-show-disputes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => ({
        ok: true,
        status: 200,
        statusText: 'ok',
        // The account screen asks for its own status; the disputes
        // screen asks for cancelled journeys. Answer both.
        json: async () =>
          String(url).includes('/api/journeys') ? [] : accountStatus,
      })) as any,
    );

    render(
      <MemoryRouter initialEntries={['/driver/account']}>
        <Routes>
          <Route path="/driver/account" element={<AccountPage />} />
          {/* The real target, lazily proven by its own heading rather
              than by re-rendering the whole page under a stub. */}
          <Route
            path="/driver/no-show-disputes"
            element={<div data-testid="no-show-disputes-screen" />}
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </MemoryRouter>,
    );

    const entry = await screen.findByTestId('no-show-disputes-entry');
    expect(entry.textContent).toContain('Dispute a no-show');
    fireEvent.click(entry);

    await waitFor(() =>
      expect(screen.getByTestId('no-show-disputes-screen')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('not-found')).not.toBeInTheDocument();
  });
});

describe('the admin reaches the funnel and the conflict audit', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => ({
        ok: true,
        status: 200,
        statusText: 'ok',
        json: async () =>
          String(url).includes('/api/admin/conflicts')
            ? { counts: [] }
            : dashboardStats,
      })) as any,
    );
  });

  test.each([
    ['Funnel metrics', '/admin/funnel', 'admin-funnel-screen'],
    ['Conflict audit log', '/admin/conflicts/audit', 'admin-conflict-audit-screen'],
  ])('the "%s" tile lands on %s', async (label, path, testId) => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<AdminDashboard />} />
          {/* Declared in the same order as App.tsx, so the param
              sibling /admin/conflicts/:type sits BEFORE the literal
              /admin/conflicts/audit — the ordering that made the audit
              screen look unreachable to the wiring extractor. React
              Router still ranks the literal first; this asserts it. */}
          <Route path="/admin/conflicts/:type" element={<div data-testid="conflicts-list-screen" />} />
          <Route path={path} element={<div data-testid={testId} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByText(label));

    await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument());
    expect(screen.queryByTestId('not-found')).not.toBeInTheDocument();
    expect(screen.queryByTestId('conflicts-list-screen')).not.toBeInTheDocument();
  });
});
