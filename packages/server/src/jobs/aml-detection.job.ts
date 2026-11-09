import * as Sentry from '@sentry/node';
import { runAllPatterns, RunAllResult } from '../services/aml/patterns';
import { withJobLock } from '../services/job-lock';

const TICK_MS = Number(process.env.AML_DETECTION_TICK_MS ?? 30 * 60 * 1000); // 30 min default

let intervalId: NodeJS.Timeout | null = null;
let runningTick: Promise<RunAllResult> | null = null;

export async function runAmlDetectionOnce(now: Date = new Date()): Promise<RunAllResult> {
  // Coalesce concurrent ticks — if one is already running, return its promise
  // so the second tick does not double-flag.
  if (runningTick) return runningTick;
  runningTick = runAllPatterns(now);
  try {
    const result = await runningTick;
    if (result.flagsRecorded > 0) {
      console.log(
        `[AML-DETECT] Tick recorded ${result.flagsRecorded} flags`,
        result.perPattern,
      );
    }
    return result;
  } finally {
    runningTick = null;
  }
}

export function startAmlDetectionJob(): void {
  console.log(`[AML-DETECT] Starting AML detection job (every ${TICK_MS}ms)`);
  intervalId = setInterval(() => {
    // withJobLock: only the advisory-lock leader runs the tick when
    // overlapping server processes race (deploy, scale-out).
    withJobLock('aml-detection.job', () => runAmlDetectionOnce()).catch((err) => {
      console.error('[AML-DETECT] Top-level tick failed:', err);
      if (process.env.SENTRY_DSN) Sentry.captureException(err);
    });
  }, TICK_MS);
}

export function stopAmlDetectionJob(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function _resetForTests(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  runningTick = null;
}
