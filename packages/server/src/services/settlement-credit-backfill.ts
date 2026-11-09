import prisma from '../prisma';
import { appendAuditEntryTx } from './escrow-audit.service';
import { creditDriverBalance } from './payout.service';

/**
 * ESCROW-CREDIT G4 — remediation for journeys settled by the pre-G1
 * auto-confirm job, which released escrow (status → RELEASED, RELEASED
 * audit entry, totalRides increment) but never credited the driver's
 * balance and never incremented completedShifts.
 *
 * Detection is evidence-based, from the audit trail alone:
 *
 *   - Only the auto-confirm job has ever written a RELEASED audit entry
 *     with triggeredBy = 'SYSTEM'. Every other writer signs differently:
 *     manual confirm and reconciliation use the customerId, the admin
 *     dispute routes and conflict resolvers use the adminId, and the
 *     audit backfill (audit-backfill.ts) uses the driverId plus a
 *     metadata.backfilled flag.
 *   - Since G1, the auto-confirm path settles via releaseEscrowTx and
 *     stamps metadata.settledVia on its RELEASED entries — those journeys
 *     WERE credited. A SYSTEM RELEASED entry without settledVia is
 *     therefore exactly the uncredited inline release.
 *   - Applying the repair writes a BACKFILL_SETTLEMENT_CREDIT audit entry
 *     in the same transaction as the credit; its presence excludes the
 *     escrow from every future run. The audit trail is both the detector
 *     and the idempotency ledger.
 *
 * The repair applies ONLY the missing pieces: the ledger credit
 * (DriverBalance.pendingAmount) and the completedShifts increment.
 * totalRides and completedRides were already incremented by the old code.
 * No payout batch or transfer is created — the repaired pendingAmount is
 * drained by the next scheduled sweep, exactly as an on-time credit would
 * have been.
 */

export interface ShortchangedSettlement {
  escrowId: string;
  journeyId: string;
  driverId: string;
  driverPayout: number;
  releasedAt: Date | null;
}

export interface AmbiguousSettlement {
  escrowId: string;
  reason: string;
}

export interface SettlementBackfillReport {
  /** SYSTEM-released escrows examined (candidate universe). */
  scanned: number;
  /** Credited correctly (post-G1 settledVia entries) — nothing to do. */
  alreadySettled: number;
  /** Already repaired by a previous run — nothing to do. */
  alreadyRepaired: number;
  /** Evidence insufficient — refused, listed for manual review. */
  ambiguous: AmbiguousSettlement[];
  /** The shortchanged journeys this run found (and, if apply, repaired). */
  findings: ShortchangedSettlement[];
  /** Sum of driverPayout across findings, in RWF. */
  totalAmount: number;
  /** True when the credits were actually applied (not a dry run). */
  applied: boolean;
}

function hasSettledViaMetadata(entry: { metadata: unknown }): boolean {
  const md = entry.metadata as Record<string, unknown> | null;
  return md != null && typeof md === 'object' && 'settledVia' in md;
}

function isBackfilledEntry(entry: { metadata: unknown }): boolean {
  const md = entry.metadata as Record<string, unknown> | null;
  return md != null && typeof md === 'object' && md.backfilled === true;
}

export async function findShortchangedSettlements(): Promise<{
  scanned: number;
  alreadySettled: number;
  alreadyRepaired: number;
  ambiguous: AmbiguousSettlement[];
  findings: ShortchangedSettlement[];
}> {
  const systemReleases = await prisma.escrowAuditLog.findMany({
    where: { action: 'RELEASED', triggeredBy: 'SYSTEM' },
    select: { escrowId: true, metadata: true },
  });

  const candidateIds = [...new Set(systemReleases.map((e: any) => e.escrowId))];
  const result = {
    scanned: candidateIds.length,
    alreadySettled: 0,
    alreadyRepaired: 0,
    ambiguous: [] as AmbiguousSettlement[],
    findings: [] as ShortchangedSettlement[],
  };
  if (candidateIds.length === 0) return result;

  // All RELEASED entries (any signer) — an escrow with more than one
  // RELEASED entry has a history this script does not understand.
  const allReleasedEntries = await prisma.escrowAuditLog.findMany({
    where: { escrowId: { in: candidateIds }, action: 'RELEASED' },
    select: { escrowId: true, metadata: true },
  });
  const repairMarkers = await prisma.escrowAuditLog.findMany({
    where: { escrowId: { in: candidateIds }, action: 'BACKFILL_SETTLEMENT_CREDIT' },
    select: { escrowId: true },
  });
  const repairedIds = new Set<string>(repairMarkers.map((m: any) => m.escrowId));

  const escrows = await prisma.escrow.findMany({
    where: { id: { in: candidateIds } },
    select: {
      id: true,
      journeyId: true,
      driverId: true,
      driverPayout: true,
      status: true,
      releasedAt: true,
    },
  });
  const escrowById = new Map<string, any>(escrows.map((e: any) => [e.id, e]));

  const releasedCount = new Map<string, number>();
  for (const entry of allReleasedEntries) {
    releasedCount.set(entry.escrowId, (releasedCount.get(entry.escrowId) ?? 0) + 1);
  }

  for (const escrowId of candidateIds) {
    const sysEntries = systemReleases.filter((e: any) => e.escrowId === escrowId);

    if (repairedIds.has(escrowId)) {
      result.alreadyRepaired++;
      continue;
    }
    if (sysEntries.some(hasSettledViaMetadata)) {
      // Settled through releaseEscrowTx (post-G1) — credit already applied.
      result.alreadySettled++;
      continue;
    }

    const escrow = escrowById.get(escrowId);
    if (!escrow) {
      result.ambiguous.push({ escrowId, reason: 'escrow row missing for RELEASED audit entry' });
      continue;
    }
    if (escrow.status !== 'RELEASED') {
      result.ambiguous.push({
        escrowId,
        reason: `RELEASED audit entry but escrow status is ${escrow.status}`,
      });
      continue;
    }
    if ((releasedCount.get(escrowId) ?? 0) > 1) {
      result.ambiguous.push({ escrowId, reason: 'multiple RELEASED audit entries' });
      continue;
    }
    if (sysEntries.some(isBackfilledEntry)) {
      result.ambiguous.push({
        escrowId,
        reason: 'RELEASED entry is a synthetic audit backfill, not an observed release',
      });
      continue;
    }
    if (escrow.driverPayout <= 0) {
      result.ambiguous.push({
        escrowId,
        reason: `non-positive driverPayout (${escrow.driverPayout})`,
      });
      continue;
    }

    result.findings.push({
      escrowId: escrow.id,
      journeyId: escrow.journeyId,
      driverId: escrow.driverId,
      driverPayout: escrow.driverPayout,
      releasedAt: escrow.releasedAt,
    });
  }

  return result;
}

export async function runSettlementCreditBackfill(
  opts: { apply?: boolean } = {},
): Promise<SettlementBackfillReport> {
  const apply = opts.apply === true;
  const detection = await findShortchangedSettlements();

  const report: SettlementBackfillReport = {
    ...detection,
    totalAmount: detection.findings.reduce((sum, f) => sum + f.driverPayout, 0),
    applied: apply,
  };

  if (!apply) return report;

  for (const f of report.findings) {
    // One transaction per journey: the credit, the completedShifts
    // increment and the idempotency marker land together or not at all,
    // so a crash mid-run can never credit without marking (double-pay on
    // re-run) or mark without crediting (permanently lost earnings).
    await prisma.$transaction(async (tx: any) => {
      // Re-assert the marker inside the transaction so two overlapping
      // runs cannot both credit the same journey.
      const marker = await tx.escrowAuditLog.findFirst({
        where: { escrowId: f.escrowId, action: 'BACKFILL_SETTLEMENT_CREDIT' },
      });
      if (marker) return;

      await creditDriverBalance(f.driverId, f.driverPayout, tx);
      await tx.user.update({
        where: { id: f.driverId },
        data: { completedShifts: { increment: 1 } },
      });
      await appendAuditEntryTx(
        tx,
        f.escrowId,
        'BACKFILL_SETTLEMENT_CREDIT',
        f.driverPayout,
        'SYSTEM',
        {
          backfill: true,
          reason: 'auto-confirm released escrow without crediting the driver',
          creditedAmount: f.driverPayout,
          completedShiftsIncremented: true,
          backfilledAt: new Date().toISOString(),
        },
      );
    });
  }

  return report;
}
