import type { PrismaClient } from '@prisma/client';

export type GraphPatternName =
  | 'COLLUSION_RING'
  | 'MONEY_FUNNEL'
  | 'REPUTATION_RING'
  | 'GEO_ANOMALY'
  | 'SYNC_RATING_ATTACK'
  | 'BID_CYCLE_RING';

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface DetectOpts {
  windowDays: number;
  minSampleSize: number;
  now?: Date;
}

export interface FlaggedFinding {
  userId: string;
  severity: Severity;
  metadata: Record<string, unknown>;
}

export interface DetectResult {
  patternName: GraphPatternName;
  flagged: FlaggedFinding[];
  scannedNodes: number;
  durationMs: number;
}

export interface PatternModule {
  name: GraphPatternName;
  detect(prisma: PrismaClient, opts: DetectOpts): Promise<DetectResult>;
}
