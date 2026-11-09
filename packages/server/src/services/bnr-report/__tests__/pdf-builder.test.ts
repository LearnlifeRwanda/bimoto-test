import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildPdf } from '../pdf/builder';
import { windowFor } from '../date-window';
import { ATTESTATIONS } from '../config';
import type { ReportData } from '../types';

function syntheticData(): ReportData {
  return {
    period: windowFor('2026-04'),
    transactions: {
      totalCount: 1234,
      totalAmountRwf: 12_345_678,
      byTier: [
        { tier: 'micro', count: 800, amount: 800_000 },
        { tier: 'standard', count: 400, amount: 8_000_000 },
        { tier: 'large', count: 34, amount: 3_545_678 },
      ],
      byPaymentMethod: [{ method: 'FLUTTERWAVE', count: 1234, amount: 12_345_678 }],
      successRate: 0.987,
      failedCount: 15,
    },
    disputes: {
      openedCount: 7,
      resolvedCount: 5,
      outstandingCount: 2,
      averageResolutionHours: 18.4,
      byOutcome: [
        { outcome: 'ARRIVED_SAFELY', count: 4 },
        { outcome: 'NEVER_ARRIVED', count: 1 },
      ],
    },
    amlFlags: {
      totalCount: 12,
      bySeverity: [
        { severity: 'LOW', count: 3 },
        { severity: 'MEDIUM', count: 4 },
        { severity: 'HIGH', count: 3 },
        { severity: 'CRITICAL', count: 2 },
      ],
      byType: [{ type: 'VELOCITY_EXCEEDED', count: 5, criticalCount: 1 }],
      flaggedUsers: 4,
      dismissedCount: 6,
      pendingCount: 6,
    },
    userGrowth: {
      totalUsers: 1500,
      newUsersInPeriod: 200,
      byRole: [{ role: 'CUSTOMER', total: 1100, new: 150 }],
      activeUsers: 800,
    },
    driverMetrics: {
      activeDrivers: 60,
      totalRidesCompleted: 1180,
      totalPayoutsRwf: 8_000_000,
      payoutBatchCount: 30,
      averageRidesPerDriver: 1180 / 60,
      cancellationCount: 25,
    },
    compliance: {
      reportPeriod: 'April 2026',
      generatedAt: new Date().toISOString(),
      hashChainHead: 'abc123',
      hashChainEntries: 4242,
      attestations: ATTESTATIONS,
    },
  };
}

describe('buildPdf', () => {
  test('writes a non-trivial PDF to disk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnr-pdf-'));
    const out = path.join(dir, 'report.pdf');
    const { bytes } = await buildPdf(syntheticData(), out);
    expect(fs.existsSync(out)).toBe(true);
    expect(bytes).toBeGreaterThan(1024);
    const head = fs.readFileSync(out).slice(0, 4).toString('ascii');
    expect(head).toBe('%PDF');
  });
});
