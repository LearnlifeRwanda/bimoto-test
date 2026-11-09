import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api';

const STATUSES = ['PENDING', 'SUCCESS', 'FAILED'] as const;
const TRIGGERS = [
  'SCHEDULED_22H',
  'SCHEDULED_06',
  'SCHEDULED_18',
  'SHIFT_END',
  'PREFERENCE_CHANGE',
  'FALLBACK_24H',
  'ADMIN',
] as const;
const PAGE_SIZE = 50;

interface Summary {
  last24h: { byStatus: Record<string, number>; byTrigger: Record<string, number> };
  last7d: { byStatus: Record<string, number>; byTrigger: Record<string, number> };
  stuckPendingCount: number;
  reversedCount7d: number;
  heldCount: number;
  frozenDriverCount: number;
  openAmlFlags: Record<string, number>;
  openAmlFlagCount: number;
  stuckThresholdMinutes: number;
}

interface BatchRow {
  id: string;
  driverId: string;
  amount: number;
  status: string;
  trigger: string;
  failureReason: string | null;
  createdAt: string;
  paidOutAt: string | null;
  held: boolean;
  heldReason: string | null;
  driver: { id: string; nickname: string; phone: string } | null;
}

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  SUCCESS: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
};

export default function AdminPayouts() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [trigger, setTrigger] = useState('');
  const [held, setHeld] = useState('');
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    apiFetch(`/api/admin/payouts/summary`, { credentials: 'include' })
      .then((res) => res.json())
      .then(setSummary)
      .catch(console.error);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (trigger) params.set('trigger', trigger);
    if (held) params.set('held', held);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    setLoading(true);
    apiFetch(`/api/admin/payouts/batches?${params.toString()}`, {
      credentials: 'include',
    })
      .then((res) => res.json())
      .then((data) => {
        setBatches(data.batches || []);
        setTotal(data.total ?? 0);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [status, trigger, held, offset]);

  const changeFilter = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setOffset(0);
  };

  const tiles: Array<{
    key: string;
    label: string;
    value: number;
    alert: boolean;
    linkTo?: string;
  }> = summary
    ? [
        {
          key: 'stuck',
          label: `Stuck PENDING (>${summary.stuckThresholdMinutes} min)`,
          value: summary.stuckPendingCount,
          alert: summary.stuckPendingCount > 0,
        },
        {
          key: 'failed24h',
          label: 'Failed (24 h)',
          value: summary.last24h.byStatus.FAILED ?? 0,
          alert: false,
        },
        {
          key: 'reversals',
          label: 'Reversals (7 d)',
          value: summary.reversedCount7d,
          alert: summary.reversedCount7d > 0,
        },
        { key: 'held', label: 'Held batches', value: summary.heldCount, alert: false },
        {
          key: 'frozen',
          label: 'Frozen drivers',
          value: summary.frozenDriverCount,
          alert: false,
        },
        {
          key: 'openAmlFlags',
          label: `Open review flags (${summary.openAmlFlags?.CRITICAL ?? 0} critical)`,
          value: summary.openAmlFlagCount ?? 0,
          alert: (summary.openAmlFlags?.CRITICAL ?? 0) > 0,
          linkTo: '/admin/flagged',
        },
      ]
    : [];

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Payouts &amp; balances</h1>

      {summary ? (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
          {tiles.map((t) => {
            const body = (
              <div
                data-testid={`tile-${t.key}`}
                className={`rounded-lg shadow p-4 ${
                  t.alert ? 'bg-red-50 border border-red-300' : 'bg-white'
                }`}
              >
                <div className="text-sm text-gray-500">{t.label}</div>
                <div className={`text-2xl font-bold ${t.alert ? 'text-red-700' : ''}`}>
                  {t.value}
                  {t.alert && <span className="ml-2 text-base align-middle">⚠ attention</span>}
                </div>
              </div>
            );
            return t.linkTo ? (
              <Link key={t.key} to={t.linkTo}>
                {body}
              </Link>
            ) : (
              <React.Fragment key={t.key}>{body}</React.Fragment>
            );
          })}
        </div>
      ) : (
        <div className="mb-6 text-gray-500">Loading summary...</div>
      )}

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <label className="block">
          <span className="text-sm text-gray-500 block">Status</span>
          <select
            aria-label="Status filter"
            value={status}
            onChange={(e) => changeFilter(setStatus)(e.target.value)}
            className="border rounded p-2"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-gray-500 block">Trigger</span>
          <select
            aria-label="Trigger filter"
            value={trigger}
            onChange={(e) => changeFilter(setTrigger)(e.target.value)}
            className="border rounded p-2"
          >
            <option value="">All triggers</option>
            {TRIGGERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-gray-500 block">Held</span>
          <select
            aria-label="Held filter"
            value={held}
            onChange={(e) => changeFilter(setHeld)(e.target.value)}
            className="border rounded p-2"
          >
            <option value="">All</option>
            <option value="true">Held only</option>
            <option value="false">Not held</option>
          </select>
        </label>
      </div>

      {loading ? (
        <div className="text-gray-500">Loading batches...</div>
      ) : batches.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <div className="text-4xl mb-2">🗂️</div>
          <div className="font-semibold">No payout batches</div>
          <div className="text-sm text-gray-500">
            Nothing matches these filters in the selected window. Batches appear here as
            the payout jobs run.
          </div>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white rounded-lg shadow text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="p-3">Created</th>
                  <th className="p-3">Driver</th>
                  <th className="p-3">Amount (RWF)</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Trigger</th>
                  <th className="p-3">Held</th>
                  <th className="p-3">Failure reason</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-b last:border-b-0">
                    <td className="p-3 whitespace-nowrap">
                      {new Date(b.createdAt).toLocaleString()}
                    </td>
                    <td className="p-3">
                      <Link
                        to={`/admin/payouts/driver/${b.driverId}`}
                        className="text-blue-600 hover:underline"
                      >
                        {b.driver ? b.driver.nickname : b.driverId}
                      </Link>
                      {b.driver && (
                        <div className="text-xs text-gray-500">{b.driver.phone}</div>
                      )}
                    </td>
                    <td className="p-3">{b.amount.toLocaleString()}</td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-1 rounded ${STATUS_BADGE[b.status] ?? 'bg-gray-100'}`}
                      >
                        {b.status}
                      </span>
                      {b.status === 'FAILED' && b.paidOutAt && (
                        <span className="ml-1 text-xs text-red-700">(reversed)</span>
                      )}
                    </td>
                    <td className="p-3">{b.trigger}</td>
                    <td className="p-3">
                      {b.held ? (
                        <span title={b.heldReason ?? undefined}>Yes</span>
                      ) : (
                        'No'
                      )}
                    </td>
                    <td className="p-3 text-gray-500">{b.failureReason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="px-3 py-1 border rounded disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500">
              Page {page} of {pageCount} ({total} batches)
            </span>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total}
              className="px-3 py-1 border rounded disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
