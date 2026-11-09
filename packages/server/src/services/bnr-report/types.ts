// Public type contracts for the BNR-format monthly report module.
// All section payloads are computed by aggregator/* and consumed by
// pdf/builder.ts and csv/builder.ts.

export interface ReportPeriod {
  period: string;
  startUtc: Date;
  endUtc: Date;
  label: string;
  timezone: string;
}

export type TransactionTier = 'micro' | 'standard' | 'large';

export interface TransactionsSection {
  totalCount: number;
  totalAmountRwf: number;
  byTier: { tier: TransactionTier; count: number; amount: number }[];
  byPaymentMethod: { method: string; count: number; amount: number }[];
  successRate: number;
  failedCount: number;
}

export interface DisputesSection {
  openedCount: number;
  resolvedCount: number;
  outstandingCount: number;
  averageResolutionHours: number | null;
  byOutcome: { outcome: string; count: number }[];
}

export type AmlSeverityCode = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AmlFlagsSection {
  totalCount: number;
  bySeverity: { severity: AmlSeverityCode; count: number }[];
  byType: { type: string; count: number; criticalCount: number }[];
  flaggedUsers: number;
  dismissedCount: number;
  pendingCount: number;
}

export interface UserGrowthSection {
  totalUsers: number;
  newUsersInPeriod: number;
  byRole: { role: string; total: number; new: number }[];
  activeUsers: number;
}

export interface DriverMetricsSection {
  activeDrivers: number;
  totalRidesCompleted: number;
  totalPayoutsRwf: number;
  payoutBatchCount: number;
  averageRidesPerDriver: number;
  cancellationCount: number;
}

export interface ComplianceAttestation {
  id: string;
  statement: string;
  status: 'CONFIRMED' | 'NOT_APPLICABLE';
}

export interface ComplianceSection {
  reportPeriod: string;
  generatedAt: string;
  hashChainHead: string | null;
  hashChainEntries: number;
  attestations: ComplianceAttestation[];
}

export interface ReportData {
  period: ReportPeriod;
  transactions: TransactionsSection;
  disputes: DisputesSection;
  amlFlags: AmlFlagsSection;
  userGrowth: UserGrowthSection;
  driverMetrics: DriverMetricsSection;
  compliance: ComplianceSection;
}
