import { getPreferenceChangeAnomalyVerdict } from '../services/payout/preferences/anomaly-check';

beforeEach(() => {
  delete process.env.ANOMALY_PAYOUT_THRESHOLD;
});

afterAll(() => {
  delete process.env.ANOMALY_PAYOUT_THRESHOLD;
});

describe('getPreferenceChangeAnomalyVerdict', () => {
  test('small balance returns allowAuto=true', async () => {
    const v = await getPreferenceChangeAnomalyVerdict({ userId: 'u1', pendingBalance: 5000 });
    expect(v.allowAuto).toBe(true);
    expect(v.thresholdRwf).toBe(50_000);
  });

  test('balance > threshold blocks auto payout (>50K RWF default)', async () => {
    const v = await getPreferenceChangeAnomalyVerdict({
      userId: 'u1',
      pendingBalance: 60_000,
    });
    expect(v.allowAuto).toBe(false);
    expect(v.reason).toBe('EXCEEDS_THRESHOLD');
  });

  test('balance == threshold (50K) is allowed (strict greater-than)', async () => {
    const v = await getPreferenceChangeAnomalyVerdict({
      userId: 'u1',
      pendingBalance: 50_000,
    });
    expect(v.allowAuto).toBe(true);
  });

  test('honors ANOMALY_PAYOUT_THRESHOLD env override', async () => {
    process.env.ANOMALY_PAYOUT_THRESHOLD = '10000';
    const v = await getPreferenceChangeAnomalyVerdict({
      userId: 'u1',
      pendingBalance: 12_000,
    });
    expect(v.allowAuto).toBe(false);
    expect(v.thresholdRwf).toBe(10_000);
  });

  test('falls back to default on garbage env override', async () => {
    process.env.ANOMALY_PAYOUT_THRESHOLD = 'not-a-number';
    const v = await getPreferenceChangeAnomalyVerdict({
      userId: 'u1',
      pendingBalance: 60_000,
    });
    expect(v.thresholdRwf).toBe(50_000);
    expect(v.allowAuto).toBe(false);
  });
});
