// COMPONENTS/INTEL/INTEL-OPS-PANEL.TSX
//
// INTEL-DECK G5 — the admin-only half of the reading room: what the
// pipeline is configured to do, what it produced in a range, and the two
// levers that change it. An ANALYST never sees this section, and the
// server would refuse both levers if they did (adminOnly on run-now and
// tier-config/reload).
//
// LOOSE-ENDS G6 — run-now takes a date range now.
//
// This panel used to carry an honest sentence instead of a picker: the
// endpoint took no range, so offering one would have been offering a
// value the server ignored. Re-building last month's aggregates meant
// asking a developer to run something by hand.
//
// The endpoint accepts an optional {dateFrom, dateTo} body, so the
// sentence becomes the picker it was standing in for. Both fields empty
// is the DEFAULT and means exactly what the button always meant — the
// job's own lookback window, the same one the nightly cron runs — so an
// admin who just wants "run it now" still presses one button.
//
// The three rules are mirrored here (both bounds or neither, ordered,
// within the cap) so the common mistakes are caught before the round
// trip; the server re-validates all three and is the authority. The cap
// itself arrives from the server with the tier config, because it is a
// deployment knob — a copy hardcoded here would be wrong on any
// deployment that overrode it.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ALL_TIERS,
  runAggregationNow,
  reloadTierConfig,
  type Tier,
  type TierConfig,
  type TierStats,
} from '../../lib/intel-api';
import { MS_PER_DAY } from '@bimoto/shared';

export interface IntelOpsPanelProps {
  config: Record<Tier, TierConfig> | null;
  classificationVersion: string | null;
  /** The server's own run-now range cap in days; null until known. */
  maxRunNowRangeDays?: number | null;
  stats: Record<Tier, TierStats> | null;
  onReloaded: () => void;
}

type ActionState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; message: string } | { kind: 'failed' };


/**
 * The server's three rules, mirrored. Returns an i18n key for the first
 * rule broken, or null when the range is acceptable (including the
 * both-empty case, which is the default run).
 */
export function validateRunNowRange(
  dateFrom: string,
  dateTo: string,
  maxDays: number | null | undefined,
): string | null {
  if (!dateFrom && !dateTo) return null;
  if (!dateFrom || !dateTo) return 'intel.ops.rangeIncomplete';
  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return 'intel.ops.rangeUnparseable';
  }
  if (to <= from) return 'intel.ops.rangeOutOfOrder';
  if (maxDays != null && (to.getTime() - from.getTime()) / MS_PER_DAY > maxDays) {
    return 'intel.ops.rangeTooLarge';
  }
  return null;
}

export const IntelOpsPanel: React.FC<IntelOpsPanelProps> = ({
  config,
  classificationVersion,
  maxRunNowRangeDays,
  stats,
  onReloaded,
}) => {
  const { t } = useTranslation();
  const [run, setRun] = useState<ActionState>({ kind: 'idle' });
  const [reload, setReload] = useState<ActionState>({ kind: 'idle' });
  // Empty = the job's own lookback window, which is what this button
  // has always done.
  const [runFrom, setRunFrom] = useState('');
  const [runTo, setRunTo] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);

  const triggerRun = async () => {
    const invalid = validateRunNowRange(runFrom, runTo, maxRunNowRangeDays);
    if (invalid) {
      setRangeError(invalid);
      setRun({ kind: 'idle' });
      return;
    }
    setRangeError(null);
    setRun({ kind: 'busy' });
    try {
      // No range → no body at all, so the request the server sees is
      // byte-identical to the one it has always received.
      await runAggregationNow(
        runFrom && runTo ? { dateFrom: runFrom, dateTo: runTo } : undefined,
      );
      setRun({
        kind: 'done',
        message:
          runFrom && runTo
            ? t('intel.ops.runAcceptedRange', { from: runFrom, to: runTo })
            : t('intel.ops.runAccepted'),
      });
    } catch {
      setRun({ kind: 'failed' });
    }
  };

  const triggerReload = async () => {
    setReload({ kind: 'busy' });
    try {
      const version = await reloadTierConfig();
      setReload({ kind: 'done', message: t('intel.ops.reloaded', { version }) });
      onReloaded();
    } catch {
      setReload({ kind: 'failed' });
    }
  };

  return (
    <section className="mt-8 border-t pt-6" data-testid="intel-ops-panel">
      <h2 className="text-lg font-bold mb-1">{t('intel.ops.title')}</h2>
      <p className="text-sm text-gray-500 mb-4">{t('intel.ops.subtitle')}</p>

      {config && (
        <table className="w-full text-sm mb-4" data-testid="intel-tier-config-table">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="py-2 pr-3">{t('intel.ops.tier')}</th>
              <th className="py-2 pr-3">{t('intel.ops.cellSize')}</th>
              <th className="py-2 pr-3">{t('intel.ops.bucket')}</th>
              <th className="py-2 pr-3">{t('intel.ops.kThreshold')}</th>
              <th className="py-2 pr-3">{t('intel.ops.attributes')}</th>
              <th className="py-2 pr-3">{t('intel.ops.cells')}</th>
              <th className="py-2 pr-3">{t('intel.ops.points')}</th>
            </tr>
          </thead>
          <tbody>
            {ALL_TIERS.map((tier) => (
              <tr key={tier} className="border-b" data-testid="intel-tier-config-row">
                <td className="py-2 pr-3 font-mono">{tier}</td>
                <td className="py-2 pr-3 font-mono">{config[tier]?.cellSizeMeters} m</td>
                <td className="py-2 pr-3 font-mono">{config[tier]?.bucketMinutes} min</td>
                <td className="py-2 pr-3 font-mono">{config[tier]?.kThreshold}</td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {(config[tier]?.attributes ?? []).join(' ') || '—'}
                </td>
                <td className="py-2 pr-3 font-mono">{stats?.[tier]?.cells ?? '—'}</td>
                <td className="py-2 pr-3 font-mono">{stats?.[tier]?.totalPoints ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {classificationVersion && (
        <p className="text-xs text-gray-500 mb-4">
          {t('intel.ops.classificationVersion', { version: classificationVersion })}
        </p>
      )}

      {/* The range. Empty is the default and is not an error — it is
          the lookback run this button has always performed. */}
      <div className="flex flex-wrap gap-3 items-end mb-3">
        <label className="text-xs text-gray-500">
          <span className="block mb-1">{t('intel.ops.rangeFrom')}</span>
          <input
            type="date"
            value={runFrom}
            onChange={(e) => {
              setRunFrom(e.target.value);
              setRangeError(null);
            }}
            data-testid="intel-run-from"
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-gray-500">
          <span className="block mb-1">{t('intel.ops.rangeTo')}</span>
          <input
            type="date"
            value={runTo}
            onChange={(e) => {
              setRunTo(e.target.value);
              setRangeError(null);
            }}
            data-testid="intel-run-to"
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </label>
        {(runFrom || runTo) && (
          <button
            type="button"
            onClick={() => {
              setRunFrom('');
              setRunTo('');
              setRangeError(null);
            }}
            data-testid="intel-run-range-clear"
            className="px-2 py-1 text-xs text-gray-500 underline"
          >
            {t('intel.ops.rangeClear')}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={() => void triggerRun()}
          disabled={run.kind === 'busy'}
          data-testid="intel-run-now"
          className="px-3 py-1 rounded bg-[#1B4F72] text-white text-sm disabled:opacity-50"
        >
          {run.kind === 'busy' ? t('intel.ops.running') : t('intel.ops.runNow')}
        </button>
        <button
          type="button"
          onClick={() => void triggerReload()}
          disabled={reload.kind === 'busy'}
          data-testid="intel-reload-config"
          className="px-3 py-1 rounded border border-gray-300 bg-white text-sm disabled:opacity-50"
        >
          {reload.kind === 'busy' ? t('intel.ops.reloading') : t('intel.ops.reload')}
        </button>
      </div>

      <p className="text-xs text-gray-500 mt-2">
        {maxRunNowRangeDays != null
          ? t('intel.ops.runNowNoteCapped', { days: maxRunNowRangeDays })
          : t('intel.ops.runNowNote')}
      </p>

      {rangeError && (
        <p className="text-sm text-red-700 mt-2" data-testid="intel-run-range-error">
          {t(rangeError, { days: maxRunNowRangeDays ?? 0 })}
        </p>
      )}

      {run.kind === 'done' && (
        <p className="text-sm text-green-700 mt-2" data-testid="intel-run-result">
          {run.message}
        </p>
      )}
      {run.kind === 'failed' && (
        <p className="text-sm text-red-700 mt-2" data-testid="intel-run-failed">
          {t('intel.ops.runFailed')}
        </p>
      )}
      {reload.kind === 'done' && (
        <p className="text-sm text-green-700 mt-2" data-testid="intel-reload-result">
          {reload.message}
        </p>
      )}
      {reload.kind === 'failed' && (
        <p className="text-sm text-red-700 mt-2" data-testid="intel-reload-failed">
          {t('intel.ops.reloadFailed')}
        </p>
      )}
    </section>
  );
};

export default IntelOpsPanel;
