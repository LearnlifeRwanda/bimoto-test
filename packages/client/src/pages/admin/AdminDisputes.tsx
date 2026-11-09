import { useCallback, useEffect, useState } from 'react';
import { ErrorState } from '../../components/ui/ErrorState';
import { apiFetch } from '../../lib/api';

interface DisputeJourney {
  id: string;
  status: string;
  pickupName: string;
  destinationName: string;
  agreedPrice: number | null;
  customer: { id: string; nickname: string };
  driver: { id: string; nickname: string } | null;
  escrow: { id: string; amount: number; status: string } | null;
  messages: { id: string; text: string; senderId: string; createdAt: string }[];
  gpsPoints: { lat: number; lng: number; timestamp: string }[];
}

export default function AdminDisputes() {
  const [disputes, setDisputes] = useState<DisputeJourney[]>([]);
  const [loading, setLoading] = useState(true);
  // NET-UX G3 — failed queue load is retryable, never a fake empty queue.
  const [loadFailed, setLoadFailed] = useState(false);
  const [resolveReason, setResolveReason] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    setLoadFailed(false);
    apiFetch(`/api/admin/disputes`, { credentials: 'include' })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(data => setDisputes(data.journeys || []))
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (journeyId: string, action: 'release' | 'refund') => {
    const reason = resolveReason[journeyId];
    if (!reason) return alert('Please provide a reason');
    await apiFetch(`/api/admin/disputes/${journeyId}/resolve`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason }),
    });
    setDisputes(d => d.filter(item => item.id !== journeyId));
  };

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Dispute Resolution</h1>
      {loadFailed ? (
        <ErrorState onRetry={load} />
      ) : disputes.length === 0 ? (
        <p className="text-gray-500">No active disputes</p>
      ) : (
        <div className="space-y-4">
          {disputes.map(d => (
            <div key={d.id} className="bg-white rounded-lg shadow p-4">
              <div className="font-semibold">{d.pickupName} → {d.destinationName}</div>
              <div className="text-sm text-gray-500">Status: {d.status}</div>
              <div className="text-sm">Customer: {d.customer.nickname}</div>
              {d.driver && <div className="text-sm">Driver: {d.driver.nickname}</div>}
              {d.escrow && (
                <div className="text-sm font-medium">Escrow: {d.escrow.amount} RWF ({d.escrow.status})</div>
              )}
              <div className="text-sm text-gray-500">GPS points: {d.gpsPoints.length}</div>
              {d.messages.length > 0 && (
                <div className="mt-2 border-t pt-2">
                  <div className="text-xs font-semibold">Chat ({d.messages.length} messages):</div>
                  {d.messages.slice(-5).map(m => (
                    <div key={m.id} className="text-xs text-gray-600">{m.text}</div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <input
                  placeholder="Resolution reason"
                  value={resolveReason[d.id] || ''}
                  onChange={e => setResolveReason({ ...resolveReason, [d.id]: e.target.value })}
                  className="border rounded px-2 flex-1"
                />
                <button onClick={() => resolve(d.id, 'release')} className="px-3 py-2 bg-green-700 text-white rounded text-sm">
                  Release to Driver
                </button>
                <button onClick={() => resolve(d.id, 'refund')} className="px-3 py-2 bg-blue-500 text-white rounded text-sm">
                  Refund Customer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
