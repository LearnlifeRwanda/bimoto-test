// SETTLE-UP G4 — the motari sees the payment state.
//
// PAY-TRUTH G2's keep-match window lets a journey sit MATCHED over a
// FAILED or PENDING escrow for ten minutes. Before this dispatch
// ApproachPage contained zero occurrences of escrow, payment, paid, HELD
// or FAILED: the driver riding toward that pickup had no way to know
// whether the fare existed. These tests pin the line, both tones, and —
// the part that matters most — that it informs without blocking.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

vi.mock('../hooks/useSocket', () => ({
  useSocket: () => ({
    socket: null,
    isConnected: false,
    joinJourneyRoom: vi.fn(),
    leaveJourneyRoom: vi.fn(),
  }),
}));

import { ApproachPage } from '../pages/driver/ApproachPage';
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';
import { useChatStore } from '../stores/chat.store';

const BASE_JOURNEY = {
  id: 'j-1',
  status: 'MATCHED',
  pickupLat: -1.95,
  pickupLng: 30.06,
  pickupName: 'Nyabugogo',
  customer: { nickname: 'Alice' },
};

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      approach: {
        title: 'Approach',
        chat: 'Chat',
        pickingUp: 'Picking up {{name}}',
        mapPlaceholder: 'Map placeholder',
        pickupAt: 'Pickup at',
        cantMakeTrip: 'I cannot make this trip',
        paymentConfirmed: 'Fare paid — this ride is covered.',
        paymentSettling:
          'Fare not confirmed yet. Keep going — if it is not paid within {{minutes}} minutes, we release you and tell you here.',
      },
      common: { yes: 'Yes', no: 'No' },
      chat: { noMessages: 'No messages yet' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

  useAuthStore.setState({
    token: 'tok',
    user: {
      id: 'driver-1',
      nickname: 'Driver Bob',
      role: 'DRIVER',
      language: 'en',
      idVerified: true,
      licenseVerified: true,
      completedRides: 5,
      cancellationCount: 0,
      totalRequests: 0,
    },
    isAuthenticated: true,
    isLoading: false,
  });
  useJourneyStore.setState({ activeJourney: BASE_JOURNEY as any });
  useChatStore.setState({ messages: [], isLoading: false });
});

// The escrow arrives on the journey the page already fetches — no new
// endpoint, no polling loop. The stub answers that one request only.
function renderWithEscrow(escrow: Record<string, unknown> | undefined) {
  const journey = { ...BASE_JOURNEY, ...(escrow ? { escrow } : {}) };
  const fetchMock = vi.fn(async (url: any) => {
    if (typeof url === 'string' && url.includes('/messages')) {
      return { ok: true, json: async () => [] } as any;
    }
    return { ok: true, json: async () => journey } as any;
  });
  (globalThis as any).fetch = fetchMock;
  render(
    <MemoryRouter initialEntries={['/driver/approach/j-1']}>
      <Routes>
        <Route path="/driver/approach/:id" element={<ApproachPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return fetchMock;
}

describe('ApproachPage payment line (SETTLE-UP G4)', () => {
  test('HELD escrow: the motari is told the fare is paid', async () => {
    renderWithEscrow({ id: 'e1', status: 'HELD', amount: 2000 });
    await waitFor(() =>
      expect(screen.getByTestId('approach-payment-line')).toHaveTextContent(
        'Fare paid — this ride is covered.',
      ),
    );
  });

  test('FAILED escrow: still settling, and the window is named', async () => {
    renderWithEscrow({ id: 'e1', status: 'FAILED', amount: 2000 });
    await waitFor(() =>
      expect(screen.getByTestId('approach-payment-line')).toHaveTextContent(
        'if it is not paid within 10 minutes',
      ),
    );
  });

  test('PENDING escrow reads the same as FAILED — both mean "not yet"', async () => {
    renderWithEscrow({ id: 'e1', status: 'PENDING', amount: 2000 });
    await waitFor(() =>
      expect(screen.getByTestId('approach-payment-line')).toHaveTextContent(
        'Fare not confirmed yet.',
      ),
    );
  });

  test('informs without blocking: the trip actions stay live on an unpaid fare', async () => {
    renderWithEscrow({ id: 'e1', status: 'FAILED', amount: 2000 });
    await waitFor(() => screen.getByTestId('approach-payment-line'));
    const withdraw = screen.getByText('I cannot make this trip');
    expect(withdraw).toBeInTheDocument();
    expect(withdraw.closest('button')).not.toBeDisabled();
  });

  test('no escrow on the journey: the page says nothing rather than guessing', async () => {
    renderWithEscrow(undefined);
    await waitFor(() => screen.getByText('I cannot make this trip'));
    expect(screen.queryByTestId('approach-payment-line')).toBeNull();
  });

  test('the line costs no extra request — it reads the journey the page already has', async () => {
    const fetchMock = renderWithEscrow({ id: 'e1', status: 'HELD', amount: 2000 });
    await waitFor(() => screen.getByTestId('approach-payment-line'));
    const urls = fetchMock.mock.calls.map((c: any) => String(c[0]));

    // The claim, unchanged: the payment line reads the escrow off the
    // journey this page already loaded, and asks the payments API for
    // nothing.
    expect(urls.some((u) => u.includes('/api/payments'))).toBe(false);

    // SOS-FOLLOW G4 — the page's request set is enumerated rather than
    // counted, so that a future addition names itself here instead of
    // moving a number. The third entry is EmergencySOS asking once on
    // mount whether this journey is already in an emergency; it belongs
    // to the red button, not to the payment line.
    expect(urls.filter((u) => u.includes('/emergency/active'))).toHaveLength(1);
    expect(urls.filter((u) => !u.includes('/emergency/active'))).toHaveLength(2);
  });
});
