import * as Sentry from '@sentry/node';
import * as pairFrequency from './pair-frequency';
import * as velocity from './velocity';
import * as payoutConcentration from './payout-concentration';
import * as newAccountValue from './new-account-value';
import * as burstSilence from './burst-silence';
import * as failureClustering from './failure-clustering';

const ALL_PATTERNS: Array<{ name: string; detect: (now?: Date) => Promise<number> }> = [
  { name: 'pair-frequency', detect: pairFrequency.detect },
  { name: 'velocity', detect: velocity.detect },
  { name: 'payout-concentration', detect: payoutConcentration.detect },
  { name: 'new-account-value', detect: newAccountValue.detect },
  { name: 'burst-silence', detect: burstSilence.detect },
  { name: 'failure-clustering', detect: failureClustering.detect },
];

export interface RunAllResult {
  flagsRecorded: number;
  perPattern: Record<string, number | 'failed'>;
}

/**
 * Runs each detector in sequence. Per-pattern failures are captured to Sentry
 * and recorded as 'failed' in the result; sibling detectors continue.
 */
export async function runAllPatterns(now: Date = new Date()): Promise<RunAllResult> {
  const perPattern: Record<string, number | 'failed'> = {};
  let total = 0;
  for (const { name, detect } of ALL_PATTERNS) {
    try {
      const n = await detect(now);
      perPattern[name] = n;
      total += n;
    } catch (err) {
      console.error(`[AML-DETECT] pattern ${name} failed:`, err);
      if (process.env.SENTRY_DSN) Sentry.captureException(err, { extra: { pattern: name } });
      perPattern[name] = 'failed';
    }
  }
  return { flagsRecorded: total, perPattern };
}
