import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminPayoutDriver from '../AdminPayoutDriver';

const DRIVER_ID = 'driver-1';

const ACTIVE_DRIVER = {
  driver: { id: DRIVER_ID, nickname: 'Driver One', phone: '+250788111111', role: 'DRIVER' },
  pendingAmount: 12500,
  storedPreference: 'AT_SHIFT_END',
  effectivePreference: 'TWICE_DAILY',
  trainingWheelsActive: true,
  freeze: { frozenAt: null, frozenReason: null, frozenBy: null, frozenCategory: null },
  batches: [
    {
      id: 'b-1',
      amount: 5000,
      status: 'SUCCESS',
      trigger: 'SCHEDULED_22H',
      failureReason: null,
      createdAt: '2026-07-01T22:00:00Z',
      paidOutAt: '2026-07-01T22:01:00Z',
      held: false,
      heldReason: null,
    },
  ],
};

const FROZEN_DRIVER = {
  ...ACTIVE_DRIVER,
  freeze: {
    frozenAt: '2026-07-01T10:00:00Z',
    frozenReason: 'AML critical pattern detected',
    frozenBy: 'admin-1',
    frozenCategory: 'AML_CRITICAL',
  },
};

let fetchMock: ReturnType<typeof vi.fn>;

const EMPTY_WAIVERS = {
  waivers: [],
  counters: { lifetimeUsed: 3, lifetimeMax: 12, temporaryUsed: 41, temporaryMax: 500 },
};

function mockFetch(driverView: any, waiverView: any = EMPTY_WAIVERS) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/admin/payouts/driver/')) {
      return { ok: true, status: 200, json: async () => driverView } as any;
    }
    // LAUNCH-TRUTH G2 — waiver panel load + grant/extend/revoke posts.
    if (String(url).includes('/api/admin/fee-waivers')) {
      if (init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            waiver: {
              id: 'fw-1',
              type: 'TEMPORARY',
              campaign: 'PILOT_500',
              expiresAt: '2027-01-13T00:00:00Z',
            },
          }),
        } as any;
      }
      return { ok: true, status: 200, json: async () => waiverView } as any;
    }
    if (String(url).includes('/freeze')) {
      const isUnfreeze = String(url).endsWith('/unfreeze');
      return {
        ok: true,
        status: 200,
        json: async () =>
          isUnfreeze
            ? { adminAction: { id: 'aa-2' }, releasedBatchCount: 3 }
            : { adminAction: { id: 'aa-1' }, heldBatchCount: 2 },
      } as any;
    }
    if (String(url).includes('/revoke')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          profile: { verificationStatus: 'REVOKED' },
          adminAction: { id: 'aa-3', action: 'REVOKE_DRIVER' },
          withdrawnBidCount: 1,
          settlement: { batchId: 'batch-9', amount: 12500, deferredForFreeze: false },
        }),
      } as any;
    }
    throw new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
  });
  vi.stubGlobal('fetch', fetchMock);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/admin/payouts/driver/${DRIVER_ID}`]}>
      <Routes>
        <Route path="/admin/payouts/driver/:driverId" element={<AdminPayoutDriver />} />
      </Routes>
    </MemoryRouter>,
  );

function freezePosts(): [string, RequestInit][] {
  return fetchMock.mock.calls
    .filter((c: any[]) => (c[1] as RequestInit | undefined)?.method === 'POST')
    .map((c: any[]) => [String(c[0]), c[1] as RequestInit]);
}

describe('AdminPayoutDriver', () => {
  test('renders balance, preferences, freeze state and batches', async () => {
    mockFetch(ACTIVE_DRIVER);
    renderPage();
    await waitFor(() => expect(screen.getByText('Driver One')).toBeInTheDocument());
    expect(screen.getByText('12,500')).toBeInTheDocument();
    expect(screen.getByText('Effective: TWICE_DAILY')).toBeInTheDocument();
    expect(
      screen.getByText(/Stored: AT_SHIFT_END\s*\(training wheels active\)/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('freeze-state')).toHaveTextContent('Active');
    expect(screen.getByText('5,000')).toBeInTheDocument();
    expect(screen.getByText('SUCCESS')).toBeInTheDocument();
  });

  test('shows heldReason-style freeze detail for a frozen driver', async () => {
    mockFetch(FROZEN_DRIVER);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('freeze-state')).toHaveTextContent('Frozen (AML_CRITICAL)'),
    );
    expect(screen.getByText('AML critical pattern detected')).toBeInTheDocument();
    expect(screen.getByText(/by admin-1/)).toBeInTheDocument();
  });

  test('confirmation gate: no POST fires until Confirm is clicked; Cancel aborts', async () => {
    mockFetch(ACTIVE_DRIVER);
    renderPage();
    await waitFor(() => expect(screen.getByText('Driver One')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Action reason'), {
      target: { value: 'Suspicious payout pattern under review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Freeze driver…' }));
    expect(screen.getByTestId('confirm-box')).toBeInTheDocument();
    expect(freezePosts()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('confirm-box')).not.toBeInTheDocument();
    expect(freezePosts()).toHaveLength(0);
  });

  test('freeze posts the validated body shape and surfaces heldBatchCount', async () => {
    mockFetch(ACTIVE_DRIVER);
    renderPage();
    await waitFor(() => expect(screen.getByText('Driver One')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Freeze category'), {
      target: { value: 'FRAUD_SUSPECTED' },
    });
    fireEvent.change(screen.getByLabelText('Action reason'), {
      target: { value: 'Suspicious payout pattern under review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Freeze driver…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm freeze' }));
    await waitFor(() =>
      expect(
        screen.getByText('Driver frozen — 2 pending batch(es) held.'),
      ).toBeInTheDocument(),
    );
    const posts = freezePosts();
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toContain(`/api/admin/freeze/${DRIVER_ID}/freeze`);
    expect(JSON.parse(String(posts[0][1].body))).toEqual({
      reason: 'Suspicious payout pattern under review',
      category: 'FRAUD_SUSPECTED',
    });
  });

  test('freeze button stays disabled while the reason is under 10 characters', async () => {
    mockFetch(ACTIVE_DRIVER);
    renderPage();
    await waitFor(() => expect(screen.getByText('Driver One')).toBeInTheDocument());
    const button = screen.getByRole('button', { name: 'Freeze driver…' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Action reason'), {
      target: { value: 'short' },
    });
    expect(button).toBeDisabled();
  });

  test('unfreeze without releasePayouts posts releasePayouts: false', async () => {
    mockFetch(FROZEN_DRIVER);
    renderPage();
    await waitFor(() => expect(screen.getByText('Driver One')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Action reason'), {
      target: { value: 'Review complete, no findings' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unfreeze driver…' }));
    expect(screen.getByTestId('confirm-box')).toHaveTextContent(
      'Held batches will stay held.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unfreeze' }));
    await waitFor(() =>
      expect(
        screen.getByText('Driver unfrozen — 3 held batch(es) released.'),
      ).toBeInTheDocument(),
    );
    const posts = freezePosts();
    expect(posts[0][0]).toContain(`/api/admin/freeze/${DRIVER_ID}/unfreeze`);
    expect(JSON.parse(String(posts[0][1].body))).toEqual({
      reason: 'Review complete, no findings',
      releasePayouts: false,
    });
  });

  test('unfreeze with releasePayouts checked posts releasePayouts: true', async () => {
    mockFetch(FROZEN_DRIVER);
    renderPage();
    await waitFor(() => expect(screen.getByText('Driver One')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Action reason'), {
      target: { value: 'Cleared by compliance review' },
    });
    fireEvent.click(screen.getByLabelText('Release held payouts'));
    fireEvent.click(screen.getByRole('button', { name: 'Unfreeze driver…' }));
    expect(screen.getByTestId('confirm-box')).toHaveTextContent(
      'Held batches WILL be released.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unfreeze' }));
    await waitFor(() => expect(freezePosts()).toHaveLength(1));
    expect(JSON.parse(String(freezePosts()[0][1].body))).toEqual({
      reason: 'Cleared by compliance review',
      releasePayouts: true,
    });
  });

  // DRIVER-ID v3 G2 — revoke action on the per-driver admin view.
  test('revoke: reason gate, confirm gate, POST body, outcome banner', async () => {
    mockFetch(ACTIVE_DRIVER);
    renderPage();
    await waitFor(() => expect(screen.getByText('Driver One')).toBeInTheDocument());

    const revokeBtn = screen.getByRole('button', { name: 'Revoke driver…' });
    expect(revokeBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Revocation reason'), {
      target: { value: 'RURA authorization withdrawn by regulator' },
    });
    expect(revokeBtn).not.toBeDisabled();

    fireEvent.click(revokeBtn);
    expect(screen.getByTestId('revoke-confirm-box')).toBeInTheDocument();
    const revokePosts = () =>
      fetchMock.mock.calls.filter(
        (c: any[]) =>
          (c[1] as RequestInit | undefined)?.method === 'POST' &&
          String(c[0]).includes('/revoke'),
      );
    expect(revokePosts()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() => expect(revokePosts()).toHaveLength(1));
    expect(String(revokePosts()[0][0])).toContain(
      `/api/admin/verifications/${DRIVER_ID}/revoke`,
    );
    expect(JSON.parse(String((revokePosts()[0][1] as RequestInit).body))).toEqual({
      reason: 'RURA authorization withdrawn by regulator',
    });
    await waitFor(() =>
      expect(
        screen.getByText(/Driver revoked — 1 open bid\(s\) withdrawn, 12,500 RWF settlement fired\./),
      ).toBeInTheDocument(),
    );
  });

  // LAUNCH-TRUTH G2 — fee-waiver panel.
  const ACTIVE_WAIVER_VIEW = {
    waivers: [
      {
        id: 'fw-9',
        driverId: DRIVER_ID,
        type: 'TEMPORARY',
        campaign: 'PILOT_500',
        grantedAt: '2026-07-01T00:00:00Z',
        expiresAt: '2099-01-01T00:00:00Z',
        extensionCount: 0,
        revokedAt: null,
        reason: 'Pilot cooperative MOU driver',
      },
    ],
    counters: { lifetimeUsed: 3, lifetimeMax: 12, temporaryUsed: 42, temporaryMax: 500 },
  };

  test('waiver panel shows campaign counters and the no-waiver state', async () => {
    mockFetch(ACTIVE_DRIVER);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('fee-waiver-counters')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('fee-waiver-counters')).toHaveTextContent(
      'Lifetime: 3/12 · Temporary: 41/500',
    );
    expect(screen.getByTestId('fee-waiver-none')).toBeInTheDocument();
  });

  test('grant: reason+confirm gates, POST body includes type/campaign/reason', async () => {
    mockFetch(ACTIVE_DRIVER);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('fee-waiver-panel')).toBeInTheDocument(),
    );
    const grantBtn = await screen.findByRole('button', { name: 'Grant waiver…' });
    expect(grantBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Waiver action reason'), {
      target: { value: 'Pilot cooperative MOU test driver' },
    });
    expect(grantBtn).not.toBeDisabled();

    const grantPosts = () =>
      fetchMock.mock.calls.filter(
        (c: any[]) =>
          (c[1] as RequestInit | undefined)?.method === 'POST' &&
          String(c[0]).includes('/grant'),
      );
    fireEvent.click(grantBtn);
    expect(screen.getByTestId('waiver-confirm-box')).toBeInTheDocument();
    expect(grantPosts()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm grant' }));
    await waitFor(() => expect(grantPosts()).toHaveLength(1));
    expect(String(grantPosts()[0][0])).toContain(
      `/api/admin/fee-waivers/driver/${DRIVER_ID}/grant`,
    );
    expect(JSON.parse(String((grantPosts()[0][1] as RequestInit).body))).toEqual({
      type: 'TEMPORARY',
      campaign: 'PILOT_500',
      reason: 'Pilot cooperative MOU test driver',
    });
  });

  test('active temporary waiver renders horizon and offers extend + revoke, not grant', async () => {
    mockFetch(ACTIVE_DRIVER, ACTIVE_WAIVER_VIEW);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('fee-waiver-current')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('fee-waiver-current')).toHaveTextContent(
      'Temporary waiver — no commission until',
    );
    expect(screen.queryByRole('button', { name: 'Grant waiver…' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Extend waiver…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke waiver…' })).toBeInTheDocument();
  });

  test('waiver revoke posts to the waiver id and shows the forward-only outcome', async () => {
    mockFetch(ACTIVE_DRIVER, ACTIVE_WAIVER_VIEW);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('fee-waiver-current')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText('Waiver action reason'), {
      target: { value: 'Driver left the pilot cooperative' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Revoke waiver…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() =>
      expect(
        screen.getByText(/Waiver revoked \(forward-only — rides already waived stay waived\)\./),
      ).toBeInTheDocument(),
    );
    const posts = fetchMock.mock.calls.filter(
      (c: any[]) =>
        (c[1] as RequestInit | undefined)?.method === 'POST' &&
        String(c[0]).includes('/api/admin/fee-waivers/fw-9/revoke'),
    );
    expect(posts).toHaveLength(1);
  });
});
