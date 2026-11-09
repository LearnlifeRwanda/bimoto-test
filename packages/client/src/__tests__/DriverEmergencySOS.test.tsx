// RED-BUTTON G3 / FLIGHT-RECORDER G5 — the motari's red button is on his
// own two ride screens, in the same floating position his passenger's
// carries.
//
// These assert the entry point only: reaching it opens the confirm
// dialog that EmergencySOS already owns (the flow itself is proven in
// EmergencySOS.test.tsx), and the endpoint's role resolution is proven
// server-side in emergency-driver-parity.test.ts.
//
// FLIGHT-RECORDER G5 changed the trigger, and two assertions here
// changed with it, named because the semantics moved:
//
//   - "pressing it asks before it fires" became "a tap does nothing, and
//      the explicit path asks before it fires". A click used to open the
//      confirm; it now must not, and the keyboard path — the one an
//      assistive device drives — must still open it on the first press.
//   - "confirming posts to the journey emergency endpoint" now advances
//      the three-second cancel window before asserting the POST, because
//      confirming opens the sheet and the countdown is what fires.
//
// A third case is new: the hold itself works on the driver's screens
// too, which is what makes this one component serving five mounts.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
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

vi.mock('../hooks/useDriverLocationBroadcast', () => ({
  useDriverLocationBroadcast: vi.fn(),
}));

import { ApproachPage } from '../pages/driver/ApproachPage';
import { ActiveRidePage } from '../pages/driver/ActiveRidePage';
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';
import { useChatStore } from '../stores/chat.store';
// QUEUE-UNITY G4 — durations from the config module.
import { SOS_HOLD_MS as HOLD_MS, SOS_CANCEL_MS as CANCEL_WINDOW_MS } from '../config/sos';

const JOURNEY = {
  id: 'j-1',
  status: 'MATCHED',
  pickupLat: -1.95,
  pickupLng: 30.06,
  pickupName: 'Sonatubes',
  destinationName: 'Giporoso',
  customer: { nickname: 'Alice' },
};

beforeEach(async () => {
  // shouldAdvanceTime keeps waitFor and the screens' own async loading
  // working on real time while advanceTimersByTime can still skip the
  // hold and the three-second cancel window instantly.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      approach: {
        title: 'Approach',
        cantMakeTrip: 'I cannot make this trip',
        cantMakeTripTitle: 'Cannot make this trip?',
        cantMakeTripConfirm: 'Confirm withdraw',
      },
      activeRide: { startJourney: 'Start journey', endJourney: 'End journey' },
      emergency: {
        button: 'EMERGENCY',
        label: 'Emergency',
        confirmTitle: 'Emergency alert',
        confirmMessage: 'Send an emergency alert to your contacts and Bimoto?',
        confirm: 'Send emergency alert to your contacts?',
        callEmergencyNumber: 'Call 112',
        notifying: 'Notifying Bimoto…',
        holdHint: 'Press and hold. Keyboard users press Enter.',
        cancelSend: 'Sending to Bimoto in {{seconds}} — tap to cancel',
      },
      common: { yes: 'Yes', no: 'No', close: 'Close' },
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
  useJourneyStore.setState({ activeJourney: JOURNEY as any });
  useChatStore.setState({ messages: [], isLoading: false });

  (globalThis as any).fetch = vi.fn(async (url: any) => {
    if (typeof url === 'string' && url.includes('/messages')) {
      return { ok: true, json: async () => [] } as any;
    }
    return { ok: true, json: async () => JOURNEY } as any;
  });
});

/**
 * Has the emergency ALERT been sent? The screens fetch other things.
 *
 * SOS-FOLLOW G4 — the method test is load-bearing now. EmergencySOS also
 * reads GET /journeys/:id/emergency/active once on mount (the remount
 * truth: component state does not survive a restart, so the server is
 * asked whether this journey is already in an emergency). That read
 * shares this URL prefix and is not a press, so a substring match alone
 * would report every mount as an alert. Every assertion below is
 * unchanged in meaning: nothing is SENT until the countdown completes.
 */
function posted(): boolean {
  return ((globalThis as any).fetch as any).mock.calls.some(
    (c: any) =>
      typeof c[0] === 'string' &&
      c[0].includes('/emergency') &&
      c[1]?.method === 'POST',
  );
}

afterEach(() => {
  vi.useRealTimers();
});

function renderAt(path: string, route: string, element: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

const SCREENS: Array<[string, string, string, () => React.ReactElement]> = [
  ['the approach screen', '/driver/approach/j-1', '/driver/approach/:id', () => <ApproachPage />],
  ['the active-ride screen', '/driver/ride/j-1', '/driver/ride/:id', () => <ActiveRidePage />],
];

describe.each(SCREENS)('%s carries the motari\'s SOS', (_name, path, route, element) => {
  test('the floating emergency button is on the screen', async () => {
    renderAt(path, route, element());
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'EMERGENCY' })).toBeInTheDocument();
    });
  });

  test('a tap alone does nothing — a knee on a moto is not an alert', async () => {
    renderAt(path, route, element());
    await waitFor(() => screen.getByRole('button', { name: 'EMERGENCY' }));

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'EMERGENCY' }));
    });

    expect(
      screen.queryByText('Send an emergency alert to your contacts and Bimoto?'),
    ).toBeNull();
    expect(posted()).toBe(false);
  });

  test('the explicit path asks before it fires — no accidental alert', async () => {
    renderAt(path, route, element());
    await waitFor(() => screen.getByRole('button', { name: 'EMERGENCY' }));

    // The keyboard/assistive route: one press, straight to the question.
    act(() => {
      fireEvent.keyDown(screen.getByRole('button', { name: 'EMERGENCY' }), { key: 'Enter' });
    });

    // The confirm dialog, not a POST.
    await waitFor(() => {
      expect(
        screen.getByText('Send an emergency alert to your contacts and Bimoto?'),
      ).toBeInTheDocument();
    });
    expect(posted()).toBe(false);
  });

  test('holding the button gets there too, on the motari\'s screens as well', async () => {
    renderAt(path, route, element());
    await waitFor(() => screen.getByRole('button', { name: 'EMERGENCY' }));

    fireEvent.pointerDown(screen.getByRole('button', { name: 'EMERGENCY' }));
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });

    expect(
      screen.getByText('Send an emergency alert to your contacts and Bimoto?'),
    ).toBeInTheDocument();
    expect(posted()).toBe(false);
  });

  test('confirming posts after the cancel window, and offers 112 throughout', async () => {
    renderAt(path, route, element());
    await waitFor(() => screen.getByRole('button', { name: 'EMERGENCY' }));

    act(() => {
      fireEvent.keyDown(screen.getByRole('button', { name: 'EMERGENCY' }), { key: 'Enter' });
    });
    await waitFor(() =>
      screen.getByText('Send an emergency alert to your contacts and Bimoto?'),
    );
    act(() => {
      fireEvent.click(screen.getByText('Send emergency alert to your contacts?'));
    });

    // 112 is there DURING the countdown, before anything has been sent.
    expect(screen.getByText('Call 112').closest('a')).toHaveAttribute('href', 'tel:112');
    expect(posted()).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(CANCEL_WINDOW_MS);
    });

    // SOS-FOLLOW G4 — the PRESS, not the mount-time active-GET that now
    // shares this URL prefix. Same assertion as before on the same call.
    const call = ((globalThis as any).fetch as any).mock.calls.find(
      (c: any) =>
        typeof c[0] === 'string' && c[0].includes('/emergency') && c[1]?.method === 'POST',
    );
    expect(call).toBeTruthy();
    expect(call[0]).toContain('/api/journeys/j-1/emergency');
    expect(call[1].method).toBe('POST');

    // And still one tap away afterwards, exactly as on the passenger's sheet.
    expect(screen.getByText('Call 112').closest('a')).toHaveAttribute('href', 'tel:112');
  });
});
