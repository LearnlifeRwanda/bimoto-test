import type { PrismaClient } from '@prisma/client';
import {
  GRAPH_PATTERN_MAX_FINDINGS,
  MONEY_FUNNEL_MAX_DISTINCT,
  MONEY_FUNNEL_MIN_AMOUNT_RWF,
  MONEY_FUNNEL_MIN_TOTAL_CUSTOMERS,
  MONEY_FUNNEL_TOP_CUSTOMER_RATIO,
} from './thresholds';
import type { DetectOpts, DetectResult, FlaggedFinding, Severity } from './types';

const PATTERN_NAME = 'MONEY_FUNNEL' as const;
const FUNNEL_LOOKBACK_DAYS = 30;

export async function detect(
  prisma: PrismaClient,
  opts: DetectOpts,
): Promise<DetectResult> {
  const startedAt = Date.now();
  const now = opts.now ?? new Date();
  // Funnel patterns concentrate over a longer settlement window — 30 days,
  // independent of the per-tick `windowDays` used by per-edge patterns.
  void opts.windowDays;
  const since = new Date(now.getTime() - FUNNEL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const escrows = await prisma.escrow.findMany({
    where: { status: 'RELEASED', releasedAt: { gte: since } },
    select: { driverId: true, customerId: true, driverPayout: true },
  });

  const byDriver = new Map<string, Map<string, number>>();
  for (const e of escrows) {
    const perCustomer = byDriver.get(e.driverId) ?? new Map<string, number>();
    perCustomer.set(e.customerId, (perCustomer.get(e.customerId) ?? 0) + e.driverPayout);
    byDriver.set(e.driverId, perCustomer);
  }

  const findings: FlaggedFinding[] = [];
  for (const [driverId, perCustomer] of byDriver) {
    const total = Array.from(perCustomer.values()).reduce((s, v) => s + v, 0);
    if (total < MONEY_FUNNEL_MIN_AMOUNT_RWF) continue;
    // Eligibility guard: with few payers overall, a high top-N share is
    // arithmetic, not a funnel (a contract driver with 4 customers is
    // always "concentrated").
    if (perCustomer.size < MONEY_FUNNEL_MIN_TOTAL_CUSTOMERS) continue;

    const ranked = Array.from(perCustomer.entries()).sort((a, b) => b[1] - a[1]);
    const topSlice = ranked.slice(0, MONEY_FUNNEL_MAX_DISTINCT);
    const topAmount = topSlice.reduce((s, [, amt]) => s + amt, 0);
    const concentration = total === 0 ? 0 : topAmount / total;
    if (concentration < MONEY_FUNNEL_TOP_CUSTOMER_RATIO) continue;

    const severity: Severity = concentration >= 0.85 ? 'CRITICAL' : 'HIGH';
    const topCustomerIds = topSlice.map(([id]) => id);
    const topAmounts = topSlice.map(([, amt]) => amt);

    if (findings.length < GRAPH_PATTERN_MAX_FINDINGS) {
      findings.push({
        userId: driverId,
        severity,
        metadata: {
          role: 'driver',
          topCustomerIds,
          topAmounts,
          totalEarnings: total,
          concentration,
          totalDistinctCustomers: perCustomer.size,
          windowDays: FUNNEL_LOOKBACK_DAYS,
        },
      });
    }
    for (const customerId of topCustomerIds) {
      if (findings.length >= GRAPH_PATTERN_MAX_FINDINGS) break;
      findings.push({
        userId: customerId,
        severity: 'MEDIUM',
        metadata: {
          role: 'customer',
          driverId,
          totalToDriver: perCustomer.get(customerId) ?? 0,
          driverConcentration: concentration,
          windowDays: FUNNEL_LOOKBACK_DAYS,
        },
      });
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
