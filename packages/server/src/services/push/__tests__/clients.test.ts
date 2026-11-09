import { sendFcm, resetFcmClientForTests } from '../fcm-client';
import { sendApns, resetApnsClientForTests } from '../apns-client';
import type { PushPayload } from '../types';

const payload: PushPayload = { title: 't', body: 'b', data: { type: 'bid' } };

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  resetFcmClientForTests();
  resetApnsClientForTests();
  // Strip provider env so each test starts clean.
  delete process.env.FCM_SERVICE_ACCOUNT_JSON;
  delete process.env.APNS_TEAM_ID;
  delete process.env.APNS_KEY_ID;
  delete process.env.APNS_BUNDLE_ID;
  delete process.env.APNS_PRIVATE_KEY;
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('sendFcm — config fallback', () => {
  test('returns auth-failed PushError when FCM_SERVICE_ACCOUNT_JSON is unset', async () => {
    const r = await sendFcm('any-token', payload);
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('auth-failed');
    expect(r.error?.providerReason).toBe('fcm-not-configured');
  });

  test('returns auth-failed when FCM_SERVICE_ACCOUNT_JSON is invalid JSON', async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = '{not-valid-json';
    const r = await sendFcm('any-token', payload);
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('auth-failed');
  });
});

describe('sendApns — config fallback', () => {
  test('returns auth-failed PushError when env is unset', async () => {
    const r = await sendApns('any-token', payload);
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('auth-failed');
    expect(r.error?.providerReason).toBe('apns-not-configured');
  });

  test('returns auth-failed when only some env vars are set', async () => {
    process.env.APNS_TEAM_ID = 'team';
    process.env.APNS_KEY_ID = 'key';
    // bundle + private-key intentionally missing
    const r = await sendApns('any-token', payload);
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('auth-failed');
  });
});
