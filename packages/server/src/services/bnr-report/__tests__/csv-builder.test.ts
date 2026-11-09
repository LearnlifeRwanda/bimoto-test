import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildCsv } from '../csv/builder';
import { windowFor } from '../date-window';
import { ATTESTATIONS } from '../config';
import type { ReportData } from '../types';

function syntheticData(): ReportData {
  return {
    period: windowFor('2026-04'),
    transactions: {
      totalCount: 10,
      totalAmountRwf: 123_000,
      byTier: [
        { tier: 'micro', count: 8, amount: 80_000 },
        { tier: 'standard', count: 2, amount: 43_000 },
        { tier: 'large', count: 0, amount: 0 },
      ],
      byPaymentMethod: [{ method: 'FLUTTERWAVE', count: 10, amount: 123_000 }],
      successRate: 0.9,
      failedCount: 1,
    },
    disputes: {
      openedCount: 0, resolvedCount: 0, outstandingCount: 0,
      averageResolutionHours: null, byOutcome: [],
    },
    amlFlags: {
      totalCount: 0, bySeverity: [
        { severity: 'LOW', count: 0 },
        { severity: 'MEDIUM', count: 0 },
        { severity: 'HIGH', count: 0 },
        { severity: 'CRITICAL', count: 0 },
      ],
      byType: [], flaggedUsers: 0, dismissedCount: 0, pendingCount: 0,
    },
    userGrowth: { totalUsers: 5, newUsersInPeriod: 1, byRole: [], activeUsers: 2 },
    driverMetrics: {
      activeDrivers: 0, totalRidesCompleted: 0, totalPayoutsRwf: 0,
      payoutBatchCount: 0, averageRidesPerDriver: 0, cancellationCount: 0,
    },
    compliance: {
      reportPeriod: 'April 2026',
      generatedAt: '2026-05-01T02:00:00+02:00',
      hashChainHead: null, hashChainEntries: 0,
      attestations: ATTESTATIONS,
    },
  };
}

describe('buildCsv', () => {
  test('writes a section-delimited CSV containing the expected markers', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnr-csv-'));
    const out = path.join(dir, 'report.csv');
    const { bytes } = await buildCsv(syntheticData(), out);
    expect(bytes).toBeGreaterThan(0);

    const text = fs.readFileSync(out, 'utf8');
    expect(text).toContain('## SECTION: METADATA');
    expect(text).toContain('## SECTION: TRANSACTIONS');
    expect(text).toContain('## SECTION: TRANSACTIONS_BY_TIER');
    expect(text).toContain('## SECTION: AML_FLAGS_BY_SEVERITY');
    expect(text).toContain('## SECTION: COMPLIANCE');
    expect(text).toContain('## SECTION: COMPLIANCE_ATTESTATIONS');
    expect(text).toContain('FLUTTERWAVE');
  });
});
