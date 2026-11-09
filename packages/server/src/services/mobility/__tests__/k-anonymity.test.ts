import { applyKAnonymity, thresholdForTier, countSuppressed } from '../k-anonymity';
import type { AggregateRow, Tier } from '../types';

function row(tier: Tier, count: number): AggregateRow {
  return {
    tier,
    aggregateType: 'POINT_DENSITY',
    cellId: `cell-${tier}-${count}`,
    cellCenterLat: -1.95,
    cellCenterLng: 30.06,
    bucketStart: new Date('2026-05-05T10:00:00Z'),
    bucketEnd: new Date('2026-05-05T10:30:00Z'),
    count,
  };
}

describe('mobility/k-anonymity', () => {
  it('thresholdForTier returns the configured per-tier value', () => {
    expect(thresholdForTier('DENSE')).toBe(20);
    expect(thresholdForTier('MEDIUM')).toBe(15);
    expect(thresholdForTier('LOW')).toBe(10);
    expect(thresholdForTier('SPARSE')).toBe(10);
  });

  it('SUPPRESSES a Dense-tier row with N=19 (below threshold 20) — smallest-wrongness #1', () => {
    const out = applyKAnonymity([row('DENSE', 19)]);
    expect(out).toHaveLength(0);
  });

  it('SUPPRESSES a Sparse-tier row with N=9 (below threshold 10) — smallest-wrongness #2', () => {
    const out = applyKAnonymity([row('SPARSE', 9)]);
    expect(out).toHaveLength(0);
  });

  it('KEEPS a Dense-tier row with N=20 (boundary inclusive)', () => {
    const out = applyKAnonymity([row('DENSE', 20)]);
    expect(out).toHaveLength(1);
  });

  it('KEEPS a Sparse-tier row with N=10 (boundary inclusive)', () => {
    const out = applyKAnonymity([row('SPARSE', 10)]);
    expect(out).toHaveLength(1);
  });

  it('mixed batch: keeps only above-threshold rows across all 4 tiers', () => {
    const batch: AggregateRow[] = [
      row('DENSE', 25),
      row('DENSE', 5),
      row('MEDIUM', 16),
      row('MEDIUM', 14),
      row('LOW', 12),
      row('LOW', 9),
      row('SPARSE', 11),
      row('SPARSE', 1),
    ];
    const out = applyKAnonymity(batch);
    const counts = out.map((r) => r.count).sort((a, b) => a - b);
    expect(counts).toEqual([11, 12, 16, 25]);
  });

  it('countSuppressed reports per-tier suppressed counts accurately', () => {
    const batch: AggregateRow[] = [
      row('DENSE', 5),
      row('DENSE', 19),
      row('DENSE', 30),
      row('MEDIUM', 14),
      row('LOW', 8),
      row('SPARSE', 10),
    ];
    const sup = countSuppressed(batch);
    expect(sup).toEqual({ DENSE: 2, MEDIUM: 1, LOW: 1, SPARSE: 0 });
  });

  it('throws on an unknown tier value (forced cast) — defence-in-depth', () => {
    const bogus = { ...row('DENSE', 100), tier: 'BOGUS' as unknown as Tier };
    expect(() => applyKAnonymity([bogus])).toThrow();
  });
});
