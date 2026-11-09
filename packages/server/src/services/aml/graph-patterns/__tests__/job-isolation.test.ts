// Acceptance test 9: pattern individual-failure-isolation. If one pattern
// throws, the other 5 must still emit findings (recordFlag must still run).

const recordFlagMock = jest.fn().mockResolvedValue({ flagId: 'x', merged: false });

jest.mock('../../flag-store', () => ({
  __esModule: true,
  recordFlag: (...args: unknown[]) => recordFlagMock(...args),
}));

jest.mock('../../../../prisma', () => ({
  __esModule: true,
  default: {},
}));

const detect = jest.fn();
jest.mock('../', () => ({
  __esModule: true,
  GRAPH_PATTERNS: [
    { name: 'COLLUSION_RING', detect: () => Promise.resolve({ patternName: 'COLLUSION_RING', flagged: [{ userId: 'u1', severity: 'HIGH', metadata: {} }], scannedNodes: 1, durationMs: 1 }) },
    { name: 'MONEY_FUNNEL', detect: () => Promise.reject(new Error('intentional')) },
    { name: 'REPUTATION_RING', detect: () => Promise.resolve({ patternName: 'REPUTATION_RING', flagged: [{ userId: 'u2', severity: 'MEDIUM', metadata: {} }], scannedNodes: 1, durationMs: 1 }) },
    { name: 'GEO_ANOMALY', detect: () => Promise.resolve({ patternName: 'GEO_ANOMALY', flagged: [{ userId: 'u3', severity: 'MEDIUM', metadata: {} }], scannedNodes: 1, durationMs: 1 }) },
    { name: 'SYNC_RATING_ATTACK', detect: () => Promise.resolve({ patternName: 'SYNC_RATING_ATTACK', flagged: [{ userId: 'u4', severity: 'HIGH', metadata: {} }], scannedNodes: 1, durationMs: 1 }) },
    { name: 'BID_CYCLE_RING', detect: () => Promise.resolve({ patternName: 'BID_CYCLE_RING', flagged: [{ userId: 'u5', severity: 'CRITICAL', metadata: {} }], scannedNodes: 1, durationMs: 1 }) },
  ],
  __detect: detect,
}));

import { runGraphDetectionOnce } from '../../../../jobs/graph-detection.job';

describe('graph-detection cron isolation', () => {
  beforeEach(() => recordFlagMock.mockClear());

  test('one failing pattern does not abort the rest', async () => {
    const result = await runGraphDetectionOnce(new Date('2026-05-04T00:00:00Z'));
    expect(result.patterns).toBe(6);
    // 5 successful patterns each emit 1 finding -> 5 recordFlag calls.
    expect(result.flagged).toBe(5);
    expect(recordFlagMock).toHaveBeenCalledTimes(5);
  });
});
