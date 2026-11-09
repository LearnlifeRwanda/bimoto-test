import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminPayouts from '../AdminPayouts';

const SUMMARY = {
  last24h: {
    byStatus: { PENDING: 1, SUCCESS: 4, FAILED: 2 },
    byTrigger: { SCHEDULED_22H: 5, SHIFT_END: 2 },
  },
  last7d: {
    byStatus: { PENDING: 1, SUCCESS: 30, FAILED: 3 },
    byTrigger: { SCHEDULED_22H: 20, SHIFT_END: 14 },
  },
  stuckPendingCount: 0,
  reversedCount7d: 0,
  heldCount: 3,
  frozenDriverCount: 1,
  openAmlFlags: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
  openAmlFlagCount: 0,
  stuckThresholdMinutes: 30,
};

const BATCH = {
  id: 'batch-1',
  driverId: 'driver-1',
  amount: 5000,
  status: 'SUCCESS',
  trigger: 'SCHEDULED_22H',
  failureReason: null,
  createdAt: '2026-07-01T22:00:00Z',
  paidOutAt: '2026-07-01T22:01:00Z',
  held: false,
  heldReason: null,
  driver: { id: 'driver-1', nickname: 'Driver One', phone: '+250788111111' },
};

let fetchMock: ReturnType<typeof vi.fn>;

function mockFetch({
  summary = SUMMARY,
  batches = [BATCH],
  total = 1,
}: { summary?: any; batches?: any[]; total?: number } = {}) {
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('/summary')) {
      return { ok: true, status: 200, json: async () => summary } as any;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ batches, total, limit: 50, offset: 0 }),
    } as any;
  });
  vi.stubGlobal('fetch', fetchMock);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <AdminPayouts />
    </MemoryRouter>,
  );

function batchCalls(): string[] {
  return fetchMock.mock.calls
    .map((c: any[]) => String(c[0]))
    .filter((u: string) => u.includes('/batches'));
}

describe('AdminPayouts', () => {
  beforeEach(() => mockFetch());

  test('renders the summary strip with counts', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('tile-stuck')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('tile-failed24h')).toHaveTextContent('2');
    expect(screen.getByTestId('tile-held')).toHaveTextContent('3');
    expect(screen.getByTestId('tile-frozen')).toHaveTextContent('1');
    // Zero stuck / zero reversals → no attention flag anywhere.
    expect(screen.queryByText(/attention/)).not.toBeInTheDocument();
  });

  test('flags non-zero stuck and reversal counts', async () => {
    mockFetch({
      summary: { ...SUMMARY, stuckPendingCount: 4, reversedCount7d: 2 },
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('tile-stuck')).toHaveTextContent('4'),
    );
    expect(screen.getByTestId('tile-stuck')).toHaveTextContent('attention');
    expect(screen.getByTestId('tile-reversals')).toHaveTextContent('attention');
    expect(screen.getByTestId('tile-stuck').className).toContain('bg-red-50');
  });

  test('open review flags tile shows counts and links to the flagged-users surface', async () => {
    mockFetch({
      summary: {
        ...SUMMARY,
        openAmlFlags: { LOW: 1, MEDIUM: 0, HIGH: 3, CRITICAL: 2 },
        openAmlFlagCount: 6,
      },
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('tile-openAmlFlags')).toBeInTheDocument(),
    );
    const tile = screen.getByTestId('tile-openAmlFlags');
    expect(tile).toHaveTextContent('6');
    expect(tile).toHaveTextContent('2 critical');
    expect(tile).toHaveTextContent('attention');
    expect(tile.closest('a')).toHaveAttribute('href', '/admin/flagged');
  });

  test('renders batch rows with driver info and a driver-view link', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Driver One')).toBeInTheDocument());
    expect(screen.getByText('+250788111111')).toBeInTheDocument();
    expect(screen.getByText('5,000')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Driver One' });
    expect(link).toHaveAttribute('href', '/admin/payouts/driver/driver-1');
  });

  test('marks FAILED batches with paidOutAt set as reversed', async () => {
    mockFetch({
      batches: [
        { ...BATCH, id: 'b-rev', status: 'FAILED', failureReason: 'transfer reversed' },
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('(reversed)')).toBeInTheDocument());
  });

  test('changing the status filter re-queries with status in the query string', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Driver One')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Status filter'), {
      target: { value: 'FAILED' },
    });
    await waitFor(() => {
      const urls = batchCalls();
      expect(urls[urls.length - 1]).toContain('status=FAILED');
    });
    fireEvent.change(screen.getByLabelText('Held filter'), {
      target: { value: 'true' },
    });
    await waitFor(() => {
      const urls = batchCalls();
      expect(urls[urls.length - 1]).toContain('held=true');
    });
  });

  test('pagination: Next advances the offset, Previous returns', async () => {
    mockFetch({ total: 120 });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      const urls = batchCalls();
      expect(urls[urls.length - 1]).toContain('offset=50');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => {
      const urls = batchCalls();
      expect(urls[urls.length - 1]).toContain('offset=0');
    });
  });

  test('filter change resets pagination to the first page', async () => {
    mockFetch({ total: 120 });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(batchCalls().some((u) => u.includes('offset=50'))).toBe(true));
    fireEvent.change(screen.getByLabelText('Trigger filter'), {
      target: { value: 'SHIFT_END' },
    });
    await waitFor(() => {
      const urls = batchCalls();
      expect(urls[urls.length - 1]).toContain('trigger=SHIFT_END');
      expect(urls[urls.length - 1]).toContain('offset=0');
    });
  });

  test('shows the designed empty state when no batches match', async () => {
    mockFetch({ batches: [], total: 0 });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('No payout batches')).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Nothing matches these filters/),
    ).toBeInTheDocument();
  });
});
