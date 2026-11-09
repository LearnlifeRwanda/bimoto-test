// D17 G6 — watch mode observes and never blocks.
//
// The whole ruling is "give each its natural call site, observe-only, no
// user-visible effect". So what is tested is not that the alarms are
// clever — it is that they cannot hurt anything: the request succeeds
// whether they flag, whether they are silent, and whether they blow up.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { count: jest.fn() },
    nameMismatchLog: { create: jest.fn() },
  },
}));

// The flag STORE is mocked, not the amlFlag table: recordFlag runs a
// dedupe lock inside a transaction, and reproducing that here would be
// testing flag-store rather than the watch-mode wiring. What matters is
// what observeVelocity ASKS FOR, and that a failure to record it cannot
// escape into the request path.
jest.mock('../services/aml/flag-store', () => ({
  recordFlag: jest.fn(),
}));

import prisma from '../prisma';
import { recordFlag } from '../services/aml/flag-store';
import { observeVelocity } from '../services/aml/limits';
import { recordNameMismatchIfDifferent } from '../services/payment/name-match';

const p = prisma as any;
const flagMock = recordFlag as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  flagMock.mockResolvedValue({ flagId: 'f1', merged: false });
  p.nameMismatchLog.create.mockResolvedValue({ id: 'n1' });
});

describe('observeVelocity — flags without blocking', () => {
  test('an ordinary customer produces no flag and no throw', async () => {
    p.journey.count.mockResolvedValue(1);
    await expect(observeVelocity('u1')).resolves.toBeUndefined();
    expect(flagMock).not.toHaveBeenCalled();
  });

  test('above the threshold it writes a MEDIUM flag — and STILL does not throw', async () => {
    // The name says "assert". The function does not assert, and this is
    // the test that says so out loud: the booking goes through.
    p.journey.count.mockResolvedValue(999);
    await expect(observeVelocity('u1')).resolves.toBeUndefined();

    expect(flagMock).toHaveBeenCalled();
    const data = flagMock.mock.calls[0][0];
    expect(data.severity).toBe('MEDIUM');
    expect(data.type).toBe('VELOCITY_EXCEEDED');
    // The first observed log line: the count and the threshold it beat.
    expect(data.metadata.hourlyCount).toBe(999);
    expect(data.metadata.threshold).toBeGreaterThan(0);
  });

  test('a DB failure while flagging is swallowed — the alarm cannot become a DoS', async () => {
    p.journey.count.mockResolvedValue(999);
    flagMock.mockRejectedValue(new Error('db down'));
    await expect(observeVelocity('u1')).resolves.toBeUndefined();
  });
});

describe('recordNameMismatchIfDifferent — writes its row, never throws', () => {
  const base = {
    escrowId: 'e1',
    customerId: 'c1',
    txRef: 'tx-1',
  };

  test('a matching name writes nothing', async () => {
    const r = await recordNameMismatchIfDifferent({
      ...base,
      walletNameOnReceipt: 'Jean Bosco',
      accountName: 'jean bosco',
    });
    expect(r.matched).toBe(true);
    expect(p.nameMismatchLog.create).not.toHaveBeenCalled();
  });

  test('a near-miss is tolerated — a typo is not a finding', async () => {
    const r = await recordNameMismatchIfDifferent({
      ...base,
      walletNameOnReceipt: 'Jean Bosko',
      accountName: 'Jean Bosco',
    });
    expect(r.matched).toBe(true);
  });

  test('a genuinely different name writes the row', async () => {
    const r = await recordNameMismatchIfDifferent({
      ...base,
      walletNameOnReceipt: 'Alice Uwase',
      accountName: 'Jean Bosco',
    });
    expect(r.matched).toBe(false);
    // The first observed log line: both names and the tx that carried them.
    expect(p.nameMismatchLog.create.mock.calls[0][0].data).toMatchObject({
      escrowId: 'e1',
      customerId: 'c1',
      walletNameOnReceipt: 'Alice Uwase',
      accountName: 'Jean Bosco',
      txRef: 'tx-1',
    });
  });

  test('a missing wallet name is not a mismatch — the gateway simply did not say', async () => {
    for (const wallet of [null, undefined, '']) {
      const r = await recordNameMismatchIfDifferent({
        ...base,
        walletNameOnReceipt: wallet,
        accountName: 'Jean Bosco',
      });
      expect(r.matched).toBe(true);
    }
    expect(p.nameMismatchLog.create).not.toHaveBeenCalled();
  });

  test('a failing write is swallowed — the charge must not care', async () => {
    p.nameMismatchLog.create.mockRejectedValue(new Error('db down'));
    await expect(
      recordNameMismatchIfDifferent({
        ...base,
        walletNameOnReceipt: 'Alice Uwase',
        accountName: 'Jean Bosco',
      }),
    ).resolves.toMatchObject({ matched: false });
  });
});
