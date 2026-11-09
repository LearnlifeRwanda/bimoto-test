// PAGES/INTEL/INTEL-PAGE.TSX
//
// INTEL-DECK G5 — the reading room.
//
// Two views over the same window: DENSITY (where movement pools, as
// hexagons) and FLOWS (which corridors are strongest, as a ranked
// table). Both carry the same filters and the same "Export this view"
// control, so the CSV a person hands to the City is the thing they were
// just looking at.
//
// The ops panel below is ADMIN-only, and the server agrees: run-now and
// tier-config/reload are adminOnly, the three reads are intelRead.
//
// The empty state is the important one. When nothing cleared the
// threshold, this screen says so in those words rather than showing a
// blank map — "no cells cleared the privacy threshold here" is a fact
// about the privacy gate, not a loading failure, and an analyst who
// cannot tell those apart will draw the wrong conclusion about the data.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/auth.store';
import { DensityMap } from '../../components/intel/DensityMap';
import { CellDetail } from '../../components/intel/CellDetail';
import { FlowsList } from '../../components/intel/FlowsList';
import { IntelOpsPanel } from '../../components/intel/IntelOpsPanel';
import {
  ALL_TIERS,
  fetchAggregates,
  fetchExport,
  fetchStats,
  fetchTierConfig,
  toFlows,
  type AggregateQuery,
  type AggregateRow,
  type Tier,
  type TierConfig,
  type TierStats,
} from '../../lib/intel-api';

type View = 'density' | 'flows';
type ExportFormat = 'csv' | 'jsonl';

function isoDay(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export default function IntelPage() {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => (s.user?.role ?? s.offlineSession?.role) === 'ADMIN');

  const [view, setView] = useState<View>('density');
  const [tier, setTier] = useState<Tier>('DENSE');
  const [dateFrom, setDateFrom] = useState(isoDay(-7));
  const [dateTo, setDateTo] = useState(isoDay(1));

  const [rows, setRows] = useState<AggregateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);

  const [config, setConfig] = useState<Record<Tier, TierConfig> | null>(null);
  const [classificationVersion, setClassificationVersion] = useState<string | null>(null);
  // LOOSE-ENDS G6 — the server's own run-now range cap, for the ops
  // panel's picker. Null until the config call answers.
  const [maxRunNowRangeDays, setMaxRunNowRangeDays] = useState<number | null>(null);
  const [stats, setStats] = useState<Record<Tier, TierStats> | null>(null);

  const [exportText, setExportText] = useState('');
  const [exportState, setExportState] = useState<'idle' | 'loading' | 'failed'>('idle');

  const query: AggregateQuery = useMemo(
    () => ({
      tier,
      aggregateType: view === 'flows' ? 'OD_MATRIX' : 'POINT_DENSITY',
      dateFrom,
      dateTo,
      limit: 500,
    }),
    [tier, view, dateFrom, dateTo],
  );

  const loadConfig = useCallback(() => {
    fetchTierConfig()
      .then((res) => {
        setConfig(res.config);
        setClassificationVersion(res.classificationVersion);
        setMaxRunNowRangeDays(res.maxRunNowRangeDays ?? null);
      })
      .catch(() => {
        setConfig(null);
        setClassificationVersion(null);
        setMaxRunNowRangeDays(null);
      });
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    setLoading(true);
    setFailed(false);
    setSelectedCellId(null);
    setSelectedFlowId(null);
    setExportText('');
    fetchAggregates(query)
      .then(setRows)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    if (!isAdmin) return;
    fetchStats(dateFrom, dateTo)
      .then(setStats)
      .catch(() => setStats(null));
  }, [isAdmin, dateFrom, dateTo]);

  const flows = useMemo(() => (view === 'flows' ? toFlows(rows) : []), [view, rows]);
  const selectedRow = rows.find((r) => r.cellId === selectedCellId) ?? null;
  const selectedFlow = flows.find((f) => f.rowId === selectedFlowId) ?? null;
  const cellSizeMeters = config?.[tier]?.cellSizeMeters ?? 250;
  const kThreshold = config?.[tier]?.kThreshold ?? 0;
  const bucketMinutes = config?.[tier]?.bucketMinutes ?? 0;

  const runExport = async (format: ExportFormat) => {
    setExportState('loading');
    setExportText('');
    try {
      setExportText(await fetchExport(query, format));
      setExportState('idle');
    } catch {
      setExportState('failed');
    }
  };

  const isEmpty = !loading && !failed && rows.length === 0;

  return (
    <div className="p-4" data-testid="intel-page">
      <h1 className="text-2xl font-bold mb-1">{t('intel.title')}</h1>
      <p className="text-sm text-gray-500 mb-4">{t('intel.subtitle')}</p>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {(['density', 'flows'] as View[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-pressed={view === v}
            data-testid={`intel-view-${v}`}
            className={`px-3 py-1 rounded border text-sm ${
              view === v ? 'bg-[#1B4F72] text-white border-[#1B4F72]' : 'bg-white border-gray-300'
            }`}
          >
            {v === 'density' ? t('intel.view.density') : t('intel.view.flows')}
          </button>
        ))}

        <select
          value={tier}
          onChange={(e) => setTier(e.target.value as Tier)}
          data-testid="intel-tier-select"
          aria-label={t('intel.filter.tier')}
          className="px-2 py-1 rounded border border-gray-300 bg-white text-sm"
        >
          {ALL_TIERS.map((tr) => (
            <option key={tr} value={tr}>
              {tr}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          data-testid="intel-date-from"
          aria-label={t('intel.filter.from')}
          className="px-2 py-1 rounded border border-gray-300 bg-white text-sm"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          data-testid="intel-date-to"
          aria-label={t('intel.filter.to')}
          className="px-2 py-1 rounded border border-gray-300 bg-white text-sm"
        />

        <button
          type="button"
          onClick={() => void runExport('csv')}
          data-testid="intel-export-csv"
          className="px-3 py-1 rounded border border-gray-300 bg-white text-sm"
        >
          {exportState === 'loading' ? t('intel.export.working') : t('intel.export.csv')}
        </button>
        <button
          type="button"
          onClick={() => void runExport('jsonl')}
          data-testid="intel-export-jsonl"
          className="px-3 py-1 rounded border border-gray-300 bg-white text-sm"
        >
          {t('intel.export.jsonl')}
        </button>
      </div>

      <p className="text-xs text-gray-500 mb-4" data-testid="intel-grain-note">
        {t('intel.grainNote', { k: kThreshold, minutes: bucketMinutes, metres: cellSizeMeters })}
      </p>

      {loading && <p className="text-sm text-gray-500">{t('intel.loading')}</p>}
      {failed && (
        <p className="text-sm text-red-700" data-testid="intel-load-failed">
          {t('intel.loadFailed')}
        </p>
      )}
      {isEmpty && (
        <p className="text-sm text-gray-500" data-testid="intel-empty">
          {t('intel.empty')}
        </p>
      )}

      {!loading && !failed && view === 'density' && rows.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <DensityMap
              rows={rows}
              cellSizeMeters={cellSizeMeters}
              selectedCellId={selectedCellId}
              onSelectCell={setSelectedCellId}
            />
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <CellDetail row={selectedRow} kThreshold={kThreshold} />
          </div>
        </div>
      )}

      {!loading && !failed && view === 'flows' && rows.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <DensityMap
              rows={rows}
              cellSizeMeters={cellSizeMeters}
              selectedCellId={null}
              onSelectCell={() => undefined}
              highlightCellIds={selectedFlow ? [selectedFlow.rowId] : []}
              extraCells={
                selectedFlow
                  ? [
                      {
                        id: `${selectedFlow.rowId}-origin`,
                        lat: selectedFlow.originCenterLat,
                        lng: selectedFlow.originCenterLng,
                        cellSizeMeters,
                      },
                      {
                        id: `${selectedFlow.rowId}-dest`,
                        lat: selectedFlow.destCenterLat,
                        lng: selectedFlow.destCenterLng,
                        cellSizeMeters,
                      },
                    ]
                  : []
              }
            />
          </div>
          <div className="md:col-span-3">
            <FlowsList flows={flows} selectedRowId={selectedFlowId} onSelect={setSelectedFlowId} />
          </div>
        </div>
      )}

      {exportState === 'failed' && (
        <p className="text-sm text-red-700 mt-3" data-testid="intel-export-failed">
          {t('intel.export.failed')}
        </p>
      )}
      {exportText && (
        <div className="mt-4">
          <h2 className="font-bold mb-2">
            {t('intel.export.heading', { lines: exportText.trim().split('\n').length })}
          </h2>
          <pre
            className="bg-gray-900 text-gray-100 text-xs p-3 rounded overflow-x-auto max-h-96"
            data-testid="intel-export-output"
          >
            {exportText}
          </pre>
        </div>
      )}

      {isAdmin && (
        <IntelOpsPanel
          config={config}
          classificationVersion={classificationVersion}
          maxRunNowRangeDays={maxRunNowRangeDays}
          stats={stats}
          onReloaded={loadConfig}
        />
      )}
    </div>
  );
}
