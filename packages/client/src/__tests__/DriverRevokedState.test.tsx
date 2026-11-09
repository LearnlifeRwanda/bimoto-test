// DRIVER-ID v3 G2 — driver-side REVOKED end-state.
//
// A revoked driver sees the calm terminal notice: the dashboard hides
// the online toggle and bidding scaffolding entirely, and the
// verification page shows the notice while keeping the re-application
// form (the only way back into the pipeline).

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { i18n } from './setup';

import { DashboardPage } from '../pages/driver/DashboardPage';
import { DriverVerificationPage } from '../pages/onboarding/DriverVerificationPage';
import { useAuthStore } from '../stores/auth.store';

vi.mock('../hooks/useGeolocation', () => ({
  geolocation: {
    getCurrentPosition: vi.fn(() => new Promise(() => {})),
  },
}));

const REVOKED_NOTICE =
  'Your Bimoto driver account is no longer active. Any remaining earnings have been paid out or will be settled with support. Contact support with any question.';

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      driver: { revokedNotice: REVOKED_NOTICE },
      dashboard: {
        imOnline: "I'm online",
        imOffline: "I'm offline",
      },
      verification: {
        title: 'Driver Verification',
        statusPending: 'Verification pending',
        statusVerified: 'Verified!',
      },
      common: { back: 'Back', save: 'Save' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as any,
  );
});

function setDriver(verificationStatus: string) {
  useAuthStore.setState({
    token: 'tok',
    user: {
      id: 'driver-1',
      role: 'DRIVER',
      driverProfile: { vehicleType: 'MOTO', verificationStatus },
    } as any,
    isAuthenticated: true,
    isLoading: false,
  });
}

describe('DashboardPage — REVOKED terminal state', () => {
  test('shows the calm terminal notice and no online toggle', () => {
    setDriver('REVOKED');
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('driver-revoked-notice')).toHaveTextContent(REVOKED_NOTICE);
    expect(screen.queryByText("I'm offline")).not.toBeInTheDocument();
    expect(screen.queryByText("I'm online")).not.toBeInTheDocument();
  });

  test('a VERIFIED driver still gets the normal dashboard', () => {
    setDriver('VERIFIED');
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('driver-revoked-notice')).not.toBeInTheDocument();
    expect(screen.getByText("I'm offline")).toBeInTheDocument();
  });
});

describe('DriverVerificationPage — REVOKED shows notice + re-application form', () => {
  test('renders the terminal notice with the form still available', () => {
    setDriver('REVOKED');
    render(
      <MemoryRouter>
        <DriverVerificationPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(REVOKED_NOTICE)).toBeInTheDocument();
    // The re-application form (save button) stays available — the
    // submission flow is the only way back into the pipeline.
    expect(screen.getByText('Save')).toBeInTheDocument();
  });
});
