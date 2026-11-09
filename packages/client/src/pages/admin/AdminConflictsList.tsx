import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../../lib/api';

interface ConflictListItem {
  id: string;
  type: string;
  summary: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

interface ListResponse {
  items: ConflictListItem[];
}

const VALID_TYPES = new Set([
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
]);

export default function AdminConflictsList() {
  const { type } = useParams<{ type: string }>();
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!type || !VALID_TYPES.has(type)) {
      setError('Invalid conflict type');
      setLoading(false);
      return;
    }
    apiFetch(`/api/admin/conflicts/${type}?limit=100`, {
      credentials: 'include',
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load list');
        return res.json();
      })
      .then((d: ListResponse) => setData(d))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [type]);

  if (loading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-red-600">Error: {error}</div>;
  if (!data) return <div className="p-4">No data</div>;

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="mb-4">
        <Link to="/admin/conflicts" className="text-blue-600 hover:underline">
          ← Back to conflicts
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-4">{type}</h1>
      <p className="text-gray-600 mb-6">
        {data.items.length} open conflict{data.items.length === 1 ? '' : 's'}.
      </p>
      {data.items.length === 0 ? (
        <p className="text-gray-500 italic">No open conflicts of this type.</p>
      ) : (
        <div className="space-y-2">
          {data.items.map((item) => (
            <Link
              key={item.id}
              to={`/admin/conflicts/${type}/${item.id}`}
              className="block p-3 bg-white border rounded-lg hover:bg-gray-50"
            >
              <div className="font-semibold">{item.summary}</div>
              <div className="text-xs text-gray-500 mt-1">
                {new Date(item.createdAt).toLocaleString()} · ID: {item.id}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
