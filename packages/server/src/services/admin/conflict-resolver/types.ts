import type {
  ConflictType,
  ConflictDecision,
  AdminAction,
} from '@prisma/client';

export interface ConflictListItem {
  id: string;
  type: ConflictType;
  summary: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface ConflictDetail {
  id: string;
  type: ConflictType;
  summary: string;
  createdAt: Date;
  data: Record<string, unknown>;
}

export interface ConflictDecisionArgs {
  id: string;
  decision: ConflictDecision;
  reason: string;
  adminId: string;
}

export interface ConflictModule {
  type: ConflictType;
  validDecisions: ReadonlyArray<ConflictDecision>;
  listOpen: (
    prisma: any,
    opts: { limit: number },
  ) => Promise<ConflictListItem[]>;
  countOpen: (prisma: any) => Promise<number>;
  getDetail: (prisma: any, id: string) => Promise<ConflictDetail | null>;
  decide: (args: ConflictDecisionArgs, prisma: any) => Promise<AdminAction>;
}
