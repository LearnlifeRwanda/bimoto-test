// SERVICES/MOBILITY/K-ANONYMITY.TS
//
// K-anonymity write gate. A cell-bucket aggregate is only written if its
// count meets-or-exceeds the tier's kThreshold; otherwise the row is
// suppressed silently — no row exists at all in MobilityAggregate.
// Suppression is the strongest privacy guarantee available without
// noise-injection (which is intentionally out of scope for v1).

import { TIER_CONFIGS } from './config';
import type { AggregateRow, Tier } from './types';

const ALL_TIERS: Tier[] = ['DENSE', 'MEDIUM', 'LOW', 'SPARSE'];

export function thresholdForTier(tier: Tier): number {
  const cfg = TIER_CONFIGS[tier];
  if (!cfg) {
    throw new Error(`k-anonymity: unknown tier ${String(tier)}`);
  }
  return cfg.kThreshold;
}

export function applyKAnonymity(rows: AggregateRow[]): AggregateRow[] {
  return rows.filter((row) => {
    // thresholdForTier throws on unknown tier — defence-in-depth.
    const k = thresholdForTier(row.tier);
    return row.count >= k;
  });
}

export function countSuppressed(rows: AggregateRow[]): Record<Tier, number> {
  const out: Record<Tier, number> = {
    DENSE: 0,
    MEDIUM: 0,
    LOW: 0,
    SPARSE: 0,
  };
  for (const row of rows) {
    if (!ALL_TIERS.includes(row.tier)) {
      throw new Error(`k-anonymity: unknown tier in row: ${String(row.tier)}`);
    }
    const k = thresholdForTier(row.tier);
    if (row.count < k) {
      out[row.tier] += 1;
    }
  }
  return out;
}
