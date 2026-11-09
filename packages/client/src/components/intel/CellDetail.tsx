// COMPONENTS/INTEL/CELL-DETAIL.TSX
//
// INTEL-DECK G5 — what one hexagon says when you tap it.
//
// A count, and the marginal splits the suppression gate allowed through,
// as plain proportional bars (no chart library — a div with a width is a
// bar). `other` is rendered explicitly and labelled as the fold it is,
// because that is the honest thing: an analyst looking at
// "MOTO 30 / other 22" should understand that the platform declined to
// break the remainder down, not wonder what "other" means.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { marginalBars } from '../../lib/intel-api';
import type { AggregateRow } from '../../lib/intel-api';

export interface CellDetailProps {
  row: AggregateRow | null;
  /** The tier's k threshold, so the screen can say why the cell exists. */
  kThreshold: number;
}

const MARGINALS: Array<{ key: string; labelKey: string }> = [
  { key: 'vehicleTypes', labelKey: 'intel.marginal.vehicleTypes' },
  { key: 'hourBuckets', labelKey: 'intel.marginal.hourBuckets' },
  { key: 'fareDecileCounts', labelKey: 'intel.marginal.fareDeciles' },
];

const Bars: React.FC<{ entries: Array<[string, number]>; otherLabel: string }> = ({
  entries,
  otherLabel,
}) => {
  const max = entries.reduce((m, [, v]) => Math.max(m, v), 0);
  return (
    <div className="space-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 font-mono text-gray-600">
            {key === 'other' ? otherLabel : key}
          </span>
          <span className="flex-1 bg-gray-100 rounded h-3 overflow-hidden">
            <span
              className={`block h-3 ${key === 'other' ? 'bg-gray-400' : 'bg-[#1B4F72]'}`}
              style={{ width: `${max > 0 ? Math.round((value / max) * 100) : 0}%` }}
            />
          </span>
          <span className="w-10 shrink-0 text-right font-mono">{value}</span>
        </div>
      ))}
    </div>
  );
};

export const CellDetail: React.FC<CellDetailProps> = ({ row, kThreshold }) => {
  const { t } = useTranslation();

  if (!row) {
    return (
      <p className="text-sm text-gray-500" data-testid="intel-cell-detail-empty">
        {t('intel.cell.tapPrompt')}
      </p>
    );
  }

  const present = MARGINALS.map((m) => ({ ...m, entries: marginalBars(row.attributesJson, m.key) }))
    .filter((m) => m.entries.length > 0);

  return (
    <div className="space-y-3" data-testid="intel-cell-detail">
      <div>
        <div className="text-xs text-gray-500 font-mono break-all">{row.cellId}</div>
        <div className="text-2xl font-bold" data-testid="intel-cell-count">
          {row.count}
        </div>
        <div className="text-xs text-gray-500">
          {t('intel.cell.window', {
            from: new Date(row.bucketStart).toLocaleString(),
            to: new Date(row.bucketEnd).toLocaleTimeString(),
          })}
        </div>
        <div className="text-xs text-gray-500">{t('intel.cell.threshold', { k: kThreshold })}</div>
      </div>

      {present.length === 0 && (
        <p className="text-xs text-gray-500" data-testid="intel-cell-no-marginals">
          {t('intel.cell.noMarginals')}
        </p>
      )}

      {present.map((m) => (
        <div key={m.key}>
          <div className="text-xs font-semibold text-gray-700 mb-1">{t(m.labelKey)}</div>
          <Bars entries={m.entries} otherLabel={t('intel.marginal.other')} />
        </div>
      ))}
    </div>
  );
};

export default CellDetail;
