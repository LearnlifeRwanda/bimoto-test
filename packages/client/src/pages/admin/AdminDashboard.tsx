import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api';

interface DashboardStats {
  totalUsers: number;
  totalDrivers: number;
  totalCustomers: number;
  totalJourneys: number;
  completedJourneys: number;
  totalRevenue: number;
  activeDisputes: number;
  flaggedUsers: number;
  pendingVerifications: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [conflictsTotal, setConflictsTotal] = useState<number>(0);

  useEffect(() => {
    apiFetch(`/api/admin/dashboard`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => setStats(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    apiFetch(`/api/admin/conflicts`, { credentials: 'include' })
      .then((res) => res.json())
      .then((d: { counts: { type: string; count: number }[] }) => {
        const total = d.counts.reduce((a, c) => a + c.count, 0);
        setConflictsTotal(total);
      })
      .catch(() => setConflictsTotal(0));
  }, []);

  if (loading) return <div className="p-4">Loading...</div>;
  if (!stats) return <div className="p-4">Failed to load dashboard</div>;

  const cards = [
    { label: 'Total Users', value: stats.totalUsers },
    { label: 'Drivers', value: stats.totalDrivers },
    { label: 'Customers', value: stats.totalCustomers },
    { label: 'Total Journeys', value: stats.totalJourneys },
    { label: 'Completed', value: stats.completedJourneys },
    { label: 'Revenue (RWF)', value: stats.totalRevenue.toLocaleString() },
    { label: 'Active Disputes', value: stats.activeDisputes },
    { label: 'Flagged Users', value: stats.flaggedUsers },
    { label: 'Pending Verifications', value: stats.pendingVerifications },
  ];

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-6">Admin Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        {cards.map(card => (
          <div key={card.label} className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-500">{card.label}</div>
            <div className="text-2xl font-bold">{card.value}</div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Link to="/admin/verifications" className="block p-3 bg-blue-50 rounded-lg hover:bg-blue-100">
          Pending Verifications ({stats.pendingVerifications})
        </Link>
        <Link to="/admin/disputes" className="block p-3 bg-red-50 rounded-lg hover:bg-red-100">
          Active Disputes ({stats.activeDisputes})
        </Link>
        <Link to="/admin/conflicts" className="block p-3 bg-orange-50 rounded-lg hover:bg-orange-100">
          Conflicts ({conflictsTotal})
        </Link>
        <Link to="/admin/flagged" className="block p-3 bg-yellow-50 rounded-lg hover:bg-yellow-100">
          Flagged Users ({stats.flaggedUsers})
        </Link>
        <Link to="/admin/payouts" className="block p-3 bg-green-50 rounded-lg hover:bg-green-100">
          Payouts &amp; balances
        </Link>
        {/* ACCOUNT-RIGHTS-SURFACE G6 — the deletion queue. No count on the
            tile: the endpoint this dashboard reads does not carry one, and
            a tile that lies about being empty is worse than a plain one. */}
        <Link to="/admin/deletions" className="block p-3 bg-rose-50 rounded-lg hover:bg-rose-100">
          Account deletion requests
        </Link>
        {/* DEADWOOD G3 — two screens that were built and then had no
            door. /admin/funnel has never had an in-app link (URL entry
            only); /admin/conflicts/audit was reachable in practice from
            AdminConflicts, but only through a link the wiring extractor
            attributes to the sibling param route, which is a thin thread
            for the audit trail an admin is meant to be able to check. */}
        <Link to="/admin/funnel" className="block p-3 bg-purple-50 rounded-lg hover:bg-purple-100">
          Funnel metrics
        </Link>
        <Link
          to="/admin/conflicts/audit"
          className="block p-3 bg-orange-50 rounded-lg hover:bg-orange-100"
        >
          Conflict audit log
        </Link>
        <Link to="/admin/error-reports" className="block p-3 bg-gray-100 rounded-lg hover:bg-gray-200">
          Error reports
        </Link>
        {/* SOS-FOLLOW G5 — the emergency surface. Reachable without an
            alert being live, because the history is the record of every
            one that ended and is worth reading on a quiet day. */}
        <Link to="/admin/emergency" className="block p-3 bg-gray-100 rounded-lg hover:bg-gray-200">
          Emergency alerts
        </Link>
        {/* INTEL-DECK G5 — the door to the mobility reading room. An
            ANALYST lands there at login and never sees this dashboard;
            an admin gets here. */}
        <Link to="/intel" className="block p-3 bg-blue-50 rounded-lg hover:bg-blue-100">
          Intelligence (mobility aggregates)
        </Link>
      </div>
    </div>
  );
}
