// FLIGHT-RECORDER G5 — the red button's guard.
//
// RED-BUTTON's trigger was a tap on a 60px FAB fixed at the corner of a
// phone held in one hand on a moto. These tests are about the two things
// that had to become true at once:
//
//   1. A tap alone does NOTHING. Not a dialog, not a toast, nothing to
//      dismiss — an accidental brush must leave no trace, because a
//      trace is itself a thing to deal with while riding.
//   2. Holding is not a wall. Keyboard and assistive activation reach
//      the confirm dialog on the first press, exactly as before, because
//      a gesture requiring sustained precise contact would lock out the
//      people least able to produce one.
//
// QUEUE-UNITY G4 — the hold DURATION moved out to config/sos.ts and its
// default changed, 700 → 1000 ms. Every assertion below was already
// written against the symbol rather than the number, so the behavioural
// change reaches them without a single edit to a threshold. The
// duration is now imported from the config module directly, so a future
// change to the component's re-export cannot silently decouple the
// tests from the value the button actually uses. What is NOT changed:
// the two claims above, which are about mechanics and not milliseconds.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { i18n } from './setup';
import { EmergencyButton } from '../components/safety/EmergencyButton';
import { SOS_HOLD_MS as HOLD_MS, SOS_HOLD_MS_DEFAULT } from '../config/sos';

const STRINGS = {
  emergency: {
    button: 'EMERGENCY',
    label: 'Emergency',
    confirm: 'Send alert',
    confirmTitle: 'Emergency alert',
    confirmMessage: 'Send an emergency alert to your contacts and Bimoto?',
    holdHint: 'Press and hold. Keyboard users press Enter.',
  },
  common: { cancel: 'Cancel' },
};

const onTrigger = vi.fn();

beforeEach(async () => {
  vi.useFakeTimers();
  i18n.addResourceBundle('en', 'translation', STRINGS, true, true);
  await i18n.changeLanguage('en');
  onTrigger.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

function button(): HTMLElement {
  return screen.getByRole('button', { name: 'EMERGENCY' });
}

function confirmShown(): boolean {
  return screen.queryByText('Send an emergency alert to your contacts and Bimoto?') !== null;
}

function hold(ms: number): void {
  fireEvent.pointerDown(button());
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('a tap is not an alert', () => {
  test('press and release before the hold completes opens nothing', () => {
    render(<EmergencyButton onTriggerEmergency={onTrigger} />);
    hold(HOLD_MS - 50);
    fireEvent.pointerUp(button());
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });

    expect(confirmShown()).toBe(false);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  test('a plain click opens nothing', () => {
    render(<EmergencyButton onTriggerEmergency={onTrigger} />);
    fireEvent.click(button());
    act(() => {
      vi.advanceTimersByTime(HOLD_MS * 3);
    });
    expect(confirmShown()).toBe(false);
  });

  test('a finger that slides off the button cancels', () => {
    render(<EmergencyButton onTriggerEmergency={onTrigger} />);
    hold(HOLD_MS - 100);
    fireEvent.pointerLeave(button());
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    expect(confirmShown()).toBe(false);
  });

  test('an interrupted press (a call, a gesture) cancels', () => {
    render(<EmergencyButton onTriggerEmergency={onTrigger} />);
    hold(HOLD_MS - 100);
    fireEvent.pointerCancel(button());
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    expect(confirmShown()).toBe(false);
  });

  test('cancelling is silent — nothing at all is rendered about it', () => {
    render(<EmergencyButton onTriggerEmergency={onTrigger} />);
    hold(100);
    fireEvent.pointerUp(button());
    // No dialog, no status region, no toast. The only thing on screen is
    // the button and its hidden hint.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('a held press asks, and only then', () => {
  test('the confirm appears after the full hold', () => {
    render(<EmergencyButton onTriggerEmergency={onTrigger} />);
    hold(HOLD_MS);
    expect(confirmShown()).toBe(true);
    // Still nothing fired: the confirm is a question, not the alert.
    expect(onTrigger).not.toHaveBeenCalled();
  });

  test('confirming after the hold is what fires', () => {
    render(<EmergencyButton onTriggerEmergency={onTrigger} />);
    hold(HOLD_MS);
    fireEvent.click(screen.getByText('Send alert'));
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  test('cancelling the confirm after a full hold fires nothing', () => {
    render(<EmergencyButton onTriggerEmergency={onTrigger} />);
    hold(HOLD_MS);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onTrigger).not.toHaveBeenCalled();
    expect(confirmShown()).toBe(false);
  });

  test('the ring shows the commitment while the press is held', () => {
    render(<EmergencyButton onTriggerEmergency={onTrigger} />);
    expect(button()).toHaveAttribute('data-holding', 'false');
    fireEvent.pointerDown(button());
    expect(button()).toHaveAttribute('data-holding', 'true');
    fireEvent.pointerUp(button());
    expect(button()).toHaveAttribute('data-holding', 'false');
  });

  test('the ring sweep is dropped under reduced motion, the ring is not', () => {
    render(<EmergencyButton onTriggerEmergency={onTrigger} />);
    const ring = screen.getByTestId('emergency-hold-ring');
    expect(ring.getAttribute('class')).toContain('motion-reduce:transition-none');
    expect(ring.getAttribute('style')).toContain(`${HOLD_MS}ms`);
  });

  test('a screen that unmounts mid-hold does not fire from nowhere', () => {
    const { unmount } = render(<EmergencyButton onTriggerEmergency={onTrigger} />);
    fireEvent.pointerDown(button());
    unmount();
    act(() => {
      vi.advanceTimersByTime(HOLD_MS * 2);
    });
    expect(onTrigger).not.toHaveBeenCalled();
  });

  // QUEUE-UNITY G4 — the founder decision, asserted so it cannot drift
  // back by accident. Named explicitly because it IS a behavioural
  // change: a press that fired at 700 ms yesterday does not today.
  test('the hold is 1000 ms by default, and the component uses that value', async () => {
    expect(SOS_HOLD_MS_DEFAULT).toBe(1000);
    expect(HOLD_MS).toBe(1000);

    const { HOLD_MS: reexported } = await import('../components/safety/EmergencyButton');
    expect(reexported).toBe(HOLD_MS);

    render(<EmergencyButton onTriggerEmergency={onTrigger} />);
    // 999 ms of contact is still not a press.
    hold(999);
    expect(onTrigger).not.toHaveBeenCalled();
    expect(screen.queryByText('Send alert')).not.toBeInTheDocument();
  });
});

describe('holding is a pointer refinement, never a requirement', () => {
  test('Enter opens the confirm on the first press, with no hold at all', () => {
    render(<EmergencyButton onTriggerEmergency={onTrigger} />);
    fireEvent.keyDown(button(), { key: 'Enter' });
    expect(confirmShown()).toBe(true);
  });

  test('Space does the same', () => {
    render(<EmergencyButton onTriggerEmergency={onTrigger} />);
    fireEvent.keyDown(button(), { key: ' ' });
    expect(confirmShown()).toBe(true);
  });

  test('holding Space down does not re-open the dialog', () => {
    render(<EmergencyButton onTriggerEmergency={onTrigger} />);
    fireEvent.keyDown(button(), { key: ' ' });
    fireEvent.keyDown(button(), { key: ' ', repeat: true });
    expect(screen.getAllByText('Send an emergency alert to your contacts and Bimoto?')).toHaveLength(
      1,
    );
  });

  test('another key does nothing', () => {
    render(<EmergencyButton onTriggerEmergency={onTrigger} />);
    fireEvent.keyDown(button(), { key: 'a' });
    expect(confirmShown()).toBe(false);
  });

  test('the button tells assistive tech both ways in', () => {
    render(<EmergencyButton onTriggerEmergency={onTrigger} />);
    const hint = button().getAttribute('aria-describedby');
    expect(hint).toBe('emergency-hold-hint');
    expect(document.getElementById('emergency-hold-hint')?.textContent).toContain('Enter');
  });
});
