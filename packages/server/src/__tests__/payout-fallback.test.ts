jest.mock('../services/payout.service', () => ({
  getPendingPastFallback: jest.fn(),
  firePreferenceChangeBatch: jest.fn(),
}));

jest.mock('@sentry/node', () => ({
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
}));

import {
  getPendingPastFallback,
  firePreferenceChangeBatch,
} from '../services/payout.service';
import * as Sentry from '@sentry/node';
import { runFallbackPayoutOnce } from '../jobs/payout-fallback.job';

const stale = getPendingPastFallback as jest.Mock;
const fire = firePreferenceChangeBatch as jest.Mock;
const breadcrumb = (Sentry as any).addBreadcrumb as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SENTRY_DSN = 'https://example.invalid/sentry';
});

afterAll(() => {
  delete process.env.SENTRY_DSN;
});

describe('runFallbackPayoutOnce', () => {
  test('catches stale balances >24h', async () => {
    stale.mockResolvedValue([{ driverId: 'd1', amount: 7000 }]);
    fire.mockResolvedValue({ batchId: 'b-1', amount: 7000 });
    await runFallbackPayoutOnce();
    expect(stale).toHaveBeenCalledWith(24);
    expect(fire).toHaveBeenCalledWith('d1', 'FALLBACK_24H');
  });

  test('no-op when no stale balances', async () => {
    stale.mockResolvedValue([]);
    await runFallbackPayoutOnce();
    expect(fire).not.toHaveBeenCalled();
  });

  test('emits Sentry breadcrumb on every fire (ops visibility)', async () => {
    stale.mockResolvedValue([
      { driverId: 'd1', amount: 7000 },
      { driverId: 'd2', amount: 9000 },
    ]);
    fire.mockResolvedValue({ batchId: 'b', amount: 1 });
    await runFallbackPayoutOnce();
    expect(breadcrumb).toHaveBeenCalledTimes(2);
  });

  test('one driver failure does not block siblings', async () => {
    stale.mockResolvedValue([
      { driverId: 'd1', amount: 7000 },
      { driverId: 'd2', amount: 9000 },
    ]);
    fire
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ batchId: 'b-2', amount: 9000 });
    await runFallbackPayoutOnce();
    expect(fire).toHaveBeenCalledTimes(2);
  });

  test('skips drivers with 0 balance (filtered out by getPendingPastFallback)', async () => {
    stale.mockResolvedValue([]);
    await runFallbackPayoutOnce();
    expect(fire).not.toHaveBeenCalled();
  });
});
