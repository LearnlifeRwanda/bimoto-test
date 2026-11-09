// AUTH-UX G2/G4 — OTP countdown, expiry, resend and back navigation.
//
// The 5:00 countdown is a client display of the known server validity;
// at zero the inputs give way to an explicit expired notice and a stale
// submit is blocked locally. Resend sits behind a 60s client cooldown;
// a 429 from the server's 3-per-10-min budget must surface the honest
// errors.rate_limited copy through the presenter. "Change phone" pops
// the pushed OTP history entry, returning to the phone step.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
import { LoginPage } from '../pages/auth/LoginPage';
import { useUIStore } from '../stores/ui.store';

beforeEach(() => {
  vi.useFakeTimers();
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      login: {
        subtitle: 'Rides and deliveries in Kigali',
        phoneLabel: 'Phone number',
        phonePlaceholder: '7XX XXX XXX',
        sendCode: 'Send code',
        otpSent: 'Code sent',
        otpFailed: 'Could not send code',
        otpPrompt: 'Enter the code sent to {{phone}}',
        otpDigit: 'Digit {{n}}',
        invalidPhone: 'Invalid phone number',
        verify: 'Verify',
        verifyFailed: 'Verification failed',
        changePhone: 'Change phone number',
        codeExpiresIn: 'Code expires in {{time}}',
        codeExpired: 'This code has expired. Request a new one below.',
        resendCode: 'Resend code',
        resendIn: 'Resend in {{seconds}}s',
      },
      errors: {
        rate_limited: 'Too many requests. Please wait a moment.',
      },
    },
    true,
    true,
  );
  useUIStore.setState({ toasts: [], toastMessage: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function okResponse() {
  return new Response(JSON.stringify({}), { status: 200 });
}

function rateLimitedResponse() {
  return new Response(
    JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'errors.rate_limited' } }),
    { status: 429 },
  );
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Type the phone and request the first code. */
async function reachOtpStep(fetchMock: FetchFn) {
  vi.stubGlobal('fetch', fetchMock);
  renderPage();
  fireEvent.change(screen.getByPlaceholderText('7XX XXX XXX'), {
    target: { value: '788123456' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
  });
  expect(screen.getByText('Enter the code sent to +250788123456')).toBeInTheDocument();
}

describe('OTP countdown and expiry (AUTH-UX G2)', () => {
  test('a fresh send shows the 5:00 countdown', async () => {
    await reachOtpStep(vi.fn(async () => okResponse()));
    expect(screen.getByRole('timer')).toHaveTextContent('Code expires in 5:00');
  });

  test('at expiry the inputs give way to the expired notice and a stale submit is blocked', async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse());
    await reachOtpStep(fetchMock);

    // Five typed digits — one short of the auto-submit.
    for (let i = 0; i < 5; i++) {
      fireEvent.change(screen.getByLabelText(`Digit ${i + 1}`), { target: { value: '1' } });
    }

    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000 + 1000);
    });

    expect(
      screen.getByText('This code has expired. Request a new one below.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Digit 1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
    // Only the request-otp call ever went out — no stale verify attempt.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/auth/request-otp');
  });
});

describe('OTP resend (AUTH-UX G2)', () => {
  test('resend is disabled behind the 60s cooldown, then sends again', async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse());
    await reachOtpStep(fetchMock);

    const cooldownButton = screen.getByRole('button', { name: 'Resend in 60s' });
    expect(cooldownButton).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    const resendButton = screen.getByRole('button', { name: 'Resend code' });
    expect(resendButton).toBeEnabled();
    await act(async () => {
      fireEvent.click(resendButton);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/auth/request-otp');
    // The clocks restarted: cooldown is back up and the countdown is full.
    expect(screen.getByRole('button', { name: 'Resend in 60s' })).toBeDisabled();
    expect(screen.getByRole('timer')).toHaveTextContent('Code expires in 5:00');
  });

  test('a resend into the server rate limit surfaces the honest 429 copy', async () => {
    let calls = 0;
    const fetchMock = vi.fn<FetchFn>(async () => {
      calls += 1;
      return calls === 1 ? okResponse() : rateLimitedResponse();
    });
    await reachOtpStep(fetchMock);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
    });

    expect(useUIStore.getState().toastMessage).toBe('Too many requests. Please wait a moment.');
    // Still on the OTP step — the failed resend must not eject the user.
    expect(screen.getByText('Enter the code sent to +250788123456')).toBeInTheDocument();
  });
});

describe('back from the OTP step (AUTH-UX G4)', () => {
  test('"change phone" returns to the phone-entry step and resets the clocks', async () => {
    await reachOtpStep(vi.fn(async () => okResponse()));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change phone number' }));
    });

    expect(screen.getByRole('button', { name: 'Send code' })).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    // The typed number is kept for editing — only the code step is gone.
    expect((screen.getByPlaceholderText('7XX XXX XXX') as HTMLInputElement).value).toBe(
      '788123456',
    );
  });
});
