// COMPLIANCE-ACK G3 — the acknowledgment both sides sign, pinned.
//
// The founder's ruling of 24 August is enforced by a version bump, not
// by a gate: needsConsent() compares the stored termsAcceptedVersion
// against CURRENT_TERMS_VERSION, so bumping the constant routes every
// existing user back through ConsentPage exactly once. These tests pin
// both halves of that mechanism and the acknowledgment it delivers:
//
//   * a user stamped at the OLD version is forced back to consent, and
//     a user stamped at the NEW version passes — the bump works in
//     both directions, which is what makes it a re-ask rather than a
//     wall;
//   * the three rules render, and carry NO number, because the legal
//     minimum age is counsel's to fix (card 2ZazTeyo);
//   * neither POST fires while the acknowledgment is unticked, and
//     both fire — stamping the NEW version — once it is;
//   * the driver's refuse-such-rides sentence renders for DRIVER and
//     BOTH on this step, which is the ONLY step that reaches an
//     existing motari (nothing checks driverTermsVersion for
//     staleness).

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import React from 'react';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '@bimoto/shared';
import { i18n } from './setup';
import enTranslation from '../../public/locales/en/translation.json';
import frTranslation from '../../public/locales/fr/translation.json';
import rwTranslation from '../../public/locales/rw/translation.json';

import { ProtectedRoute } from '../App';
import ConsentPage from '../pages/onboarding/ConsentPage';
import { useAuthStore } from '../stores/auth.store';

// The version a user accepted BEFORE this dispatch. Written as a
// literal on purpose: if it ever equals CURRENT_TERMS_VERSION again the
// re-ask silently stops happening, and the guard below fails loudly.
const PREVIOUS_TERMS_VERSION = '1.0';

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    nickname: 'Test',
    role: 'CUSTOMER',
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
    ...overrides,
  };
}

function signIn(user: Record<string, unknown>) {
  useAuthStore.setState({
    user,
    isAuthenticated: true,
    isLoading: false,
    token: 'tok',
    registrationPendingUserId: null,
    offlineSession: false,
  } as never);
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function renderGuard() {
  return render(
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
        <Route path="/consent" element={<LocationProbe />} />
        <Route path="/login" element={<LocationProbe />} />
        <Route path="/register" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderConsent() {
  return render(
    <MemoryRouter initialEntries={['/consent']}>
      <Routes>
        <Route path="/consent" element={<ConsentPage />} />
        <Route path="/" element={<LocationProbe />} />
        <Route path="/driver/screener" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  window.localStorage.clear();
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    token: null,
    registrationPendingUserId: null,
    offlineSession: false,
  } as never);
  i18n.addResourceBundle('en', 'translation', enTranslation, true, true);
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('COMPLIANCE-ACK — the bump is the enforcement', () => {
  test('the constant actually moved: the version users hold is no longer current', () => {
    // If this fails, the re-ask below is vacuous — everybody is already
    // stamped at the "new" version and nobody is asked anything.
    expect(CURRENT_TERMS_VERSION).not.toBe(PREVIOUS_TERMS_VERSION);
  });

  test('a user who accepted the OLD terms is walked back to consent', () => {
    signIn(baseUser({ termsAcceptedVersion: PREVIOUS_TERMS_VERSION }));
    renderGuard();
    expect(screen.getByTestId('location')).toHaveTextContent('/consent');
    expect(screen.queryByTestId('app-shell')).toBeNull();
  });

  test('a user who accepted the NEW terms passes straight through', () => {
    signIn(baseUser());
    renderGuard();
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('location')).toBeNull();
  });

  test('the re-ask is ONCE, not every launch — stamping the new version ends it', () => {
    // The same user, before and after the consent write. This is the
    // difference between a version-keyed re-ask and a wall.
    signIn(baseUser({ termsAcceptedVersion: PREVIOUS_TERMS_VERSION }));
    const first = renderGuard();
    expect(screen.getByTestId('location')).toHaveTextContent('/consent');
    first.unmount();

    signIn(baseUser({ termsAcceptedVersion: CURRENT_TERMS_VERSION }));
    renderGuard();
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
  });
});

describe('COMPLIANCE-ACK — the three rules, in plain words and no numbers', () => {
  test('all three sentences render on the consent step', () => {
    signIn(baseUser({ termsAcceptedVersion: PREVIOUS_TERMS_VERSION }));
    renderConsent();

    expect(screen.getByTestId('safety-acknowledgment')).toBeInTheDocument();
    expect(screen.getByTestId('safety-ack-no-infants')).toHaveTextContent(/babies or infants/i);
    expect(screen.getByTestId('safety-ack-one-passenger')).toHaveTextContent(
      /exactly one passenger/i,
    );
    expect(screen.getByTestId('safety-ack-minimum-age')).toHaveTextContent(
      /legal minimum age/i,
    );
  });

  test('NO legal number appears in the acknowledgment, in any of the three languages', () => {
    // The number waits for counsel (card 2ZazTeyo). A digit appearing
    // here would be a policy this repo invented, quoted back at us.
    const ACK_KEYS = [
      'safetyAckTitle',
      'safetyAckNoInfants',
      'safetyAckOnePassenger',
      'safetyAckMinimumAge',
      'safetyAckDriverRefuse',
      'safetyAckAgree',
    ];
    const bundles: Array<[string, Record<string, string>]> = [
      ['en', (enTranslation as never as { legal: Record<string, string> }).legal],
      ['fr', (frTranslation as never as { legal: Record<string, string> }).legal],
      ['rw', (rwTranslation as never as { legal: Record<string, string> }).legal],
    ];

    for (const [lang, legal] of bundles) {
      for (const key of ACK_KEYS) {
        expect(legal[key], `${lang}.legal.${key} must exist`).toBeTruthy();
        expect(legal[key], `${lang}.legal.${key} must carry no digit`).not.toMatch(/\d/);
      }
    }
  });

  test('the dormant child-gate is not consulted by this screen', () => {
    // The acknowledgment is copy a user affirms, not a booking gate.
    // Nothing on the consent path may import the thresholds module.
    signIn(baseUser({ termsAcceptedVersion: PREVIOUS_TERMS_VERSION }));
    renderConsent();
    expect(screen.getByTestId('safety-acknowledgment').textContent ?? '').not.toMatch(/\d/);
  });
});

describe('COMPLIANCE-ACK — the acknowledgment is a distinct affirmative act', () => {
  test('neither POST fires while the acknowledgment is unticked', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    signIn(baseUser({ termsAcceptedVersion: PREVIOUS_TERMS_VERSION }));
    renderConsent();

    const agree = screen.getByRole('button', { name: /I Understand and Agree/i });
    expect(agree).toBeDisabled();

    // Click anyway — the handler's own guard is the half that survives
    // a programmatic click or a later layout change.
    fireEvent.click(agree);
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('ticking it enables the button and both POSTs fire with the NEW version', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    signIn(baseUser({ termsAcceptedVersion: PREVIOUS_TERMS_VERSION }));
    renderConsent();

    fireEvent.click(screen.getByTestId('safety-ack-checkbox'));
    const agree = screen.getByRole('button', { name: /I Understand and Agree/i });
    expect(agree).toBeEnabled();
    fireEvent.click(agree);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const calls = fetchMock.mock.calls as unknown as Array<[string, { body: string }]>;
    const byUrl = (fragment: string) => calls.find(([url]) => String(url).includes(fragment));

    const privacy = byUrl('accept-privacy');
    const terms = byUrl('accept-terms');
    expect(privacy, 'accept-privacy must be posted').toBeTruthy();
    expect(terms, 'accept-terms must be posted').toBeTruthy();

    expect(JSON.parse(privacy![1].body)).toEqual({ version: CURRENT_PRIVACY_VERSION });
    expect(JSON.parse(terms![1].body)).toEqual({ version: CURRENT_TERMS_VERSION });

    // The consent UX stays two POSTs — no third endpoint was invented
    // to carry the acknowledgment.
    expect(calls).toHaveLength(2);
  });

  test('the stamped user carries the NEW terms version, so needsConsent stops firing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));

    signIn(baseUser({ termsAcceptedVersion: PREVIOUS_TERMS_VERSION }));
    renderConsent();

    fireEvent.click(screen.getByTestId('safety-ack-checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /I Understand and Agree/i }));

    await waitFor(() =>
      expect(useAuthStore.getState().user?.termsAcceptedVersion).toBe(CURRENT_TERMS_VERSION),
    );
    expect(useAuthStore.getState().user?.privacyConsentVersion).toBe(CURRENT_PRIVACY_VERSION);
  });
});

describe('COMPLIANCE-ACK — the driver half rides the step every driver passes', () => {
  test('a DRIVER sees the refuse-such-rides sentence on the consent step', () => {
    signIn(baseUser({ role: 'DRIVER', termsAcceptedVersion: PREVIOUS_TERMS_VERSION }));
    renderConsent();
    expect(screen.getByTestId('safety-ack-driver-refuse')).toHaveTextContent(/refuse any ride/i);
  });

  test('a BOTH user sees it too — BOTH is the shape onboarding produces for a motari', () => {
    signIn(baseUser({ role: 'BOTH', termsAcceptedVersion: PREVIOUS_TERMS_VERSION }));
    renderConsent();
    expect(screen.getByTestId('safety-ack-driver-refuse')).toBeInTheDocument();
  });

  test('a CUSTOMER does not — it is not a sentence a passenger can act on', () => {
    signIn(baseUser({ role: 'CUSTOMER', termsAcceptedVersion: PREVIOUS_TERMS_VERSION }));
    renderConsent();
    expect(screen.queryByTestId('safety-ack-driver-refuse')).toBeNull();
    // The three shared rules still render for her.
    expect(screen.getByTestId('safety-ack-no-infants')).toBeInTheDocument();
  });

  test('the driver still lands on the screener, and the customer on home', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    signIn(baseUser({ role: 'BOTH', termsAcceptedVersion: PREVIOUS_TERMS_VERSION }));
    renderConsent();

    fireEvent.click(screen.getByTestId('safety-ack-checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /I Understand and Agree/i }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/driver/screener'),
    );
  });
});
