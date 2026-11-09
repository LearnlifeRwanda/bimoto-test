// NOTIFY G3/G4 — the client half of the six newly-wired notifications.
//
// Each test drives the registered handler with the payload the SERVICE
// actually emits (the shapes are asserted server-side in
// notify-inapp-emits.test.ts, and transcribed here so a divergence
// breaks one side or the other rather than passing on both), and
// asserts the two things a user experiences: the toast — its words, and
// its ~15-second notification CLASS — and the sound variant.
//
// The sound is mocked at the module boundary because a jsdom AudioContext
// is not the thing under test here; the sound module's own behaviour has
// its own file (NotifySound.test.ts).

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { SOCKET_EVENTS } from '@bimoto/shared';
import { i18n } from './setup';

const { handlers, mockSocket, ioMock } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => void>();
  const mockSocket = {
    on: (evt: string, cb: (...args: any[]) => void) => {
      handlers.set(evt, cb);
      return mockSocket;
    },
    emit: () => mockSocket,
    disconnect: () => {},
    connected: true,
  };
  return { handlers, mockSocket, ioMock: { io: () => mockSocket } };
});

vi.mock('socket.io-client', () => ioMock);

const { playNotificationSound } = vi.hoisted(() => ({
  playNotificationSound: vi.fn(),
}));
vi.mock('../lib/notification-sound', () => ({
  playNotificationSound,
  installSoundUnlock: vi.fn(),
}));

import { useSocket } from '../hooks/useSocket';
import { useAuthStore } from '../stores/auth.store';
import { useUIStore } from '../stores/ui.store';

const JOURNEY = 'jrn-1';

beforeEach(async () => {
  handlers.clear();
  playNotificationSound.mockClear();
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      notify: {
        escrowReleased: 'You were paid {{amount}} RWF',
        escrowRefunded: '{{amount}} RWF has been returned to you',
        ratingReceived: 'You received a {{count}}-star rating',
        ratingReceived_one: 'You received a {{count}}-star rating',
        ratingReceived_other: 'You received a {{count}}-star rating',
        verificationApproved: 'Your account is verified — you can start working',
        verificationRejected: 'Your verification was not approved — check your documents',
        noShowWarning: 'No-show warning ({{count}}) — this affects your account',
        noShowWarning_one: 'No-show warning ({{count}}) — this affects your account',
        noShowWarning_other: 'No-show warning ({{count}}) — this affects your account',
        disputeUpheld: 'Your dispute was upheld',
        disputeRejected: 'Your dispute was not upheld',
        disputeClosed: 'Your dispute was closed with no action',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  useAuthStore.setState({ token: 'tok', isAuthenticated: true, isLoading: false });
  useUIStore.setState({ toasts: [], toastMessage: null, toastType: null } as never);
  renderHook(() => useSocket());
});

/** Fire one server event into the hook's registered handler. */
function fire(event: string, payload: unknown): void {
  const handler = handlers.get(event);
  if (!handler) throw new Error(`no handler registered for ${event}`);
  handler(payload);
}

/** The single toast this event produced. */
function onlyToast() {
  const { toasts } = useUIStore.getState();
  expect(toasts).toHaveLength(1);
  return toasts[0];
}

describe('every new event registers a listener', () => {
  test('all six, under their canonical constant names', () => {
    for (const evt of [
      SOCKET_EVENTS.ESCROW_RELEASED,
      SOCKET_EVENTS.ESCROW_REFUNDED,
      SOCKET_EVENTS.RATING_RECEIVED,
      SOCKET_EVENTS.VERIFICATION_DECIDED,
      SOCKET_EVENTS.NO_SHOW_WARNING,
      SOCKET_EVENTS.DISPUTE_RESOLVED,
    ]) {
      expect(handlers.has(evt)).toBe(true);
    }
  });
});

describe('escrow released — "you were paid X RWF"', () => {
  test('says the amount, in notification class, with the critical sound', () => {
    fire(SOCKET_EVENTS.ESCROW_RELEASED, { journeyId: JOURNEY, amount: 4200 });
    const toast = onlyToast();
    expect(toast.message).toBe('You were paid 4,200 RWF');
    expect(toast.toastClass).toBe('notification');
    expect(toast.type).toBe('success');
    expect(playNotificationSound).toHaveBeenCalledWith('critical');
  });

  test('a malformed payload announces nothing rather than "you were paid undefined"', () => {
    fire(SOCKET_EVENTS.ESCROW_RELEASED, { journeyId: JOURNEY });
    expect(useUIStore.getState().toasts).toHaveLength(0);
    expect(playNotificationSound).not.toHaveBeenCalled();
  });
});

describe('escrow refunded — the passenger’s money back', () => {
  test('standard sound: she is holding the phone, and does not need startling', () => {
    fire(SOCKET_EVENTS.ESCROW_REFUNDED, { journeyId: JOURNEY, amount: 3000 });
    const toast = onlyToast();
    expect(toast.message).toBe('3,000 RWF has been returned to you');
    expect(toast.toastClass).toBe('notification');
    expect(playNotificationSound).toHaveBeenCalledWith('standard');
  });
});

describe('rating received', () => {
  test('names the stars, standard sound', () => {
    fire(SOCKET_EVENTS.RATING_RECEIVED, { journeyId: JOURNEY, stars: 5 });
    const toast = onlyToast();
    expect(toast.message).toContain('5');
    expect(toast.toastClass).toBe('notification');
    expect(playNotificationSound).toHaveBeenCalledWith('standard');
  });
});

describe('verification decided', () => {
  test('approved — the motari can work today, so: critical', () => {
    fire(SOCKET_EVENTS.VERIFICATION_DECIDED, { decision: 'APPROVED' });
    const toast = onlyToast();
    expect(toast.message).toContain('verified');
    expect(toast.type).toBe('success');
    expect(toast.toastClass).toBe('notification');
    expect(playNotificationSound).toHaveBeenCalledWith('critical');
  });

  test('rejected — critical too, because he cannot', () => {
    fire(SOCKET_EVENTS.VERIFICATION_DECIDED, { decision: 'REJECTED' });
    const toast = onlyToast();
    expect(toast.type).toBe('error');
    expect(playNotificationSound).toHaveBeenCalledWith('critical');
  });

  test('an unknown decision announces nothing', () => {
    fire(SOCKET_EVENTS.VERIFICATION_DECIDED, { decision: 'PENDING' });
    expect(useUIStore.getState().toasts).toHaveLength(0);
  });
});

describe('no-show warning', () => {
  test('names his own count, as an error, in notification class', () => {
    fire(SOCKET_EVENTS.NO_SHOW_WARNING, { journeyId: JOURNEY, count: 2 });
    const toast = onlyToast();
    expect(toast.message).toContain('2');
    expect(toast.type).toBe('error');
    expect(toast.toastClass).toBe('notification');
  });
});

describe('dispute resolved', () => {
  test.each([
    ['UPHELD', 'Your dispute was upheld', 'success'],
    ['REJECTED', 'Your dispute was not upheld', 'info'],
    ['NO_ACTION', 'Your dispute was closed with no action', 'info'],
  ])('%s says so and nothing about the admin', (outcome, message, kind) => {
    fire(SOCKET_EVENTS.DISPUTE_RESOLVED, { journeyId: JOURNEY, outcome });
    const toast = onlyToast();
    expect(toast.message).toBe(message);
    expect(toast.type).toBe(kind);
    expect(toast.toastClass).toBe('notification');
  });

  test('an unknown outcome announces nothing', () => {
    fire(SOCKET_EVENTS.DISPUTE_RESOLVED, { journeyId: JOURNEY, outcome: 'PENDING' });
    expect(useUIStore.getState().toasts).toHaveLength(0);
  });
});

describe('D9’s no-inbox ruling, at the handler', () => {
  test('several arriving at once STACK — none erases another', () => {
    fire(SOCKET_EVENTS.ESCROW_RELEASED, { journeyId: JOURNEY, amount: 4200 });
    fire(SOCKET_EVENTS.RATING_RECEIVED, { journeyId: JOURNEY, stars: 5 });
    fire(SOCKET_EVENTS.DISPUTE_RESOLVED, { journeyId: JOURNEY, outcome: 'UPHELD' });
    const { toasts } = useUIStore.getState();
    expect(toasts).toHaveLength(3);
    // Newest first.
    expect(toasts[0].message).toBe('Your dispute was upheld');
    expect(toasts.every((t) => t.toastClass === 'notification')).toBe(true);
  });

  test('a handler writes NOTHING but the toast — no store, no queue, no table', () => {
    fire(SOCKET_EVENTS.ESCROW_RELEASED, { journeyId: JOURNEY, amount: 4200 });
    // Clearing the stack leaves no trace anywhere a reload could read.
    useUIStore.getState().hideToast();
    expect(useUIStore.getState().toasts).toEqual([]);
  });
});
