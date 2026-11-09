// __TESTS__/BASE-TILE-LAYER.TEST.TSX
//
// MAP-TRUTH G2 — the shared base layer: which layer gets picked, and
// that tile failure is reported BOTH ways.
//
// On main, MapCanvas latched `tilesFailed` to true and never cleared it,
// so one six-error burst (measured: exactly one screenful at z14) grayed
// the map for the rest of the component's life even after tiles came
// back. The recovery test below fails on main.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

type Handlers = { tileerror?: () => void; tileload?: () => void };
let captured: Handlers = {};

vi.mock('react-leaflet', () => ({
  TileLayer: ({ url, eventHandlers }: { url: string; eventHandlers: Handlers }) => {
    captured = eventHandlers;
    return <div data-testid="osm-tile-layer" data-url={url} />;
  },
}));

vi.mock('../components/map/OfflineMapLayer', () => ({
  OfflineMapLayer: () => <div data-testid="offline-map-layer" />,
}));

const useOfflineMapMock = vi.fn((): unknown => null);
vi.mock('../hooks/useOfflineMap', () => ({
  useOfflineMap: () => useOfflineMapMock(),
  // MAP-RWANDA G4 — BaseTileLayer now asks for every cached archive and
  // lets the layer pick the covering one. These suites control a single
  // "is anything cached" knob, so the plural view is derived from it.
  useOfflineMaps: () => {
    const m = useOfflineMapMock();
    return m ? [{ region: 'kigali', pmtiles: m }] : [];
  },
  useMapCacheResolved: () => true,
}));

import { BaseTileLayer } from '../components/map/BaseTileLayer';
import { OSM_TILE_URL, TILE_ERROR_THRESHOLD } from '../components/map/tile-source';
import { act } from '@testing-library/react';

beforeEach(() => {
  captured = {};
  useOfflineMapMock.mockReset().mockReturnValue(null);
});

describe('BaseTileLayer (MAP-TRUTH G2)', () => {
  test('no cached extract → OSM raster at the canonical URL', () => {
    render(<BaseTileLayer />);
    const layer = screen.getByTestId('osm-tile-layer');
    expect(layer).toHaveAttribute('data-url', OSM_TILE_URL);
    expect(screen.queryByTestId('offline-map-layer')).not.toBeInTheDocument();
  });

  test('cached extract → offline layer, zero network tiles', () => {
    useOfflineMapMock.mockReturnValue({ fake: 'pmtiles' });
    render(<BaseTileLayer />);
    expect(screen.getByTestId('offline-map-layer')).toBeInTheDocument();
    expect(screen.queryByTestId('osm-tile-layer')).not.toBeInTheDocument();
  });

  test('a screenful of tile errors reports failure exactly once', () => {
    const onChange = vi.fn();
    render(<BaseTileLayer onTilesFailedChange={onChange} />);

    act(() => {
      for (let i = 0; i < TILE_ERROR_THRESHOLD; i++) captured.tileerror?.();
    });
    expect(onChange).toHaveBeenCalledWith(true);
    expect(onChange).toHaveBeenCalledTimes(1);

    // Still failing — no repeat chatter.
    act(() => captured.tileerror?.());
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('below the threshold, nothing is reported', () => {
    const onChange = vi.fn();
    render(<BaseTileLayer onTilesFailedChange={onChange} />);
    act(() => {
      for (let i = 0; i < TILE_ERROR_THRESHOLD - 1; i++) captured.tileerror?.();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  test('tiles recovering reports false — the latch is gone', () => {
    const onChange = vi.fn();
    render(<BaseTileLayer onTilesFailedChange={onChange} />);

    act(() => {
      for (let i = 0; i < TILE_ERROR_THRESHOLD; i++) captured.tileerror?.();
    });
    expect(onChange).toHaveBeenLastCalledWith(true);

    act(() => captured.tileload?.());
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  test('a successful load resets the error budget', () => {
    const onChange = vi.fn();
    render(<BaseTileLayer onTilesFailedChange={onChange} />);

    act(() => {
      for (let i = 0; i < TILE_ERROR_THRESHOLD - 1; i++) captured.tileerror?.();
      captured.tileload?.();
      captured.tileerror?.();
    });
    // The budget restarted, so one more error is nowhere near failing.
    expect(onChange).not.toHaveBeenCalledWith(true);
  });
});
