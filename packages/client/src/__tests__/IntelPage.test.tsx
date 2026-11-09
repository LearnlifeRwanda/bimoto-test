// INTEL-DECK G5 — the reading room, rendered.
//
// The things that must be true on screen: hexagons appear for cells that
// survived, tapping one shows its count and its SANITIZED splits, the
// empty state names the privacy threshold rather than looking like a
// failure, the OD view ranks flows, the export control asks for the view
// being looked at, and the ops panel exists for an admin and not for an
// analyst.
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import './setup';
import i18n from 'i18next';
import enTranslation from '../../public/locales/en/translation.json';
import IntelPage from '../pages/intel/IntelPage';
import { useAuthStore } from '../stores/auth.store';

// The shared setup registers a minimal stub; load the REAL shipped
// English strings for this namespace so the assertions below are about
// what a person actually reads, not about key names.
i18n.addResourceBundle(
  'en',
  'translation',
  { intel: (enTranslation as Record<string, unknown>).intel },
  true,
  true,
);

const polygons: any[] = [];

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  Polygon: (props: any) => {
    polygons.push(props);
    return (
      <div
        data-testid="hex"
        data-vertices={props.positions.length}
        onClick={() => props.eventHandlers?.click?.()}
      />
    );
  },
  useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn() }),
  useMapEvents: () => ({}),
}));
vi.mock('leaflet', () => ({ default: { divIcon: () => ({}) }, divIcon: () => ({}) }));
vi.mock('../components/map/BaseTileLayer', () => ({ BaseTileLayer: () => null }));

const apiFetch = vi.fn();
vi.mock('../lib/api', () => ({
  apiFetch: (...args: any[]) => apiFetch(...args),
  isConnectivityError: () => false,
}));

const TIER_CONFIG = {
  config: {
    DENSE: { tier: 'DENSE', cellSizeMeters: 250, bucketMinutes: 30, kThreshold: 20, attributes: ['VEHICLE_TYPE'] },
    MEDIUM: { tier: 'MEDIUM', cellSizeMeters: 500, bucketMinutes: 60, kThreshold: 15, attributes: [] },
    LOW: { tier: 'LOW', cellSizeMeters: 1000, bucketMinutes: 120, kThreshold: 10, attributes: [] },
    SPARSE: { tier: 'SPARSE', cellSizeMeters: 5000, bucketMinutes: 240, kThreshold: 10, attributes: [] },
  },
  classificationVersion: '1.0',
};

function densityRow(over: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    tier: 'DENSE',
    aggregateType: 'POINT_DENSITY',
    cellId: 'cell-aaaa1111',
    cellCenterLat: -1.9441,
    cellCenterLng: 30.0619,
    bucketStart: '2026-05-01T08:00:00.000Z',
    bucketEnd: '2026-05-01T08:30:00.000Z',
    count: 24,
    attributesJson: { vehicleTypes: { MOTO: 24 }, hourBuckets: { 8: 24 } },
    ...over,
  };
}

function odRow(over: Record<string, unknown> = {}) {
  return {
    id: 'od-1',
    tier: 'DENSE',
    aggregateType: 'OD_MATRIX',
    cellId: 'pair-hash-1',
    cellCenterLat: -1.9441,
    cellCenterLng: 30.0619,
    bucketStart: '2026-05-01T08:00:00.000Z',
    bucketEnd: '2026-05-01T08:30:00.000Z',
    count: 30,
    attributesJson: {
      originCellId: 'origin-aaaa1111',
      destCellId: 'dest-bbbb2222',
      originCenterLat: -1.9441,
      originCenterLng: 30.0619,
      destCenterLat: -1.949,
      destCenterLng: 30.09,
      destTier: 'DENSE',
      vehicleTypes: { MOTO: 30 },
    },
    ...over,
  };
}

function respond(rows: any[], exportText = 'header\n') {
  apiFetch.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/admin/mobility/tier-config')) {
      return { ok: true, json: async () => TIER_CONFIG } as any;
    }
    if (path.startsWith('/api/admin/mobility/aggregates/stats')) {
      return {
        ok: true,
        json: async () => ({
          stats: {
            DENSE: { cells: 3, totalPoints: 90 },
            MEDIUM: { cells: 0, totalPoints: 0 },
            LOW: { cells: 0, totalPoints: 0 },
            SPARSE: { cells: 0, totalPoints: 0 },
          },
        }),
      } as any;
    }
    if (path.startsWith('/api/admin/mobility/aggregates')) {
      return { ok: true, json: async () => ({ rows }) } as any;
    }
    if (path.startsWith('/api/intel/aggregates/export')) {
      return { ok: true, text: async () => exportText } as any;
    }
    throw new Error(`unexpected call ${path}`);
  });
}

function signIn(role: string) {
  useAuthStore.setState({
    user: { id: 'u1', nickname: 'A', role, language: 'en' } as any,
    isAuthenticated: true,
    isLoading: false,
    offlineSession: null,
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <IntelPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  polygons.length = 0;
  apiFetch.mockReset();
  signIn('ANALYST');
});

describe('IntelPage — density', () => {
  test('draws one hexagon per surviving cell, with six corners each', async () => {
    respond([densityRow(), densityRow({ id: 'row-2', cellId: 'cell-bbbb', count: 40 })]);
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('hex')).toHaveLength(2));
    for (const hex of screen.getAllByTestId('hex')) {
      expect(hex.getAttribute('data-vertices')).toBe('6');
    }
  });

  test('the busiest cell is drawn strongest', async () => {
    respond([densityRow({ count: 10 }), densityRow({ id: 'row-2', cellId: 'c2', count: 40 })]);
    renderPage();
    await waitFor(() => expect(polygons.length).toBeGreaterThanOrEqual(2));
    const [quiet, busy] = polygons;
    expect(busy.pathOptions.fillOpacity).toBeGreaterThan(quiet.pathOptions.fillOpacity);
  });

  test('tapping a hexagon reveals its count and its splits', async () => {
    respond([densityRow()]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId('hex')).toBeTruthy());
    expect(screen.getByTestId('intel-cell-detail-empty')).toBeTruthy();
    fireEvent.click(screen.getByTestId('hex'));
    await waitFor(() => expect(screen.getByTestId('intel-cell-count').textContent).toBe('24'));
    expect(screen.getByTestId('intel-cell-detail').textContent).toContain('MOTO');
  });

  test('a folded category is labelled as a fold, not as a vehicle', async () => {
    respond([densityRow({ attributesJson: { vehicleTypes: { other: 24 } } })]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId('hex')).toBeTruthy());
    fireEvent.click(screen.getByTestId('hex'));
    await waitFor(() =>
      expect(screen.getByTestId('intel-cell-detail').textContent).toContain('other (folded)'),
    );
  });

  test('an empty window blames the privacy threshold, not the network', async () => {
    respond([]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId('intel-empty')).toBeTruthy());
    expect(screen.getByTestId('intel-empty').textContent).toBe(
      'No cells cleared the privacy threshold here.',
    );
    expect(screen.queryByTestId('intel-load-failed')).toBeNull();
  });

  test('a failed load says so, distinctly from an empty one', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/admin/mobility/tier-config')) {
        return { ok: true, json: async () => TIER_CONFIG } as any;
      }
      return { ok: false, status: 500 } as any;
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('intel-load-failed')).toBeTruthy());
    expect(screen.queryByTestId('intel-empty')).toBeNull();
  });

  test('the grain note states the cell size, bucket and k of the chosen tier', async () => {
    respond([densityRow()]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('intel-grain-note').textContent).toContain('250 m'),
    );
    expect(screen.getByTestId('intel-grain-note').textContent).toContain('30 min');
    expect(screen.getByTestId('intel-grain-note').textContent).toContain('20 movements');
  });
});

describe('IntelPage — flows', () => {
  test('switching to Flows asks for OD_MATRIX and ranks the pairs', async () => {
    respond([odRow(), odRow({ id: 'od-2', count: 10, attributesJson: { ...odRow().attributesJson, destCellId: 'dest-cccc' } })]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId('intel-view-flows')).toBeTruthy());
    fireEvent.click(screen.getByTestId('intel-view-flows'));
    await waitFor(() => expect(screen.getByTestId('intel-flows-table')).toBeTruthy());
    const rows = screen.getAllByTestId('intel-flow-row');
    expect(rows).toHaveLength(2);
    // Ranked: 30 before 10.
    expect(rows[0].textContent).toContain('30');
    expect(rows[0].textContent).toContain('75.0%');
    expect(apiFetch.mock.calls.some(([p]) => String(p).includes('aggregateType=OD_MATRIX'))).toBe(true);
  });

  test('selecting a flow outlines both of its hexes', async () => {
    respond([odRow()]);
    renderPage();
    fireEvent.click(screen.getByTestId('intel-view-flows'));
    await waitFor(() => expect(screen.getByTestId('intel-flows-table')).toBeTruthy());
    const before = polygons.length;
    fireEvent.click(screen.getAllByTestId('intel-flow-row')[0]);
    await waitFor(() => expect(polygons.length).toBeGreaterThan(before));
    const dashed = polygons.filter((p) => p.pathOptions.dashArray);
    expect(dashed).toHaveLength(2);
  });

  test('an OD window with no surviving pair says the stricter threshold refused them', async () => {
    respond([]);
    renderPage();
    fireEvent.click(screen.getByTestId('intel-view-flows'));
    await waitFor(() => expect(screen.getByTestId('intel-empty')).toBeTruthy());
  });
});

describe('IntelPage — export', () => {
  test('Export this view asks for the same tier, type and window as the screen', async () => {
    respond([densityRow()], 'tier,aggregateType\nDENSE,POINT_DENSITY\n');
    renderPage();
    await waitFor(() => expect(screen.getByTestId('intel-export-csv')).toBeTruthy());
    fireEvent.click(screen.getByTestId('intel-export-csv'));
    await waitFor(() => expect(screen.getByTestId('intel-export-output')).toBeTruthy());
    const call = apiFetch.mock.calls.map(([p]) => String(p)).find((p) => p.includes('/api/intel/aggregates/export'));
    expect(call).toContain('tier=DENSE');
    expect(call).toContain('aggregateType=POINT_DENSITY');
    expect(call).toContain('format=csv');
  });

  test('a failed export says so', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/admin/mobility/tier-config')) {
        return { ok: true, json: async () => TIER_CONFIG } as any;
      }
      if (path.startsWith('/api/intel/aggregates/export')) return { ok: false, status: 500 } as any;
      return { ok: true, json: async () => ({ rows: [densityRow()] }) } as any;
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('intel-export-csv')).toBeTruthy());
    fireEvent.click(screen.getByTestId('intel-export-csv'));
    await waitFor(() => expect(screen.getByTestId('intel-export-failed')).toBeTruthy());
  });
});

describe('IntelPage — the ops panel is for admins', () => {
  test('an ANALYST never sees it, and never asks for stats', async () => {
    respond([densityRow()]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId('hex')).toBeTruthy());
    expect(screen.queryByTestId('intel-ops-panel')).toBeNull();
    expect(apiFetch.mock.calls.some(([p]) => String(p).includes('/stats'))).toBe(false);
  });

  test('an ADMIN sees the tier config, the range stats and both levers', async () => {
    signIn('ADMIN');
    respond([densityRow()]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId('intel-ops-panel')).toBeTruthy());
    expect(screen.getAllByTestId('intel-tier-config-row')).toHaveLength(4);
    expect(screen.getByTestId('intel-run-now')).toBeTruthy();
    expect(screen.getByTestId('intel-reload-config')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('intel-tier-config-table').textContent).toContain('90'),
    );
  });

  test('run-now reports honestly when the server accepts it', async () => {
    signIn('ADMIN');
    respond([densityRow()]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId('intel-run-now')).toBeTruthy());
    apiFetch.mockImplementationOnce(async () => ({ ok: true, json: async () => ({}) }) as any);
    fireEvent.click(screen.getByTestId('intel-run-now'));
    await waitFor(() => expect(screen.getByTestId('intel-run-result')).toBeTruthy());
  });
});
