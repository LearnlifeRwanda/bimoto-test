// R3-N-5 — driver Account page tests. Covers each status banner
// variant (ACTIVE / SUSPENDED / FLAGGED), the dispute-row states
// (pending + 3 resolution decisions), and the fetch-failure path.
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { i18n } from './setup';

// TEAM-SAID G4 — AccountPage now carries the entry point to the
// auto-bid rules screen, so it uses useNavigate and must render
// inside a router.
import { AccountPage } from '../pages/driver/AccountPage';
import { useAuthStore } from '../stores/auth.store';

const baseStatus = {
  status: 'ACTIVE' as const,
  suspendedUntil: null,
  isFlagged: false,
  counters: {
    noShowCount: 1,
    cancellationCount: 0,
    lateMarkCount: 0,
    wrongVehicleCount: 0,
    driverInitiatedCancellationCount: 0,
    completedRides: 12,
  },
  thresholds: {
    noShowWarning: 3,
    noShowSuspension24h: 5,
    noShowFlag: 10,
  },
  recentDisputes: [],
};

function mockFetch(status: any, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      statusText: 'fail',
      json: async () => status,
    })) as any,
  );
}

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      account: {
        title: 'Account status',
        statusActive: 'Active',
        statusSuspended: 'Suspended until {{until}}',
        statusFlagged: 'Flagged for review',
        noShowCount: 'No-shows',
        cancellationCount: 'Cancellations',
        lateMarkCount: 'Late marks',
        wrongVehicleCount: 'Wrong-vehicle reports',
        driverInitiatedCancellationCount: 'Honest withdrawals',
        warningThreshold: 'Warning',
        suspensionThreshold: '24h suspension',
        flagThreshold: 'Admin review',
        recentDisputes: 'Recent disputes',
        noRecentDisputes: 'No disputes filed yet',
        disputePending: 'Pending review',
        disputeUpheld: 'Upheld — no-show removed',
        disputeRejected: 'Rejected — original stands',
        disputeClosedNoAction: 'Closed — no action',
        fetchFailed: 'Could not load account status',
        viewAccount: 'View account status',
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

describe('AccountPage — R3-N-5', () => {
  test('renders ACTIVE banner when status is ACTIVE', async () => {
    mockFetch({ ...baseStatus, status: 'ACTIVE' });
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
    const banner = await screen.findByTestId('account-status-banner');
    expect(banner).toHaveAttribute('data-status', 'ACTIVE');
    expect(banner.textContent).toContain('Active');
  });

  test('renders SUSPENDED banner with the until timestamp', async () => {
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    mockFetch({ ...baseStatus, status: 'SUSPENDED', suspendedUntil: until });
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
    const banner = await screen.findByTestId('account-status-banner');
    expect(banner).toHaveAttribute('data-status', 'SUSPENDED');
    expect(banner.textContent).toMatch(/Suspended until/);
  });

  test('renders FLAGGED banner with the flagged label', async () => {
    mockFetch({ ...baseStatus, status: 'FLAGGED', isFlagged: true });
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
    const banner = await screen.findByTestId('account-status-banner');
    expect(banner).toHaveAttribute('data-status', 'FLAGGED');
    expect(banner.textContent).toContain('Flagged for review');
  });

  test('renders no-show counter with all three threshold markers', async () => {
    mockFetch({ ...baseStatus, counters: { ...baseStatus.counters, noShowCount: 4 } });
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('account-status-banner');
    const cards = await screen.findAllByTestId('account-counter-card');
    const noShow = cards.find((c) => c.getAttribute('data-label') === 'No-shows');
    expect(noShow?.textContent).toContain('Warning');
    expect(noShow?.textContent).toContain('24h suspension');
    expect(noShow?.textContent).toContain('Admin review');
    expect(noShow?.textContent).toContain('4 / 3');
  });

  test('renders dispute rows with the correct outcome label per decision', async () => {
    const recentDisputes = [
      {
        journeyId: 'j-overturn',
        cancelledAt: new Date().toISOString(),
        driverDisputedAt: new Date().toISOString(),
        resolution: { decision: 'OVERTURN_FLAG' as const, decidedAt: new Date().toISOString(), reason: null },
      },
      {
        journeyId: 'j-uphold',
        cancelledAt: new Date().toISOString(),
        driverDisputedAt: new Date().toISOString(),
        resolution: { decision: 'UPHOLD_FLAG' as const, decidedAt: new Date().toISOString(), reason: null },
      },
      {
        journeyId: 'j-noaction',
        cancelledAt: new Date().toISOString(),
        driverDisputedAt: new Date().toISOString(),
        resolution: { decision: 'NO_ACTION' as const, decidedAt: new Date().toISOString(), reason: null },
      },
      {
        journeyId: 'j-pending',
        cancelledAt: new Date().toISOString(),
        driverDisputedAt: new Date().toISOString(),
        resolution: { decision: null, decidedAt: null, reason: null },
      },
    ];
    mockFetch({ ...baseStatus, recentDisputes });
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('account-status-banner');
    const rows = await screen.findAllByTestId('account-dispute-row');
    expect(rows).toHaveLength(4);
    const decisions = rows.map((r) => r.getAttribute('data-decision'));
    expect(decisions).toEqual(['OVERTURN_FLAG', 'UPHOLD_FLAG', 'NO_ACTION', 'PENDING']);
    expect(rows[0].textContent).toContain('Upheld');
    expect(rows[1].textContent).toContain('Rejected');
    expect(rows[2].textContent).toContain('Closed');
    expect(rows[3].textContent).toContain('Pending');
  });

  test('renders fetch-failed error when /api/users/me/account-status returns !ok', async () => {
    mockFetch(null, false);
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByText('Could not load account status')).toBeInTheDocument(),
    );
  });
});
