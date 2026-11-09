import prisma from '../../prisma';
import type { FlwTxnRecord } from './gateway-query';

export interface DiffInput {
  gatewayRecords: FlwTxnRecord[];
  since: Date;
}

export interface GatewayOnly {
  txRef: string;
  amount: number;
  status: string;
}

export interface LedgerOnly {
  txRef: string;
  amount: number;
  ledgerStatus: string;
  escrowId: string;
}

export interface Mismatch {
  txRef: string;
  ledgerStatus: string;
  gatewayStatus: string;
  amount: number;
  escrowId: string;
}

export interface DiffResult {
  matches: number;
  missingFromLedger: GatewayOnly[];
  missingFromGateway: LedgerOnly[];
  statusMismatch: Mismatch[];
}

const CONFIRMED_GATEWAY_STATUSES = new Set(['successful', 'success']);
const FAILED_GATEWAY_STATUSES = new Set(['failed', 'cancelled']);

function gatewayBucket(status: string): 'CONFIRMED' | 'FAILED' | 'PENDING' {
  const s = status.toLowerCase();
  if (CONFIRMED_GATEWAY_STATUSES.has(s)) return 'CONFIRMED';
  if (FAILED_GATEWAY_STATUSES.has(s)) return 'FAILED';
  return 'PENDING';
}

function ledgerBucket(status: string): 'CONFIRMED' | 'FAILED' | 'PENDING' {
  if (status === 'HELD' || status === 'RELEASED') return 'CONFIRMED';
  if (status === 'FAILED' || status === 'REFUNDED') return 'FAILED';
  return 'PENDING';
}

export async function diffGatewayVsLedger(input: DiffInput): Promise<DiffResult> {
  const escrows = await prisma.escrow.findMany({
    where: {
      txRef: { not: null },
      createdAt: { gte: input.since },
    },
    select: { id: true, txRef: true, status: true, amount: true },
  });

  const ledgerByRef = new Map<string, (typeof escrows)[number]>();
  for (const e of escrows) {
    if (e.txRef) ledgerByRef.set(e.txRef, e);
  }

  const result: DiffResult = {
    matches: 0,
    missingFromLedger: [],
    missingFromGateway: [],
    statusMismatch: [],
  };

  const seenRefs = new Set<string>();

  for (const tx of input.gatewayRecords) {
    seenRefs.add(tx.tx_ref);
    const ledger = ledgerByRef.get(tx.tx_ref);
    if (!ledger) {
      result.missingFromLedger.push({
        txRef: tx.tx_ref,
        amount: tx.amount,
        status: tx.status,
      });
      continue;
    }
    const gBucket = gatewayBucket(tx.status);
    const lBucket = ledgerBucket(ledger.status);
    if (gBucket !== lBucket) {
      result.statusMismatch.push({
        txRef: tx.tx_ref,
        ledgerStatus: ledger.status,
        gatewayStatus: tx.status,
        amount: ledger.amount,
        escrowId: ledger.id,
      });
    } else {
      result.matches++;
    }
  }

  for (const e of escrows) {
    if (!e.txRef || seenRefs.has(e.txRef)) continue;
    // Only flag CONFIRMED ledger rows the gateway has no record of —
    // PENDING in our DB just means "not yet reached gateway", which is
    // expected and handled by the payment-reconciliation poller.
    if (ledgerBucket(e.status) !== 'CONFIRMED') continue;
    result.missingFromGateway.push({
      txRef: e.txRef,
      amount: e.amount,
      ledgerStatus: e.status,
      escrowId: e.id,
    });
  }

  return result;
}
