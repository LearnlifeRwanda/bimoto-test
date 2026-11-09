import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import enLocale from '../../../../public/locales/en/translation.json';
import { i18n } from '../../../__tests__/setup';
import AdminFunnel from '../AdminFunnel';

// The global test setup ships a minimal i18n bundle for chat/common.
// AdminFunnel reads from the admin.funnel.* namespace, so we layer
// those keys in (read directly from the en translation.json so the
// test stays in sync with the locale source-of-truth).
i18n.addResource('en', 'translation', 'admin', (enLocale as any).admin);

const SAMPLE_RESULT = {
  weekOf: '2026-W30',
  filters: {},
  funnel: {
    registered: [10, 20, 30, 40, 50],
    screenerQualified: [4, 8, 12, 16, 20],
    onboarded: [4, 8, 12, 16, 20],
    active: [2, 4, 6, 8, 10],
  },
  operational: {
    timeToFirstBidMedianMinutes: [3, 2.5, 2.2, 2.1, 2.0],
    bidsPerRideMean: [3.5, 4.0, 4.2, 4.5, 5.0],
    acceptanceRate: [0.5, 0.55, 0.6, 0.65, 0.7],
    cancellationRate: [0.2, 0.18, 0.15, 0.12, 0.1],
    parcelRecipientConfirmationRate: [0.3, 0.4, 0.5, 0.6, 0.85],
    offlineSyncSuccessRate: [1, 1, 1, 1, 1],
  },
  meta: { computedAt: '2026-07-21T00:00:00Z' },
};

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as any;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => okResponse(SAMPLE_RESULT)));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <AdminFunnel />
    </MemoryRouter>,
  );

describe('AdminFunnel', () => {
  test('renders 4 funnel-step cards with the current-week values', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Pilot Funnel')).toBeInTheDocument());
    expect(screen.getByText('Registered')).toBeInTheDocument();
    expect(screen.getByText('Screener-qualified')).toBeInTheDocument();
    expect(screen.getByText('Onboarded')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    // Current-week values
    expect(screen.getByText('50')).toBeInTheDocument(); // registered[4]
    // 20 appears in both screenerQualified[4] and onboarded[4] — assert
    // there are exactly 2 matches.
    expect(screen.getAllByText('20').length).toBe(2);
    expect(screen.getByText('10')).toBeInTheDocument(); // active[4]
  });

  test('renders 6 operational metric cards with values', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Time-to-first-bid (median)')).toBeInTheDocument());
    expect(screen.getByText('Bids per ride (mean)')).toBeInTheDocument();
    expect(screen.getByText('Acceptance rate')).toBeInTheDocument();
    expect(screen.getByText('Cancellation rate')).toBeInTheDocument();
    expect(screen.getByText('Parcel recipient SMS-confirm rate')).toBeInTheDocument();
    expect(screen.getByText('Offline-sync success rate')).toBeInTheDocument();
    expect(screen.getByText('70.0%')).toBeInTheDocument(); // acceptance
    expect(screen.getByText('10.0%')).toBeInTheDocument(); // cancellation
  });

  test('city-band filter change refetches data', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Pilot Funnel')).toBeInTheDocument());
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const callsBefore = fetchMock.mock.calls.length;
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'kigali_dense' } });
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    const lastCallUrl = fetchMock.mock.calls.at(-1)?.[0] as string;
    expect(lastCallUrl).toContain('cityBand=kigali_dense');
  });

  test('cooperative filter change refetches data with the new value', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Pilot Funnel')).toBeInTheDocument());
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const callsBefore = fetchMock.mock.calls.length;
    const input = screen.getByPlaceholderText('All cooperatives');
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    fireEvent.change(input, { target: { value: uuid } });
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    const lastCallUrl = fetchMock.mock.calls.at(-1)?.[0] as string;
    expect(lastCallUrl).toContain(`cooperativeId=${uuid}`);
  });

  test('CSV export button points at the export endpoint with current filters', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Export CSV')).toBeInTheDocument());
    const link = screen.getByText('Export CSV').closest('a')!;
    const href = link.getAttribute('href')!;
    expect(href).toContain('/api/admin/funnel/export.csv?');
    expect(href).toContain('weekOf=');
  });
});
