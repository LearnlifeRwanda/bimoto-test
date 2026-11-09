import type { PrismaClient } from '@prisma/client';
import { connectedComponents, type Edge } from './utils';
import {
  BID_CYCLE_MIN_PAIRS,
  BID_CYCLE_MIN_PER_PAIR,
  BID_CYCLE_WINDOW_HOURS,
  GRAPH_PATTERN_MAX_FINDINGS,
} from './thresholds';
import type { DetectOpts, DetectResult, FlaggedFinding, Severity } from './types';

const PATTERN_NAME = 'BID_CYCLE_RING' as const;

interface BidRow {
  driverId: string;
  status: string;
  withdrawnSource: string | null;
  createdAt: Date;
  updatedAt: Date;
  journeyId: string;
  customerId: string;
}

export async function detect(
  prisma: PrismaClient,
  opts: DetectOpts,
): Promise<DetectResult> {
  const startedAt = Date.now();
  const now = opts.now ?? new Date();
  void opts.windowDays;
  const since = new Date(now.getTime() - BID_CYCLE_WINDOW_HOURS * 60 * 60 * 1000);

  // ACCEPTED -> WITHDRAWN within minutes is the cycle signature. Only those two
  // statuses matter for this pattern; other end-states are ignored.
  //
  // COUNTER-READY G1 (the D4 ruling's AML rider) — the Bid row this reads
  // now also carries counterAmountRwf / counterAt / counterOutcome. They
  // are NOT read here and this detector is unchanged: counter patterns
  // (a pair that always counters to the same number, a counter answered
  // in under a second, a ring that counters its way to a chosen price)
  // are PAYMENTS-GATE MATERIAL — they become worth detecting when the
  // counter experiment has produced real rows to set thresholds from,
  // exactly as the velocity threshold is waiting for a month of Kigali.
  const bids = await prisma.bid.findMany({
    where: {
      createdAt: { gte: since },
      status: { in: ['ACCEPTED', 'WITHDRAWN'] },
    },
    select: {
      driverId: true,
      status: true,
      withdrawnSource: true,
      createdAt: true,
      updatedAt: true,
      journey: { select: { id: true, customerId: true } },
    },
  });

  const flat: BidRow[] = bids.map((b: any) => ({
    driverId: b.driverId,
    status: b.status,
    withdrawnSource: b.withdrawnSource,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    journeyId: b.journey.id,
    customerId: b.journey.customerId,
  }));

  // Group by (driverId, customerId) pair, count cycles. SYSTEM-initiated
  // withdrawals (conflict machinery, cascades) are the platform's own
  // churn, not a human signature — they don't count. Legacy null-source
  // rows keep counting so the detector isn't blind on pre-migration data.
  const cyclesPerPair = new Map<string, number>();
  let systemWithdrawnExcluded = 0;
  for (const b of flat) {
    if (b.status !== 'WITHDRAWN') continue;
    if (b.withdrawnSource === 'SYSTEM') {
      systemWithdrawnExcluded += 1;
      continue;
    }
    const key = `${b.driverId}|${b.customerId}`;
    cyclesPerPair.set(key, (cyclesPerPair.get(key) ?? 0) + 1);
  }

  const qualifyingPairs: Edge[] = [];
  for (const [key, cycles] of cyclesPerPair) {
    if (cycles < BID_CYCLE_MIN_PER_PAIR) continue;
    const [driverId, customerId] = key.split('|');
    qualifyingPairs.push([driverId, customerId] as Edge);
  }

  const components = connectedComponents(qualifyingPairs);
  const findings: FlaggedFinding[] = [];
  const seen = new Set<string>();

  for (const component of components) {
    const componentSet = new Set(component);
    const ringPairs = qualifyingPairs.filter(
      ([u, v]) => componentSet.has(u) && componentSet.has(v),
    );
    if (ringPairs.length < BID_CYCLE_MIN_PAIRS) continue;
    const totalCycles = ringPairs.reduce(
      (s, [u, v]) => s + (cyclesPerPair.get(`${u}|${v}`) ?? 0),
      0,
    );
    const avgCyclesPerPair = totalCycles / ringPairs.length;
    const severity: Severity = avgCyclesPerPair >= 5 ? 'CRITICAL' : 'HIGH';
    const meta = {
      ringPairs: ringPairs.map(([u, v]) => ({ a: u, b: v })),
      totalCycles,
      windowHours: BID_CYCLE_WINDOW_HOURS,
      systemWithdrawnExcluded,
    };
    for (const id of component) {
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
    scannedNodes: cyclesPerPair.size,
    durationMs: Date.now() - startedAt,
  };
}
