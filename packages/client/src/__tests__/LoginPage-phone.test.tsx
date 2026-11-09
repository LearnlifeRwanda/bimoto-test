// PILOT-UX G1 — phone-prefix regression net.
//
// The field previously held the full +250-normalised number while a
// static +250 prefix box sat next to it, so the pilot user saw the
// country code twice. These tests pin the fix: the input holds only
// the 9 local subscriber digits (a typed/pasted +250, 250 or leading 0
// is stripped), and the request-OTP call still receives the full,
// valid +250XXXXXXXXX number.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';
import { LoginPage } from '../pages/auth/LoginPage';

beforeEach(() => {
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
      },
    },
    true,
    true,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderPage() {
  // Real router (no useNavigate mock): AUTH-UX G4 made the OTP step a
  // pushed history entry on /login, so the page needs actual navigation
  // for the step transition to render.
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function phoneInput(): HTMLInputElement {
  return screen.getByPlaceholderText('7XX XXX XXX') as HTMLInputElement;
}

describe('LoginPage phone input (single +250 prefix)', () => {
  test('typing local digits keeps only the digits in the field', () => {
    renderPage();
    fireEvent.change(phoneInput(), { target: { value: '788123456' } });
    expect(phoneInput().value).toBe('788123456');
  });

  test('a pasted +250 number is stripped to local digits — no double prefix', () => {
    renderPage();
    fireEvent.change(phoneInput(), { target: { value: '+250788123456' } });
    expect(phoneInput().value).toBe('788123456');
    // The one visible +250 is the static prefix box.
    expect(screen.getAllByText('+250')).toHaveLength(1);
  });

  test('a pasted 250-prefixed number (no plus) is stripped', () => {
    renderPage();
    fireEvent.change(phoneInput(), { target: { value: '250788123456' } });
    expect(phoneInput().value).toBe('788123456');
  });

  test('a leading trunk 0 is stripped', () => {
    renderPage();
    fireEvent.change(phoneInput(), { target: { value: '0788123456' } });
    expect(phoneInput().value).toBe('788123456');
  });

  test('input is capped at 9 subscriber digits', () => {
    renderPage();
    fireEvent.change(phoneInput(), { target: { value: '78812345678901' } });
    expect(phoneInput().value).toBe('788123456');
  });

  test('submit stays disabled until 9 local digits are present', () => {
    renderPage();
    const button = screen.getByRole('button', { name: 'Send code' });
    fireEvent.change(phoneInput(), { target: { value: '78812345' } });
    expect(button).toBeDisabled();
    fireEvent.change(phoneInput(), { target: { value: '788123456' } });
    expect(button).toBeEnabled();
  });

  test('request-OTP receives the full +250 number and the prompt shows it', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    fireEvent.change(phoneInput(), { target: { value: '0788123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/api/auth/request-otp');
    expect(JSON.parse(String(init.body))).toEqual({ phone: '+250788123456' });

    // Confirmation copy shows the full number exactly once.
    expect(
      await screen.findByText('Enter the code sent to +250788123456'),
    ).toBeInTheDocument();
  });
});
