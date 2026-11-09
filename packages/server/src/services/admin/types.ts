import type {
  AdminActionType,
  ConflictType,
  ConflictDecision,
  FreezeCategory,
} from '@prisma/client';

export interface FreezePayload {
  userId: string;
  adminId: string;
  reason: string;
  category: FreezeCategory;
  notify: boolean;
}

export interface UnfreezePayload {
  userId: string;
  adminId: string;
  reason: string;
  releasePayouts: boolean;
  notify: boolean;
}

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

export interface ConflictDecisionPayload {
  id: string;
  decision: ConflictDecision;
  reason: string;
  adminId: string;
}

export interface AdminActionRow {
  id: string;
  adminId: string;
  action: AdminActionType;
  targetType: string;
  targetId: string;
  payload: unknown;
  reason: string;
  conflictType: ConflictType | null;
  conflictDecision: ConflictDecision | null;
  prevHash: string;
  entryHash: string;
  crossLinkedEscrowAuditLogId: string | null;
  createdAt: Date;
}

export interface ConflictModule {
  listOpen: (
    prisma: any,
    opts: { limit: number },
  ) => Promise<ConflictListItem[]>;
  getDetail: (prisma: any, id: string) => Promise<ConflictDetail | null>;
  decide: (
    args: ConflictDecisionPayload,
    prisma: any,
  ) => Promise<AdminActionRow>;
  countOpen: (prisma: any) => Promise<number>;
}
