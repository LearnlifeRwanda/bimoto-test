import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

interface FlaggedUser {
  id: string;
  nickname: string;
  role: string;
  disputeCount: number;
  disputeRate: number;
  completedRides: number;
  isFlagged: boolean;
  // PILOT-GUARD Item 1 — why this account is here. Null only for rows
  // flagged before every writer recorded a reason.
  flagReason: string | null;
}

export default function AdminFlaggedUsers() {
  const [users, setUsers] = useState<FlaggedUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch(`/api/admin/flagged-users`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => setUsers(data.users || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const unflag = async (userId: string) => {
    await apiFetch(`/api/admin/flagged-users/${userId}/unflag`, {
      method: 'POST',
      credentials: 'include',
    });
    setUsers(u => u.filter(item => item.id !== userId));
  };

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Flagged Users</h1>
      {users.length === 0 ? (
        <p className="text-gray-500">No flagged users</p>
      ) : (
        <div className="space-y-4">
          {users.map(u => (
            <div key={u.id} className="bg-white rounded-lg shadow p-4 flex items-center justify-between">
              <div>
                <div className="font-semibold">{u.nickname}</div>
                <div className="text-sm text-gray-500">Role: {u.role}</div>
                <div className="text-sm text-gray-700" data-testid={`flag-reason-${u.id}`}>
                  Reason: {u.flagReason ?? 'not recorded'}
                </div>
                <div className="text-sm">Disputes: {u.disputeCount} | Rate: {(u.disputeRate * 100).toFixed(1)}%</div>
                <div className="text-sm">Completed rides: {u.completedRides}</div>
              </div>
              <button onClick={() => unflag(u.id)} className="px-4 py-2 bg-yellow-500 text-white rounded">
                Unflag
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
