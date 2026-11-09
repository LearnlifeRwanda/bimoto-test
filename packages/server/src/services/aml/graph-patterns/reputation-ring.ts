import type { PrismaClient } from '@prisma/client';
import {
  GRAPH_PATTERN_MAX_FINDINGS,
  REPUTATION_RING_CLIQUE_MAX,
  REPUTATION_RING_MAX_DRIVERS,
  REPUTATION_RING_MIN_AVG_STARS,
  REPUTATION_RING_MIN_RATINGS,
} from './thresholds';
import type { DetectOpts, DetectResult, FlaggedFinding, Severity } from './types';

const PATTERN_NAME = 'REPUTATION_RING' as const;
const REPUTATION_LOOKBACK_DAYS = 30;

type RatingRow = {
  raterId: string;
  ratedId: string;
  stars: number;
};

export async function detect(
  prisma: PrismaClient,
  opts: DetectOpts,
): Promise<DetectResult> {
  const startedAt = Date.now();
  const now = opts.now ?? new Date();
  void opts.windowDays;
  const since = new Date(now.getTime() - REPUTATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const ratings: RatingRow[] = await prisma.rating.findMany({
    where: { createdAt: { gte: since } },
    select: { raterId: true, ratedId: true, stars: true },
  });

  // Resolve roles for everyone touched by a rating in the window.
  const involvedIds = Array.from(
    new Set([...ratings.map((r) => r.raterId), ...ratings.map((r) => r.ratedId)]),
  );
  const users = await prisma.user.findMany({
    where: { id: { in: involvedIds } },
    select: { id: true, role: true },
  });
  const roleById = new Map(users.map((u) => [u.id, u.role]));

  const givenByCustomer = new Map<string, RatingRow[]>();
  const receivedByDriver = new Map<string, RatingRow[]>();
  for (const r of ratings) {
    if (roleById.get(r.raterId) === 'CUSTOMER') {
      const arr = givenByCustomer.get(r.raterId) ?? [];
      arr.push(r);
      givenByCustomer.set(r.raterId, arr);
    }
    if (roleById.get(r.ratedId) === 'DRIVER') {
      const arr = receivedByDriver.get(r.ratedId) ?? [];
      arr.push(r);
      receivedByDriver.set(r.ratedId, arr);
    }
  }

  const findings: FlaggedFinding[] = [];
  const flaggedUsers = new Set<string>();

  for (const [customerId, given] of givenByCustomer) {
    if (given.length < REPUTATION_RING_MIN_RATINGS) continue;
    const distinctDrivers = new Set(given.map((r) => r.ratedId));
    if (distinctDrivers.size > REPUTATION_RING_MAX_DRIVERS) continue;
    const avgStars = given.reduce((s, r) => s + r.stars, 0) / given.length;
    if (avgStars < REPUTATION_RING_MIN_AVG_STARS) continue;

    // Inverse check: union of all raters of these drivers must be a small clique
    // AND that clique must account for >50% of each driver's ratings.
    const cliqueCustomers = new Set<string>();
    let inverseSatisfied = true;
    for (const driverId of distinctDrivers) {
      const received = receivedByDriver.get(driverId) ?? [];
      if (received.length === 0) {
        inverseSatisfied = false;
        break;
      }
      for (const r of received) cliqueCustomers.add(r.raterId);
    }
    if (!inverseSatisfied) continue;
    if (cliqueCustomers.size > REPUTATION_RING_CLIQUE_MAX) continue;
    for (const driverId of distinctDrivers) {
      const received = receivedByDriver.get(driverId) ?? [];
      const cliqueShare =
        received.filter((r) => cliqueCustomers.has(r.raterId)).length / received.length;
      if (cliqueShare <= 0.5) {
        inverseSatisfied = false;
        break;
      }
    }
    if (!inverseSatisfied) continue;

    const severity: Severity =
      avgStars === 5.0 && cliqueCustomers.size >= 5 ? 'HIGH' : 'MEDIUM';
    const meta = {
      cliqueDrivers: Array.from(distinctDrivers),
      cliqueCustomers: Array.from(cliqueCustomers),
      ratingCount: given.length,
      avgStars,
    };

    for (const id of [...cliqueCustomers, ...distinctDrivers]) {
      if (findings.length >= GRAPH_PATTERN_MAX_FINDINGS) break;
      if (flaggedUsers.has(id)) continue;
      flaggedUsers.add(id);
      findings.push({ userId: id, severity, metadata: meta });
    }
    if (findings.length >= GRAPH_PATTERN_MAX_FINDINGS) break;
  }

  return {
    patternName: PATTERN_NAME,
    flagged: findings,
    scannedNodes: givenByCustomer.size + receivedByDriver.size,
    durationMs: Date.now() - startedAt,
  };
}
