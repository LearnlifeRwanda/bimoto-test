// COMPONENTS/INTEL/DENSITY-MAP.TSX
//
// INTEL-DECK G5 — Kigali as hexagons.
//
// Every polygon here is a mobility cell that cleared its tier's
// k-threshold, drawn at the exact shape grid.ts snapped it to (see
// lib/hex-geometry.ts on why the projection inverse is per-vertex).
// Darker means busier, relative to the busiest cell in this view.
//
// Composition, not tile surgery: MapContainer + the shared
// BaseTileLayer, the same pairing RoutePreviewMap uses, plus a Polygon
// layer. Nothing in components/map is modified, and the offline extract
// keeps working underneath because BaseTileLayer decides that, as it
// does for every other surface.

import React from 'react';
import { MapContainer, Polygon } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { BaseTileLayer } from '../map/BaseTileLayer';
import { hexVertices, intensity, intensityFill } from '../../lib/hex-geometry';
import type { AggregateRow } from '../../lib/intel-api';

const KIGALI_CENTER = { lat: -1.9441, lng: 30.0619 };
const DEFAULT_ZOOM = 12;

export interface DensityMapProps {
  rows: AggregateRow[];
  /** Metres per cell for the tier being shown — from the tier config. */
  cellSizeMeters: number;
  selectedCellId: string | null;
  onSelectCell: (cellId: string) => void;
  /** Cells to outline regardless of selection (a flow's two endpoints). */
  highlightCellIds?: string[];
  /** Extra polygons that are not rows — a flow's destination hexes. */
  extraCells?: Array<{ id: string; lat: number; lng: number; cellSizeMeters: number }>;
}

export const DensityMap: React.FC<DensityMapProps> = ({
  rows,
  cellSizeMeters,
  selectedCellId,
  onSelectCell,
  highlightCellIds = [],
  extraCells = [],
}) => {
  const maxCount = rows.reduce((max, r) => Math.max(max, r.count), 0);
  const highlighted = new Set(highlightCellIds);

  return (
    <div className="h-[420px] rounded-lg overflow-hidden border border-gray-200" data-testid="intel-density-map">
      <MapContainer
        center={[KIGALI_CENTER.lat, KIGALI_CENTER.lng]}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <BaseTileLayer />
        {rows.map((row) => {
          const fill = intensityFill(intensity(row.count, maxCount));
          const isSelected = row.cellId === selectedCellId;
          const isHighlighted = highlighted.has(row.cellId);
          return (
            <Polygon
              key={row.id}
              positions={hexVertices(row.cellCenterLat, row.cellCenterLng, cellSizeMeters)}
              pathOptions={{
                color: isSelected || isHighlighted ? '#B03A2E' : fill.color,
                weight: isSelected || isHighlighted ? 3 : 1,
                fillColor: fill.color,
                fillOpacity: fill.fillOpacity,
              }}
              eventHandlers={{ click: () => onSelectCell(row.cellId) }}
            />
          );
        })}
        {extraCells.map((cell) => (
          <Polygon
            key={`extra-${cell.id}`}
            positions={hexVertices(cell.lat, cell.lng, cell.cellSizeMeters)}
            pathOptions={{
              color: '#B03A2E',
              weight: 3,
              fillColor: '#B03A2E',
              fillOpacity: 0.15,
              dashArray: '6 4',
            }}
          />
        ))}
      </MapContainer>
    </div>
  );
};

export default DensityMap;
