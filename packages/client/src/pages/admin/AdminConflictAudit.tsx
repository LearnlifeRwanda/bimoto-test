import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api';

interface AdminAction {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  conflictType: string | null;
  conflictDecision: string | null;
  prevHash: string;
  entryHash: string;
  crossLinkedEscrowAuditLogId: string | null;
  createdAt: string;
}

interface AuditResponse {
  actions: AdminAction[];
}

interface VerifyResponse {
  valid: boolean;
  brokenAt: string | null;
  entries: number;
}

const TYPE_FILTERS: Array<string | null> = [
  null,
  'JOURNEY_RECONCILIATION',
  'AML_APPEAL',
  'BID_MANIPULATION',
  'GPS_PLAUSIBILITY',
  'STALE_DRIVER_NO_SHOW',
  'PHOTO_MISMATCH',
  'GRAPH_ANOMALY',
  'DRIVER_NO_SHOW_DISPUTE',
  'RECIPIENT_DISPUTE',
  'RIDE_REPORT',
];

export default function AdminConflictAudit() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResponse | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    // DEADWOOD G3 — the query string varies, the path does not, so the
    // path stays a literal at the call site and the wiring audit
    // (scripts/wiring-audit) can read it instead of filing it
    // UNRESOLVED. It also goes through apiFetch now, like the verify
    // call below and like every other authenticated call in this app:
    // this is an admin-only endpoint, and hand-rolling the URL was the
    // one thing keeping it out of the AUTH-REFRESH G4 gate
    // (__tests__/raw-fetch-guard.test.ts). Same URL, same method; it
    // gains the Authorization header and refresh-and-retry on 401.
    const query = filter ? `?type=${filter}&limit=100` : '?limit=100';
    apiFetch(`/api/admin/conflicts/audit${query}`, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load audit log');
        return res.json();
      })
      .then((d: AuditResponse) => setData(d))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filter]);

  const verify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await apiFetch(`/api/admin/conflicts/audit/verify`, {
        credentials: 'include',
      });
      const v: VerifyResponse = await res.json();
      setVerifyResult(v);
    } catch {
      setVerifyResult({ valid: false, brokenAt: 'fetch-failed', entries: 0 });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="mb-4">
        <Link to="/admin/conflicts" className="text-blue-600 hover:underline">
          ← Back to conflicts
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-4">Audit Log</h1>
      <div className="mb-4 p-3 bg-gray-50 rounded">
        <button
          onClick={verify}
          disabled={verifying}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {verifying ? 'Verifying...' : 'Verify chain integrity'}
        </button>
        {verifyResult && (
          <div
            className={`mt-3 p-2 rounded text-sm ${
              verifyResult.valid
                ? 'bg-green-100 text-green-800'
                : 'bg-red-100 text-red-800'
            }`}
          >
            {verifyResult.valid
              ? `✓ Chain intact (${verifyResult.entries} entries)`
              : `✗ Chain broken at ${verifyResult.brokenAt} (${verifyResult.entries} entries scanned)`}
          </div>
        )}
      </div>
      <div className="mb-4">
        <select
          value={filter ?? ''}
          onChange={(e) => setFilter(e.target.value || null)}
          className="border rounded px-3 py-2"
        >
          <option value="">All types</option>
          {TYPE_FILTERS.filter((t): t is string => t !== null).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <div>Loading audit log...</div>
      ) : error ? (
        <div className="text-red-600">Error: {error}</div>
      ) : !data || data.actions.length === 0 ? (
        <p className="text-gray-500 italic">No actions recorded.</p>
      ) : (
        <div className="space-y-2">
          {data.actions.map((a) => (
            <div key={a.id} className="p-3 bg-white border rounded">
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm">{a.action}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {new Date(a.createdAt).toLocaleString()} · admin{' '}
                    {a.adminId.slice(0, 8)}
                  </div>
                  <div className="text-sm text-gray-700 mt-1">{a.reason}</div>
                  {a.conflictType && a.conflictDecision && (
                    <div className="text-xs mt-1">
                      <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded mr-2">
                        {a.conflictType}
                      </span>
                      <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded">
                        → {a.conflictDecision}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
