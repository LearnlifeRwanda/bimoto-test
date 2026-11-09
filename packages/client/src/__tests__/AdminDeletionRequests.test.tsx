// ACCOUNT-RIGHTS-SURFACE G6 — ops can see WHY a due deletion has not run.
//
// The screen exists for one column. A PENDING request whose executesAt is
// in the past looks, from outside, exactly like a broken job; the deferral
// reason is what tells an operator it is not broken and what to go and
// clear. So the reason rendering is what this suite pins, in every shape
// it arrives in — including the unknown code, which must still show
// something rather than swallow a row.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { DEFERRAL_REASONS } from '@bimoto/shared';

const apiFetch = vi.fn();
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

import AdminDeletionRequests from '../pages/admin/AdminDeletionRequests';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'req-1',
  userId: 'u1',
  nickname: 'Chantal',
  status: 'PENDING',
  requestedAt: '2026-08-20T10:00:00.000Z',
  executesAt: '2026-08-23T10:00:00.000Z',
  cancelledAt: null,
  executedAt: null,
  deferredReason: null,
  ...over,
});

const respond = (requests: unknown[]) =>
  apiFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ requests }) });

beforeEach(() => {
  apiFetch.mockReset();
});

describe('AdminDeletionRequests', () => {
  test('reads the admin endpoint with credentials', async () => {
    respond([]);
    render(<AdminDeletionRequests />);
    await waitFor(() => expect(screen.getByText('No deletion requests')).toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/admin/deletion-requests',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  test('shows a pending row with its real nickname — requesters are not anonymised yet', async () => {
    respond([row()]);
    render(<AdminDeletionRequests />);
    await waitFor(() => expect(screen.getByTestId('deletion-request-req-1')).toBeInTheDocument());
    expect(screen.getByText('Chantal')).toBeInTheDocument();
    expect(screen.getByTestId('deletion-status-req-1')).toHaveTextContent('PENDING');
    // No reason on a row that is simply not due yet.
    expect(screen.queryByTestId('deletion-reason-req-1')).toBeNull();
  });

  test.each(DEFERRAL_REASONS.map((r) => [r]))(
    'renders the %s deferral with its operator gloss',
    async (reason) => {
      respond([row({ deferredReason: reason })]);
      render(<AdminDeletionRequests />);
      const cell = await screen.findByTestId('deletion-reason-req-1');
      // The code itself, so it can be searched for in logs...
      expect(cell).toHaveTextContent(reason);
      // ...and a gloss, so it can be acted on without a schema lookup.
      expect(cell.textContent!.length).toBeGreaterThan(reason.length + 3);
    },
  );

  test('an unrecognised code still renders rather than blanking the row', async () => {
    respond([row({ deferredReason: 'SOMETHING_NEW' })]);
    render(<AdminDeletionRequests />);
    const cell = await screen.findByTestId('deletion-reason-req-1');
    // Ops is the audience here, not a user: a bare code they can escalate
    // beats a row that silently drops the only column that explains it.
    expect(cell).toHaveTextContent('SOMETHING_NEW');
  });

  test('renders executed and cancelled rows alongside open ones', async () => {
    respond([
      row({ id: 'req-1', status: 'PENDING', deferredReason: 'LIVE_ESCROW' }),
      row({
        id: 'req-2',
        status: 'CANCELLED',
        nickname: 'Jean',
        cancelledAt: '2026-08-21T08:00:00.000Z',
      }),
      row({
        id: 'req-3',
        status: 'EXECUTED',
        nickname: 'Deleted User',
        executedAt: '2026-08-23T10:05:00.000Z',
      }),
    ]);
    render(<AdminDeletionRequests />);

    await waitFor(() => expect(screen.getByTestId('deletion-request-req-3')).toBeInTheDocument());
    expect(screen.getByTestId('deletion-status-req-2')).toHaveTextContent('CANCELLED');
    // The erased row reads "Deleted User" — the anonymisation showing
    // through, which is correct and not a rendering bug.
    expect(screen.getByText('Deleted User')).toBeInTheDocument();
    expect(screen.getByTestId('deletion-reason-req-1')).toBeInTheDocument();
    expect(screen.queryByTestId('deletion-reason-req-3')).toBeNull();
  });

  test('a failed fetch leaves an empty list rather than a broken screen', async () => {
    apiFetch.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<AdminDeletionRequests />);
    await waitFor(() => expect(screen.getByText('No deletion requests')).toBeInTheDocument());
  });
});
