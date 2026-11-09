import React from 'react';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AdminConflictDetail from '../AdminConflictDetail';

const FIXTURES: Record<string, Record<string, unknown>> = {
  JOURNEY_RECONCILIATION: {
    journey: { id: 'j1', status: 'DISPUTED' },
    responses: [{ userId: 'u1', verdict: 'COMPLETED' }],
    gpsPoints: [{ lat: -1.95, lng: 30.06 }],
    escrow: { status: 'HELD' },
  },
  AML_APPEAL: { flag: { id: 'f1', reason: 'velocity' } },
  BID_MANIPULATION: { bids: [{ id: 'b1' }] },
  GPS_PLAUSIBILITY: { trace: [{ lat: 0, lng: 0 }] },
  STALE_DRIVER_NO_SHOW: { driver: { id: 'd1' }, lastHeartbeat: null },
  PHOTO_MISMATCH: { reference: 'r.jpg', candidate: 'c.jpg' },
  GRAPH_ANOMALY: { actors: ['a', 'b', 'c'] },
};

function makeOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as any;
}

function make404() {
  return { ok: false, status: 404, json: async () => ({}) } as any;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderAt = (type: string, id: string) =>
  render(
    <MemoryRouter initialEntries={[`/admin/conflicts/${type}/${id}`]}>
      <Routes>
        <Route
          path="/admin/conflicts/:type/:id"
          element={<AdminConflictDetail />}
        />
      </Routes>
    </MemoryRouter>,
  );

describe('AdminConflictDetail', () => {
  for (const type of Object.keys(FIXTURES)) {
    test(`renders without throwing for ${type} fixture`, async () => {
      (globalThis as any).fetch = vi.fn(async () =>
        makeOk({
          detail: {
            id: 'x1',
            type,
            summary: `${type} summary`,
            createdAt: new Date().toISOString(),
            data: FIXTURES[type],
          },
          validDecisions: ['NO_ACTION'],
        }),
      );

      renderAt(type, 'x1');

      await waitFor(() =>
        expect(screen.getByText(`${type} summary`)).toBeInTheDocument(),
      );
      expect(
        screen.getByRole('button', { name: /Decide this conflict/i }),
      ).toBeInTheDocument();
    });
  }

  test('ErrorBoundary catches a thrown render error and falls back to raw JSON', async () => {
    // Make DataView's per-key JSON.stringify call throw, but let the
    // fallback's outer JSON.stringify succeed so the fallback can render.
    // DataView passes the inner value (e.g. { ok: true }); the fallback
    // passes the outer { boom: ... } object — discriminate by structure.
    const originalStringify = JSON.stringify.bind(JSON);
    const stringifySpy = vi
      .spyOn(JSON, 'stringify')
      .mockImplementation(((value: unknown, replacer?: any, space?: any) => {
        if (
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          !('boom' in (value as Record<string, unknown>))
        ) {
          throw new Error('synthetic render error');
        }
        return originalStringify(value as any, replacer, space);
      }) as any);

    (globalThis as any).fetch = vi.fn(async () =>
      makeOk({
        detail: {
          id: 'cx',
          type: 'JOURNEY_RECONCILIATION',
          summary: 'crashy',
          createdAt: new Date().toISOString(),
          data: { boom: { ok: true } },
        },
        validDecisions: ['NO_ACTION'],
      }),
    );

    // Suppress noisy error logs from React's error handling.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderAt('JOURNEY_RECONCILIATION', 'cx');

    await waitFor(() =>
      expect(screen.getByText(/Detail rendering failed/i)).toBeInTheDocument(),
    );

    stringifySpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('404 from the detail endpoint renders "Conflict not found"', async () => {
    (globalThis as any).fetch = vi.fn(async () => make404());

    renderAt('JOURNEY_RECONCILIATION', 'missing');

    await waitFor(() =>
      expect(screen.getByText(/Conflict not found/i)).toBeInTheDocument(),
    );
  });
});
