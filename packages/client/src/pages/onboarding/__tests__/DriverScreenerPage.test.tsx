// R3-DRIVER-SCREENER — client tests for DriverScreenerPage. Mirrors
// the WelcomePage test setup (i18n bundle layering + MemoryRouter).

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import React from 'react';
import enLocale from '../../../../public/locales/en/translation.json';
import rwLocale from '../../../../public/locales/rw/translation.json';
import { i18n } from '../../../__tests__/setup';
import { SCREENER_QUESTIONS } from '@bimoto/shared';
import DriverScreenerPage from '../DriverScreenerPage';

// Layer the screener namespace onto the global test i18n bundle for
// both en and rw — the page reads strings from t().
const enScreener = (enLocale as Record<string, unknown>).screener as unknown as string;
const rwScreener = (rwLocale as Record<string, unknown>).screener as unknown as string;
i18n.addResource('en', 'translation', 'screener', enScreener);
i18n.addResource('rw', 'translation', 'screener', rwScreener);

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function mockFetchResponse(body: any, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status,
      json: async () => body,
    })),
  );
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
});

function getSubmitButton(): HTMLButtonElement {
  // Continue button uses screener.continue ("Continue") — match exactly to
  // avoid colliding with screener.actions.continueAnyway in the callout.
  const buttons = screen.getAllByRole('button');
  const exact = buttons.filter(
    (b) => b.textContent?.trim() === i18n.t('screener.continue'),
  );
  if (exact.length !== 1) {
    throw new Error(
      `expected exactly one Continue button, found ${exact.length}`,
    );
  }
  return exact[0] as HTMLButtonElement;
}

describe('DriverScreenerPage', () => {
  test('renders all 8 questions from the shared catalogue', () => {
    render(
      <MemoryRouter>
        <DriverScreenerPage />
      </MemoryRouter>,
    );

    // Each question prompt resolves to a non-key English string.
    for (const q of SCREENER_QUESTIONS) {
      const prompt = i18n.t(q.i18nKey);
      expect(prompt).not.toBe(q.i18nKey);
      expect(screen.getByText(prompt)).toBeInTheDocument();
    }
    expect(SCREENER_QUESTIONS.length).toBe(8);
  });

  test('submit is disabled until all required questions are answered', () => {
    render(
      <MemoryRouter>
        <DriverScreenerPage />
      </MemoryRouter>,
    );
    const submit = getSubmitButton();
    expect(submit).toBeDisabled();
  });

  test('renders all visible strings in Kinyarwanda when language=rw', async () => {
    await act(async () => {
      await i18n.changeLanguage('rw');
    });
    render(
      <MemoryRouter>
        <DriverScreenerPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(i18n.t('screener.title'))).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('screener.questions.is18OrOlder')),
    ).toBeInTheDocument();
    // "Yes" renders for two boolean questions — assert at least one match.
    expect(
      screen.getAllByText(i18n.t('screener.boolean.yes')).length,
    ).toBeGreaterThan(0);
    // Sanity check: the rendered title isn't the English fallback.
    expect(screen.queryByText('Quick eligibility check')).toBeNull();
  });

  test('shows ineligibility callout on ineligible — does not auto-redirect', async () => {
    mockFetchResponse({
      screenerId: 's-1',
      eligibilityResult: 'ineligible',
      ineligibilityReason: 'under_18',
    });
    render(
      <MemoryRouter initialEntries={['/driver/screener']}>
        <Routes>
          <Route path="/driver/screener" element={<DriverScreenerPage />} />
          <Route path="/driver/verification" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    // Click "No" on the first question (is_18_or_older) — that pivots to
    // ineligible in the eligibility evaluator and lets us test the
    // server-side ineligible path even though server is mocked.
    fillAllAnswers(/* underAge */ true);
    const submit = getSubmitButton();
    expect(submit).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(submit);
    });

    await waitFor(() => {
      expect(
        screen.getByText(i18n.t('screener.results.ineligible.under_18.title')),
      ).toBeInTheDocument();
    });
    // Did not redirect to verification.
    expect(screen.queryByTestId('location')).toBeNull();
  });

  test('redirects to /driver/verification on eligible', async () => {
    mockFetchResponse({
      screenerId: 's-1',
      eligibilityResult: 'eligible',
      ineligibilityReason: null,
    });
    render(
      <MemoryRouter initialEntries={['/driver/screener']}>
        <Routes>
          <Route path="/driver/screener" element={<DriverScreenerPage />} />
          <Route path="/driver/verification" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fillAllAnswers(false);
    const submit = getSubmitButton();
    await act(async () => {
      fireEvent.click(submit);
    });

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        '/driver/verification',
      );
    });
  });

  test('renders an info-icon trigger button for every question', () => {
    render(
      <MemoryRouter>
        <DriverScreenerPage />
      </MemoryRouter>,
    );
    const triggers = screen.getAllByRole('button', {
      name: i18n.t('screener.help.toggle'),
    });
    expect(triggers).toHaveLength(SCREENER_QUESTIONS.length);
    expect(triggers).toHaveLength(8);
  });

  test('tapping the info icon expands the help body and sets aria-expanded to true', () => {
    render(
      <MemoryRouter>
        <DriverScreenerPage />
      </MemoryRouter>,
    );
    const helpBody = i18n.t('screener.help.is18OrOlder');
    const trigger = screen.getAllByRole('button', {
      name: i18n.t('screener.help.toggle'),
    })[0];

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(helpBody)).toBeNull();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(helpBody)).toBeInTheDocument();
  });

  test('help body content reads from the right i18n key', () => {
    render(
      <MemoryRouter>
        <DriverScreenerPage />
      </MemoryRouter>,
    );
    const trigger = screen.getAllByRole('button', {
      name: i18n.t('screener.help.toggle'),
    })[0];
    fireEvent.click(trigger);
    // The expanded body resolves to the translated value of the first
    // question's helpKey (language-agnostic — assert against t(), not a
    // hardcoded English string, so the test is locale-independent).
    expect(
      screen.getByText(i18n.t('screener.help.is18OrOlder')),
    ).toBeInTheDocument();
  });

  test('renders per-option description text under each vehicle-type option', () => {
    render(
      <MemoryRouter>
        <DriverScreenerPage />
      </MemoryRouter>,
    );
    // Vehicle-type descriptions render below each radio label without needing
    // any expansion (they are always-visible captions).
    expect(
      screen.getByText(i18n.t('screener.options.vehicleType.BIKE_description')),
    ).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('screener.options.vehicleType.MOTO_description')),
    ).toBeInTheDocument();
  });

  test('progress copy includes the time-remaining estimate when answered < total', () => {
    render(
      <MemoryRouter>
        <DriverScreenerPage />
      </MemoryRouter>,
    );
    // Answer one of eight → 7 remaining → ceil(7*15/60) = 2 minutes.
    clickRadioByName('is_18_or_older', 'true');
    expect(
      screen.getByText(
        i18n.t('screener.progress', { answered: 1, total: 8, minutes: 2 }),
      ),
    ).toBeInTheDocument();
  });

  test('progress copy clamps minutes to at least 1 as answers complete', () => {
    render(
      <MemoryRouter>
        <DriverScreenerPage />
      </MemoryRouter>,
    );
    fillAllAnswers(false);
    // 7 of 8 required answered (cooperative is optional) → 1 remaining →
    // ceil(1*15/60) clamped to a 1-minute minimum, never 0.
    expect(
      screen.getByText(
        i18n.t('screener.progress', { answered: 7, total: 8, minutes: 1 }),
      ),
    ).toBeInTheDocument();
  });
});

// Fills all required questions with a valid (or under-18) answer set.
// underAge=true picks "No" for is_18_or_older to drive the ineligible path.
// Radios are scoped by question name attribute since labels like
// "Yes"/"No" repeat across the boolean questions.
function clickRadioByName(name: string, value: string) {
  const radio = document.querySelector(
    `input[type="radio"][name="${name}"][value="${value}"]`,
  ) as HTMLInputElement | null;
  if (!radio) throw new Error(`radio not found: ${name}=${value}`);
  fireEvent.click(radio);
}

function fillAllAnswers(underAge: boolean) {
  clickRadioByName('is_18_or_older', underAge ? 'false' : 'true');
  clickRadioByName('holds_drivers_licence', 'yes');
  clickRadioByName('has_rura_authorisation', 'have');
  clickRadioByName('primary_vehicle_type', 'MOTO');
  // Q5 — cooperative_affiliation is optional — skip.
  clickRadioByName('primary_city_band', 'kigali_dense');
  const hoursInput = screen.getByLabelText(
    i18n.t('screener.questions.weeklyAvailabilityHours'),
  ) as HTMLInputElement;
  fireEvent.change(hoursInput, { target: { value: '20' } });
  clickRadioByName('prior_platform_experience', 'false');
}
