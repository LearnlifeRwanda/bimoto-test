// SOS-FOLLOW G5 — the ops emergency surface.
//
// Two claims are worth testing here and the rest is rendering.
//
// THE AGE IS NOT DECORATION. A follow over a phone network goes quiet,
// and a map that keeps showing the last dot without saying when it
// arrived tells an operator somebody is standing still when in truth
// nobody has heard from them for four minutes. Those are opposite facts.
// So the age is asserted, including that it KEEPS COUNTING while nothing
// arrives — a frozen "40 s" would be the same lie in slower motion.
//
// THE RESOLVE IS THE POINT. Everything this dispatch built is defensible
// only because a person can end it, so: the note floor is enforced
// before the request is made, the request carries the note, and an alert
// somebody else already closed says so instead of appearing to work.

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SOCKET_EVENTS, ADMIN_REASON_MIN_LENGTH } from '@bimoto/shared';
import { i18n } from './setup';

const { handlers, mockSocket, ioMock } = vi.hoisted(() => {
  const handlers = new Map<string, Array<(...args: any[]) => void>>();
  const mockSocket = {
    on: (evt: string, cb: (...args: any[]) => void) => {
      handlers.set(evt, [...(handlers.get(evt) ?? []), cb]);
      return mockSocket;
    },
    off: (evt: string, cb: (...args: any[]) => void) => {
      handlers.set(evt, (handlers.get(evt) ?? []).filter((h) => h !== cb));
      return mockSocket;
    },
    emit: () => mockSocket,
    disconnect: () => {},
    connected: true,
  };
  return { handlers, mockSocket, ioMock: { io: () => mockSocket } };
});
vi.mock('socket.io-client', () => ioMock);

// Leaflet does not render in jsdom; the map is proven by the component
// it delegates to being asked for the right positions, not by pixels.
vi.mock('../components/admin/EmergencyFollowMap', () => ({
  EmergencyFollowMap: ({ positions, pressLat }: any) => (
    <div
      data-testid="follow-map"
      data-count={positions.length}
      data-press={pressLat === null ? 'none' : 'yes'}
    />
  ),
}));

import { AdminEmergency, ageSeconds } from '../pages/admin/AdminEmergency';
import { useAuthStore } from '../stores/auth.store';
import { useEmergencyAlertStore } from '../stores/emergency-alert.store';

const STRINGS = {
  emergency: {
    opsTitle: 'Emergency alerts',
    opsIntro: 'Open emergencies can be followed live until they are closed.',
    opsTabActive: 'Open ({{count}})',
    opsTabHistory: 'History',
    opsNoneActive: 'No emergency is open.',
    opsNoneClosed: 'No emergency has been closed yet.',
    opsLoadFailed: 'Could not load emergency alerts',
    opsRaisedByDriver: 'Driver',
    opsRaisedByCustomer: 'Passenger',
    opsOpenFor: 'open {{age}}',
    opsLastPosition: 'last position {{age}} ago',
    opsNoFramesYet: 'No live position yet',
    opsAgeSeconds: '{{seconds}} s',
    opsAgeMinutes: '{{minutes}} min',
    opsAgeHours: '{{hours}} h',
    opsResolve: 'Close this emergency',
    opsResolveNoteLabel: 'What happened',
    opsResolveNotePlaceholder: 'Spoke to the driver',
    opsResolveNoteTooShort: 'Write at least {{min}} characters',
    opsResolveFailed: 'Could not close this alert',
    opsStatusResolved: 'Closed by ops',
    opsStatusExpired: 'Timed out',
    opsClosedBy: 'Closed by {{name}}',
    adminJourney: 'Journey',
  },
};

const ALERT = {
  id: 'a1',
  journeyId: 'j1',
  raisedById: 'u-driver',
  raisedByRole: 'DRIVER' as const,
  pressLat: -1.95,
  pressLng: 30.06,
  createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  journey: { type: 'PASSENGER', status: 'IN_PROGRESS', pickupName: 'A', destinationName: 'B' },
  raisedBy: { nickname: 'Jean' },
};

const CLOSED = {
  id: 'a0',
  journeyId: 'j0',
  raisedByRole: 'CUSTOMER' as const,
  status: 'RESOLVED' as const,
  createdAt: '2026-08-18T10:00:00.000Z',
  resolvedAt: '2026-08-18T10:12:00.000Z',
  resolveNote: 'Spoke to the passenger, false alarm from a pocket press.',
  journey: { type: 'PASSENGER' },
  raisedBy: { nickname: 'Aline' },
  resolvedBy: { nickname: 'Ops Grace' },
};

const EXPIRED = { ...CLOSED, id: 'a-x', status: 'EXPIRED' as const, resolvedBy: null,
  resolveNote: 'Auto-expired by the system after 60 minutes with no administrator resolution.' };

let fetchMock: ReturnType<typeof vi.fn>;

function respondWith(active: unknown[], history: unknown[]) {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes('/history')) {
      return { ok: true, json: async () => ({ alerts: history }) };
    }
    if (String(url).includes('/active')) {
      return { ok: true, json: async () => ({ alerts: active }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

function fire(evt: string, payload: unknown) {
  act(() => { for (const h of handlers.get(evt) ?? []) h(payload); });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminEmergency />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  handlers.clear();
  i18n.addResourceBundle('en', 'translation', STRINGS, true, true);
  await i18n.changeLanguage('en');
  useAuthStore.setState({ token: 'tok', isAuthenticated: true, isLoading: false });
  useEmergencyAlertStore.setState({ alerts: [], positions: {} });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  respondWith([], []);
});

afterEach(() => { vi.useRealTimers(); });

describe('the open list', () => {
  test('an empty panel says so rather than showing nothing', async () => {
    renderPage();
    await screen.findByTestId('emergency-active-empty');
    expect(screen.getByText('No emergency is open.')).toBeInTheDocument();
  });

  test('an open alert names who raised it, their role, and how long it has been open', async () => {
    respondWith([ALERT], []);
    renderPage();

    await screen.findByTestId('emergency-active-card');
    expect(screen.getByTestId('emergency-active-raiser')).toHaveTextContent('Driver — Jean');
    expect(screen.getByTestId('emergency-active-age')).toHaveTextContent('open 4 min');
    expect(screen.getByText('j1', { exact: false })).toBeInTheDocument();
  });

  test('the map is handed this alert‘s positions and its press point', async () => {
    respondWith([ALERT], []);
    renderPage();
    await screen.findByTestId('emergency-active-card');

    expect(screen.getByTestId('follow-map')).toHaveAttribute('data-press', 'yes');
    expect(screen.getByTestId('follow-map')).toHaveAttribute('data-count', '0');
  });

  test('with no frames yet it says so — silence is not an empty map', async () => {
    respondWith([ALERT], []);
    renderPage();
    await screen.findByTestId('emergency-active-card');
    expect(screen.getByText('No live position yet')).toBeInTheDocument();
  });
});

describe('following live', () => {
  test('a relayed frame appears with its age', async () => {
    respondWith([ALERT], []);
    renderPage();
    await screen.findByTestId('emergency-active-card');

    fire(SOCKET_EVENTS.EMERGENCY_LOCATION_UPDATE, {
      alertId: 'a1',
      journeyId: 'j1',
      userId: 'u-driver',
      role: 'DRIVER',
      lat: -1.95,
      lng: 30.06,
      accuracy: 8,
      at: new Date(Date.now() - 40_000).toISOString(),
    });

    expect(screen.getByTestId('emergency-position-age')).toHaveTextContent(
      'last position 40 s ago',
    );
    expect(screen.getByTestId('follow-map')).toHaveAttribute('data-count', '1');
  });

  test('both participants appear separately — two people, two dots', async () => {
    respondWith([ALERT], []);
    renderPage();
    await screen.findByTestId('emergency-active-card');

    const at = new Date().toISOString();
    fire(SOCKET_EVENTS.EMERGENCY_LOCATION_UPDATE, {
      alertId: 'a1', journeyId: 'j1', userId: 'u-driver', role: 'DRIVER',
      lat: -1.95, lng: 30.06, at,
    });
    fire(SOCKET_EVENTS.EMERGENCY_LOCATION_UPDATE, {
      alertId: 'a1', journeyId: 'j1', userId: 'u-pax', role: 'CUSTOMER',
      lat: -1.96, lng: 30.07, at,
    });

    expect(screen.getByTestId('follow-map')).toHaveAttribute('data-count', '2');
    expect(screen.getAllByTestId('emergency-position-age')).toHaveLength(2);
  });

  test("a frame for ANOTHER alert does not appear on this one", async () => {
    respondWith([ALERT], []);
    renderPage();
    await screen.findByTestId('emergency-active-card');

    fire(SOCKET_EVENTS.EMERGENCY_LOCATION_UPDATE, {
      alertId: 'some-other-alert', journeyId: 'j9', userId: 'u9', role: 'DRIVER',
      lat: -1.9, lng: 30.0, at: new Date().toISOString(),
    });

    expect(screen.getByTestId('follow-map')).toHaveAttribute('data-count', '0');
  });

  // CLEAN-SWEEP G5 — the cutoff is BRACKETED, not raced.
  //
  // This test used to sleep 5.1 REAL seconds and then assert
  // synchronously, betting that AdminEmergency's 5 000 ms age interval
  // (AdminEmergency.tsx:58-59) would have fired and re-rendered inside a
  // 100 ms margin. Under a parallel run it does not — timer callbacks are
  // delayed by load, and it fired once during GAP-CLOSE's run for exactly
  // that reason. The margin was the defect, not the assertion.
  //
  // FAKE TIMERS DO NOT WORK HERE, and the reason is worth recording so the
  // next person does not spend the afternoon on it: `vi.useFakeTimers`
  // only captures timers created after it is installed, so it has to go in
  // BEFORE the render to catch the age interval — and the socket
  // connection this screen's live half depends on never completes on a
  // fake clock. `handlers.get(EMERGENCY_LOCATION_UPDATE)` comes back
  // empty, the position effect returned early on a null socket, and no
  // frame can be delivered at all. The test then passes only in a full-file
  // run, for reasons that have nothing to do with what it asserts.
  //
  // So: real clock, and a BRACKET that spans the cutoff instead of landing
  // on it. `waitFor` re-reads until the interval has actually fired,
  // however late load makes it; the assertion is the same one, and it can
  // no longer fail for being early.
  test('the age keeps counting while nothing arrives — a frozen age is the same lie, slower', async () => {
    respondWith([ALERT], []);
    renderPage();
    await screen.findByTestId('emergency-active-card');

    const at = new Date(Date.now() - 10_000).toISOString();
    fire(SOCKET_EVENTS.EMERGENCY_LOCATION_UPDATE, {
      alertId: 'a1', journeyId: 'j1', userId: 'u-driver', role: 'DRIVER',
      lat: -1.95, lng: 30.06, at,
    });
    expect(screen.getByTestId('emergency-position-age')).toHaveTextContent('10 s ago');

    // No frame arrives. The clock advances anyway.
    const realNow = Date.now;
    Date.now = () => realNow() + 130_000;
    try {
      await waitFor(
        () =>
          expect(screen.getByTestId('emergency-position-age')).toHaveTextContent('2 min ago'),
        // Comfortably past one 5 s tick, so a late timer is waited for
        // rather than raced. It returns as soon as the tick lands, so the
        // headroom costs nothing on an unloaded machine.
        { timeout: 20_000, interval: 100 },
      );
    } finally {
      Date.now = realNow;
    }
  }, 30_000);

  test('an ended alert takes its card and its positions off the screen', async () => {
    respondWith([ALERT], []);
    renderPage();
    await screen.findByTestId('emergency-active-card');
    fire(SOCKET_EVENTS.EMERGENCY_LOCATION_UPDATE, {
      alertId: 'a1', journeyId: 'j1', userId: 'u-driver', role: 'DRIVER',
      lat: -1.95, lng: 30.06, at: new Date().toISOString(),
    });

    respondWith([], [CLOSED]);
    fire(SOCKET_EVENTS.EMERGENCY_ENDED, { alertId: 'a1', journeyId: 'j1', status: 'RESOLVED' });

    await waitFor(() => expect(screen.queryByTestId('emergency-active-card')).toBeNull());
    expect(useEmergencyAlertStore.getState().positions).toEqual({});
  });
});

describe('closing one', () => {
  test('the button is refused until the note reaches the floor', async () => {
    respondWith([ALERT], []);
    renderPage();
    await screen.findByTestId('emergency-active-card');

    const button = screen.getByRole('button', { name: 'Close this emergency' });
    expect(button).toBeDisabled();

    await userEvent.type(screen.getByLabelText('What happened'), 'ok');
    expect(button).toBeDisabled();
    expect(screen.getByText(`Write at least ${ADMIN_REASON_MIN_LENGTH} characters`)).toBeInTheDocument();

    const calls = fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST');
    expect(calls).toHaveLength(0);
  });

  test('a real note closes it, carrying the note to the server', async () => {
    respondWith([ALERT], []);
    renderPage();
    await screen.findByTestId('emergency-active-card');

    await userEvent.type(
      screen.getByLabelText('What happened'),
      'Spoke to the motari, he is safe.',
    );
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Close this emergency' }));
    });

    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(post).toBeTruthy();
    expect(String(post![0])).toContain('/api/admin/emergency/a1/resolve');
    expect(JSON.parse(post![1].body)).toEqual({
      note: 'Spoke to the motari, he is safe.',
    });
  });

  test('an alert somebody else already closed says so rather than appearing to work', async () => {
    respondWith([ALERT], []);
    renderPage();
    await screen.findByTestId('emergency-active-card');

    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === 'POST') return { ok: false, status: 404, json: async () => ({}) };
      if (String(url).includes('/history')) return { ok: true, json: async () => ({ alerts: [] }) };
      return { ok: true, json: async () => ({ alerts: [ALERT] }) };
    });

    await userEvent.type(screen.getByLabelText('What happened'), 'Closing this one now.');
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Close this emergency' }));
    });

    expect(await screen.findByText('Could not close this alert')).toBeInTheDocument();
  });
});

describe('the history', () => {
  test('a resolved alert shows its note and who closed it', async () => {
    respondWith([], [CLOSED]);
    renderPage();
    await act(async () => {});
    await userEvent.click(screen.getByTestId('emergency-tab-history'));

    expect(screen.getByTestId('emergency-history-status')).toHaveTextContent('Closed by ops');
    expect(screen.getByTestId('emergency-history-note')).toHaveTextContent('false alarm');
    expect(screen.getByText('Closed by Ops Grace')).toBeInTheDocument();
  });

  test('EXPIRED stays distinct from RESOLVED — a panel nobody watched is a fact worth keeping', async () => {
    respondWith([], [EXPIRED]);
    renderPage();
    await act(async () => {});
    await userEvent.click(screen.getByTestId('emergency-tab-history'));

    expect(screen.getByTestId('emergency-history-status')).toHaveTextContent('Timed out');
    expect(screen.queryByText('Closed by Ops Grace')).toBeNull();
  });

  test('an empty history says so', async () => {
    renderPage();
    await act(async () => {});
    await userEvent.click(screen.getByTestId('emergency-tab-history'));
    expect(screen.getByTestId('emergency-history-empty')).toBeInTheDocument();
  });
});

describe('a failed load is said, not shown as calm', () => {
  test('the panel reports it could not read the alerts', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    renderPage();
    expect(await screen.findByText('Could not load emergency alerts')).toBeInTheDocument();
  });
});

describe('ageSeconds', () => {
  test('floors at zero rather than counting backwards on clock skew', () => {
    expect(ageSeconds(new Date(Date.now() + 60_000).toISOString())).toBe(0);
  });

  test('an unparseable instant is zero, not NaN on an operator’s screen', () => {
    expect(ageSeconds('not a date')).toBe(0);
  });
});
