import prisma from '../../prisma';

export interface NameMatchInput {
  escrowId: string;
  customerId: string;
  walletNameOnReceipt: string | null | undefined;
  accountName: string | null | undefined;
  txRef: string;
}

export interface NameMatchResult {
  matched: boolean;
  distance?: number;
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev: number[] = new Array(b.length + 1);
  const curr: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

export async function recordNameMismatchIfDifferent(
  input: NameMatchInput,
): Promise<NameMatchResult> {
  const wallet = input.walletNameOnReceipt;
  const account = input.accountName;

  if (!wallet || !account) {
    return { matched: true };
  }

  const dist = levenshtein(normalise(wallet), normalise(account));
  if (dist <= 2) {
    return { matched: true, distance: dist };
  }

  try {
    await prisma.nameMismatchLog.create({
      data: {
        escrowId: input.escrowId,
        customerId: input.customerId,
        walletNameOnReceipt: wallet,
        accountName: account,
        txRef: input.txRef,
      },
    });
  } catch (err) {
    console.warn('[PAYMENT] Failed to log name mismatch:', err);
  }

  return { matched: false, distance: dist };
}
