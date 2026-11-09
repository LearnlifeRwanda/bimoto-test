import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

// BLACKBOX G4 / FLIGHT-RECORDER G4 — the team reads the black box.
//
// BLACKBOX shipped a list and a per-bundle export, and said in writing
// that grouping was deliberately absent: "the pilot does not yet know
// which crashes matter, and a heuristic here would decide that for the
// people who do."
//
// That held while every report was a deliberate tap. It stops holding
// now that reports arrive by themselves: forty phones hitting one fault
// produce forty rows, and forty identical-looking rows hide the only
// fact worth having, which is that they are identical. So this screen
// gains two things and keeps everything it had:
//
//   - Grouped: an exact count per fingerprint — not a similarity guess —
//     split by app build and by role, so "is this every build or just
//     the new one" and "is this drivers or customers" are answered
//     without opening a bundle. Reports older than the fingerprint
//     column are shown honestly as `unfingerprinted`.
//   - Export all: the whole filtered set as JSONL, one report per line,
//     for whoever would rather have grep than a dashboard.
//
// The table styling is the one that was already here.

interface ReportRow {
  id: string;
  createdAt: string;
  appBuild: string;
  reporterRole: string;
  entryCount: number;
  fingerprint: string | null;
  reporter: { id: string; nickname: string } | null;
}

interface GroupRow {
  fingerprint: string;
  reports: number;
  entries: number;
  lastSeen: string | null;
  sample: string | null;
  builds: { build: string; count: number }[];
  roles: { role: string; count: number }[];
}

type Tab = 'grouped' | 'reports';

export default function AdminErrorReports() {
  const [tab, setTab] = useState<Tab>('grouped');
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openJson, setOpenJson] = useState<string>('');
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [exportState, setExportState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [exportLines, setExportLines] = useState<string>('');

  useEffect(() => {
    setLoading(true);
    setFailed(false);
    const query = fingerprint ? `?fingerprint=${encodeURIComponent(fingerprint)}` : '';
    Promise.all([
      apiFetch('/api/admin/error-reports', { credentials: 'include' }).then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(String(res.status))),
      ),
      apiFetch(`/api/admin/error-reports/groups${query}`, { credentials: 'include' }).then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(String(res.status))),
      ),
    ])
      .then(([list, grouped]) => {
        setReports(list.reports || []);
        setGroups(grouped.groups || []);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [fingerprint]);

  const openExport = async (id: string) => {
    setOpenId(id);
    setOpenJson('');
    try {
      const res = await apiFetch(`/api/admin/error-reports/${id}/export.json`, {
        credentials: 'include',
      });
      const data = await res.json();
      setOpenJson(JSON.stringify(data, null, 2));
    } catch {
      setOpenJson('could not load this bundle');
    }
  };

  // The firehose. Shown in the page rather than downloaded because the
  // WebView's download story is not worth depending on: select-all and
  // copy works everywhere, and a line-per-report pastes into anything.
  const exportAll = async () => {
    setExportState('loading');
    setExportLines('');
    try {
      const query = fingerprint ? `?fingerprint=${encodeURIComponent(fingerprint)}` : '';
      const res = await apiFetch(`/api/admin/error-reports/export.jsonl${query}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(String(res.status));
      setExportLines(await res.text());
      setExportState('idle');
    } catch {
      setExportState('failed');
    }
  };

  const visibleReports = fingerprint
    ? reports.filter((r) => (r.fingerprint ?? 'unfingerprinted') === fingerprint)
    : reports;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-1">Error reports</h1>
      <p className="text-sm text-gray-500 mb-4">
        Sent from Diagnostics — by a tap on Send report, and automatically by phones whose owner
        left diagnostics upload on.
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        {(['grouped', 'reports'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            data-testid={`admin-error-tab-${t}`}
            className={`px-3 py-1 rounded border text-sm ${
              tab === t ? 'bg-[#1B4F72] text-white border-[#1B4F72]' : 'bg-white border-gray-300'
            }`}
          >
            {t === 'grouped' ? 'Grouped' : 'All reports'}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void exportAll()}
          data-testid="admin-error-export-all"
          className="px-3 py-1 rounded border border-gray-300 bg-white text-sm"
        >
          {exportState === 'loading' ? 'Exporting…' : 'Export all (JSONL)'}
        </button>
        {fingerprint && (
          <button
            type="button"
            onClick={() => setFingerprint(null)}
            data-testid="admin-error-clear-filter"
            className="px-3 py-1 rounded border border-gray-300 bg-white text-sm"
          >
            Clear filter: {fingerprint}
          </button>
        )}
      </div>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {failed && <p className="text-sm text-red-700">Could not load error reports.</p>}
      {exportState === 'failed' && (
        <p className="text-sm text-red-700" data-testid="admin-error-export-failed">
          Could not export.
        </p>
      )}

      {!loading && !failed && tab === 'grouped' && groups.length === 0 && (
        <p className="text-sm text-gray-500" data-testid="admin-error-groups-empty">
          No reports have been sent yet.
        </p>
      )}

      {!loading && !failed && tab === 'reports' && visibleReports.length === 0 && (
        <p className="text-sm text-gray-500" data-testid="admin-error-reports-empty">
          No reports have been sent yet.
        </p>
      )}

      {tab === 'grouped' && groups.length > 0 && (
        <table className="w-full text-sm" data-testid="admin-error-groups-table">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="py-2 pr-3">Fingerprint</th>
              <th className="py-2 pr-3">What it says</th>
              <th className="py-2 pr-3">Reports</th>
              <th className="py-2 pr-3">Entries</th>
              <th className="py-2 pr-3">Builds</th>
              <th className="py-2 pr-3">Roles</th>
              <th className="py-2 pr-3">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.fingerprint} className="border-b" data-testid="admin-error-group-row">
                <td className="py-2 pr-3 font-mono">
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setFingerprint(g.fingerprint)}
                    data-testid={`admin-error-group-${g.fingerprint}`}
                  >
                    {g.fingerprint}
                  </button>
                </td>
                <td className="py-2 pr-3 break-all">{g.sample ?? '—'}</td>
                <td className="py-2 pr-3 font-mono">{g.reports}</td>
                <td className="py-2 pr-3 font-mono">{g.entries}</td>
                <td className="py-2 pr-3 font-mono">
                  {g.builds.map((b) => `${b.build}×${b.count}`).join(' ')}
                </td>
                <td className="py-2 pr-3 font-mono">
                  {g.roles.map((r) => `${r.role}×${r.count}`).join(' ')}
                </td>
                <td className="py-2 pr-3 font-mono">
                  {g.lastSeen ? new Date(g.lastSeen).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'reports' && visibleReports.length > 0 && (
        <table className="w-full text-sm" data-testid="admin-error-reports-table">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="py-2 pr-3">Sent</th>
              <th className="py-2 pr-3">Who</th>
              <th className="py-2 pr-3">Role</th>
              <th className="py-2 pr-3">App build</th>
              <th className="py-2 pr-3">Fingerprint</th>
              <th className="py-2 pr-3">Entries</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {visibleReports.map((r) => (
              <tr key={r.id} className="border-b" data-testid="admin-error-report-row">
                <td className="py-2 pr-3 font-mono">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="py-2 pr-3">{r.reporter?.nickname ?? '—'}</td>
                <td className="py-2 pr-3 font-mono">{r.reporterRole}</td>
                <td className="py-2 pr-3 font-mono">{r.appBuild}</td>
                <td className="py-2 pr-3 font-mono">{r.fingerprint ?? 'unfingerprinted'}</td>
                <td className="py-2 pr-3 font-mono">{r.entryCount}</td>
                <td className="py-2">
                  <button
                    type="button"
                    className="px-3 py-1 rounded bg-[#1B4F72] text-white"
                    onClick={() => void openExport(r.id)}
                    data-testid={`admin-error-report-export-${r.id}`}
                  >
                    Export JSON
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {exportLines && (
        <div className="mt-4">
          <h2 className="font-bold mb-2">Export ({exportLines.trim().split('\n').length} lines)</h2>
          <pre
            className="bg-gray-900 text-gray-100 text-xs p-3 rounded overflow-x-auto max-h-96"
            data-testid="admin-error-export-jsonl"
          >
            {exportLines}
          </pre>
        </div>
      )}

      {openId && (
        <div className="mt-4">
          <h2 className="font-bold mb-2">Bundle {openId}</h2>
          <pre
            className="bg-gray-900 text-gray-100 text-xs p-3 rounded overflow-x-auto max-h-96"
            data-testid="admin-error-report-json"
          >
            {openJson || 'Loading…'}
          </pre>
        </div>
      )}
    </div>
  );
}
