// PILOT-GUARD Item 6(b) — the dead ETA read is gone.
//
// ApproachPage rendered `{activeJourney.driverEtaMinutes && (...)}`.
// No API payload and no Prisma model carries `driverEtaMinutes` on a
// journey, so the guard was always falsy and the line has never appeared
// on any build — the #191/#192 dead-read class, on a screen neither of
// those dispatches touched.
//
// The stronger of the two assertions below is the first: the field is
// FORCED onto the store, so even a payload that started carrying it
// would not resurrect the line. The second says the read itself is gone
// rather than merely unreachable.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
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

const JOURNEY = {
  id: 'j-1',
  status: 'MATCHED',
  pickupLat: -1.95,
  pickupLng: 30.06,
  pickupName: 'Kigali Heights',
  customer: { nickname: 'Alice' },
  // The field the removed line read. Nothing produces it; it is set here
  // so the assertion cannot pass merely because the value was absent.
  driverEtaMinutes: 7,
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
        etaAway: '{{min}} min away',
        cantMakeTrip: 'I cannot make this trip',
        fetchFailed: 'Fetch failed',
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
  } as never);
  useJourneyStore.setState({ activeJourney: JOURNEY as never });
  useChatStore.setState({ messages: [], isLoading: false });

  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: unknown) => {
    if (typeof url === 'string' && url.includes('/messages')) {
      return { ok: true, json: async () => [] };
    }
    return { ok: true, json: async () => JOURNEY };
  });
});

describe('ApproachPage — the dead ETA line', () => {
  test('no ETA is rendered even when the journey carries driverEtaMinutes', async () => {
    render(
      <MemoryRouter initialEntries={['/driver/approach/j-1']}>
        <Routes>
          <Route path="/driver/approach/:id" element={<ApproachPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // The screen itself rendered — the assertion is about what is absent
    // from a page that is present, not about a page that failed to load.
    await waitFor(() => expect(screen.getByText('Picking up Alice')).toBeTruthy());
    expect(screen.queryByText('7 min away')).toBeNull();
    expect(screen.queryByText(/min away/)).toBeNull();
  });

  test('the source carries no driverEtaMinutes read at all', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../pages/driver/ApproachPage.tsx'),
      'utf8',
    );
    // Comments are stripped first: the note left in the removed line's
    // place names the old expression, and documenting a removal may not
    // count as the removal failing.
    const code = src
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/driverEtaMinutes/);
    expect(code).not.toMatch(/etaAway/);
  });
});
