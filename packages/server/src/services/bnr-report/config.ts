import os from 'os';
import path from 'path';
import type { ComplianceAttestation } from './types';

// FIELD-BATCH G3 — the shipped default was '/var/bimoto/reports/bnr'.
// A standard macOS user account cannot create '/var/bimoto', so the
// monthly BNR job died with EACCES on the pilot machine and Kigali had
// to set BNR_REPORT_DIR by hand. A default that only works for root is
// not a default.
//
// The replacement is a per-user data location: ~/.bimoto/reports/bnr.
// It needs no elevated permissions on macOS, Linux or the Render
// container, and it is stable across working directories (a cwd-relative
// path would put the reports somewhere different depending on how the
// server was started). os.homedir() never throws — it falls back to the
// OS notion of home — but it can return an empty string on a stripped
// environment with no HOME, so we fall back to the temp dir rather than
// silently resolving to '/.bimoto', which is a system directory again.
//
// BNR_REPORT_DIR still overrides, so Kigali's current setting keeps
// working untouched. Nothing about report content, schedule or format
// changes — only where the default lands.
export function defaultReportDir(): string {
  const home = os.homedir();
  const base = home && home.trim() ? home : os.tmpdir();
  return path.join(base, '.bimoto', 'reports', 'bnr');
}

// `??` alone would accept the empty string that .env.example ships (and
// that an unfilled deploy env supplies), which resolves every report
// path against the process working directory. An unset override and a
// blank override mean the same thing: use the default.
export const REPORT_OUTPUT_DIR =
  process.env.BNR_REPORT_DIR?.trim() || defaultReportDir();
export const RETENTION_YEARS = parseInt(
  process.env.BNR_RETENTION_YEARS ?? '7',
  10,
);
export const TIMEZONE = process.env.BNR_TIMEZONE ?? 'Africa/Kigali';
export const CRON_SCHEDULE = process.env.BNR_CRON_SCHEDULE ?? '0 2 1 * *';
export const GENERATION_TIMEOUT_MS = parseInt(
  process.env.BNR_GENERATION_TIMEOUT_MS ?? '300000',
  10,
);
export const PDF_PAGE_SIZE = process.env.BNR_PDF_PAGE_SIZE ?? 'A4';

export const ATTESTATIONS: ComplianceAttestation[] = [
  {
    id: 'A1',
    statement:
      'All transactions in this period were processed via licensed PSP (Flutterwave) integration.',
    status: 'CONFIRMED',
  },
  {
    id: 'A2',
    statement:
      'AML flag detection ran for the entire period; no detection-job downtime exceeded 1 hour.',
    status: 'CONFIRMED',
  },
  {
    id: 'A3',
    statement:
      'CRITICAL AML flags resulted in user.isFlagged transitions; manual review process is in place.',
    status: 'CONFIRMED',
  },
  {
    id: 'A4',
    statement:
      'Hash-chain audit trail integrity verified for the reporting period.',
    status: 'CONFIRMED',
  },
  {
    id: 'A5',
    statement:
      'Customer KYC tier limits enforced via assertAmlCheck pre-charge gate.',
    status: 'CONFIRMED',
  },
];
