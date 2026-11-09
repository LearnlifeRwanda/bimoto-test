jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    payoutPreferenceChangeLog: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import prisma from '../prisma';
import {
  runPreferenceChangePayoutOnce,
  _setFireImplForTests,
} from '../jobs/preference-change-payout.job';

const findManyLog = (prisma as any).payoutPreferenceChangeLog.findMany as jest.Mock;
const updateLog = (prisma as any).payoutPreferenceChangeLog.update as jest.Mock;

const NOW = new Date('2026-05-04T12:00:00.000Z');

let fireMock: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  findManyLog.mockResolvedValue([]);
  updateLog.mockResolvedValue({});
  fireMock = jest.fn().mockResolvedValue(undefined);
  _setFireImplForTests(fireMock);
});

afterAll(() => {
  _setFireImplForTests(null);
});

describe('runPreferenceChangePayoutOnce', () => {
  test('selects only unfired rows that are due — fired rows and anomaly-blocked (payoutDueAt null) rows never match', async () => {
    await runPreferenceChangePayoutOnce(NOW);
    expect(findManyLog).toHaveBeenCalledWith({
      where: {
        payoutFired: false,
        payoutDueAt: { not: null, lte: NOW },
      },
    });
  });

  test('due row fires exactly once and is marked payoutFired', async () => {
    findManyLog.mockResolvedValue([
      { id: 'log-a', userId: 'u1', payoutFired: false, payoutDueAt: new Date(NOW.getTime() - 10_000) },
    ]);

    const fired = await runPreferenceChangePayoutOnce(NOW);

    expect(fired).toBe(1);
    expect(fireMock).toHaveBeenCalledTimes(1);
    expect(fireMock).toHaveBeenCalledWith('u1');
    expect(updateLog).toHaveBeenCalledWith({
      where: { id: 'log-a' },
      data: { payoutFired: true },
    });

    // Second tick: the row is now payoutFired:true, so the scan returns
    // nothing and the payout does not fire again.
    findManyLog.mockResolvedValue([]);
    const firedAgain = await runPreferenceChangePayoutOnce(NOW);
    expect(firedAgain).toBe(0);
    expect(fireMock).toHaveBeenCalledTimes(1);
  });

  test('fires all due rows (restart inside the cooldown window recovers)', async () => {
    findManyLog.mockResolvedValue([
      { id: 'log-a', userId: 'u1', payoutFired: false, payoutDueAt: new Date(NOW.getTime() - 10_000) },
      { id: 'log-b', userId: 'u2', payoutFired: false, payoutDueAt: new Date(NOW.getTime() - 60_000) },
    ]);

    const fired = await runPreferenceChangePayoutOnce(NOW);

    expect(fired).toBe(2);
    expect(fireMock).toHaveBeenNthCalledWith(1, 'u1');
    expect(fireMock).toHaveBeenNthCalledWith(2, 'u2');
  });

  test('a failing fire leaves the row unfired (retried next tick) and does not block siblings', async () => {
    findManyLog.mockResolvedValue([
      { id: 'log-a', userId: 'u1', payoutFired: false, payoutDueAt: new Date(NOW.getTime() - 10_000) },
      { id: 'log-b', userId: 'u2', payoutFired: false, payoutDueAt: new Date(NOW.getTime() - 60_000) },
    ]);
    fireMock
      .mockRejectedValueOnce(new Error('gateway down'))
      .mockResolvedValueOnce(undefined);

    const fired = await runPreferenceChangePayoutOnce(NOW);

    expect(fired).toBe(1);
    expect(updateLog).toHaveBeenCalledTimes(1);
    expect(updateLog).toHaveBeenCalledWith({
      where: { id: 'log-b' },
      data: { payoutFired: true },
    });
  });
});
