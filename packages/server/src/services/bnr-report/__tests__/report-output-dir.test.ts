// FIELD-BATCH G3 — where the monthly BNR report lands by default.
//
// The shipped default was '/var/bimoto/reports/bnr'. A standard macOS
// user account cannot create '/var/bimoto', so the monthly job died with
// EACCES on the pilot machine and Kigali had to set BNR_REPORT_DIR by
// hand. These tests pin the replacement: a per-user data location that a
// normal account can write to, created on first run, still overridable.
//
// The write test is deliberately end-to-end through the real PDF and CSV
// builders into a home directory that does not exist when the test
// starts — that is the "clean environment" the field report describes.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { windowFor } from '../date-window';
import { ATTESTATIONS } from '../config';
import type { ReportData } from '../types';

const REAL_OVERRIDE = process.env.BNR_REPORT_DIR;

/**
 * Re-imports config.ts with a chosen home directory. REPORT_OUTPUT_DIR is
 * a module-level constant, so both the home and the override have to be
 * in place before the module is evaluated.
 *
 * The home is installed by spying on os.homedir() rather than by setting
 * process.env.HOME: Jest hands each test file a *copy* of process.env, so
 * writes to it never reach the real environ that libuv reads.
 */
function loadConfig(env: { home: string; override?: string | undefined }) {
  jest.spyOn(os, 'homedir').mockReturnValue(env.home);
  if (env.override === undefined) delete process.env.BNR_REPORT_DIR;
  else process.env.BNR_REPORT_DIR = env.override;

  let mod!: typeof import('../config');
  jest.isolateModules(() => {
    mod = require('../config');
  });
  return mod;
}

afterEach(() => {
  jest.restoreAllMocks();
  if (REAL_OVERRIDE === undefined) delete process.env.BNR_REPORT_DIR;
  else process.env.BNR_REPORT_DIR = REAL_OVERRIDE;
  jest.resetModules();
});

describe('BNR report output directory (FIELD-BATCH G3)', () => {
  test('the default is a per-user location, not a system directory', () => {
    const home = path.join(os.tmpdir(), 'bnr-home-default');
    const { REPORT_OUTPUT_DIR } = loadConfig({ home, override: undefined });

    expect(REPORT_OUTPUT_DIR).toBe(path.join(home, '.bimoto', 'reports', 'bnr'));
    expect(path.isAbsolute(REPORT_OUTPUT_DIR)).toBe(true);
  });

  test('the old unwritable default is gone', () => {
    const { REPORT_OUTPUT_DIR } = loadConfig({
      home: path.join(os.tmpdir(), 'bnr-home-old'),
      override: undefined,
    });

    expect(REPORT_OUTPUT_DIR).not.toBe('/var/bimoto/reports/bnr');
    expect(REPORT_OUTPUT_DIR.startsWith('/var/')).toBe(false);
    expect(REPORT_OUTPUT_DIR.startsWith('/etc/')).toBe(false);
    expect(REPORT_OUTPUT_DIR.startsWith('/opt/')).toBe(false);
  });

  test('BNR_REPORT_DIR still overrides — Kigali keeps working untouched', () => {
    const { REPORT_OUTPUT_DIR } = loadConfig({
      home: path.join(os.tmpdir(), 'bnr-home-override'),
      override: '/srv/kigali/bnr',
    });

    expect(REPORT_OUTPUT_DIR).toBe('/srv/kigali/bnr');
  });

  test('a blank override falls back to the default instead of the cwd', () => {
    // .env.example ships BNR_REPORT_DIR="" and an unfilled deploy env
    // supplies the same. `??` alone would accept it and resolve every
    // report path against the process working directory.
    const home = path.join(os.tmpdir(), 'bnr-home-blank');
    const { REPORT_OUTPUT_DIR } = loadConfig({ home, override: '   ' });

    expect(REPORT_OUTPUT_DIR).toBe(path.join(home, '.bimoto', 'reports', 'bnr'));
  });

  test('defaultReportDir falls back to the temp dir when there is no home', () => {
    const { defaultReportDir } = loadConfig({ home: '', override: undefined });

    // Never '/.bimoto/...' — that would be a system directory again.
    expect(defaultReportDir()).toBe(
      path.join(os.tmpdir(), '.bimoto', 'reports', 'bnr'),
    );
  });

  test('the job writes a real report into the default dir in a clean environment', async () => {
    // A home directory that does not exist yet, and no elevated
    // permissions: exactly the stock-Mac case that was failing.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bnr-clean-home-'));
    fs.rmSync(home, { recursive: true, force: true });
    expect(fs.existsSync(home)).toBe(false);

    const { REPORT_OUTPUT_DIR } = loadConfig({ home, override: undefined });
    expect(REPORT_OUTPUT_DIR).toBe(path.join(home, '.bimoto', 'reports', 'bnr'));
    expect(fs.existsSync(REPORT_OUTPUT_DIR)).toBe(false);

    let store!: typeof import('../store/filesystem');
    let pdf!: typeof import('../pdf/builder');
    let csv!: typeof import('../csv/builder');
    jest.isolateModules(() => {
      store = require('../store/filesystem');
      pdf = require('../pdf/builder');
      csv = require('../csv/builder');
    });

    const period = '2026-04';

    // The directory is created, not assumed.
    await store.ensureDir(period);
    expect(fs.existsSync(path.join(REPORT_OUTPUT_DIR, period))).toBe(true);

    const pdfPath = store.pathFor(period, 'pdf');
    const csvPath = store.pathFor(period, 'csv');
    const { bytes: pdfBytes } = await pdf.buildPdf(syntheticData(), pdfPath);
    const { bytes: csvBytes, rows } = await csv.buildCsv(syntheticData(), csvPath);

    expect(fs.existsSync(pdfPath)).toBe(true);
    expect(fs.existsSync(csvPath)).toBe(true);
    expect(pdfBytes).toBeGreaterThan(1024);
    expect(csvBytes).toBeGreaterThan(0);
    expect(rows).toBeGreaterThan(0);
    expect(fs.readFileSync(pdfPath).slice(0, 4).toString('ascii')).toBe('%PDF');

    fs.rmSync(home, { recursive: true, force: true });
  });
});

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
