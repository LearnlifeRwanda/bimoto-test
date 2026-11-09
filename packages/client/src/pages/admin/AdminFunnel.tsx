// PAGES/ADMIN/ADMIN-FUNNEL.TSX
//
// R3-FUNNEL-METRICS-DASHBOARD — admin-only dashboard for the 4-stage
// pilot funnel + 6 operational metrics.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CITY_BAND_KEYS,
  FUNNEL_LOOKBACK_WEEKS,
  type CityBand,
} from '@bimoto/shared';
import { useFunnelMetrics } from '../../hooks/useFunnelMetrics';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function isoWeekOfNow(): string {
  const now = new Date();
  const kigaliMs = now.getTime() + 2 * 60 * 60 * 1000;
  const local = new Date(kigaliMs);
  const dow = local.getUTCDay() || 7;
  const thursdayMs = kigaliMs + (4 - dow) * 86_400_000;
  const thursday = new Date(thursdayMs);
  const year = thursday.getUTCFullYear();
  const jan1Ms = Date.UTC(year, 0, 1);
  const week = Math.ceil(
    (thursdayMs - jan1Ms) / (7 * 86_400_000) +
      (new Date(jan1Ms).getUTCDay() || 7) / 7,
  );
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function fmtRate(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtMinutes(n: number): string {
  if (n < 1) return `${(n * 60).toFixed(0)}s`;
  return `${n.toFixed(1)}m`;
}

function fmtMean(n: number): string {
  return n.toFixed(1);
}

function wowDelta(values: number[]): { delta: number; pct: number | null } {
  if (values.length < 2) return { delta: 0, pct: null };
  const cur = values[values.length - 1];
  const prev = values[values.length - 2];
  const delta = cur - prev;
  const pct = prev === 0 ? null : (delta / prev) * 100;
  return { delta, pct };
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  const w = 80;
  const h = 24;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const pts = values
    .map((v, i) => `${i * step},${h - ((v - min) / range) * h}`)
    .join(' ');
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      role="img"
      className="text-blue-500"
    >
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      />
    </svg>
  );
}

export default function AdminFunnel() {
  const { t } = useTranslation();
  const [weekOf] = useState(isoWeekOfNow());
  const [cityBand, setCityBand] = useState<CityBand | ''>('');
  const [cooperativeId, setCooperativeId] = useState<string>('');

  const { data, loading, error, refetch } = useFunnelMetrics({
    weekOf,
    cityBand: cityBand || undefined,
    cooperativeId: cooperativeId || undefined,
  });

  const exportHref = useMemo(() => {
    const qs = new URLSearchParams({ weekOf });
    if (cityBand) qs.set('cityBand', cityBand);
    if (cooperativeId) qs.set('cooperativeId', cooperativeId);
    return `${API_URL}/api/admin/funnel/export.csv?${qs.toString()}`;
  }, [weekOf, cityBand, cooperativeId]);

  const currentIdx = FUNNEL_LOOKBACK_WEEKS - 1;

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="mb-4">
        <Link to="/admin" className="text-blue-600 hover:underline">
          ← Back to dashboard
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="text-2xl font-bold">{t('admin.funnel.title')}</h1>
        <p className="text-gray-600 text-sm">
          {t('admin.funnel.subtitle')}
        </p>
      </header>

      <div className="flex flex-wrap gap-3 mb-6 items-center">
        <label className="text-sm">
          <span className="block text-gray-700">{t('admin.funnel.filters.weekOf')}</span>
          <span className="font-mono bg-gray-100 px-2 py-1 rounded">{weekOf}</span>
        </label>
        <label className="text-sm">
          <span className="block text-gray-700">{t('admin.funnel.filters.cityBand')}</span>
          <select
            value={cityBand}
            onChange={(e) => setCityBand(e.target.value as CityBand | '')}
            className="border border-gray-300 rounded px-2 py-1"
          >
            <option value="">{t('admin.funnel.filters.allCityBands')}</option>
            {CITY_BAND_KEYS.map((b) => (
              <option key={b} value={b}>
                {t(`admin.funnel.cityBands.${b}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-gray-700">{t('admin.funnel.filters.cooperative')}</span>
          <input
            type="text"
            placeholder={t('admin.funnel.filters.allCooperatives')}
            value={cooperativeId}
            onChange={(e) => setCooperativeId(e.target.value.trim())}
            className="border border-gray-300 rounded px-2 py-1 font-mono text-xs w-64"
          />
        </label>
        <a
          href={exportHref}
          className="ml-auto bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700"
        >
          {t('admin.funnel.actions.exportCsv')}
        </a>
      </div>

      {loading && (
        <div className="space-y-3" data-testid="funnel-loading">
          <div className="h-20 bg-gray-100 rounded animate-pulse" />
          <div className="h-40 bg-gray-100 rounded animate-pulse" />
        </div>
      )}

      {!loading && error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded">
          <p className="text-red-700 mb-3">{t('admin.funnel.states.errorRetry')}</p>
          <button
            onClick={refetch}
            className="bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700"
          >
            {t('admin.funnel.states.errorRetry')}
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {data.funnel.registered[currentIdx] === 0 ? (
            <div className="p-6 text-center bg-gray-50 rounded">
              {t('admin.funnel.states.empty')}
            </div>
          ) : (
            <>
              <section className="mb-8">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <FunnelStepCard
                    label={t('admin.funnel.stages.registered')}
                    values={data.funnel.registered}
                  />
                  <FunnelStepCard
                    label={t('admin.funnel.stages.screenerQualified')}
                    values={data.funnel.screenerQualified}
                  />
                  <FunnelStepCard
                    label={t('admin.funnel.stages.onboarded')}
                    values={data.funnel.onboarded}
                  />
                  <FunnelStepCard
                    label={t('admin.funnel.stages.active')}
                    values={data.funnel.active}
                  />
                </div>
              </section>

              <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <MetricCard
                  label={t('admin.funnel.metrics.timeToFirstBid')}
                  values={data.operational.timeToFirstBidMedianMinutes}
                  format={fmtMinutes}
                />
                <MetricCard
                  label={t('admin.funnel.metrics.bidsPerRide')}
                  values={data.operational.bidsPerRideMean}
                  format={fmtMean}
                />
                <MetricCard
                  label={t('admin.funnel.metrics.acceptanceRate')}
                  values={data.operational.acceptanceRate}
                  format={fmtRate}
                />
                <MetricCard
                  label={t('admin.funnel.metrics.cancellationRate')}
                  values={data.operational.cancellationRate}
                  format={fmtRate}
                />
                <MetricCard
                  label={t('admin.funnel.metrics.parcelRecipientConfirmation')}
                  values={data.operational.parcelRecipientConfirmationRate}
                  format={fmtRate}
                />
                <MetricCard
                  label={t('admin.funnel.metrics.offlineSyncSuccess')}
                  values={data.operational.offlineSyncSuccessRate}
                  format={fmtRate}
                />
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

function FunnelStepCard({
  label,
  values,
  badge,
}: {
  label: string;
  values: number[];
  badge?: string;
}) {
  const cur = values[values.length - 1] ?? 0;
  const { delta } = wowDelta(values);
  return (
    <div className="p-4 bg-white border border-gray-200 rounded">
      <div className="text-sm text-gray-600 flex items-center gap-2">
        <span>{label}</span>
        {badge && (
          <span
            className="text-xs bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded"
            title={badge}
          >
            {badge}
          </span>
        )}
      </div>
      <div className="text-2xl font-bold mt-1">{cur}</div>
      <div className="text-xs text-gray-500">
        {delta >= 0 ? '+' : ''}
        {delta} WoW
      </div>
    </div>
  );
}

function MetricCard({
  label,
  values,
  format,
}: {
  label: string;
  values: number[];
  format: (n: number) => string;
}) {
  const cur = values[values.length - 1] ?? 0;
  return (
    <div className="p-4 bg-white border border-gray-200 rounded">
      <div className="text-sm text-gray-600">{label}</div>
      <div className="flex items-end justify-between mt-1">
        <div className="text-2xl font-bold">{format(cur)}</div>
        <Sparkline values={values} />
      </div>
    </div>
  );
}
