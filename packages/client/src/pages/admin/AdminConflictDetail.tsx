import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AdminConflictDecideModal } from './AdminConflictDecideModal';
import { apiFetch } from '../../lib/api';

interface ConflictDetail {
  id: string;
  type: string;
  summary: string;
  createdAt: string;
  data: Record<string, unknown>;
}

interface DetailResponse {
  detail: ConflictDetail;
  validDecisions: string[];
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

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  override render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function DataView({ data }: { data: Record<string, unknown> }) {
  const keys = Object.keys(data);
  return (
    <div className="space-y-4">
      {keys.map((key) => (
        <div key={key} className="bg-white border rounded p-3">
          <div className="text-sm font-mono text-gray-500 mb-1">{key}</div>
          <pre className="text-xs overflow-auto max-h-64 bg-gray-50 p-2 rounded">
            {JSON.stringify(data[key], null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

export default function AdminConflictDetail() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decideModalOpen, setDecideModalOpen] = useState(false);

  useEffect(() => {
    if (!type || !VALID_TYPES.has(type)) {
      setError('Invalid conflict type');
      setLoading(false);
      return;
    }
    if (!id) {
      setError('Missing conflict ID');
      setLoading(false);
      return;
    }
    apiFetch(`/api/admin/conflicts/${type}/${id}`, {
      credentials: 'include',
    })
      .then((res) => {
        if (res.status === 404) throw new Error('Conflict not found');
        if (!res.ok) throw new Error('Failed to load detail');
        return res.json();
      })
      .then((d: DetailResponse) => setData(d))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [type, id]);

  if (loading) return <div className="p-4">Loading detail...</div>;
  if (error) return <div className="p-4 text-red-600">Error: {error}</div>;
  if (!data) return <div className="p-4">No data</div>;

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="mb-4">
        <Link
          to={`/admin/conflicts/${type}`}
          className="text-blue-600 hover:underline"
        >
          ← Back to {type} list
        </Link>
      </div>
      <h1 className="text-xl font-bold mb-2">{data.detail.summary}</h1>
      <div className="text-sm text-gray-500 mb-4">
        ID: {data.detail.id} · Type: {data.detail.type} · Created:{' '}
        {new Date(data.detail.createdAt).toLocaleString()}
      </div>
      <div className="mb-6">
        <button
          onClick={() => setDecideModalOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Decide this conflict
        </button>
      </div>
      {decideModalOpen && (
        <AdminConflictDecideModal
          conflictType={type!}
          conflictId={id!}
          validDecisions={data.validDecisions}
          onSuccess={() => {
            setDecideModalOpen(false);
            navigate(`/admin/conflicts/${type}`, { replace: true });
          }}
          onCancel={() => setDecideModalOpen(false)}
        />
      )}
      <ErrorBoundary
        fallback={
          <div className="p-4 bg-red-50 border border-red-200 rounded">
            Detail rendering failed. Raw data:
            <pre className="text-xs overflow-auto max-h-96 mt-2 bg-white p-2 rounded">
              {JSON.stringify(data.detail.data, null, 2)}
            </pre>
          </div>
        }
      >
        <DataView data={data.detail.data} />
      </ErrorBoundary>
    </div>
  );
}
