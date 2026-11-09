// ADMIN-ACTION AUDIT CHAIN
//
// HAZARD: this module has NO internal try/catch by design. A thrown
// error during append (e.g. DB unavailable, hash collision detection)
// propagates up to the caller's transaction; the transaction rolls
// back; chain integrity is preserved (no partial writes).
//
// Callers MUST wrap audit appends inside their own prisma.$transaction
// so audit failures roll back the underlying business action. Callers
// MAY add Sentry capture in their catch block — the audit service
// deliberately does not, to avoid double-capture noise when the
// error-handler middleware also captures.

import crypto from 'crypto';
import type {
  AdminAction,
  AdminActionType,
  ConflictType,
  ConflictDecision,
} from '@prisma/client';
import prisma from '../../prisma';

export interface AppendAdminActionArgs {
  adminId: string;
  action: AdminActionType;
  targetType: string;
  targetId: string;
  reason: string;
  payload?: Record<string, unknown>;
  conflictType?: ConflictType | null;
  conflictDecision?: ConflictDecision | null;
  crossLinkedEscrowAuditLogId?: string | null;
}

interface HashInput {
  adminId: string;
  action: AdminActionType;
  targetType: string;
  targetId: string;
  reason: string;
  payload: Record<string, unknown>;
  conflictType: ConflictType | null;
  conflictDecision: ConflictDecision | null;
  prevHash: string;
  timestamp: string;
}

function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalJson((obj as any)[k]))
      .join(',') +
    '}'
  );
}

export function computeAdminActionHash(input: HashInput): string {
  return crypto
    .createHash('sha256')
    .update(canonicalJson(input), 'utf8')
    .digest('hex');
}

// BID-ATOMICITY G4 — single-winner conflict decisions. Every conflict
// module's "open" predicate is "no AdminAction with this (action,
// targetType, targetId) yet", which is a stale read: two admins deciding
// the same conflict concurrently both see it open, and both transactions
// proceed (double audit entries, and a second settlement attempt that
// either 500s on an invalid transition or silently no-ops while still
// recording a decision row). This claim runs FIRST inside the module's
// decide transaction: a transaction-scoped advisory lock per
// (conflictType, targetId) serializes racing decides — the loser's
// existence check then sees the winner's committed AdminAction and
// throws ALREADY_DECIDED (mapped to 409 by the route), rolling back with
// no side-effects. Same xact-lock rationale as services/job-lock.ts: the
// lock dies with the transaction, so a crashed decide can never leak it.
//
// The lock statement is skipped when the tx lacks $queryRaw (unit-test
// mocks); the existence check still runs, preserving the sequential
// "already decided" behaviour there.
export async function assertConflictUndecidedTx(
  tx: any,
  args: {
    action: AdminActionType;
    targetType: string;
    targetId: string;
    conflictType: ConflictType;
  },
): Promise<void> {
  if (typeof tx.$queryRaw === 'function') {
    const lockKey = `conflict-decision:${args.conflictType}:${args.targetId}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS locked`;
  }
  const existing = await tx.adminAction.findFirst({
    where: {
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId,
    },
  });
  if (existing) {
    const err: any = new Error('ALREADY_DECIDED');
    err.code = 'ALREADY_DECIDED';
    throw err;
  }
}

export async function appendAdminActionTx(
  tx: any,
  args: AppendAdminActionArgs,
): Promise<AdminAction> {
  const last = await tx.adminAction.findFirst({
    orderBy: { createdAt: 'desc' },
  });
  const prevHash: string = last?.entryHash ?? '';
  const now = new Date();
  const payload = args.payload ?? {};
  const entryHash = computeAdminActionHash({
    adminId: args.adminId,
    action: args.action,
    targetType: args.targetType,
    targetId: args.targetId,
    reason: args.reason,
    payload,
    conflictType: args.conflictType ?? null,
    conflictDecision: args.conflictDecision ?? null,
    prevHash,
    timestamp: now.toISOString(),
  });
  return tx.adminAction.create({
    data: {
      adminId: args.adminId,
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId,
      payload: payload as any,
      reason: args.reason,
      conflictType: args.conflictType ?? null,
      conflictDecision: args.conflictDecision ?? null,
      crossLinkedEscrowAuditLogId: args.crossLinkedEscrowAuditLogId ?? null,
      prevHash,
      entryHash,
      createdAt: now,
    },
  });
}

export async function appendAdminAction(
  args: AppendAdminActionArgs,
): Promise<AdminAction> {
  return prisma.$transaction((tx) => appendAdminActionTx(tx, args));
}

export async function verifyAdminActionChain(): Promise<{
  valid: boolean;
  brokenAt: string | null;
  entries: number;
}> {
  const all = await prisma.adminAction.findMany({
    orderBy: { createdAt: 'asc' },
  });
  let prevHash = '';
  for (const row of all) {
    if (row.prevHash !== prevHash) {
      return { valid: false, brokenAt: row.id, entries: all.length };
    }
    const expected = computeAdminActionHash({
      adminId: row.adminId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      reason: row.reason,
      payload: (row.payload as Record<string, unknown>) ?? {},
      conflictType: row.conflictType,
      conflictDecision: row.conflictDecision,
      prevHash,
      timestamp: row.createdAt.toISOString(),
    });
    if (row.entryHash !== expected) {
      return { valid: false, brokenAt: row.id, entries: all.length };
    }
    prevHash = row.entryHash;
  }
  return { valid: true, brokenAt: null, entries: all.length };
}
