// PILOT-INSTRUMENT G2 — pickup-identity prompt tests.
//
// Verifies:
//   - the card appears ONLY when approachStatus === 'arrived'
//   - "Yes" posts outcome MATCHED and the card disappears
//   - the negative path posts MISMATCH with the tapped one-tap reason
//   - "not sure" posts UNSURE with no reason
//   - dismissing posts nothing (optional, never gates the ride)
//   - an already-answered journey (localStorage) is never re-asked
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { i18n } from './setup';
import { PickupVerifyCard } from '../components/journey/PickupVerifyCard';

const fetchMock = vi.fn();

beforeEach(async () => {
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ outcome: 'MATCHED' }),
  });
  vi.stubGlobal('fetch', fetchMock);
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      common: { dismiss: 'Close' },
      driver: { jacketNumber: 'Jacket Nº {{number}}' },
      matched: {
        pickupVerify: {
          title: 'Is this your driver?',
          yes: "Yes, that's my driver",
          no: 'No / not sure',
          reasonPrompt: "What doesn't match?",
          reasonWrongNumber: "Jacket number doesn't match",
          reasonNoVest: 'No vest / jacket',
          reasonDifferentPerson: 'Different person',
          notSure: "I'm not sure",
          thanks: 'Thanks — your answer was recorded.',
          failed: 'Could not record your answer.',
        },
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

const defaultProps = {
  journeyId: 'j-1',
  jacketNumber: '4217',
};

describe('PickupVerifyCard — PILOT-INSTRUMENT', () => {
  test("shows on 'arrived' with the jacket number", () => {
    render(<PickupVerifyCard {...defaultProps} approachStatus="arrived" />);
    expect(screen.getByTestId('pickup-verify-card')).toBeInTheDocument();
    expect(screen.getByText('Is this your driver?')).toBeInTheDocument();
    expect(screen.getByText('Jacket Nº 4217')).toBeInTheDocument();
  });

  test.each(['silent', 'approaching', 'lost', null] as const)(
    'hidden when approachStatus is %s',
    (status) => {
      render(<PickupVerifyCard {...defaultProps} approachStatus={status} />);
      expect(screen.queryByTestId('pickup-verify-card')).toBeNull();
    },
  );

  test('"Yes" posts MATCHED and hides the card', async () => {
    render(<PickupVerifyCard {...defaultProps} approachStatus="arrived" />);
    fireEvent.click(screen.getByText("Yes, that's my driver"));

    await waitFor(() =>
      expect(screen.queryByTestId('pickup-verify-card')).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/journeys/j-1/pickup-verification');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ outcome: 'MATCHED' });
  });

  test('negative path posts MISMATCH with the tapped one-tap reason', async () => {
    render(<PickupVerifyCard {...defaultProps} approachStatus="arrived" />);
    fireEvent.click(screen.getByText('No / not sure'));
    fireEvent.click(screen.getByText("Jacket number doesn't match"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      outcome: 'MISMATCH',
      reason: 'WRONG_NUMBER',
    });
  });

  test('"not sure" posts UNSURE with no reason', async () => {
    render(<PickupVerifyCard {...defaultProps} approachStatus="arrived" />);
    fireEvent.click(screen.getByText('No / not sure'));
    fireEvent.click(screen.getByText("I'm not sure"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      outcome: 'UNSURE',
    });
  });

  test('dismissing hides the card and posts nothing — never gates the ride', () => {
    render(<PickupVerifyCard {...defaultProps} approachStatus="arrived" />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByTestId('pickup-verify-card')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('an already-answered journey is never re-asked', () => {
    localStorage.setItem('bimoto:pickupVerified:j-1', 'MATCHED');
    render(<PickupVerifyCard {...defaultProps} approachStatus="arrived" />);
    expect(screen.queryByTestId('pickup-verify-card')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a failed post keeps the card visible so the customer can retry or dismiss', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    render(<PickupVerifyCard {...defaultProps} approachStatus="arrived" />);
    fireEvent.click(screen.getByText("Yes, that's my driver"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('pickup-verify-card')).toBeInTheDocument();
    expect(localStorage.getItem('bimoto:pickupVerified:j-1')).toBeNull();
  });

  test('renders without a jacket number (unverified driver) — question still asked', () => {
    render(
      <PickupVerifyCard
        {...defaultProps}
        jacketNumber={null}
        approachStatus="arrived"
      />,
    );
    expect(screen.getByTestId('pickup-verify-card')).toBeInTheDocument();
    expect(screen.queryByText(/Jacket Nº/)).toBeNull();
  });
});
