import cron, { ScheduledTask } from 'node-cron';
import * as Sentry from '@sentry/node';
import prisma from '../prisma';
import { GRAPH_PATTERNS } from '../services/aml/graph-patterns';
import { recordFlag, type AmlFlagType } from '../services/aml/flag-store';
import { withJobLock } from '../services/job-lock';
import {
  GRAPH_DETECTION_CRON,
  GRAPH_DETECTION_TIMEOUT_MS,
  GRAPH_DETECTION_WINDOW_DAYS,
} from '../services/aml/graph-patterns/thresholds';

let task: ScheduledTask | null = null;
let running = false;

export interface GraphTickResult {
  patterns: number;
  flagged: number;
  durationMs: number;
}

export async function runGraphDetectionOnce(
  now: Date = new Date(),
): Promise<GraphTickResult> {
  const startedAt = Date.now();
  let totalFlagged = 0;
  for (const pattern of GRAPH_PATTERNS) {
    try {
      const result = await Promise.race([
        pattern.detect(prisma, {
          windowDays: GRAPH_DETECTION_WINDOW_DAYS,
          minSampleSize: 10,
          now,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('graph-pattern-timeout')),
            GRAPH_DETECTION_TIMEOUT_MS,
          ),
        ),
      ]);
      for (const finding of result.flagged) {
        await recordFlag({
          userId: finding.userId,
          type: pattern.name as AmlFlagType,
          severity: finding.severity,
          metadata: finding.metadata,
        });
        totalFlagged += 1;
      }
      console.log(
        `[GRAPH-DETECT] ${pattern.name}: flagged=${result.flagged.length} scanned=${result.scannedNodes} ms=${result.durationMs}`,
      );
    } catch (err) {
      console.error(`[GRAPH-DETECT] pattern ${pattern.name} failed:`, err);
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, { tags: { pattern: pattern.name } });
      }
      // Continue with next pattern — do NOT abort whole cycle.
    }
  }
  return {
    patterns: GRAPH_PATTERNS.length,
    flagged: totalFlagged,
    durationMs: Date.now() - startedAt,
  };
}

export function startGraphDetectionJob(): void {
  if (task) return;
  console.log(`[GRAPH-DETECT] Starting graph detection cron (${GRAPH_DETECTION_CRON})`);
  task = cron.schedule(
    GRAPH_DETECTION_CRON,
    async () => {
      if (running) return;
      running = true;
      try {
        // withJobLock: only the advisory-lock leader runs the tick when
        // overlapping server processes race (deploy, scale-out).
        await withJobLock('graph-detection.job', () => runGraphDetectionOnce());
      } catch (err) {
        if (process.env.SENTRY_DSN) Sentry.captureException(err);
      } finally {
        running = false;
      }
    },
    { noOverlap: true },
  );
}

export function stopGraphDetectionJob(): void {
  if (task) {
    task.stop();
    task = null;
  }
}

export function _resetForTests(): void {
  if (task) {
    task.stop();
    task = null;
  }
  running = false;
}
