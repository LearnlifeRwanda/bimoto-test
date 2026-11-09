jest.mock('../jobs/reconciliation/gateway-query', () => ({
  queryFlutterwaveTransactions: jest.fn(),
}));

jest.mock('../jobs/reconciliation/ledger-diff', () => ({
  diffGatewayVsLedger: jest.fn(),
}));

jest.mock('../jobs/reconciliation/alert', () => ({
  alertOnDrift: jest.fn().mockResolvedValue(undefined),
}));

import { queryFlutterwaveTransactions } from '../jobs/reconciliation/gateway-query';
import { diffGatewayVsLedger } from '../jobs/reconciliation/ledger-diff';
import { alertOnDrift } from '../jobs/reconciliation/alert';
import { runReconciliationOnce } from '../jobs/reconciliation.job';
import { FlutterwaveError } from '../services/payment';

const query = queryFlutterwaveTransactions as jest.Mock;
const diff = diffGatewayVsLedger as jest.Mock;
const alert = alertOnDrift as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('runReconciliationOnce', () => {
  test('queries 24h window, diffs, alerts', async () => {
    query.mockResolvedValue([{ tx_ref: 'r1', amount: 1, status: 'successful', created_at: '' }]);
    diff.mockResolvedValue({
      matches: 1,
      missingFromLedger: [],
      missingFromGateway: [],
      statusMismatch: [],
    });
    const now = new Date('2026-05-04T12:00:00Z');
    await runReconciliationOnce(now);
    expect(query).toHaveBeenCalledTimes(1);
    const queryArg = query.mock.calls[0][0];
    expect(queryArg.to.toISOString()).toBe(now.toISOString());
    expect(queryArg.from.getTime()).toBe(now.getTime() - 24 * 60 * 60 * 1000);
    expect(diff).toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
  });

  test('NO_KEYS_CONFIGURED is silently skipped', async () => {
    query.mockRejectedValue(new FlutterwaveError('NO_KEYS_CONFIGURED'));
    await expect(runReconciliationOnce()).resolves.toBeUndefined();
    expect(diff).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  test('other gateway errors propagate (visible to caller)', async () => {
    query.mockRejectedValue(new FlutterwaveError('GATEWAY_DOWN', { retryable: true }));
    await expect(runReconciliationOnce()).rejects.toBeInstanceOf(FlutterwaveError);
  });
});
