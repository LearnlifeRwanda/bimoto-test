// MONEY-PIN G6 — the gate: which code comes back when, how long a session
// lives, and that the preference change is now proven by the PIN.

jest.mock('../services/money-pin.service', () => ({
  getMoneyPinStatus: jest.fn(),
}));

import { getMoneyPinStatus } from '../services/money-pin.service';
import {
  requireMoneyStepUp,
  openMoneyStepUp,
  closeMoneyStepUp,
  getMoneyStepUp,
  _resetMoneyStepUpForTests,
} from '../middleware/money-step-up';
import { MONEY_STEP_UP_TTL_MINUTES } from '@bimoto/shared';

const statusMock = getMoneyPinStatus as jest.Mock;

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetMoneyStepUpForTests();
});

describe('requireMoneyStepUp', () => {
  test('no PIN → the enrolment code, which is what drives the lazy block', async () => {
    statusMock.mockResolvedValue({ state: 'NOT_SET' });
    const res = mockRes();
    const next = jest.fn();
    // CUTGUARD v2 G6 (B-3) — `appVersion` is now part of the request the
    // middleware reads. This case is about a CURRENT client, which is the
    // one that has an enrollment screen to answer 428 with; the legacy
    // arm is the new behaviour and is tested beside it.
    await requireMoneyStepUp({ user: { userId: 'u1' }, appVersion: 14 } as any, res, next);

    expect(res.status).toHaveBeenCalledWith(428);
    expect(res.json.mock.calls[0][0].error.code).toBe('MONEY_PIN_ENROLLMENT_REQUIRED');
    expect(next).not.toHaveBeenCalled();
  });

  test('no PIN on a LEGACY client → through, not locked out (B-3)', async () => {
    // A v13 build has no enrollment screen. 428 made the whole earnings
    // surface a dead end for the length of the rollout — he could not see
    // his own money. The gate narrows by CLIENT: it cannot open a v14
    // hole, because this arm is only reachable when no PIN exists.
    statusMock.mockResolvedValue({ state: 'NOT_SET' });
    const res = mockRes();
    const next = jest.fn();
    await requireMoneyStepUp({ user: { userId: 'u1' }, appVersion: 13 } as any, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('PIN set, no session → the step-up code', async () => {
    statusMock.mockResolvedValue({ state: 'SET' });
    const res = mockRes();
    const next = jest.fn();
    await requireMoneyStepUp({ user: { userId: 'u1' } } as any, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].error.code).toBe('MONEY_STEP_UP_REQUIRED');
  });

  test('locked → 423 and WHEN it lifts, so the client can say so', async () => {
    const until = new Date(Date.now() + 10 * 60_000);
    statusMock.mockResolvedValue({ state: 'SET', lockedUntil: until });
    const res = mockRes();
    await requireMoneyStepUp({ user: { userId: 'u1' } } as any, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(423);
    expect(res.json.mock.calls[0][0].lockedUntil).toBe(until.toISOString());
  });

  test('a lockout outranks a missing PIN — there is nothing to enrol into', async () => {
    statusMock.mockResolvedValue({
      state: 'NOT_SET',
      lockedUntil: new Date(Date.now() + 60_000),
    });
    const res = mockRes();
    await requireMoneyStepUp({ user: { userId: 'u1' } } as any, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(423);
  });

  test('open session → passes through', async () => {
    statusMock.mockResolvedValue({ state: 'SET' });
    openMoneyStepUp('u1');
    const res = mockRes();
    const next = jest.fn();
    await requireMoneyStepUp({ user: { userId: 'u1' } } as any, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('one user\'s session does not open another\'s money', async () => {
    statusMock.mockResolvedValue({ state: 'SET' });
    openMoneyStepUp('u1');
    const res = mockRes();
    await requireMoneyStepUp({ user: { userId: 'u2' } } as any, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('PENDING_RESET still passes — the live PIN keeps working in the window', async () => {
    statusMock.mockResolvedValue({ state: 'PENDING_RESET' });
    openMoneyStepUp('u1');
    const next = jest.fn();
    await requireMoneyStepUp({ user: { userId: 'u1' } } as any, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('an unauthenticated request never reaches the PIN lookup', async () => {
    const res = mockRes();
    await requireMoneyStepUp({} as any, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(statusMock).not.toHaveBeenCalled();
  });
});

describe('the session itself', () => {
  test('expires after its TTL, without a sweeper having run', () => {
    jest.useFakeTimers();
    try {
      openMoneyStepUp('u1');
      expect(getMoneyStepUp('u1')).not.toBeNull();
      jest.advanceTimersByTime(MONEY_STEP_UP_TTL_MINUTES * 60_000 + 1);
      // Read-time expiry: nothing swept it, it simply is not live.
      expect(getMoneyStepUp('u1')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test('is DROPPED by close, not merely expired', () => {
    openMoneyStepUp('u1');
    closeMoneyStepUp('u1');
    expect(getMoneyStepUp('u1')).toBeNull();
  });

  test('carries the instant the proof was given, for the audit row', () => {
    const at = openMoneyStepUp('u1');
    expect(getMoneyStepUp('u1')!.verifiedAt).toEqual(at);
  });
});
