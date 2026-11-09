// ACCOUNT-RIGHTS-SURFACE G6 — what ops can see about deletions.
//
// Built on AdminFlaggedUsers' shape deliberately (fetch, list, per-row
// testid, no framework): the two screens answer the same kind of question
// and an operator should not have to learn a second idiom.
//
// The column that justifies the screen is `deferredReason`. A deletion
// whose 72 hours have passed and which has not executed looks, from the
// outside, exactly like a broken job. This is where an operator sees that
// it is not broken — it is waiting on a live escrow, or on a driver
// balance we still owe — and can go and clear the thing it waits on.
//
// Nicknames are real on PENDING and CANCELLED rows: a requester is not
// anonymised until the erasure runs. An EXECUTED row reads "Deleted User",
// which is the anonymisation showing through and is exactly right.

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import type { DeferralReason } from '@bimoto/shared';

interface DeletionRequestRow {
  id: string;
  userId: string;
  nickname: string;
  status: string;
  requestedAt: string;
  executesAt: string;
  cancelledAt: string | null;
  executedAt: string | null;
  deferredReason: DeferralReason | string | null;
}

/** Operator-facing English, not the user-facing localized sentence: this
 *  screen is read by ops, and a code plus a short gloss is more useful to
 *  someone about to go and unblock it than a reassuring paragraph. */
const REASON_GLOSS: Record<DeferralReason, string> = {
  NON_TERMINAL_JOURNEY: 'a ride is still in progress',
  LIVE_ESCROW: 'money is still held in escrow',
  // CUTGUARD v2 G5 — the obligation audit's three. The Record type
  // demanded them the moment the union grew, which is the second time in
  // this dispatch the compiler found a map nobody remembered.
  OPEN_BID: 'they have a live offer out on someone\u2019s ride',
  UNRESOLVED_EMERGENCY: 'an emergency they raised is still ACTIVE',
  ACCOUNT_FROZEN: 'the account is frozen',
  POSITIVE_DRIVER_BALANCE: 'we still owe them a payout',
  IN_FLIGHT_PAYOUT: 'a transfer to them has not settled at the processor yet',
  SCHEDULED_PAYOUT: 'a preference-change payout is booked and not yet fired',
};

function reasonGloss(reason: string | null): string | null {
  if (!reason) return null;
  return (REASON_GLOSS as Record<string, string>)[reason] ?? null;
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

export default function AdminDeletionRequests() {
  const [requests, setRequests] = useState<DeletionRequestRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch(`/api/admin/deletion-requests`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => setRequests(data.requests || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Account deletion requests</h1>
      <p className="text-sm text-gray-500 mb-4">
        Everything still open, plus erasures executed in the last 30 days.
      </p>
      {requests.length === 0 ? (
        <p className="text-gray-500">No deletion requests</p>
      ) : (
        <div className="space-y-4">
          {requests.map(r => {
            const gloss = reasonGloss(r.deferredReason as string | null);
            return (
              <div
                key={r.id}
                data-testid={`deletion-request-${r.id}`}
                className="bg-white rounded-lg shadow p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{r.nickname}</div>
                  <div
                    className="text-xs font-semibold uppercase text-gray-600"
                    data-testid={`deletion-status-${r.id}`}
                  >
                    {r.status}
                  </div>
                </div>
                <div className="text-sm text-gray-500">User: {r.userId}</div>
                <div className="text-sm">Requested: {fmt(r.requestedAt)}</div>
                <div className="text-sm">Due: {fmt(r.executesAt)}</div>
                {r.cancelledAt && <div className="text-sm">Cancelled: {fmt(r.cancelledAt)}</div>}
                {r.executedAt && <div className="text-sm">Executed: {fmt(r.executedAt)}</div>}
                {r.deferredReason && (
                  <div
                    className="mt-1 text-sm text-amber-800"
                    data-testid={`deletion-reason-${r.id}`}
                  >
                    Deferred: {r.deferredReason}
                    {gloss ? ` — ${gloss}` : ''}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
