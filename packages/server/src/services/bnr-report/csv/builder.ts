import fs from 'fs/promises';
import { stringify } from 'csv-stringify/sync';
import type { ReportData } from '../types';

type Row = readonly (string | number)[];

function section(name: string): string {
  return `## SECTION: ${name}\n`;
}

function csv(rows: readonly Row[]): string {
  return stringify(rows as (string | number)[][]);
}

export async function buildCsv(
  data: ReportData,
  outputPath: string,
): Promise<{ bytes: number; rows: number }> {
  const parts: string[] = [];

  parts.push(section('METADATA'));
  parts.push(
    csv([
      ['key', 'value'],
      ['period', data.period.period],
      ['label', data.period.label],
      ['startUtc', data.period.startUtc.toISOString()],
      ['endUtc', data.period.endUtc.toISOString()],
      ['timezone', data.period.timezone],
      ['generatedAt', data.compliance.generatedAt],
    ]),
  );
  parts.push('\n');

  const t = data.transactions;
  parts.push(section('TRANSACTIONS'));
  parts.push(
    csv([
      ['metric', 'value'],
      ['totalCount', t.totalCount],
      ['totalAmountRwf', t.totalAmountRwf],
      ['successRate', t.successRate.toFixed(6)],
      ['failedCount', t.failedCount],
    ]),
  );
  parts.push('\n');

  parts.push(section('TRANSACTIONS_BY_TIER'));
  parts.push(
    csv([
      ['tier', 'count', 'amountRwf'],
      ...t.byTier.map((r) => [r.tier, r.count, r.amount] as Row),
    ]),
  );
  parts.push('\n');

  parts.push(section('TRANSACTIONS_BY_PAYMENT_METHOD'));
  parts.push(
    csv([
      ['method', 'count', 'amountRwf'],
      ...t.byPaymentMethod.map((r) => [r.method, r.count, r.amount] as Row),
    ]),
  );
  parts.push('\n');

  const d = data.disputes;
  parts.push(section('DISPUTES'));
  parts.push(
    csv([
      ['metric', 'value'],
      ['openedCount', d.openedCount],
      ['resolvedCount', d.resolvedCount],
      ['outstandingCount', d.outstandingCount],
      ['averageResolutionHours', d.averageResolutionHours ?? ''],
    ]),
  );
  parts.push('\n');

  parts.push(section('DISPUTES_BY_OUTCOME'));
  parts.push(
    csv([
      ['outcome', 'count'],
      ...d.byOutcome.map((r) => [r.outcome, r.count] as Row),
    ]),
  );
  parts.push('\n');

  const a = data.amlFlags;
  parts.push(section('AML_FLAGS'));
  parts.push(
    csv([
      ['metric', 'value'],
      ['totalCount', a.totalCount],
      ['flaggedUsers', a.flaggedUsers],
      ['dismissedCount', a.dismissedCount],
      ['pendingCount', a.pendingCount],
    ]),
  );
  parts.push('\n');

  parts.push(section('AML_FLAGS_BY_SEVERITY'));
  parts.push(
    csv([
      ['severity', 'count'],
      ...a.bySeverity.map((r) => [r.severity, r.count] as Row),
    ]),
  );
  parts.push('\n');

  parts.push(section('AML_FLAGS_BY_TYPE'));
  parts.push(
    csv([
      ['type', 'count', 'criticalCount'],
      ...a.byType.map((r) => [r.type, r.count, r.criticalCount] as Row),
    ]),
  );
  parts.push('\n');

  const u = data.userGrowth;
  parts.push(section('USER_GROWTH'));
  parts.push(
    csv([
      ['metric', 'value'],
      ['totalUsers', u.totalUsers],
      ['newUsersInPeriod', u.newUsersInPeriod],
      ['activeUsers', u.activeUsers],
    ]),
  );
  parts.push('\n');

  parts.push(section('USER_GROWTH_BY_ROLE'));
  parts.push(
    csv([
      ['role', 'total', 'new'],
      ...u.byRole.map((r) => [r.role, r.total, r.new] as Row),
    ]),
  );
  parts.push('\n');

  const drv = data.driverMetrics;
  parts.push(section('DRIVER_METRICS'));
  parts.push(
    csv([
      ['metric', 'value'],
      ['activeDrivers', drv.activeDrivers],
      ['totalRidesCompleted', drv.totalRidesCompleted],
      ['totalPayoutsRwf', drv.totalPayoutsRwf],
      ['payoutBatchCount', drv.payoutBatchCount],
      ['averageRidesPerDriver', drv.averageRidesPerDriver.toFixed(4)],
      ['cancellationCount', drv.cancellationCount],
    ]),
  );
  parts.push('\n');

  const c = data.compliance;
  parts.push(section('COMPLIANCE'));
  parts.push(
    csv([
      ['metric', 'value'],
      ['reportPeriod', c.reportPeriod],
      ['generatedAt', c.generatedAt],
      ['hashChainHead', c.hashChainHead ?? ''],
      ['hashChainEntries', c.hashChainEntries],
    ]),
  );
  parts.push('\n');

  parts.push(section('COMPLIANCE_ATTESTATIONS'));
  parts.push(
    csv([
      ['id', 'status', 'statement'],
      ...c.attestations.map((r) => [r.id, r.status, r.statement] as Row),
    ]),
  );

  const body = parts.join('');
  await fs.writeFile(outputPath, body, 'utf8');
  const stat = await fs.stat(outputPath);
  // CSV rows written (header + data lines), excluding section markers —
  // surfaced as the `rows` field of the job's run-metrics line.
  const rows = body
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('## SECTION:'))
    .length;
  return { bytes: stat.size, rows };
}
