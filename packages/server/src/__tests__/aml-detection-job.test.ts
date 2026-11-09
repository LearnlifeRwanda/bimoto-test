jest.mock('../services/aml/patterns', () => ({
  runAllPatterns: jest.fn(),
}));

import { runAllPatterns } from '../services/aml/patterns';
import {
  runAmlDetectionOnce,
  startAmlDetectionJob,
  stopAmlDetectionJob,
  _resetForTests,
} from '../jobs/aml-detection.job';

const mockRunAll = runAllPatterns as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  _resetForTests();
});

afterEach(() => {
  _resetForTests();
});

describe('aml-detection.job', () => {
  test('start → setInterval registered, stop → cleared', () => {
    mockRunAll.mockResolvedValue({ flagsRecorded: 0, perPattern: {} });
    startAmlDetectionJob();
    stopAmlDetectionJob();
    // No assert other than no-throw; the interval is internal state.
  });

  test('runAmlDetectionOnce calls runAllPatterns and returns its result', async () => {
    mockRunAll.mockResolvedValue({
      flagsRecorded: 3,
      perPattern: { velocity: 1, 'pair-frequency': 2 },
    });
    const r = await runAmlDetectionOnce();
    expect(mockRunAll).toHaveBeenCalledTimes(1);
    expect(r.flagsRecorded).toBe(3);
  });

  test('per-pattern failure does not throw out of runAmlDetectionOnce', async () => {
    // runAllPatterns itself catches per-pattern failures; we just ensure the
    // job surface does not bubble.
    mockRunAll.mockResolvedValue({
      flagsRecorded: 0,
      perPattern: { velocity: 'failed', 'pair-frequency': 0 },
    });
    await expect(runAmlDetectionOnce()).resolves.toMatchObject({ flagsRecorded: 0 });
  });

  test('idempotent: concurrent calls coalesce to one underlying run', async () => {
    let resolveRun: (v: any) => void;
    const slow = new Promise((res) => {
      resolveRun = res;
    });
    mockRunAll.mockReturnValueOnce(slow as any);

    const first = runAmlDetectionOnce();
    const second = runAmlDetectionOnce();
    resolveRun!({ flagsRecorded: 1, perPattern: { velocity: 1 } });
    await Promise.all([first, second]);

    expect(mockRunAll).toHaveBeenCalledTimes(1); // coalesced
  });

  test('_resetForTests clears running tick state', async () => {
    mockRunAll.mockResolvedValue({ flagsRecorded: 0, perPattern: {} });
    await runAmlDetectionOnce();
    _resetForTests();
    await runAmlDetectionOnce();
    expect(mockRunAll).toHaveBeenCalledTimes(2);
  });
});
