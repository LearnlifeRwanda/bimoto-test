jest.mock('../services/sms.service', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import { sendSms } from '../services/sms.service';
import * as Sentry from '@sentry/node';
import { alertOnDrift } from '../jobs/reconciliation/alert';

const sms = sendSms as jest.Mock;
const cap = (Sentry as any).captureMessage as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SENTRY_DSN = 'https://example.invalid';
  process.env.ADMIN_ALERT_PHONE = '+250788000000';
});

afterAll(() => {
  delete process.env.SENTRY_DSN;
  delete process.env.ADMIN_ALERT_PHONE;
});

describe('alertOnDrift', () => {
  test('no-op when zero drift', async () => {
    await alertOnDrift({
      matches: 5,
      missingFromLedger: [],
      missingFromGateway: [],
      statusMismatch: [],
    });
    expect(cap).not.toHaveBeenCalled();
    expect(sms).not.toHaveBeenCalled();
  });

  test('captures Sentry warning + SMS when drift detected', async () => {
    await alertOnDrift({
      matches: 0,
      missingFromLedger: [{ txRef: 'r1', amount: 100, status: 'successful' }],
      missingFromGateway: [],
      statusMismatch: [],
    });
    expect(cap).toHaveBeenCalledTimes(1);
    expect(cap.mock.calls[0][0]).toMatch(/missingLedger=1/);
    expect(sms).toHaveBeenCalledTimes(1);
    expect(sms.mock.calls[0][0]).toBe('+250788000000');
  });

  test('SMS errors do not throw (best-effort alerting)', async () => {
    sms.mockRejectedValueOnce(new Error('SMS down'));
    await expect(
      alertOnDrift({
        matches: 0,
        missingFromLedger: [],
        missingFromGateway: [{ txRef: 'r1', amount: 1, ledgerStatus: 'HELD', escrowId: 'e1' }],
        statusMismatch: [],
      }),
    ).resolves.toBeUndefined();
  });

  test('skips Sentry when DSN not set', async () => {
    delete process.env.SENTRY_DSN;
    await alertOnDrift({
      matches: 0,
      missingFromLedger: [{ txRef: 'r1', amount: 1, status: 'successful' }],
      missingFromGateway: [],
      statusMismatch: [],
    });
    expect(cap).not.toHaveBeenCalled();
    expect(sms).toHaveBeenCalled();
  });

  test('skips SMS when ADMIN_ALERT_PHONE not set', async () => {
    delete process.env.ADMIN_ALERT_PHONE;
    await alertOnDrift({
      matches: 0,
      missingFromLedger: [{ txRef: 'r1', amount: 1, status: 'successful' }],
      missingFromGateway: [],
      statusMismatch: [],
    });
    expect(sms).not.toHaveBeenCalled();
  });
});
