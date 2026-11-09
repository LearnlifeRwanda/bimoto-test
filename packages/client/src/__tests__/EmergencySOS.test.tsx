// SOS-WIRE G4 / FLIGHT-RECORDER G5 — customer SOS flow tests.
//
// The sheet must still do BOTH things: POST /journeys/:id/emergency AND
// surface a prominent tel:112 action. A failed POST still shows the
// explicit "could not notify Bimoto — call 112" copy (nothing queues
// silently) with the 112 action still foremost.
//
// FLIGHT-RECORDER G5 changed WHEN the POST happens, and these tests
// changed with it. Named, because the semantics moved and not just the
// wiring:
//
//   - `confirmSOS()` now holds the button for HOLD_MS instead of
//     clicking it; a click no longer opens the confirm at all (proved
//     separately in EmergencyButtonHold.test.tsx).
//   - Every assertion that used to run straight after confirming now
//     runs after CANCEL_WINDOW_MS as well. Confirming opens the sheet;
//     the countdown fires the POST.
//   - "cancelling the confirm dialog sends nothing" is kept verbatim and
//     joined by two new ones: the countdown itself sends nothing while
//     it runs, and cancelling it sends nothing ever.
//   - The tel:112 assertion is now made DURING the countdown as well as
//     after it. The guard is on notifying Bimoto; it has never been on
//     calling the emergency services.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { i18n } from './setup';
import { EmergencySOS } from '../components/safety/EmergencySOS';
// QUEUE-UNITY G4 — both durations come from the config module now, so
// these timings track the shipped values rather than a re-export.
import { SOS_HOLD_MS as HOLD_MS, SOS_CANCEL_MS as CANCEL_WINDOW_MS } from '../config/sos';
import { useAuthStore } from '../stores/auth.store';

const EMERGENCY_STRINGS = {
  emergency: {
    button: 'EMERGENCY',
    label: 'Emergency',
    confirm: 'Send alert',
    confirmTitle: 'Emergency alert',
    confirmMessage: 'Send an emergency alert to your contacts and Bimoto?',
    callEmergencyNumber: 'Call 112',
    notifying: 'Notifying Bimoto…',
    notified: 'Bimoto has been notified',
    notifyFailed: 'Could not notify Bimoto — call 112',
    retry: 'Try again',
    holdHint: 'Press and hold. Keyboard users press Enter.',
    cancelSend: 'Sending to Bimoto in {{seconds}} — tap to cancel',
  },
  common: { cancel: 'Cancel', close: 'Close' },
};

const fetchMock = vi.fn();

beforeEach(async () => {
  vi.useFakeTimers();
  i18n.addResourceBundle('en', 'translation', EMERGENCY_STRINGS, true, true);
  await i18n.changeLanguage('en');
  useAuthStore.setState({ token: 'tok', isAuthenticated: true, isLoading: false });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const emergencyButton = () => screen.getByRole('button', { name: 'EMERGENCY' });

/** Hold the button for its full duration, then confirm. Opens the sheet;
 *  does NOT yet send anything. */
function confirmSOS(): void {
  render(<EmergencySOS journeyId="j1" />);
  fireEvent.pointerDown(emergencyButton());
  act(() => {
    vi.advanceTimersByTime(HOLD_MS);
  });
  fireEvent.click(screen.getByText('Send alert'));
}

/** Let the three-second regret window run out. */
async function letItSend(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(CANCEL_WINDOW_MS);
  });
}

/**
 * SOS-FOLLOW G4 — the method test is load-bearing now. EmergencySOS also
 * reads GET /journeys/:id/emergency/active once on mount (the remount
 * truth), which shares this URL prefix and is not a press. Every
 * assertion in this file is unchanged in meaning: nothing is SENT until
 * the countdown completes.
 */
function posted(): boolean {
  return fetchMock.mock.calls.some(
    (c) =>
      typeof c[0] === 'string' &&
      c[0].includes('/emergency') &&
      (c[1] as { method?: string } | undefined)?.method === 'POST',
  );
}

/** Every `fetchMock` call that is a press, ignoring the mount-time read. */
function pressCalls() {
  return fetchMock.mock.calls.filter(
    (c) => (c[1] as { method?: string } | undefined)?.method === 'POST',
  );
}

describe('EmergencySOS', () => {
  test('confirm fires the emergency POST and shows the Call 112 action', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    confirmSOS();
    await letItSend();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/journeys/j1/emergency'),
      expect.objectContaining({ method: 'POST' }),
    );

    const callLink = screen.getByRole('link', { name: /Call 112/ });
    expect(callLink).toHaveAttribute('href', 'tel:112');
    expect(screen.getByText('Bimoto has been notified')).toBeInTheDocument();
  });

  test('failed POST shows the call-112 fallback copy, keeps the tel action, offers retry', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    confirmSOS();
    await letItSend();

    expect(screen.getByText('Could not notify Bimoto — call 112')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Call 112/ })).toHaveAttribute('href', 'tel:112');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  test('non-ok response counts as failure (no silent success)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    confirmSOS();
    await letItSend();

    expect(screen.getByText('Could not notify Bimoto — call 112')).toBeInTheDocument();
  });

  test('retry re-attempts the POST', async () => {
    // SOS-FOLLOW G4 — keyed on the method rather than on call order.
    // The mount-time active-GET is the component's first fetch now, so a
    // bare mockRejectedValueOnce would land on the read instead of on
    // the press it is meant to fail. The behaviour under test is
    // unchanged: the first PRESS fails, the retry succeeds.
    let press = 0;
    fetchMock.mockImplementation(async (_url: unknown, init?: { method?: string }) => {
      if (init?.method !== 'POST') return { ok: true, json: async () => ({ alert: null }) };
      press += 1;
      if (press === 1) throw new Error('offline');
      return { ok: true, json: async () => ({ success: true }) };
    });
    confirmSOS();
    await letItSend();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });

    expect(pressCalls()).toHaveLength(2);
    expect(screen.getByText('Bimoto has been notified')).toBeInTheDocument();
  });

  test('cancelling the confirm dialog sends nothing', () => {
    render(<EmergencySOS journeyId="j1" />);
    fireEvent.pointerDown(emergencyButton());
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    fireEvent.click(screen.getByText('Cancel'));
    act(() => {
      vi.advanceTimersByTime(CANCEL_WINDOW_MS * 2);
    });
    expect(pressCalls()).toHaveLength(0);
  });
});

describe('the three-second regret window', () => {
  test('nothing is sent while the countdown runs', () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    confirmSOS();

    act(() => {
      vi.advanceTimersByTime(CANCEL_WINDOW_MS - 500);
    });
    expect(posted()).toBe(false);
  });

  test('the countdown says what is about to happen and how to stop it', () => {
    confirmSOS();
    expect(screen.getByTestId('emergency-cancel-send').textContent).toContain('Sending to Bimoto');
    expect(screen.getByTestId('emergency-cancel-send').textContent).toContain('tap to cancel');
  });

  test('cancelling the countdown sends nothing, ever', () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    confirmSOS();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(screen.getByTestId('emergency-cancel-send'));
    act(() => {
      vi.advanceTimersByTime(CANCEL_WINDOW_MS * 3);
    });

    expect(pressCalls()).toHaveLength(0);
    // Cancel records nothing and closes cleanly: no dialog left behind.
    expect(screen.queryByTestId('emergency-cancel-send')).toBeNull();
  });

  test('112 is reachable during the countdown, not only after it', () => {
    confirmSOS();
    const link = screen.getByRole('link', { name: /Call 112/ });
    expect(link).toHaveAttribute('href', 'tel:112');
    // Foremost: the call action precedes the cancel action in the DOM,
    // which is what "above the fold" means on a 5-inch screen.
    expect(
      link.compareDocumentPosition(screen.getByTestId('emergency-cancel-send')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test('the whole path from a ride screen is hold, confirm, tap 112', () => {
    render(<EmergencySOS journeyId="j1" />);
    fireEvent.pointerDown(emergencyButton());
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    // Tap one: confirm. Tap two: 112. No step in between hides it.
    fireEvent.click(screen.getByText('Send alert'));
    expect(screen.getByRole('link', { name: /Call 112/ })).toHaveAttribute('href', 'tel:112');
    expect(pressCalls()).toHaveLength(0);
  });

  test('a screen that unmounts mid-countdown never fires the alert', () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { unmount } = render(<EmergencySOS journeyId="j1" />);
    fireEvent.pointerDown(emergencyButton());
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    fireEvent.click(screen.getByText('Send alert'));
    unmount();
    act(() => {
      vi.advanceTimersByTime(CANCEL_WINDOW_MS * 2);
    });
    expect(pressCalls()).toHaveLength(0);
  });
});
