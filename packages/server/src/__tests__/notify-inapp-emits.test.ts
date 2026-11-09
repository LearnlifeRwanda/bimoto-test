// NOTIFY G3 — the in-app half, at the service boundary.
//
// WHAT THIS FILE IS DEFENDING. The census run for this dispatch found
// that all 23 notify* helpers composed push and ONLY push, and that
// push has no APNS/FCM credentials (Barack, 24 Aug). So every helper
// here "worked" — it built a payload, found no registered device, and
// returned — while the person it was about was told nothing at all.
//
// These tests assert the socket leg that closes that: the right event,
// on the right person's room, carrying the right fields and no others.
//
// THE PRIVACY ASSERTIONS ARE THE POINT, not decoration. emitToUser is
// the only delivery any of these may use, because a journey room holds
// two people and a broadcast holds everyone; and each payload is
// asserted by EXACT SHAPE, so a future field added upstream cannot ride
// out to a phone without this file failing first.

jest.mock('../socket', () => ({
  __esModule: true,
  emitToUser: jest.fn(),
  emitToJourney: jest.fn(),
  emitToAdmins: jest.fn(),
}));

jest.mock('../services/push', () => ({
  __esModule: true,
  sendPushToUser: jest.fn().mockResolvedValue([]),
  buildPushPayload: jest.fn().mockReturnValue({ title: 't', body: 'b' }),
  getUserLanguage: jest.fn().mockResolvedValue('rw'),
}));

jest.mock('../prisma', () => ({
  __esModule: true,
  default: { user: { findUnique: jest.fn().mockResolvedValue(null) } },
}));

import { SOCKET_EVENTS } from '@bimoto/shared';
import { emitToUser, emitToJourney, emitToAdmins } from '../socket';
import {
  notifyEscrowReleased,
  notifyEscrowRefunded,
  notifyRatingReceived,
  notifyDriverNoShowWarning,
  notifyDriverVerificationApproved,
  notifyDriverVerificationRejected,
  notifyDriverDisputeUpheld,
  notifyDriverDisputeRejected,
  notifyDriverDisputeClosedNoAction,
  notifyDriverAccountFlagged,
  notifyDriverAccountSuspended,
} from '../services/notification.service';

const emit = emitToUser as jest.Mock;
const DRIVER = 'usr-driver-1';
const CUSTOMER = 'usr-customer-1';
const JOURNEY = 'jrn-1';

let logSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
});

/** The single call this helper made, as [userId, event, payload]. */
function onlyEmit(): [string, string, Record<string, unknown>] {
  expect(emit).toHaveBeenCalledTimes(1);
  return emit.mock.calls[0] as [string, string, Record<string, unknown>];
}

describe('escrow released — the one a motari has never been told', () => {
  test('emits to the DRIVER’s room with the journey and the amount, and nothing else', () => {
    notifyEscrowReleased(DRIVER, JOURNEY, 4200);
    const [userId, event, payload] = onlyEmit();
    expect(userId).toBe(DRIVER);
    expect(event).toBe(SOCKET_EVENTS.ESCROW_RELEASED);
    // EXACT shape: no phone, no name, no plate, no coordinates.
    expect(payload).toEqual({ journeyId: JOURNEY, amount: 4200 });
  });

  test('reaches ONE named user’s room — never a journey room, never a broadcast', () => {
    notifyEscrowReleased(DRIVER, JOURNEY, 4200);
    expect(emitToJourney).not.toHaveBeenCalled();
    expect(emitToAdmins).not.toHaveBeenCalled();
  });
});

describe('escrow refunded', () => {
  test('emits to the CUSTOMER’s room with journey and amount only', () => {
    notifyEscrowRefunded(CUSTOMER, JOURNEY, 3000);
    const [userId, event, payload] = onlyEmit();
    expect(userId).toBe(CUSTOMER);
    expect(event).toBe(SOCKET_EVENTS.ESCROW_REFUNDED);
    expect(payload).toEqual({ journeyId: JOURNEY, amount: 3000 });
    expect(emitToJourney).not.toHaveBeenCalled();
  });
});

describe('rating received', () => {
  test('carries the stars and NOT the comment, the reason, or the rater', () => {
    notifyRatingReceived(DRIVER, JOURNEY, 5);
    const [userId, event, payload] = onlyEmit();
    expect(userId).toBe(DRIVER);
    expect(event).toBe(SOCKET_EVENTS.RATING_RECEIVED);
    expect(payload).toEqual({ journeyId: JOURNEY, stars: 5 });
    expect(Object.keys(payload)).not.toContain('comment');
    expect(Object.keys(payload)).not.toContain('raterId');
  });
});

describe('verification decided', () => {
  test('approved emits the decision to the driver alone', () => {
    notifyDriverVerificationApproved(DRIVER);
    const [userId, event, payload] = onlyEmit();
    expect(userId).toBe(DRIVER);
    expect(event).toBe(SOCKET_EVENTS.VERIFICATION_DECIDED);
    expect(payload).toEqual({ decision: 'APPROVED' });
  });

  test('rejected does NOT put the admin’s reason on the wire', () => {
    notifyDriverVerificationRejected(DRIVER, 'licence photo unreadable, suspected forgery');
    const [, event, payload] = onlyEmit();
    expect(event).toBe(SOCKET_EVENTS.VERIFICATION_DECIDED);
    expect(payload).toEqual({ decision: 'REJECTED' });
    // The reason reaches him by SMS and push, addressed to him — never
    // as a toast on whatever screen he is standing on.
    expect(JSON.stringify(payload)).not.toContain('forgery');
  });
});

describe('no-show warning', () => {
  test('tells the driver his own running count', () => {
    notifyDriverNoShowWarning(DRIVER, JOURNEY, 2);
    const [userId, event, payload] = onlyEmit();
    expect(userId).toBe(DRIVER);
    expect(event).toBe(SOCKET_EVENTS.NO_SHOW_WARNING);
    expect(payload).toEqual({ journeyId: JOURNEY, count: 2 });
  });
});

describe('dispute resolved', () => {
  test.each([
    [notifyDriverDisputeUpheld, 'UPHELD'],
    [notifyDriverDisputeRejected, 'REJECTED'],
    [notifyDriverDisputeClosedNoAction, 'NO_ACTION'],
  ])('%p emits the outcome and no admin note', (fn, outcome) => {
    (fn as (d: string, j: string) => void)(DRIVER, JOURNEY);
    const [userId, event, payload] = onlyEmit();
    expect(userId).toBe(DRIVER);
    expect(event).toBe(SOCKET_EVENTS.DISPUTE_RESOLVED);
    expect(payload).toEqual({ journeyId: JOURNEY, outcome });
  });
});

describe('§0.7 — the two exclusions stay excluded', () => {
  // #194 Item 2 dropped errors.accountFlagged deliberately, and the
  // D19/AML no-tipping-off posture is why. Telling a person under
  // review that they are under review is the thing that posture exists
  // to prevent, so this helper emits NOTHING and this test is what
  // stops a later dispatch wiring it by reflex.
  test('account FLAGGED emits no socket event at all', () => {
    notifyDriverAccountFlagged(DRIVER, JOURNEY);
    expect(emit).not.toHaveBeenCalled();
    expect(emitToJourney).not.toHaveBeenCalled();
    expect(emitToAdmins).not.toHaveBeenCalled();
  });

  test('account SUSPENDED emits no socket event either — it neighbours the flag posture', () => {
    notifyDriverAccountSuspended(DRIVER, JOURNEY, new Date('2026-09-01T00:00:00Z'));
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('never throws — a dead socket cannot fail money that already moved', () => {
  test('an emitToUser that throws is swallowed, and push still fires', () => {
    emit.mockImplementationOnce(() => {
      throw new Error('socket.io not initialized');
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => notifyEscrowReleased(DRIVER, JOURNEY, 4200)).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
