import { getClient } from '../../services/payment/flutterwave-client';
import { mapFlwError, FlutterwaveError } from '../../services/payment/errors';

export interface FlwTxnRecord {
  tx_ref: string;
  amount: number;
  status: string;
  created_at: string;
  flwId?: string;
}

interface QueryInput {
  from: Date;
  to: Date;
}

const MAX_RETRIES = 4;
const RATE_LIMIT_BACKOFF_MS = [1000, 2000, 4000, 8000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref?.());
}

/**
 * Pulls every transaction from Flutterwave whose created_at falls inside
 * [from, to). Defensive against rate-limit (HTTP 429) — sleep + retry up
 * to 4 times before giving up.
 */
export async function queryFlutterwaveTransactions(
  input: QueryInput,
): Promise<FlwTxnRecord[]> {
  const flw = getClient() as any;

  const fromIso = input.from.toISOString();
  const toIso = input.to.toISOString();
  const out: FlwTxnRecord[] = [];

  let page = 1;
  while (true) {
    let attempt = 0;
    let raw: any = null;
    while (attempt < MAX_RETRIES) {
      try {
        raw = await flw.Transaction.fetch_multiple_transactions({
          from: fromIso,
          to: toIso,
          page,
        });
        break;
      } catch (err) {
        const httpStatus = (err as any)?.response?.status ?? (err as any)?.httpStatus;
        const isRate = httpStatus === 429;
        if (!isRate || attempt === MAX_RETRIES - 1) {
          throw err instanceof FlutterwaveError ? err : mapFlwError(err);
        }
        await sleep(RATE_LIMIT_BACKOFF_MS[attempt]);
        attempt++;
      }
    }

    const data: any[] = raw?.data ?? [];
    for (const t of data) {
      out.push({
        tx_ref: String(t.tx_ref ?? ''),
        amount: Number(t.amount ?? 0),
        status: String(t.status ?? ''),
        created_at: String(t.created_at ?? ''),
        flwId: t.id != null ? String(t.id) : undefined,
      });
    }

    const meta = raw?.meta?.page_info ?? raw?.meta ?? {};
    const totalPages = Number(meta.total_pages ?? meta.totalPages ?? 1);
    if (page >= totalPages || data.length === 0) break;
    page++;
  }

  return out;
}
