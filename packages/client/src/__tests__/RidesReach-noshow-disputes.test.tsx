// RIDES-REACH G2 — the SECOND dead screen, found by this dispatch's
// caller census rather than named in it.
//
// The dispatch's starting census said DashboardPage was the only client
// caller of `?viewAs=driver`. It is not: NoShowDisputesPage
// (/driver/no-show-disputes, DriverRoute-guarded, reachable from the
// driver AccountPage) fetches
//
//     GET /api/journeys?viewAs=driver&status=CANCELLED
//
// with NO coordinates — so it hit the same LOCATION_REQUIRED gate as the
// rides tab and rendered an ErrorState. And under the old `where`, had a
// coordinate ever been sent, it would have answered with every CANCELLED
// journey in radius: the screen offers a "Dispute this no-show" button
// per row, so it would have offered a motari the chance to dispute a
// no-show on a RIVAL's cancelled ride.
//
// It relies on the opposite of the IDOR shape, so narrowing cures it
// rather than breaking it — no STOP. This is the pin.
//
// PAGE-mounted (#203). Nothing in the page changed; the server's answer
// did.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

import { NoShowDisputesPage } from '../pages/driver/NoShowDisputesPage';
import { useAuthStore } from '../stores/auth.store';
import { _resetConnectivityForTests } from '../sync/connectivity';

const DRIVER_ID = 'd1';

/** His own cancelled ride, flagged DRIVER_NO_SHOW — what the screen is for. */
const HIS_NO_SHOW = {
  id: 'j-mine',
  pickupName: 'Kimironko Market',
  destinationName: 'Kigali Heights',
  cancelledAt: '2026-08-20T10:00:00Z',
  cancelReason: 'DRIVER_NO_SHOW',
  driverDisputedAt: null,
  driverId: DRIVER_ID,
};

/** His own cancelled ride for a different reason — filtered out client-side. */
const HIS_OTHER_CANCEL = {
  id: 'j-mine-other',
  pickupName: 'Remera',
  destinationName: 'Nyabugogo',
  cancelledAt: '2026-08-19T10:00:00Z',
  cancelReason: 'CUSTOMER_CHANGED_MIND',
  driverDisputedAt: null,
  driverId: DRIVER_ID,
};

beforeEach(async () => {
  _resetConnectivityForTests();
  useAuthStore.setState({
    token: 'tok',
    user: { id: DRIVER_ID, role: 'DRIVER' } as any,
  } as any);
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      common: { retry: 'Retry' },
      states: { loadFailed: "This couldn't load", loadFailedHint: 'Try again.' },
      driver: {
        disputeNoShow: 'Dispute this no-show',
        disputeNoShowSubmitted: 'Dispute submitted',
        cancelledTrips: { title: 'Cancelled trips', empty: 'No cancelled trips' },
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetConnectivityForTests();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/driver/no-show-disputes']}>
      <Routes>
        <Route path="/driver/no-show-disputes" element={<NoShowDisputesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RIDES-REACH G2 — the no-show disputes screen reaches an answer', () => {
  test('his own no-show rows render, and there is no ErrorState', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify([HIS_NO_SHOW, HIS_OTHER_CANCEL]), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('no-show-disputes-page')).toBeInTheDocument(),
    );
    const rows = await screen.findAllByTestId('no-show-dispute-row');
    expect(rows).toHaveLength(1);
    expect(screen.getByText(/Kimironko Market/)).toBeInTheDocument();
    expect(screen.getByText('Dispute this no-show')).toBeInTheDocument();
    expect(screen.queryByText("This couldn't load")).not.toBeInTheDocument();

    // The request is unchanged — no coordinates, and the arm answers it.
    const url = String((fetchMock.mock.calls[0] as any[])[0]);
    const params = new URL(url, 'http://localhost').searchParams;
    expect(params.get('viewAs')).toBe('driver');
    expect(params.get('status')).toBe('CANCELLED');
    expect(params.get('lat')).toBeNull();
    expect(params.get('lng')).toBeNull();
  });

  test('a 400 from the arm is still an ErrorState, not a false "no cancelled trips"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: 'LOCATION_REQUIRED', message: 'errors.locationRequired' },
            }),
            { status: 400 },
          ),
      ),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("This couldn't load")).toBeInTheDocument(),
    );
    expect(screen.queryByText('No cancelled trips')).not.toBeInTheDocument();
  });
});
