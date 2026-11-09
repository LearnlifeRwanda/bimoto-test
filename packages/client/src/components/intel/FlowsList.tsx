// COMPONENTS/INTEL/FLOWS-LIST.TSX
//
// INTEL-DECK G5 — the OD matrix as a ranked table.
//
// v1 renders flows as a list and highlights both hexes on the map when
// a row is selected. No arcs: an arc layer over a hex field is a
// legibility problem before it is a rendering one, and the question an
// analyst actually asks first — "which corridors are strongest this
// week" — is a sorted table's question.
//
// The cell ids are sha256 hashes with no coordinates in them, by design
// (grid.ts). They are shown truncated, as identifiers to compare rather
// than places to read; the map is where a flow becomes a place.

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Flow } from '../../lib/intel-api';

export interface FlowsListProps {
  flows: Flow[];
  selectedRowId: string | null;
  onSelect: (rowId: string) => void;
}

const shortId = (id: string) => id.slice(0, 8);

export const FlowsList: React.FC<FlowsListProps> = ({ flows, selectedRowId, onSelect }) => {
  const { t } = useTranslation();

  if (flows.length === 0) {
    return (
      <p className="text-sm text-gray-500" data-testid="intel-flows-empty">
        {t('intel.flows.empty')}
      </p>
    );
  }

  return (
    <table className="w-full text-sm" data-testid="intel-flows-table">
      <thead>
        <tr className="text-left text-gray-500 border-b">
          <th className="py-2 pr-3">{t('intel.flows.origin')}</th>
          <th className="py-2 pr-3">{t('intel.flows.destination')}</th>
          <th className="py-2 pr-3">{t('intel.flows.count')}</th>
          <th className="py-2 pr-3">{t('intel.flows.share')}</th>
          <th className="py-2 pr-3">{t('intel.flows.window')}</th>
        </tr>
      </thead>
      <tbody>
        {flows.map((flow) => (
          <tr
            key={flow.rowId}
            className={`border-b cursor-pointer ${
              flow.rowId === selectedRowId ? 'bg-blue-50' : ''
            }`}
            onClick={() => onSelect(flow.rowId)}
            data-testid="intel-flow-row"
          >
            <td className="py-2 pr-3 font-mono">{shortId(flow.originCellId)}</td>
            <td className="py-2 pr-3 font-mono">
              {shortId(flow.destCellId)}
              {flow.destTier && flow.destTier !== flow.tier && (
                <span className="ml-2 text-xs text-gray-500">{flow.destTier}</span>
              )}
            </td>
            <td className="py-2 pr-3 font-mono">{flow.count}</td>
            <td className="py-2 pr-3 font-mono">{(flow.share * 100).toFixed(1)}%</td>
            <td className="py-2 pr-3 font-mono text-xs">
              {new Date(flow.bucketStart).toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default FlowsList;
