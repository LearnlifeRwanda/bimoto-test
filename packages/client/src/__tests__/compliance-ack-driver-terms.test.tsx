// COMPLIANCE-ACK G3 — the driver-terms step, and the limitation it has.
//
// A NEW driver reaches DriverVerificationPage, reads the three rules
// plus the sentence that is his alone (he refuses such a ride even when
// the passenger insists), and stamps CURRENT_DRIVER_TERMS_VERSION on
// accept. That is what this file pins.
//
// It also pins, deliberately, what this step does NOT do. Nothing in
// the repo reads driverTermsVersion for staleness — needsConsent()
// checks privacy and general terms only — so bumping the driver
// constant re-prompts NOBODY who already exists. The mechanism that
// reaches an existing motari is the general-terms bump on ConsentPage,
// which renders his refuse line there (pinned in
// compliance-ack-consent.test.tsx). The absence below is asserted so a
// later reader cannot mistake this step for the enforcement.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import {
  CURRENT_DRIVER_TERMS_VERSION,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from '@bimoto/shared';
import { i18n } from './setup';
import enTranslation from '../../public/locales/en/translation.json';

import { ProtectedRoute } from '../App';
import { DriverVerificationPage } from '../pages/onboarding/DriverVerificationPage';
import { useAuthStore } from '../stores/auth.store';

const PREVIOUS_DRIVER_TERMS_VERSION = '1.0';

function setDriver(vehicleType = 'MOTO') {
  useAuthStore.setState({
    token: 'tok',
    user: {
      id: 'driver-1',
      role: 'DRIVER',
      driverProfile: { vehicleType, verificationStatus: 'PENDING' },
    },
    isAuthenticated: true,
    isLoading: false,
  } as never);
}

function renderVerification() {
  return render(
    <MemoryRouter>
      <DriverVerificationPage />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  i18n.addResourceBundle('en', 'translation', enTranslation, true, true);
  await i18n.changeLanguage('en');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('COMPLIANCE-ACK — the driver reads the rules where he accepts his terms', () => {
  test('the three rules and the refuse sentence render on the driver step', () => {
    setDriver();
    renderVerification();

    const block = screen.getByTestId('driver-safety-acknowledgment');
    expect(block).toBeInTheDocument();
    expect(block).toHaveTextContent(/babies or infants/i);
    expect(block).toHaveTextContent(/exactly one passenger/i);
    expect(block).toHaveTextContent(/legal minimum age/i);
    expect(screen.getByTestId('driver-safety-ack-refuse')).toHaveTextContent(/refuse any ride/i);
  });

  test('no legal number appears on this step either', () => {
    setDriver();
    renderVerification();
    expect(screen.getByTestId('driver-safety-acknowledgment').textContent ?? '').not.toMatch(/\d/);
  });

  test('a bicycle rider sees it too — the rules are not moto-document-conditional', () => {
    // The document fields are compliance-conditional (BIKE-GATE G4).
    // The safety rules are not: they sit outside that matrix.
    setDriver('BIKE');
    renderVerification();
    expect(screen.getByTestId('driver-safety-acknowledgment')).toBeInTheDocument();
    expect(screen.getByTestId('driver-safety-ack-refuse')).toBeInTheDocument();
  });
});

describe('COMPLIANCE-ACK — the driver step stamps the bumped version', () => {
  test('the driver constant actually moved', () => {
    expect(CURRENT_DRIVER_TERMS_VERSION).not.toBe(PREVIOUS_DRIVER_TERMS_VERSION);
  });

  test('accepting posts the NEW driver-terms version', async () => {
    setDriver();
    renderVerification();

    fireEvent.click(screen.getByLabelText(/I Accept the Driver Terms/i));
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => {
      const calls = fetchMock.mock.calls as unknown as Array<[string, { body: string }]>;
      const driverTerms = calls.find(([url]) => String(url).includes('accept-driver-terms'));
      expect(driverTerms, 'accept-driver-terms must be posted').toBeTruthy();
      expect(JSON.parse(driverTerms![1].body)).toEqual({
        version: CURRENT_DRIVER_TERMS_VERSION,
      });
    });
  });

  test('nothing is posted while the driver-terms box is unticked', async () => {
    setDriver();
    renderVerification();

    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    await Promise.resolve();

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const calls = fetchMock.mock.calls as unknown as Array<[string]>;
    expect(calls.some(([url]) => String(url).includes('accept-driver-terms'))).toBe(false);
  });
});

describe('COMPLIANCE-ACK — the documented limitation, asserted behaviourally', () => {
  test('a stale driverTermsVersion alone does NOT send an existing driver back to consent', () => {
    // The limitation stated as behaviour rather than as prose. The
    // driver below has accepted the CURRENT privacy and general terms
    // but an OLD driver-terms version. needsConsent() reads only the
    // first two, so he sails into the app and is never re-asked.
    //
    // That is precisely why the refuse-such-rides sentence also renders
    // on ConsentPage for DRIVER and BOTH: the general-terms bump is the
    // only thing that reaches him.
    //
    // If a driver-terms staleness guard is ever built, THIS test is the
    // one that must change — it should start expecting the consent
    // screen. It must not be deleted quietly.
    useAuthStore.setState({
      user: {
        id: 'driver-1',
        nickname: 'Motari',
        role: 'DRIVER',
        language: 'en',
        idVerified: false,
        licenseVerified: false,
        completedRides: 0,
        cancellationCount: 0,
        totalRequests: 0,
        privacyConsentAt: '2026-01-01T00:00:00Z',
        privacyConsentVersion: CURRENT_PRIVACY_VERSION,
        termsAcceptedAt: '2026-01-01T00:00:00Z',
        termsAcceptedVersion: CURRENT_TERMS_VERSION,
        driverTermsAcceptedAt: '2026-01-01T00:00:00Z',
        driverTermsVersion: PREVIOUS_DRIVER_TERMS_VERSION,
      },
      isAuthenticated: true,
      isLoading: false,
      token: 'tok',
      registrationPendingUserId: null,
      offlineSession: false,
    } as never);

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <div data-testid="app-shell">home</div>
              </ProtectedRoute>
            }
          />
          <Route path="/consent" element={<div data-testid="consent-screen">consent</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('consent-screen')).toBeNull();
  });
});
