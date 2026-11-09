import { useCallback, useEffect, useState } from 'react';
import { ErrorState } from '../../components/ui/ErrorState';
import { getVehicleCompliance } from '@bimoto/shared';
import { apiFetch } from '../../lib/api';
import { DocumentLink } from '../../components/admin/DocumentLink';

// BIKE-GATE — what the approval gate actually enforces, derived from
// the same compliance matrix the server consults: the person identifier
// (jacket number) for every vehicle type, the plate only where
// registrationRequired. Field names mirror the gate's `missing` list.
const GATE_FIELD_LABELS: Record<string, string> = {
  ruraAuthorizationNumber: 'driver number (jacket)',
  registrationPlate: 'registration plate',
};

function approvalRequirements(vehicleType: string): string {
  const compliance = getVehicleCompliance(vehicleType);
  const parts = [
    compliance.ruraRequired ? 'RURA number' : 'driver number (jacket)',
  ];
  if (compliance.registrationRequired) parts.push('registration plate');
  return parts.join(' + ');
}

interface Verification {
  id: string;
  userId: string;
  vehicleType: string;
  drivingLicenseNumber: string | null;
  ruraAuthorizationNumber: string | null;
  registrationPlate: string | null;
  drivingLicensePhotoUrl: string | null;
  ruraAuthorizationPhotoUrl: string | null;
  insurancePhotoUrl: string | null;
  verificationStatus: string;
  user: { id: string; nickname: string };
}

// '' = the default pending queue (PENDING + UNDER_REVIEW server-side).
const STATUS_FILTERS = ['', 'VERIFIED', 'REJECTED', 'REVOKED'] as const;

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  UNDER_REVIEW: 'bg-blue-100 text-blue-800',
  VERIFIED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  REVOKED: 'bg-red-100 text-red-800',
};

export default function AdminVerifications() {
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [loading, setLoading] = useState(true);
  // NET-UX G3 — failed queue load is retryable, never a fake empty queue.
  const [loadFailed, setLoadFailed] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [revokeReason, setRevokeReason] = useState<Record<string, string>>({});
  const [revokeConfirming, setRevokeConfirming] = useState<string | null>(null);
  const [revokeSubmitting, setRevokeSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  const load = useCallback(() => {
    setLoading(true);
    setLoadFailed(false);
    const query = statusFilter ? `?status=${statusFilter}` : '';
    apiFetch(`/api/admin/verifications${query}`, { credentials: 'include' })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(data => setVerifications(data.verifications || []))
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, [API_URL, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (userId: string) => {
    setActionError(null);
    const res = await apiFetch(`/api/admin/verifications/${userId}/approve`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data?.error?.code === 'DRIVER_MISSING_IDENTIFIERS') {
        const missing: string[] = Array.isArray(data?.error?.details?.missing)
          ? data.error.details.missing
          : [];
        const missingLabels = missing
          .map(field => GATE_FIELD_LABELS[field] ?? field)
          .join(', ');
        setActionError(
          `Cannot approve: still missing ${missingLabels || 'required identifiers'}.`,
        );
      } else {
        setActionError(`Approve failed (${data?.error?.code ?? res.status}).`);
      }
      return;
    }
    setVerifications(v => v.filter(item => item.userId !== userId));
  };

  const reject = async (userId: string) => {
    const reason = rejectReason[userId];
    if (!reason) return alert('Please provide a reason');
    await apiFetch(`/api/admin/verifications/${userId}/reject`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    setVerifications(v => v.filter(item => item.userId !== userId));
  };

  const revoke = async (userId: string) => {
    setRevokeSubmitting(true);
    setActionError(null);
    setOutcome(null);
    try {
      const res = await apiFetch(`/api/admin/verifications/${userId}/revoke`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: (revokeReason[userId] ?? '').trim() }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error?.code ?? `Request failed (${res.status})`);
      }
      const settled = payload.settlement?.deferredForFreeze
        ? 'settlement deferred (account frozen — runs after unfreeze)'
        : payload.settlement?.batchId
          ? `${payload.settlement.amount.toLocaleString()} RWF settlement fired`
          : 'no balance to settle';
      setOutcome(
        `Driver revoked — ${payload.withdrawnBidCount} open bid(s) withdrawn, ${settled}.`,
      );
      load();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setRevokeSubmitting(false);
      setRevokeConfirming(null);
    }
  };

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Driver Verifications</h1>

      <label className="block mb-4">
        <span className="text-sm text-gray-500 block">Status</span>
        <select
          aria-label="Status filter"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="border rounded p-2"
        >
          {STATUS_FILTERS.map(s => (
            <option key={s} value={s}>
              {s === '' ? 'Pending queue' : s}
            </option>
          ))}
        </select>
      </label>

      {outcome && (
        <div className="mb-3 p-2 bg-green-50 border border-green-300 rounded text-sm">
          {outcome}
        </div>
      )}
      {actionError && (
        <div className="mb-3 p-2 bg-red-50 border border-red-300 rounded text-sm">
          {actionError}
        </div>
      )}

      {loadFailed ? (
        <ErrorState onRetry={load} />
      ) : verifications.length === 0 ? (
        <p className="text-gray-500">
          {statusFilter ? 'No drivers with this status' : 'No pending verifications'}
        </p>
      ) : (
        <div className="space-y-4">
          {verifications.map(v => (
            <div key={v.id} className="bg-white rounded-lg shadow p-4">
              <div className="flex items-center gap-2">
                <div className="font-semibold">{v.user.nickname}</div>
                <span
                  className={`px-2 py-0.5 rounded text-xs ${STATUS_BADGE[v.verificationStatus] ?? 'bg-gray-100'}`}
                >
                  {v.verificationStatus}
                </span>
              </div>
              <div className="text-sm text-gray-500">Vehicle: {v.vehicleType}</div>
              <div className="text-xs text-gray-500">
                Required for approval: {approvalRequirements(v.vehicleType)}
              </div>
              {v.registrationPlate && <div className="text-sm">Plate: {v.registrationPlate}</div>}
              {v.drivingLicenseNumber && <div className="text-sm">License: {v.drivingLicenseNumber}</div>}
              {v.ruraAuthorizationNumber && (
                <div className="text-sm">
                  {getVehicleCompliance(v.vehicleType).ruraRequired ? 'RURA' : 'Driver Nº'}:{' '}
                  {v.ruraAuthorizationNumber}
                </div>
              )}
              {/* DOC-GUARD G2 — these were plain anchors to /uploads/...,
                  which the unauthenticated static mount served to anyone.
                  DocumentLink fetches through apiFetch so the admin's
                  token actually reaches the new authenticated route. */}
              {v.drivingLicensePhotoUrl && (
                <DocumentLink url={v.drivingLicensePhotoUrl} label="License Photo" />
              )}
              {v.ruraAuthorizationPhotoUrl && (
                <DocumentLink url={v.ruraAuthorizationPhotoUrl} label="RURA Photo" />
              )}
              {v.insurancePhotoUrl && (
                <DocumentLink url={v.insurancePhotoUrl} label="Insurance" />
              )}

              {v.verificationStatus !== 'VERIFIED' && v.verificationStatus !== 'REVOKED' && (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => approve(v.userId)} className="px-4 py-2 bg-green-700 text-white rounded">
                    Approve
                  </button>
                  <input
                    placeholder="Rejection reason"
                    value={rejectReason[v.userId] || ''}
                    onChange={e => setRejectReason({ ...rejectReason, [v.userId]: e.target.value })}
                    className="border rounded px-2 flex-1"
                  />
                  <button onClick={() => reject(v.userId)} className="px-4 py-2 bg-red-600 text-white rounded">
                    Reject
                  </button>
                </div>
              )}

              {v.verificationStatus !== 'REVOKED' && (
                <div className="mt-3 border-t pt-3">
                  {revokeConfirming === v.userId ? (
                    <div
                      data-testid="revoke-confirm-box"
                      className="p-3 bg-yellow-50 border border-yellow-300 rounded"
                    >
                      <div className="text-sm mb-2">
                        Revoke {v.user.nickname}? Their number stops validating immediately, all open
                        bids are withdrawn, and any remaining earnings are paid out through the normal
                        payout path (or settled after unfreeze if the account is frozen). Records are
                        kept; nothing is deleted. To return, the driver re-applies through verification.
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => revoke(v.userId)}
                          disabled={revokeSubmitting}
                          className="px-4 py-2 bg-red-600 text-white rounded disabled:opacity-50"
                        >
                          Confirm revoke
                        </button>
                        <button
                          onClick={() => setRevokeConfirming(null)}
                          disabled={revokeSubmitting}
                          className="px-4 py-2 border rounded"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 items-center">
                      <input
                        placeholder="Revocation reason (min 10 chars, audited)"
                        aria-label="Revocation reason"
                        value={revokeReason[v.userId] || ''}
                        onChange={e => setRevokeReason({ ...revokeReason, [v.userId]: e.target.value })}
                        className="border rounded px-2 py-2 flex-1"
                      />
                      <button
                        onClick={() => setRevokeConfirming(v.userId)}
                        disabled={(revokeReason[v.userId] ?? '').trim().length < 10}
                        className="px-4 py-2 bg-red-700 text-white rounded disabled:opacity-50"
                      >
                        Revoke…
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
