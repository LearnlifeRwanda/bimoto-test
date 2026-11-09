import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api';

interface ConflictTypeCount {
  type: string;
  count: number;
}

interface ConflictsResponse {
  counts: ConflictTypeCount[];
}

const TYPE_LABELS: Record<string, { label: string; description: string }> = {
  JOURNEY_RECONCILIATION: {
    label: 'Journey Reconciliation',
    description: 'Customer + driver disagreed on journey outcome',
  },
  AML_APPEAL: {
    label: 'AML Appeal',
    description: 'User appealing an AML/CFT flag',
  },
  BID_MANIPULATION: {
    label: 'Bid Manipulation',
    description: 'Suspected bid manipulation patterns',
  },
  GPS_PLAUSIBILITY: {
    label: 'GPS Plausibility',
    description: 'Implausible journey trace flagged',
  },
  STALE_DRIVER_NO_SHOW: {
    label: 'Stale Driver / No-Show',
    description: 'Driver disconnected mid-trip or never started',
  },
  PHOTO_MISMATCH: {
    label: 'Photo Mismatch',
    description: 'Verification photo does not match reference',
  },
  GRAPH_ANOMALY: {
    label: 'Graph Anomaly',
    description: 'Multi-actor adversarial pattern detected',
  },
  DRIVER_NO_SHOW_DISPUTE: {
    label: 'Driver No-Show Dispute',
    description: 'Driver disputes a no-show attribution',
  },
  RECIPIENT_DISPUTE: {
    label: 'Recipient Disputes',
    description: 'Recipient SMS-flagged a parcel as wrong or damaged',
  },
  // TEAM-ANSWERS G3 — the tenth type. No new admin screen: the list,
  // the detail and the decide modal are all type-driven, so a report
  // arrives here through the same machinery as everything else.
  RIDE_REPORT: {
    label: 'Ride Reports',
    description: 'Driver reported a problem with a ride they drove',
  },
};

export default function AdminConflicts() {
  const [data, setData] = useState<ConflictsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(`/api/admin/conflicts`, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load conflicts');
        return res.json();
      })
      .then((d: ConflictsResponse) => setData(d))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-4">Loading conflicts...</div>;
  if (error) return <div className="p-4 text-red-600">Error: {error}</div>;
  if (!data) return <div className="p-4">No data</div>;

  const total = data.counts.reduce((acc, c) => acc + c.count, 0);

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="mb-4">
        <Link to="/admin" className="text-blue-600 hover:underline">
          ← Back to dashboard
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-2">Conflicts</h1>
      <p className="text-gray-600 mb-6">
        {total} open conflict{total === 1 ? '' : 's'} across {data.counts.length} types.
      </p>
      <div className="space-y-3">
        {data.counts.map((c) => {
          const meta = TYPE_LABELS[c.type] ?? {
            label: c.type,
            description: '(unknown type)',
          };
          return (
            <Link
              key={c.type}
              to={`/admin/conflicts/${c.type}`}
              className={`block p-4 rounded-lg border ${
                c.count > 0
                  ? 'bg-red-50 border-red-200 hover:bg-red-100'
                  : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{meta.label}</div>
                  <div className="text-sm text-gray-600">{meta.description}</div>
                </div>
                <div
                  className={`text-2xl font-bold ${
                    c.count > 0 ? 'text-red-600' : 'text-gray-500'
                  }`}
                >
                  {c.count}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      <div className="mt-6 pt-6 border-t">
        <Link
          to="/admin/conflicts/audit"
          className="block p-3 bg-blue-50 rounded-lg hover:bg-blue-100"
        >
          View Audit Log →
        </Link>
      </div>
    </div>
  );
}
