import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminConflicts from '../AdminConflicts';

const ALL_TYPES = [
  'JOURNEY_RECONCILIATION',
  'AML_APPEAL',
  'BID_MANIPULATION',
  'GPS_PLAUSIBILITY',
  'STALE_DRIVER_NO_SHOW',
  'PHOTO_MISMATCH',
  'GRAPH_ANOMALY',
  'DRIVER_NO_SHOW_DISPUTE',
  'RECIPIENT_DISPUTE',
];

function makeOkResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as any;
}

function makeErrorResponse() {
  return { ok: false, status: 500, json: async () => ({}) } as any;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <AdminConflicts />
    </MemoryRouter>,
  );

describe('AdminConflicts', () => {
  test('renders all 9 conflict-type cards', async () => {
    (globalThis as any).fetch = vi.fn(async () =>
      makeOkResponse({
        counts: ALL_TYPES.map((type) => ({ type, count: 0 })),
      }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText('Conflicts')).toBeInTheDocument());
    expect(screen.getByText('Journey Reconciliation')).toBeInTheDocument();
    expect(screen.getByText('AML Appeal')).toBeInTheDocument();
    expect(screen.getByText('Bid Manipulation')).toBeInTheDocument();
    expect(screen.getByText('GPS Plausibility')).toBeInTheDocument();
    expect(screen.getByText('Stale Driver / No-Show')).toBeInTheDocument();
    expect(screen.getByText('Photo Mismatch')).toBeInTheDocument();
    expect(screen.getByText('Graph Anomaly')).toBeInTheDocument();
    expect(screen.getByText('Driver No-Show Dispute')).toBeInTheDocument();
    expect(screen.getByText('Recipient Disputes')).toBeInTheDocument();
  });

  test('Recipient Disputes tile links to the RECIPIENT_DISPUTE list', async () => {
    (globalThis as any).fetch = vi.fn(async () =>
      makeOkResponse({
        counts: [{ type: 'RECIPIENT_DISPUTE', count: 2 }],
      }),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText('Recipient Disputes')).toBeInTheDocument(),
    );
    const tile = screen.getByText('Recipient Disputes').closest('a')!;
    expect(tile.getAttribute('href')).toBe('/admin/conflicts/RECIPIENT_DISPUTE');
    expect(tile.className).toContain('bg-red-50');
  });

  test('count of 0 renders gray-styled card; > 0 renders red', async () => {
    (globalThis as any).fetch = vi.fn(async () =>
      makeOkResponse({
        counts: [
          { type: 'JOURNEY_RECONCILIATION', count: 3 },
          { type: 'AML_APPEAL', count: 0 },
        ],
      }),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText('Journey Reconciliation')).toBeInTheDocument(),
    );

    const journeyLink = screen.getByText('Journey Reconciliation').closest('a')!;
    const amlLink = screen.getByText('AML Appeal').closest('a')!;
    expect(journeyLink.className).toContain('bg-red-50');
    expect(amlLink.className).toContain('bg-gray-50');
  });

  test('error state renders error message', async () => {
    (globalThis as any).fetch = vi.fn(async () => makeErrorResponse());

    renderPage();

    await waitFor(() =>
      expect(
        screen.getByText(/Error: Failed to load conflicts/i),
      ).toBeInTheDocument(),
    );
  });

  test('audit-log link is present', async () => {
    (globalThis as any).fetch = vi.fn(async () =>
      makeOkResponse({ counts: [] }),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/View Audit Log/i)).toBeInTheDocument(),
    );
    const link = screen.getByText(/View Audit Log/i).closest('a')!;
    expect(link.getAttribute('href')).toBe('/admin/conflicts/audit');
  });
});
