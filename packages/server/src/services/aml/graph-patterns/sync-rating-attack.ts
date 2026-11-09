import type { PrismaClient } from '@prisma/client';
import {
  GRAPH_PATTERN_MAX_FINDINGS,
  SYNC_RATING_FIRST_TIME_RATIO,
  SYNC_RATING_MIN_COUNT,
  SYNC_RATING_WINDOW_MIN,
} from './thresholds';
import type { DetectOpts, DetectResult, FlaggedFinding, Severity } from './types';

const PATTERN_NAME = 'SYNC_RATING_ATTACK' as const;

interface RatingRow {
  raterId: string;
  ratedId: string;
  stars: number;
  createdAt: Date;
}

export async function detect(
  prisma: PrismaClient,
  opts: DetectOpts,
): Promise<DetectResult> {
  const startedAt = Date.now();
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.windowDays * 24 * 60 * 60 * 1000);

  const ratings: RatingRow[] = await prisma.rating.findMany({
    where: { createdAt: { gte: since } },
    select: { raterId: true, ratedId: true, stars: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  // Pre-compute first-time-rater set: any rater whose earliest rating in the
  // entire history is inside this window AND whose total rating count is 1.
  const firstSeenAt = new Map<string, Date>();
  const ratingCount = new Map<string, number>();
  // Cheaper than another DB hit: approximate "first-time" as raters with a
  // single rating in the lookback window. False-positives become MEDIUM-only.
  for (const r of ratings) {
    const cur = firstSeenAt.get(r.raterId);
    if (!cur || r.createdAt < cur) firstSeenAt.set(r.raterId, r.createdAt);
    ratingCount.set(r.raterId, (ratingCount.get(r.raterId) ?? 0) + 1);
  }
  const firstTimers = new Set(
    Array.from(ratingCount.entries())
      .filter(([, c]) => c === 1)
      .map(([id]) => id),
  );

  const byDriver = new Map<string, RatingRow[]>();
  for (const r of ratings) {
    const arr = byDriver.get(r.ratedId) ?? [];
    arr.push(r);
    byDriver.set(r.ratedId, arr);
  }

  const findings: FlaggedFinding[] = [];
  const seen = new Set<string>();
  const windowMs = SYNC_RATING_WINDOW_MIN * 60 * 1000;

  for (const [driverId, perDriver] of byDriver) {
    let leftIdx = 0;
    let bestBurst: RatingRow[] | null = null;
    for (let rightIdx = 0; rightIdx < perDriver.length; rightIdx++) {
      while (
        perDriver[rightIdx].createdAt.getTime() -
          perDriver[leftIdx].createdAt.getTime() >
        windowMs
      ) {
        leftIdx++;
      }
      const burstSize = rightIdx - leftIdx + 1;
      if (burstSize >= SYNC_RATING_MIN_COUNT) {
        const burst = perDriver.slice(leftIdx, rightIdx + 1);
        if (!bestBurst || burst.length > bestBurst.length) bestBurst = burst;
      }
    }
    if (!bestBurst) continue;

    const burstRaters = bestBurst.map((r) => r.raterId);
    const firstTimeShare =
      burstRaters.filter((id) => firstTimers.has(id)).length / burstRaters.length;
    if (firstTimeShare < SYNC_RATING_FIRST_TIME_RATIO) continue;

    const allFiveStar = bestBurst.every((r) => r.stars === 5);
    const allFirstTime = burstRaters.every((id) => firstTimers.has(id));
    const severity: Severity =
      allFiveStar && allFirstTime ? 'CRITICAL' : 'HIGH';
    const avgStars =
      bestBurst.reduce((s, r) => s + r.stars, 0) / bestBurst.length;
    const meta = {
      driverId,
      ratingCount: bestBurst.length,
      windowStart: bestBurst[0].createdAt.toISOString(),
      raterIds: burstRaters,
      firstTimeRatio: firstTimeShare,
      avgStars,
    };

    for (const id of [driverId, ...burstRaters]) {
      if (findings.length >= GRAPH_PATTERN_MAX_FINDINGS) break;
      if (seen.has(id)) continue;
      seen.add(id);
      findings.push({ userId: id, severity, metadata: meta });
    }
    if (findings.length >= GRAPH_PATTERN_MAX_FINDINGS) break;
  }

  return {
    patternName: PATTERN_NAME,
    flagged: findings,
    scannedNodes: byDriver.size,
    durationMs: Date.now() - startedAt,
  };
}
